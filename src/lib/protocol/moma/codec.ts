/**
 * The "standard Moma" envelope shared by LARK M3 (6303), LARK MAX 2 (6701) and MELO P1 (6201)
 * (docs/FAMILIES.md §3.5; m3-6303.md §3, max2-6701.md §3, melo-6201.md §3). Encoder, decoder and a
 * streaming frame assembler. Profiles (report id, target, control byte, padding) are in profiles.ts;
 * the engine glue (requests, per-item messages, correlation) is in spec.ts.
 *
 *   [reportId] AA DD src tgt ctl cntHi cntLo [5A FA 00 00 00] {cmdHi cmdLo type lenHi lenLo payload…}× [5E FE 00 00 00] [chk] [pad]
 *
 * Sources (A = Android HollyAudio 3.1.0 jadx, I = iOS larkSound):
 *  - A protocol/core/sound/transfer/CommandPostBuilder.build(): the generic builder (all three families)
 *  - A protocol/core/sound/transfer/CommandStanderParser.parse(): the generic parser (6201, 6303)
 *  - A blemic/operation/BleMicCmd.cmdSingleSend / cmdMultiSend / cmdMultiMapSend: MAX 2 builders (same bytes)
 *  - A blemic/operation/BleMicCommUtil.parseNotifyResult / crcCalculate: MAX 2 parser and XOR
 *  - I +[HLCommandFrameBuilder frameWithSource:target:control:commands:startMagic:includeStart:endMagic:includeEnd:checksum:]
 *    @0x1000a3058; +[NSData requestCommand:payload:needStartEnd:deviceType:] @0x10011d320; -[NSData getOrData:]
 *    @0x10027a6f8 (XOR); -[HL6201ViewModel receiveDataDeal] @0x10026ea4c / seprateDataWithCmdNum @0x10026ec58,
 *    -[HLBleViewModel receiveDataDeal] @0x1001586e4 (iOS reassembles by searching for BB DD)
 *
 * Header fields (magic, count, cmd, len) are big-endian: A NumberUtil.intToByte2 / byte2ToUnsignedShort,
 * HexUtils.hexStringToByteArray("0x600B") → 60 0B. Payload fields are the families' business (mostly LE).
 *
 * Decoder rules (FAMILIES.md §3.5, all three docs agree):
 *  - accept BB DD (replies, A ProtocolHeader.HEAD_UP) and AA DD (CommandStanderParser.isMatch accepts both);
 *  - ignore source and target (neither app routes on them);
 *  - checksum presence comes from the control byte of THIS frame (bits 2–3 ≠ 0 → one trailing byte), so a
 *    6201 device that answers iOS-style control 0x00 decodes without a checksum and an XOR reply with one;
 *  - the checksum is never required: an XOR mismatch is reported (frame.anomalies) but the frame is kept;
 *  - start/end marker items are dropped; type 2 = set ack, 3 = data, 0 = notify (device push), 1 = request.
 *
 * Android parser quirk (documented, not reproduced). CommandStanderParser.parse and
 * BleMicCommUtil.parseNotifyResult read the checksum bits as the string `bit2 + bit3` and map "01" → XOR,
 * "10" → CRC16, "11" → CRC32 (RobotMsgType.TEXT = "01"). The builder writes `algorithm << 2` (XOR = 1 → bit 2),
 * so the parser reads the builder's XOR (0x04) as CRC16 and waits for two trailing bytes, while the builder
 * appends one byte for every algorithm (`(byte) crc16(…)`). The parser also never advances past a present
 * end marker before its checksum check, and CRC32 asks for 3 bytes. melo-6201.md §3.2, m3-6303.md §3.1.
 * This library uses the builder's meaning (one byte), so it never waits for a byte that will not come; if a
 * device follows the parser's reading and sends two, the extra byte is skipped by the resync scan.
 */
import { CodecError, toHex } from '../codec'
import { hex16, xor8 } from '../core/bytes'

// ------------------------------------------------------------------------------------- constants

/** Host → device magic. A ProtocolHeader.HEAD_DOWN = {-86, -35}. */
export const MOMA_HEAD_DOWN: readonly number[] = [0xaa, 0xdd]
/** Device → host magic. A ProtocolHeader.HEAD_UP = {0xBB, -35}; QueryDeviceResult.getMasterStationPrefix (MAX 2). */
export const MOMA_HEAD_UP: readonly number[] = [0xbb, 0xdd]

/**
 * Envelope addresses (source / target bytes). A protocol/core/sound/transfer/DeviceIdentify (0..6, 255);
 * TX3/TX4 = 10/11 from A blemic/operation/BleMicCmd.IDENTIFIER_TX3 / IDENTIFIER_TX4 (MAX 2 only).
 * M3 payload unit ids (TX 1–4, RX 6–9, hot shoe 10) are a different numbering (m3-6303.md §1.1).
 */
export const MOMA_ID = {
  BROADCAST: 0,
  PHONE_RX: 1,
  CAMERA_RX: 2,
  TX1: 3,
  TX2: 4,
  BOX: 5,
  /** Source of every app request (CommandPostBuilder.build hard-codes IDENTIFIER_PHONE_APP). */
  PHONE_APP: 6,
  TX3: 10,
  TX4: 11,
  DEFAULT: 255,
} as const

/** Item type. A protocol/core/sound/transfer/ProtocolCmdType (unknown values decode as NOTIFY there). */
export const MOMA_TYPE = {
  /** Device push (MAX 2 BOX status items, MELO P1 VU after 0x6048 [I]). */
  NOTIFY: 0,
  /** Every app request, GET (usually empty payload) or SET. */
  REQUEST: 1,
  /** Set acknowledgement: payload[0] 0 = success, 1 = fail (A DeviceControlConstant.SetResult). */
  EXEC_RESP: 2,
  /** GET reply with data (A BleMicCommUtil.GET_CMD_RESPONSE = 3). */
  DATA: 3,
} as const

/** Checksum algorithm of control bits 2–3 (A VerificationAlgorithm NONE 0, XOR 1, CRC16 2, CRC32 3). */
export type MomaChecksum = 'none' | 'xor' | 'crc16' | 'crc32'
const CHECKSUMS: readonly MomaChecksum[] = ['none', 'xor', 'crc16', 'crc32']

/** Start marker item `5A FA 00 00 00` (CommandPostBuilder.build: {90, -6, 0, 0, 0}). */
export const MOMA_START_CMD = 0x5afa
/** End marker item `5E FE 00 00 00` (CommandPostBuilder.build: {94, -2, 0, 0, 0}). */
export const MOMA_END_CMD = 0x5efe
/** magic(2) source target control count(2) (CommandStanderParser PROTOCOL_*_LENGTH constants). */
export const MOMA_HEADER_SIZE = 7
/** cmd(2) type(1) len(2). */
export const MOMA_ITEM_HEADER_SIZE = 5
/**
 * Decoder bound for one frame (header to checksum). Largest known replies: 6303 0x1F18 413 B, 0x1F04
 * 387 B (m3-6303.md §5.6); 6701 0x600A 75 B; OTA frames are host → device and never built here.
 */
export const MOMA_MAX_FRAME_BYTES = 16384
/** Decoder bound for the item count (the apps batch at most ~8 items: BleMicCmd.getMicBoxAllInfo). */
export const MOMA_MAX_ITEMS = 1024

export class MomaCodecError extends CodecError {
  constructor(message: string) {
    super(message)
    this.name = 'MomaCodecError'
  }
}

// --------------------------------------------------------------------------------- control byte

/** Control byte fields with the builder's meaning (CommandPostBuilder.build). */
export interface MomaControl {
  /** bit 0: start marker item present. */
  start: boolean
  /** bit 1: end marker item present. */
  end: boolean
  /** bits 2–3: checksum algorithm. */
  checksum: MomaChecksum
  /** bit 4: long-package "reliable" mode (A LongPackageSendMethod; never set by the families' requests). */
  reliable: boolean
}

export interface DecodedMomaControl extends MomaControl {
  /** Android CommandStanderParser's (reversed) reading of bits 2–3, for diagnostics only. */
  parserChecksum: MomaChecksum
  /** Bits 5–7, unused by every builder. */
  reserved: number
}

/** `(end << 1) + start + (algorithm << 2) + (method << 4)` exactly as CommandPostBuilder.build. */
export function encodeMomaControl(c: MomaControl): number {
  return (c.start ? 1 : 0) | (c.end ? 2 : 0) | (CHECKSUMS.indexOf(c.checksum) << 2) | (c.reliable ? 0x10 : 0)
}

export function decodeMomaControl(byte: number): DecodedMomaControl {
  const bit2 = (byte >> 2) & 1
  const bit3 = (byte >> 3) & 1
  return {
    start: (byte & 1) !== 0,
    end: (byte & 2) !== 0,
    checksum: CHECKSUMS[(byte >> 2) & 3],
    reliable: (byte & 0x10) !== 0,
    // CommandStanderParser.parse: strConcat = bit2 + bit3; "01" XOR, "10" CRC16, "11" CRC32.
    parserChecksum: CHECKSUMS[(bit2 << 1) | bit3],
    reserved: (byte >> 5) & 7,
  }
}

/** Bytes after the items: one for any algorithm (the builder casts CRC16/CRC32 to a byte), else none. */
export function momaTrailerLength(control: number): number {
  return (control >> 2) & 3 ? 1 : 0
}

/**
 * What Android's CommandStanderParser waits for after the items (documentation and tests only): its reversed
 * bit reading gives XOR 1, CRC16 2, CRC32 3 bytes (A CommandStanderParser.parse, the `i5 + n > length` checks).
 */
export function androidParserTrailerLength(control: number): number {
  return [0, 1, 2, 3][CHECKSUMS.indexOf(decodeMomaControl(control).parserChecksum)]
}

// ---------------------------------------------------------------------------------------- encode

/** One command item to encode. */
export interface MomaItemInput {
  /** 16-bit command id (A Command6201 / Command6303 / BleMicCommUtil strings, "0x600B" → 0x600B). */
  cmd: number
  /** Item type; default MOMA_TYPE.REQUEST (the apps send 1 for GET and SET alike). */
  type?: number
  payload?: ArrayLike<number>
}

export interface MomaFrameOptions {
  /** 'down' AA DD (default, host → device), 'up' BB DD (device → host, simulators). */
  head?: 'down' | 'up'
  /** Default MOMA_ID.PHONE_APP (6). */
  source?: number
  target: number
  control: number
  /** HID report id prepended to the frame (6303: 8), or null. */
  reportId?: number | null
  /**
   * Zero-pad the packet (report id included) to the first size that is strictly larger than it; a packet
   * at least as long as the last size is sent as is. That is Protocol6303Provider.buildPacket for [64, 512]:
   * `len < 64` → 64, `len < 512` → 512, else as is, so a packet of exactly 64 bytes becomes 512.
   */
  padTo?: readonly number[]
}

function checkByte(name: string, v: number, max = 0xff): number {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new MomaCodecError(`${name} must be an integer in 0..${max}, got ${v}`)
  return v
}

/**
 * Build one frame exactly as CommandPostBuilder.build (plus the provider's padding, e.g.
 * Protocol6303Provider.buildPacket). The start/end markers and the item count follow the control byte:
 * count = items + 1 per marker (`intToByte2(size + start + end)`); the checksum is the XOR of every byte
 * before it (A ChecksumUtils.crcCalculate over the builder's whole list / BleMicCommUtil.crcCalculate;
 * I getOrData:). Like the builder, that would include a report id byte, but no profile combines a report id
 * with a checksum (6303 has none); the decoder checks the XOR from the magic on.
 */
export function encodeMomaFrame(items: readonly MomaItemInput[], o: MomaFrameOptions): Uint8Array {
  const control = checkByte('control', o.control)
  const c = decodeMomaControl(control)
  if (c.checksum === 'crc16' || c.checksum === 'crc32') {
    // No Moma profile uses them (FAMILIES.md §3.5) and the app writes only their low byte.
    throw new MomaCodecError(`checksum ${c.checksum} is not implemented (no family uses it)`)
  }
  const count = items.length + (c.start ? 1 : 0) + (c.end ? 1 : 0)
  checkByte('item count', count, 0xffff)
  const out: number[] = []
  if (o.reportId !== undefined && o.reportId !== null) out.push(checkByte('reportId', o.reportId))
  out.push(...(o.head === 'up' ? MOMA_HEAD_UP : MOMA_HEAD_DOWN))
  out.push(checkByte('source', o.source ?? MOMA_ID.PHONE_APP), checkByte('target', o.target), control, count >> 8, count & 0xff)
  if (c.start) out.push(0x5a, 0xfa, 0, 0, 0)
  for (const it of items) {
    const cmd = checkByte('cmd', it.cmd, 0xffff)
    const payload = it.payload ?? []
    const len = checkByte('payload length', payload.length, 0xffff)
    out.push(cmd >> 8, cmd & 0xff, checkByte('type', it.type ?? MOMA_TYPE.REQUEST), len >> 8, len & 0xff)
    for (let i = 0; i < len; i++) out.push(checkByte('payload byte', payload[i]))
  }
  if (c.end) out.push(0x5e, 0xfe, 0, 0, 0)
  if (c.checksum === 'xor') out.push(xor8(out))
  // A Protocol6303Provider.buildPacket: `if (len < 64) pad to 64; return len < 512 ? pad to 512 : as is`
  // (strict comparisons: exactly 64 bytes → 512, exactly 512 → as is).
  const size = (o.padTo ?? []).find((s) => out.length < s) ?? out.length
  const frame = new Uint8Array(size)
  frame.set(out)
  return frame
}

// ---------------------------------------------------------------------------------------- decode

/** One decoded command item (markers removed). */
export interface MomaItem {
  cmd: number
  type: number
  payload: Uint8Array
}

export interface MomaChecksumInfo {
  kind: MomaChecksum
  /** False when the frame was emitted without its trailing byte (see MomaFrameAssembler). */
  present: boolean
  value: number | null
  /** XOR the frame should carry; null when not computable (none, CRC16, CRC32). */
  expected: number | null
  /** null: not verified (none, CRC, or byte missing). */
  ok: boolean | null
}

export interface MomaFrame {
  /** HID report id (decodeMomaFrame: the byte before the magic; MomaFrameAssembler: its configured id), or null. */
  reportId: number | null
  head: 'down' | 'up'
  source: number
  target: number
  control: number
  flags: DecodedMomaControl
  /** Item count from the header (markers included). */
  count: number
  /** Command items in order, start/end markers removed. */
  items: MomaItem[]
  /** Marker items actually found. */
  markers: { start: boolean; end: boolean }
  checksum: MomaChecksumInfo
  /** Lenient-decoding notes for the traffic log (checksum mismatch, marker/control disagreement…). */
  anomalies: string[]
  /** Magic … checksum (no report id, no padding). */
  raw: Uint8Array
}

export type MomaHeads = 'up' | 'down' | 'both'

export interface MomaDecodeOptions {
  /** Report id expected before the magic (6303: 8). A frame that starts with the magic is accepted too. */
  reportId?: number | null
  /** Accepted magics; default 'both' (CommandStanderParser accepts BB DD and AA DD). */
  heads?: MomaHeads
  maxFrameBytes?: number
  /** Return the frame when only its checksum byte is missing (`checksum.present === false`). */
  allowMissingChecksum?: boolean
}

export type MomaDecodeResult =
  | { status: 'ok'; frame: MomaFrame; /** bytes consumed from the input, report id included */ length: number }
  | { status: 'incomplete'; /** every item (and end marker) is present, only the checksum byte is missing */ itemsComplete: boolean }
  | { status: 'invalid'; reason: string }

function headAt(b: ArrayLike<number>, i: number, heads: MomaHeads): 'down' | 'up' | null {
  const x = b[i]
  if (x === 0xbb && heads !== 'down') return 'up'
  if (x === 0xaa && heads !== 'up') return 'down'
  return null
}

/** True when `b[i..]` starts with an accepted magic (a lone first byte at the end counts as a possible start). */
function magicAt(b: Uint8Array, i: number, heads: MomaHeads): boolean {
  if (headAt(b, i, heads) === null) return false
  return i + 1 >= b.length || b[i + 1] === 0xdd
}

/** Decode the frame whose magic is at `off` (no report id). */
function decodeAt(b: Uint8Array, off: number, o: MomaDecodeOptions, reportId: number | null): MomaDecodeResult {
  const heads = o.heads ?? 'both'
  const max = o.maxFrameBytes ?? MOMA_MAX_FRAME_BYTES
  const head = headAt(b, off, heads)
  if (head === null) return { status: 'invalid', reason: 'no BB DD / AA DD magic' }
  if (b.length < off + 2) return { status: 'incomplete', itemsComplete: false }
  if (b[off + 1] !== 0xdd) return { status: 'invalid', reason: 'no BB DD / AA DD magic' }
  if (b.length < off + MOMA_HEADER_SIZE) return { status: 'incomplete', itemsComplete: false }
  const control = b[off + 4]
  const flags = decodeMomaControl(control)
  const count = (b[off + 5] << 8) | b[off + 6]
  if (count > MOMA_MAX_ITEMS) return { status: 'invalid', reason: `implausible item count ${count}` }
  const items: MomaItem[] = []
  const markers = { start: false, end: false }
  let pos = off + MOMA_HEADER_SIZE
  for (let i = 0; i < count; i++) {
    if (b.length < pos + MOMA_ITEM_HEADER_SIZE) return { status: 'incomplete', itemsComplete: false }
    const cmd = (b[pos] << 8) | b[pos + 1]
    const type = b[pos + 2]
    const len = (b[pos + 3] << 8) | b[pos + 4]
    const next = pos + MOMA_ITEM_HEADER_SIZE + len
    if (next - off > max) return { status: 'invalid', reason: `frame longer than ${max} bytes` }
    if (b.length < next) return { status: 'incomplete', itemsComplete: false }
    if (len === 0 && cmd === MOMA_START_CMD && i === 0) markers.start = true
    else if (len === 0 && cmd === MOMA_END_CMD && i === count - 1) markers.end = true
    else items.push({ cmd, type, payload: b.slice(pos + MOMA_ITEM_HEADER_SIZE, next) })
    pos = next
  }
  const anomalies: string[] = []
  if (flags.start !== markers.start) anomalies.push(flags.start ? 'control bit 0 set but no start marker' : 'start marker without control bit 0')
  if (flags.end !== markers.end) anomalies.push(flags.end ? 'control bit 1 set but no end marker' : 'end marker without control bit 1')
  if (flags.reserved) anomalies.push(`reserved control bits 0x${(control & 0xe0).toString(16)}`)
  const kind = flags.checksum
  const checksum: MomaChecksumInfo = { kind, present: false, value: null, expected: null, ok: null }
  if (kind === 'xor') checksum.expected = xor8(b, off, pos)
  if (momaTrailerLength(control)) {
    if (b.length < pos + 1) {
      if (!o.allowMissingChecksum) return { status: 'incomplete', itemsComplete: true }
      anomalies.push('checksum byte not received with the frame')
    } else {
      checksum.present = true
      checksum.value = b[pos]
      if (checksum.expected !== null) {
        checksum.ok = checksum.value === checksum.expected
        if (!checksum.ok) anomalies.push(`XOR mismatch: got 0x${hex(checksum.value)}, expected 0x${hex(checksum.expected)}`)
      }
      pos += 1
    }
  }
  const frame: MomaFrame = {
    reportId, head, source: b[off + 2], target: b[off + 3], control, flags, count, items, markers, checksum, anomalies,
    raw: b.slice(off, pos),
  }
  return { status: 'ok', frame, length: pos - off }
}

const hex = (n: number) => n.toString(16).padStart(2, '0')

/**
 * Decode one frame at the start of `bytes` (optionally after the report id). Trailing bytes (padding,
 * a following frame) are not looked at; `length` says where the frame ended.
 */
export function decodeMomaFrame(bytes: Uint8Array, o: MomaDecodeOptions = {}): MomaDecodeResult {
  const rid = o.reportId ?? null
  const skip = rid !== null && bytes.length > 0 && bytes[0] === rid && headAt(bytes, 0, o.heads ?? 'both') === null ? 1 : 0
  if (skip && bytes.length === 1) return { status: 'incomplete', itemsComplete: false }
  const r = decodeAt(bytes, skip, o, skip ? rid : null)
  return r.status === 'ok' ? { ...r, length: r.length + skip } : r
}

/**
 * Decode a complete packet holding exactly one frame plus optional zero padding (a request frame as the
 * transport sends it). Null when it is not exactly that.
 */
export function parseMomaPacket(bytes: Uint8Array, o: MomaDecodeOptions = {}): MomaFrame | null {
  const r = decodeMomaFrame(bytes, o)
  if (r.status !== 'ok') return null
  for (let i = r.length; i < bytes.length; i++) if (bytes[i] !== 0) return null
  return r.frame
}

// ------------------------------------------------------------------------------------ assembler

export interface MomaAssemblerOptions {
  /** Report id that starts every HID report of the family (6303: 8). Stripped at frame starts only. */
  reportId?: number | null
  /** Default 'both'. Simulators reading host requests use 'down'. */
  heads?: MomaHeads
  maxFrameBytes?: number
}

/** Header check used before abandoning a pending frame for a packet that looks like a new one. */
function plausibleHeader(b: Uint8Array, i: number, heads: MomaHeads): boolean {
  if (b.length < i + MOMA_HEADER_SIZE || headAt(b, i, heads) === null || b[i + 1] !== 0xdd) return false
  const count = (b[i + 5] << 8) | b[i + 6]
  return (b[i + 4] & 0xe0) === 0 && count >= 1 && count <= 64
}

/**
 * Streaming assembler (FAMILIES.md §3.5, melo-6201.md §3.5, max2-6701.md §3.4). Feed transport packets
 * (HID reports with or without the report id, BLE notifications of any size, bridge USB packets); get
 * complete frames. A library extension over the apps (A PacketProcessor6303 never concatenates;
 * A DefaultPacketProcessor concatenates without resync), closer to iOS receiveDataDeal:
 *  - resyncs on BB DD / AA DD; zero padding is dropped silently, other junk goes to `onGarbage`;
 *  - the report id is stripped only where a frame starts: numbered HID reports carry it, while bridge USB
 *    packets and simulator chunks of a longer frame do not (continuations are raw bytes);
 *  - a frame truncated by the transport (an M3 reply longer than an undeclared 63-byte input report,
 *    FAMILIES.md §6 #3) does not block the stream: when a packet starts like a new frame while one is
 *    pending, the pending bytes are dropped unless appending the packet completes them with a valid XOR;
 *  - a frame whose items end exactly at a packet end and whose only missing piece is the checksum byte is
 *    emitted right away (`checksum.present = false`): the apps never require the checksum, and a device
 *    that sets the XOR bit but sends no byte (or iOS-style frames) would otherwise wait forever. If the next
 *    packet then starts with the expected XOR byte, that byte is consumed silently.
 */
export class MomaFrameAssembler {
  onGarbage?: (bytes: Uint8Array) => void
  private buf: Uint8Array = new Uint8Array(0)
  private lateChecksum: number | null = null
  private readonly reportId: number | null
  private readonly heads: MomaHeads
  private readonly maxFrameBytes: number

  constructor(o: MomaAssemblerOptions = {}) {
    this.reportId = o.reportId ?? null
    this.heads = o.heads ?? 'both'
    this.maxFrameBytes = o.maxFrameBytes ?? MOMA_MAX_FRAME_BYTES
  }

  /** Bytes held for an incomplete frame. */
  get pending(): number {
    return this.buf.length
  }

  reset(): void {
    this.buf = new Uint8Array(0)
    this.lateChecksum = null
  }

  push(packet: Uint8Array): MomaFrame[] {
    let data = packet
    const late = this.lateChecksum
    this.lateChecksum = null
    if (late !== null && this.buf.length === 0 && data.length && data[0] === late && !plausibleHeader(data, 0, this.heads)) {
      data = data.subarray(1)
    }
    const rid = this.reportId
    const newFrameAt = rid !== null ? (data[0] === rid && plausibleHeader(data, 1, this.heads) ? 1 : -1) : plausibleHeader(data, 0, this.heads) ? 0 : -1
    if (this.buf.length && newFrameAt >= 0) {
      // A packet that starts like a new frame while one is pending: continuation only if it completes the
      // pending frame with a verified checksum; otherwise the pending bytes were a truncated frame.
      const joined = concat(this.buf, data)
      const r = decodeAt(joined, 0, { heads: this.heads, maxFrameBytes: this.maxFrameBytes }, null)
      if (!(r.status === 'ok' && r.frame.checksum.ok === true)) {
        this.garbage(this.buf)
        this.buf = new Uint8Array(0)
        data = data.subarray(newFrameAt)
      }
    } else if (!this.buf.length && rid !== null && data.length && data[0] === rid) {
      data = data.subarray(1)
    }
    const buf = this.buf.length ? concat(this.buf, data) : data
    const out: MomaFrame[] = []
    let pos = 0
    while (pos < buf.length) {
      let s = pos
      while (s < buf.length && !magicAt(buf, s, this.heads)) s++
      if (s > pos) this.garbage(buf.subarray(pos, s), s < buf.length)
      pos = s
      if (pos >= buf.length) break
      const r = decodeAt(buf, pos, { heads: this.heads, maxFrameBytes: this.maxFrameBytes }, null)
      if (r.status === 'ok') {
        out.push(r.frame)
        pos += r.length
        continue
      }
      if (r.status === 'invalid') {
        this.garbage(buf.subarray(pos, pos + 1))
        pos += 1
        continue
      }
      if (r.itemsComplete) {
        const m = decodeAt(buf, pos, { heads: this.heads, maxFrameBytes: this.maxFrameBytes, allowMissingChecksum: true }, null)
        if (m.status === 'ok') {
          out.push(m.frame)
          this.lateChecksum = m.frame.checksum.expected
          pos += m.length
          continue
        }
      }
      break
    }
    this.buf = pos < buf.length ? buf.slice(pos) : new Uint8Array(0)
    if (rid !== null) for (const f of out) f.reportId = rid
    return out
  }

  /** Report junk unless it is zero padding (or zero padding plus the report id of the next frame). */
  private garbage(bytes: Uint8Array, beforeMagic = false): void {
    let end = bytes.length
    if (beforeMagic && this.reportId !== null && end > 0 && bytes[end - 1] === this.reportId) end--
    for (let i = 0; i < end; i++) {
      if (bytes[i] !== 0) {
        this.onGarbage?.(bytes.slice())
        return
      }
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/** Short human-readable dump of a frame for logs and tests. */
export function describeMomaFrame(f: MomaFrame): string {
  const items = f.items.map((it) => `${hex16(it.cmd)}/${it.type}${it.payload.length ? ` [${toHex(it.payload.subarray(0, 16))}${it.payload.length > 16 ? ' …' : ''}]` : ''}`)
  return `${f.head === 'up' ? 'BB DD' : 'AA DD'} ${f.source}→${f.target} ctl ${hex(f.control)} ${items.join(', ')}${f.anomalies.length ? ` (${f.anomalies.join('; ')})` : ''}`
}
