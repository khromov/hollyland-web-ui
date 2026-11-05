/**
 * A complete toy FamilyDriver used to test the generic engine and the conformance suite. It is
 * also the smallest working example of the contracts in core/types.ts for the Phase 1 family
 * agents: codec, assembler, catalogue, ProtocolSpec, controls, simulator.
 *
 * Toy wire format (no relation to any Hollyland product):
 *   request  5A cmdHi cmdLo unit len payload… xor
 *   reply    A5 cmdHi cmdLo unit len payload… xor      (ack: payload[0] == 0)
 */
import { UnsupportedError } from '../../device'
import { ascii, chunkBytes, xor8 } from '../bytes'
import { CONTROL, controlKey, versionGate } from '../controls'
import { FamilyDevice } from '../engine'
import { ControlUnavailableError } from '../errors'
import { usbProduct } from '../product-rows'
import type {
  CommandCatalogue, ControlSpec, DeviceSimulator, EngineContext, FamilyDriver, MessageAssembler, ProtocolSpec, SimFaults, SimOptions,
  SupportInfo, UnitId,
} from '../types'

export const T = {
  STATUS: 0x0001,
  VERSION: 0x0002,
  GET_ALL: 0x0003,
  SET_NC_LEVEL: 0x0101,
  NC_TOGGLE: 0x0102,
  SET_VOLUME: 0x0103,
  SET_LED: 0x0104,
  SET_MUTE: 0x0105,
  RESTART: 0x0200,
  FACTORY_RESET: 0x0300,
  OTA_START: 0x0400,
  PUSH_LEVEL: 0x0500,
  /** Parses, but is not in the catalogue. */
  UNCATALOGUED: 0x0999,
} as const

export const TOY_COMMANDS: CommandCatalogue = {
  [T.STATUS]: { name: 'STATUS', safety: 'read', retrySafe: true, source: 'toy' },
  [T.VERSION]: { name: 'VERSION', safety: 'read', retrySafe: true, source: 'toy' },
  [T.GET_ALL]: { name: 'GET_ALL', safety: 'read', retrySafe: true, source: 'toy' },
  [T.SET_NC_LEVEL]: { name: 'SET_NC_LEVEL', safety: 'write', retrySafe: true, source: 'toy' },
  [T.NC_TOGGLE]: { name: 'NC_TOGGLE', safety: 'write', retrySafe: false, toggle: true, source: 'toy' },
  [T.SET_VOLUME]: { name: 'SET_VOLUME', safety: 'write', retrySafe: true, source: 'toy' },
  [T.SET_LED]: { name: 'SET_LED', safety: 'write', retrySafe: true, source: 'toy' },
  [T.SET_MUTE]: { name: 'SET_MUTE', safety: 'write', retrySafe: true, source: 'toy' },
  [T.RESTART]: { name: 'RESTART', safety: 'disruptive', retrySafe: false, source: 'toy' },
  [T.FACTORY_RESET]: { name: 'FACTORY_RESET', safety: 'destructive', retrySafe: false, source: 'toy' },
  [T.OTA_START]: { name: 'OTA_START', safety: 'ota', retrySafe: false, source: 'toy' },
  [T.PUSH_LEVEL]: { name: 'PUSH_LEVEL', safety: 'notify', retrySafe: false, source: 'toy' },
}

const UNIT_BYTE: Partial<Record<UnitId, number>> = { rx: 0, tx1: 1, tx2: 2 }
const BYTE_UNIT: Record<number, UnitId> = { 0: 'rx', 1: 'tx1', 2: 'tx2' }

export interface ToyReq {
  cmd: number
  unit?: UnitId
  payload?: number[]
}

export interface ToyMsg {
  cmd: number
  unit: UnitId
  payload: Uint8Array
  raw: Uint8Array
}

export function encodeToy(magic: 0x5a | 0xa5, cmd: number, unit: number, payload: ArrayLike<number> = []): Uint8Array {
  const out = new Uint8Array(6 + payload.length)
  out.set([magic, (cmd >> 8) & 0xff, cmd & 0xff, unit, payload.length])
  out.set(payload, 5)
  out[out.length - 1] = xor8(out, 0, out.length - 1)
  return out
}

/** Stream assembler: resyncs on A5, completes on 5 + len + 1 bytes. */
export class ToyAssembler implements MessageAssembler<ToyMsg> {
  private buf = new Uint8Array(0)
  onGarbage?: (b: Uint8Array) => void

  push(chunk: Uint8Array): ToyMsg[] {
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf)
    merged.set(chunk, this.buf.length)
    const out: ToyMsg[] = []
    let pos = 0
    for (;;) {
      let start = merged.indexOf(0xa5, pos)
      if (start < 0) start = merged.length
      if (start > pos) this.onGarbage?.(merged.slice(pos, start))
      if (merged.length - start < 5) {
        this.buf = merged.slice(start)
        return out
      }
      const total = 6 + merged[start + 4]
      if (merged.length - start < total) {
        this.buf = merged.slice(start)
        return out
      }
      const raw = merged.slice(start, start + total)
      out.push({ cmd: (raw[1] << 8) | raw[2], unit: BYTE_UNIT[raw[3]] ?? 'rx', payload: raw.slice(5, total - 1), raw })
      pos = start + total
    }
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }
}

const ctlBase = { readBack: 'status', confidence: 'high', source: 'toy' } as const

export const TOY_CONTROLS: readonly ControlSpec[] = [
  { ...ctlBase, id: CONTROL.NOISE_ENABLED, label: 'NC', group: 'audio', kind: 'switch', safety: 'write' },
  {
    ...ctlBase, id: CONTROL.NOISE_LEVEL, label: 'NC level', group: 'audio', kind: 'choice', safety: 'write',
    options: [{ value: 1, label: 'Weak' }, { value: 2, label: 'Medium' }, { value: 3, label: 'Strong' }],
  },
  { ...ctlBase, id: CONTROL.VOLUME, label: 'Volume', group: 'receiver', kind: 'steps', safety: 'write', range: { min: 0, max: 5, step: 1 } },
  { ...ctlBase, id: CONTROL.LED, label: 'LED', group: 'settings', kind: 'switch', safety: 'write' },
  { ...ctlBase, id: CONTROL.MIC_MUTE, label: 'Mute', group: 'mics', kind: 'switch', safety: 'write', perUnit: ['tx1', 'tx2'] },
  { ...ctlBase, id: CONTROL.RESTART_RX, label: 'Restart', group: 'advanced', kind: 'action', safety: 'disruptive', readBack: 'none', confirmText: 'The receiver restarts.' },
  { ...ctlBase, id: CONTROL.FACTORY_RESET, label: 'Factory reset', group: 'advanced', kind: 'action', safety: 'destructive', readBack: 'none' },
  { ...ctlBase, id: 'toy.firmware', label: 'Update firmware', group: 'advanced', kind: 'action', safety: 'ota', readBack: 'none' },
]

/** LED needs RX firmware >= 1.2.0 (toy firmware gate). */
export const TOY_LED_MIN_VERSION = '1.2.0'

export interface ToyStatus {
  tx: { online: boolean; battery: number; muted: boolean }[]
  ncOn: boolean
  ncLevel: number
  volume: number
  ledOn: boolean
}

export function parseToyStatus(p: Uint8Array): ToyStatus {
  return {
    tx: [0, 1].map((i) => ({ online: p[i * 2] === 1, battery: p[i * 2 + 1] ?? 0, muted: ((p[8] ?? 0) >> i & 1) === 1 })),
    ncOn: p[4] === 1, ncLevel: p[5] ?? 0, volume: p[6] ?? 0, ledOn: p[7] === 1,
  }
}

function applyAvailability(ctx: EngineContext<ToyReq, ToyMsg>): void {
  const s = ctx.state
  const anyMic = (['tx1', 'tx2'] as const).some((u) => s.units[u]?.online)
  ctx.setAvailability({
    [CONTROL.LED]: versionGate(s.units.rx.version, TOY_LED_MIN_VERSION, { ignore: ctx.options.ignoreFirmwareGates }),
    [CONTROL.VOLUME]: anyMic ? { ok: true } : { ok: false, reason: 'mic-disconnected', message: 'no mic online' },
    [CONTROL.NOISE_LEVEL]: s.values[CONTROL.NOISE_ENABLED] === false ? { ok: false, reason: 'noise-off', message: 'NC is off' } : { ok: true },
  })
}

export const TOY_SPEC: ProtocolSpec<ToyReq, ToyMsg> = {
  encode: (r) => encodeToy(0x5a, r.cmd, UNIT_BYTE[r.unit ?? 'rx'] ?? 0, r.payload ?? []),
  parseRequest: (f) => {
    if (f.length < 6 || f[0] !== 0x5a || f.length !== 6 + f[4]) return null
    return { cmd: (f[1] << 8) | f[2], unit: BYTE_UNIT[f[3]] ?? 'rx', payload: [...f.slice(5, f.length - 1)] }
  },
  createAssembler: () => new ToyAssembler(),
  matches: (req, msg) => {
    if (msg.cmd !== req.cmd) return false
    if (req.cmd === T.VERSION && msg.unit !== (req.unit ?? 'rx')) return false
    if (req.cmd === T.GET_ALL) return msg.payload[0] === msg.payload[1] - 1 ? 'done' : 'partial'
    return 'done'
  },
  ack: (_req, msg) => ({ ok: msg.payload[0] === 0, code: msg.payload[0] ?? null }),
  commandOf: (r) => r.cmd,
  coalesceKey: (r) => `${r.cmd}:${r.unit ?? 'rx'}`,
  describe: (x) => `${TOY_COMMANDS[x.cmd]?.name ?? x.cmd.toString(16)} ${x.unit ?? 'rx'}`,
  rawOf: (m) => m.raw,
  probe: () => ({ cmd: T.STATUS }),
  heartbeat: { request: () => ({ cmd: T.STATUS }), intervalMs: 1000 },
  async onConnected(ctx) {
    if (ctx.options.fetchIdentity) await ctx.request({ cmd: T.VERSION, unit: 'rx' }, { priority: 'background' })
    if (ctx.options.fetchSettings) await ctx.request({ cmd: T.GET_ALL }, { priority: 'background' })
  },
  onUnitOnline(ctx, unit) {
    if (ctx.options.fetchIdentity) void ctx.request({ cmd: T.VERSION, unit }, { priority: 'background' }).catch(() => undefined)
  },
  onMessage(ctx, msg) {
    if (msg.cmd === T.STATUS) {
      const s = parseToyStatus(msg.payload)
      ctx.patchUnits({
        tx1: { online: s.tx[0].online, battery: s.tx[0].battery, muted: s.tx[0].muted },
        tx2: { online: s.tx[1].online, battery: s.tx[1].battery, muted: s.tx[1].muted },
      })
      ctx.setValues({
        [CONTROL.NOISE_ENABLED]: s.ncOn, [CONTROL.NOISE_LEVEL]: s.ncLevel, [CONTROL.VOLUME]: s.volume, [CONTROL.LED]: s.ledOn,
        [controlKey(CONTROL.MIC_MUTE, 'tx1')]: s.tx[0].muted, [controlKey(CONTROL.MIC_MUTE, 'tx2')]: s.tx[1].muted,
      })
      ctx.statusApplied(s)
      applyAvailability(ctx)
    } else if (msg.cmd === T.VERSION) {
      ctx.patchUnits({ [msg.unit]: { version: ascii(msg.payload, 0, msg.payload.length) } })
      applyAvailability(ctx)
    } else if (msg.cmd === T.GET_ALL) {
      ctx.setValues({ [`toy.item${msg.payload[2]}`]: msg.payload[3] })
    } else if (msg.cmd === T.PUSH_LEVEL) {
      ctx.setValues({ 'toy.level': msg.payload[0] })
    }
  },
  async refresh(ctx, what) {
    if (what === 'status') await ctx.request({ cmd: T.STATUS })
    else if (what === 'identity') {
      for (const u of ['rx', 'tx1', 'tx2'] as const) if (ctx.state.units[u]?.online) await ctx.request({ cmd: T.VERSION, unit: u })
    } else await ctx.request({ cmd: T.GET_ALL })
  },
  encodeSet(ctx, id, value, o) {
    switch (id) {
      case CONTROL.NOISE_ENABLED: {
        const cur = ctx.state.values[CONTROL.NOISE_ENABLED]
        if (cur === undefined) throw new ControlUnavailableError(id, 'state-unknown', 'NC state not known yet')
        return cur === value ? { requests: [] } : { requests: [{ cmd: T.NC_TOGGLE }], optimistic: { [id]: value } }
      }
      case CONTROL.NOISE_LEVEL:
        return { requests: [{ cmd: T.SET_NC_LEVEL, payload: [value as number] }], optimistic: { [id]: value } }
      case CONTROL.VOLUME:
        return { requests: [{ cmd: T.SET_VOLUME, payload: [value as number] }], optimistic: { [id]: value } }
      case CONTROL.LED:
        return { requests: [{ cmd: T.SET_LED, payload: [value ? 1 : 0] }], optimistic: { [id]: value }, readBack: { request: { cmd: T.STATUS }, delayMs: 5 } }
      case CONTROL.MIC_MUTE:
        return { requests: [{ cmd: T.SET_MUTE, unit: o.unit, payload: [value ? 1 : 0] }], optimistic: { [controlKey(id, o.unit)]: value } }
      case CONTROL.RESTART_RX:
        return { requests: [{ cmd: T.RESTART }] }
      case CONTROL.FACTORY_RESET:
        return { requests: [{ cmd: T.FACTORY_RESET }] }
      case 'toy.firmware':
        return { requests: [{ cmd: T.OTA_START }] }
      default:
        throw new UnsupportedError(id)
    }
  },
  controls: () => TOY_CONTROLS,
  timing: { replyTimeoutMs: 40, probeTimeoutMs: 50, interFrameDelayMs: 0 },
}

/** Simulated toy receiver. */
export class ToySimulator implements DeviceSimulator {
  readonly info = { vendorId: 0x3547, productId: 0xf001, productName: 'Toy RX (simulated)' }
  readonly capabilities = { receive: 'yes' as const, link: 'mock' as const }
  faults: SimFaults
  rxVersion: string
  tx = [
    { online: true, battery: 80, muted: false },
    { online: true, battery: 55, muted: false },
  ]
  ncOn = true
  ncLevel = 2
  volume = 3
  ledOn = true
  items = [10, 20, 30]
  /** Every request frame received. */
  readonly received: Uint8Array[] = []
  private inject: ((p: Uint8Array) => void) | null = null

  constructor(o: SimOptions = {}) {
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    this.rxVersion = o.rxVersion ?? '1.2.0'
    if (o.online) {
      this.tx[0].online = o.online.includes('tx1')
      this.tx[1].online = o.online.includes('tx2')
    }
  }

  attach(inject: (p: Uint8Array) => void): () => void {
    this.inject = inject
    return () => {
      this.inject = null
    }
  }

  /** Device-initiated PUSH_LEVEL. */
  push(level: number): void {
    this.inject?.(encodeToy(0xa5, T.PUSH_LEVEL, 0, [level]))
  }

  respond(packet: Uint8Array): Uint8Array[] {
    this.received.push(packet.slice())
    const req = TOY_SPEC.parseRequest!(packet)
    if (!req) return []
    const replies = this.handle(req)
    if (this.faults.dropReplies) return []
    const out = this.faults.duplicateReplies ? replies.flatMap((r) => [r, r.slice()]) : replies
    const n = this.faults.chunkSize
    return n ? out.flatMap((r) => chunkBytes(r, n)) : out
  }

  private handle(r: ToyReq): Uint8Array[] {
    const reply = (payload: number[], unit = 0) => [encodeToy(0xa5, r.cmd, unit, payload)]
    const ok = () => reply([0])
    const p = r.payload ?? []
    switch (r.cmd) {
      case T.STATUS:
        return reply([
          this.tx[0].online ? 1 : 0, this.tx[0].battery, this.tx[1].online ? 1 : 0, this.tx[1].battery,
          this.ncOn ? 1 : 0, this.ncLevel, this.volume, this.ledOn ? 1 : 0, (this.tx[0].muted ? 1 : 0) | (this.tx[1].muted ? 2 : 0),
        ])
      case T.VERSION: {
        const u = r.unit ?? 'rx'
        if (u !== 'rx' && !this.tx[u === 'tx1' ? 0 : 1].online) return []
        const v = u === 'rx' ? this.rxVersion : '0.9.1'
        return reply(Array.from(v, (c) => c.charCodeAt(0)), UNIT_BYTE[u])
      }
      case T.GET_ALL:
        return this.items.map((v, i) => encodeToy(0xa5, T.GET_ALL, 0, [i, this.items.length, i, v]))
      case T.SET_NC_LEVEL:
        this.ncLevel = p[0]
        return ok()
      case T.NC_TOGGLE:
        this.ncOn = !this.ncOn
        return ok()
      case T.SET_VOLUME:
        if (!this.tx.some((t) => t.online)) return reply([1])
        this.volume = p[0]
        return ok()
      case T.SET_LED:
        this.ledOn = p[0] === 1
        return ok()
      case T.SET_MUTE:
        this.tx[r.unit === 'tx2' ? 1 : 0].muted = p[0] === 1
        return ok()
      case T.RESTART:
        return []
      case T.FACTORY_RESET:
        return ok()
      default:
        return []
    }
  }
}

export const TOY_UNTESTED_SUPPORT: SupportInfo = { level: 'experimental', hardware: 'untested', confidence: 'high', research: 'toy' }
export const TOY_TESTED_SUPPORT: SupportInfo = { level: 'experimental', hardware: 'tested', confidence: 'high', research: 'toy' }

export const TOY_PRODUCT = usbProduct('6108', TOY_UNTESTED_SUPPORT, {
  productId: 0xf001, name: 'Toy RX', code: 'toy', txCount: 2, channels: 2, heartbeatIntervalMs: 1000, maxUnits: ['rx', 'tx1', 'tx2'],
  links: [{ kind: 'webhid', reportId: 'byte0', outSizes: [64] }],
})
export const TOY_TESTED_PRODUCT = { ...TOY_PRODUCT, productId: 0xf002, name: 'Toy RX (tested)', support: TOY_TESTED_SUPPORT }

export const toyDriver: FamilyDriver = {
  code: '6108',
  name: 'Toy',
  status: 'experimental',
  products: [TOY_PRODUCT, TOY_TESTED_PRODUCT],
  commands: TOY_COMMANDS,
  controls: TOY_CONTROLS,
  research: 'toy',
  createDevice: (transport, product, o) => new FamilyDevice(transport, product, { family: '6108', commands: TOY_COMMANDS, spec: TOY_SPEC }, o),
  createSimulator: (_product, o) => new ToySimulator(o),
  commandOfFrame: (f) => {
    const r = TOY_SPEC.parseRequest!(f)
    return r ? r.cmd : null
  },
  mockPresets: [{ id: 'toy', label: 'Toy', family: '6108', productId: 0xf001 }],
  hardwareCheck: [],
}
