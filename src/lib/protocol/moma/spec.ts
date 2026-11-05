/**
 * Engine glue for Moma families (docs/FAMILIES.md §3.3): the request and message types the 6201, 6303 and
 * 6701 drivers run on `FamilyDevice<MomaRequest, MomaMessage>`, and `createMomaSpecBase()`, which fills the
 * framing half of a ProtocolSpec (encode, parseRequest, assembler, matches, ack, commandOf, describe…).
 * Families add probe / heartbeat / onMessage / encodeSet / controls / timing:
 *
 *   const base = createMomaSpecBase(MOMA_6303, { commands: COMMANDS_6303 })
 *   const spec: ProtocolSpec<MomaRequest, MomaMessage> = {
 *     ...base,
 *     probe: () => momaRequest(0x6000),
 *     heartbeat: { request: () => momaRequest(0x6000), intervalMs: 1500 },
 *     onMessage(ctx, msg) { if (msg.cmd === 0x6000) … },
 *     …
 *   }
 *
 * Correlation is by 16-bit command id, as in both apps (no sequence numbers: m3-6303.md §4 #5,
 * melo-6201.md §3.1, max2-6701.md §3.1). Families whose replies echo a unit id add `matchItem`.
 */
import type { Safety } from '../commands'
import { hex16 } from '../core/bytes'
import { toHex } from '../codec'
import type { CommandCatalogue, MessageAssembler, ProtocolSpec } from '../core/types'
import {
  encodeMomaFrame, MomaFrameAssembler, MOMA_ID, MOMA_TYPE, parseMomaPacket, type MomaFrame, type MomaItemInput,
} from './codec'
import type { MomaProfile } from './profiles'

// --------------------------------------------------------------------------------- request / message

/** A host request: one frame with one item (usually) or a batch. */
export interface MomaRequest {
  readonly items: readonly MomaItemInput[]
  /** Target byte; default the profile's (6701 BLE: per unit; 6701 USB "get all": 0). */
  readonly target?: number
}

/** One command item of a received frame (a multi-item reply becomes several messages, in order). */
export interface MomaMessage {
  readonly cmd: number
  readonly type: number
  readonly payload: Uint8Array
  /** Position among the frame's command items (markers excluded). */
  readonly index: number
  /** Command items in the frame. */
  readonly count: number
  readonly frame: MomaFrame
}

/** Single-item request (type REQUEST). GETs usually have no payload; some take a unit id (0x600A [unit]). */
export function momaRequest(cmd: number, payload: ArrayLike<number> = [], o: { target?: number } = {}): MomaRequest {
  return { items: [{ cmd, payload: Array.from(payload) }], ...(o.target !== undefined ? { target: o.target } : {}) }
}

/**
 * Multi-item request ("get all": A BleMicCmd.getMicBoxAllInfo, A Protocol6201Provider.buildBatchRequest,
 * I +[HL6201Messenger requestCommandArr:…]). Items are numbers (empty GET) or full items.
 */
export function momaBatch(items: readonly (number | MomaItemInput)[], o: { target?: number } = {}): MomaRequest {
  if (!items.length) throw new RangeError('a Moma batch needs at least one item')
  return {
    items: items.map((it) => (typeof it === 'number' ? { cmd: it } : it)),
    ...(o.target !== undefined ? { target: o.target } : {}),
  }
}

/** Split a frame into per-item messages. */
export function momaMessages(frame: MomaFrame): MomaMessage[] {
  return frame.items.map((it, index) => ({ cmd: it.cmd, type: it.type, payload: it.payload, index, count: frame.items.length, frame }))
}

/** Encode a request with a profile (report id, control, padding, default target). */
export function encodeMomaRequest(profile: MomaProfile, req: MomaRequest): Uint8Array {
  return encodeMomaFrame(req.items, {
    reportId: profile.reportId, target: req.target ?? profile.target, control: profile.control, padTo: profile.padTo,
  })
}

/**
 * Inverse of encodeMomaRequest (ProtocolSpec.parseRequest, used by the console's sendRaw, and by
 * simulators): an AA DD frame in this profile's framing (same control byte, report id present exactly when
 * the profile has one) whose items are all REQUEST items, plus optional zero padding. The engine re-encodes
 * a parsed request, so anything that would not re-encode to the same frame (another profile's framing) is
 * refused with null; a wrong XOR byte is corrected on re-encoding.
 */
export function parseMomaRequest(profile: MomaProfile, frame: Uint8Array): MomaRequest | null {
  if ((profile.reportId !== null) !== (frame.length > 0 && frame[0] === profile.reportId)) return null
  const f = parseMomaPacket(frame, { reportId: profile.reportId, heads: 'down' })
  if (!f || f.control !== profile.control || !f.items.length || f.items.some((it) => it.type !== MOMA_TYPE.REQUEST)) return null
  return {
    items: f.items.map((it) => ({ cmd: it.cmd, type: it.type, payload: Array.from(it.payload) })),
    ...(f.target !== profile.target ? { target: f.target } : {}),
  }
}

export interface MomaAssemblerExtras {
  /**
   * Keep items that are our own requests coming back (AA DD, type REQUEST; e.g. a GATT characteristic used
   * for both directions, MAX 2 FEC1). Default false: they are dropped so onMessage never parses a request
   * payload as device state; `echoes` counts them.
   */
  keepEchoes?: boolean
}

/** Assembler for the engine: frames from MomaFrameAssembler, split into one message per item. */
export class MomaAssembler implements MessageAssembler<MomaMessage> {
  onGarbage?: (bytes: Uint8Array) => void
  /** Echoed request items dropped so far. */
  echoes = 0
  private readonly frames: MomaFrameAssembler
  private readonly keepEchoes: boolean

  constructor(profileOrReportId: MomaProfile | number | null = null, o: MomaAssemblerExtras = {}) {
    const reportId = typeof profileOrReportId === 'object' && profileOrReportId !== null ? profileOrReportId.reportId : profileOrReportId
    this.keepEchoes = o.keepEchoes === true
    this.frames = new MomaFrameAssembler({ reportId, heads: 'both' })
    this.frames.onGarbage = (b) => this.onGarbage?.(b)
  }

  push(chunk: Uint8Array): MomaMessage[] {
    const msgs = this.frames.push(chunk).flatMap(momaMessages)
    if (this.keepEchoes) return msgs
    const kept = msgs.filter((m) => !isMomaEcho(m))
    this.echoes += msgs.length - kept.length
    return kept
  }

  reset(): void {
    this.frames.reset()
  }
}

// ------------------------------------------------------------------------------------- spec helpers

/** Severity order used to classify a batch by its riskiest item (unknown ids rank highest). */
const RISK: Readonly<Record<Safety, number>> = { read: 0, write: 1, disruptive: 2, notify: 3, destructive: 4, ota: 5 }

/**
 * Catalogue key of a request for the engine's safety and retry rules: the item itself, or for a batch
 * the riskiest item (an uncatalogued item wins, so the engine refuses the whole frame in request(), and a
 * forced sendRaw refuses it on an untested product). A batch of reads is a read; one destructive item makes
 * the frame destructive. The engine also checks every catalogued item on its own (commandsOf), so the
 * ranking is not the only safeguard.
 */
export function momaCommandOf(req: MomaRequest, commands?: CommandCatalogue): number {
  if (!req.items.length) return -1
  if (req.items.length === 1 || !commands) return req.items[0].cmd
  let best = req.items[0].cmd
  let bestRisk = -1
  for (const it of req.items) {
    const info = commands[it.cmd]
    const r = info ? RISK[info.safety] : 99
    if (r > bestRisk) {
      best = it.cmd
      bestRisk = r
    }
  }
  return best
}

/**
 * Set acknowledgement as the apps decode it: `payload[0] == SetResult.SUCCESS (0)` (A DeviceControlConstant
 * .SetResult; A BleMicCommUtil.generateSetResponse; I seprateDataWithCmdNum `cbz` on the first payload byte),
 * whatever the item type. A reply without payload is a failure (the apps' decoders throw on it).
 */
export function momaStatusAck(msg: MomaMessage): { ok: boolean; code: number | null } {
  const code = msg.payload.length ? msg.payload[0] : null
  return { ok: code === 0, code }
}

/** An AA DD item of type REQUEST: our own frame coming back (BLE characteristics used for both directions). */
export function isMomaEcho(msg: MomaMessage): boolean {
  return msg.frame.head === 'down' && msg.type === MOMA_TYPE.REQUEST
}

const TYPE_NAME: Readonly<Record<number, string>> = { 0: 'notify', 1: 'request', 2: 'ack', 3: 'data' }

/** Display name of an envelope address (A DeviceIdentify; TX3/TX4 from BleMicCmd). */
export function momaIdName(id: number): string {
  switch (id) {
    case MOMA_ID.BROADCAST: return 'broadcast'
    case MOMA_ID.PHONE_RX: return 'phone RX'
    case MOMA_ID.CAMERA_RX: return 'camera RX'
    case MOMA_ID.TX1: return 'TX1'
    case MOMA_ID.TX2: return 'TX2'
    case MOMA_ID.BOX: return 'BOX'
    case MOMA_ID.PHONE_APP: return 'app'
    case MOMA_ID.TX3: return 'TX3'
    case MOMA_ID.TX4: return 'TX4'
    default: return `id ${id}`
  }
}

function payloadText(p: ArrayLike<number>): string {
  if (!p.length) return ''
  const shown = Array.from(p).slice(0, 16)
  return ` [${toHex(shown)}${p.length > 16 ? ` … ${p.length} B` : ''}]`
}

export interface MomaDescribeOptions {
  commands?: CommandCatalogue
  /** Profile target; requests to another target name it. */
  defaultTarget?: number
}

function itemName(cmd: number, commands?: CommandCatalogue): string {
  const n = commands?.[cmd]?.name
  return n ? `${n} ${hex16(cmd)}` : hex16(cmd)
}

/** Traffic-log text for a request or a received item. */
export function describeMoma(x: MomaRequest | MomaMessage, o: MomaDescribeOptions = {}): string {
  if ('items' in x) {
    const items = x.items.map((it) => `${itemName(it.cmd, o.commands)}${payloadText(it.payload ?? [])}`)
    const to = x.target !== undefined && x.target !== o.defaultTarget ? ` → ${momaIdName(x.target)}` : ''
    return x.items.length === 1 ? `${items[0]}${to}` : `batch ${x.items.length}: ${items.join(', ')}${to}`
  }
  const part = x.count > 1 ? ` (${x.index + 1}/${x.count})` : ''
  const type = TYPE_NAME[x.type] ?? `type ${x.type}`
  const status = x.type === MOMA_TYPE.EXEC_RESP && x.payload.length === 1 ? (x.payload[0] === 0 ? ' ok' : ` fail ${x.payload[0]}`) : payloadText(x.payload)
  const notes = x.index === x.count - 1 && x.frame.anomalies.length ? ` ⚠ ${x.frame.anomalies.join('; ')}` : ''
  const echo = isMomaEcho(x) ? ' (echo of a request)' : ''
  return `${itemName(x.cmd, o.commands)} ${type}${status}${part}${echo}${notes}`
}

export interface MomaSpecOptions {
  /** Family catalogue: names for describe(); batches are classified by their riskiest item. */
  commands?: CommandCatalogue
  /**
   * Extra per-item correlation beyond the command id, e.g. replies that echo the requested unit in
   * payload[0] (M3 0x1F04 txPosition, m3-6303.md §4 #5). Default: the command id alone.
   */
  matchItem?: (item: MomaItemInput, msg: MomaMessage, req: MomaRequest) => boolean
  /** Write acknowledgement; default momaStatusAck (payload[0] == 0). */
  ack?: (req: MomaRequest, msg: MomaMessage) => { ok: boolean; code: number | null }
  /** Queue coalescing key; default target + command ids (per-unit setters should add the unit). */
  coalesceKey?: (req: MomaRequest) => string
}

export type MomaSpecBase = Required<
  Pick<
    ProtocolSpec<MomaRequest, MomaMessage>,
    'encode' | 'parseRequest' | 'createAssembler' | 'matches' | 'ack' | 'commandOf' | 'commandsOf' | 'coalesceKey' | 'describe' | 'rawOf'
  >
>

/**
 * The framing half of a Moma family's ProtocolSpec for one profile (create one per product / link).
 *
 * matches():
 *  - our own echoed request items never match (isMomaEcho; the assembler drops them unless keepEchoes);
 *  - single-item request: 'done' on the first item with the same command id (and `matchItem`);
 *  - batch: 'partial' per requested item, 'done' once every requested id was seen, or on the last requested
 *    item of a multi-item reply frame (the device answered the batch in one frame, possibly leaving items
 *    out: A BleMicCommUtil.parseNotifyResult and Protocol6201Provider.parseBatchResponse take what is there).
 *    The apps send batches with HashMap order (max2-6701.md §3.3), so replies may come in any order.
 *
 * rawOf(): the whole frame for single-item frames, the item bytes for items of a multi-item frame, so the
 * engine's duplicate filter (same bytes within a short window) never drops a sibling item.
 */
export function createMomaSpecBase(profile: MomaProfile, o: MomaSpecOptions = {}): MomaSpecBase {
  const seen = new WeakMap<MomaRequest, Set<number>>()
  const describeOpts: MomaDescribeOptions = { commands: o.commands, defaultTarget: profile.target }
  return {
    encode: (req) => encodeMomaRequest(profile, req),
    parseRequest: (frame) => parseMomaRequest(profile, frame),
    createAssembler: () => new MomaAssembler(profile),
    matches(req, msg) {
      if (isMomaEcho(msg)) return false
      const hit = req.items.some((it) => it.cmd === msg.cmd && (o.matchItem?.(it, msg, req) ?? true))
      if (!hit) return false
      if (req.items.length === 1) return 'done'
      let s = seen.get(req)
      if (!s) seen.set(req, (s = new Set()))
      s.add(msg.cmd)
      const requested = (cmd: number) => req.items.some((it) => it.cmd === cmd)
      const lastOfFrame = msg.count > 1 && !msg.frame.items.slice(msg.index + 1).some((it) => requested(it.cmd))
      if (req.items.every((it) => s.has(it.cmd)) || lastOfFrame) {
        seen.delete(req)
        return 'done'
      }
      return 'partial'
    },
    ack: o.ack ?? ((_req, msg) => momaStatusAck(msg)),
    commandOf: (req) => momaCommandOf(req, o.commands),
    // Every item, so the engine checks each catalogued one (a batch [destructive, uncatalogued] is ranked by
    // its uncatalogued item, which alone would hide the destructive one from a forced sendRaw).
    commandsOf: (req) => req.items.map((it) => it.cmd),
    coalesceKey: o.coalesceKey ?? ((req) => `${req.target ?? profile.target}:${req.items.map((it) => it.cmd).join(',')}`),
    describe: (x) => describeMoma(x, describeOpts),
    rawOf: (msg) => (msg.count === 1 ? msg.frame.raw : momaItemBytes(msg)),
  }
}

/** The item's own bytes (cmd type len payload). */
export function momaItemBytes(msg: MomaMessage): Uint8Array {
  const n = msg.payload.length
  const out = new Uint8Array(5 + n)
  out.set([msg.cmd >> 8, msg.cmd & 0xff, msg.type, n >> 8, n & 0xff])
  out.set(msg.payload, 5)
  return out
}

/** Command id of an encoded request (driver.commandOfFrame): the batch's riskiest item, null if not a request. */
export function momaCommandOfFrame(profile: MomaProfile, frame: Uint8Array, commands?: CommandCatalogue): number | null {
  const req = parseMomaRequest(profile, frame)
  return req ? momaCommandOf(req, commands) : null
}
