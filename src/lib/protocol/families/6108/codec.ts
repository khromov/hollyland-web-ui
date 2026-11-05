/**
 * LARK A1 (6108) "ProtocolV2" framing on HID Feature report 5 (docs/research/families/a1-6108.md §3).
 *
 *   request  05 03 AA DD cmd lenHi lenLo payload… EF 00…   SET_REPORT(Feature 5), 64 bytes incl. the id
 *   reply    05 ?? BB DD cmd lenHi lenLo payload…           GET_REPORT(Feature 5), 64 bytes incl. the id
 *
 * No address byte (the unit travels in the payload), no checksum, no sequence number; the request
 * ends with an 0xEF marker. Set replies acknowledge with body[0] == 0 (status.ts).
 *
 * Sources (A = Android HollyAudio 3.1.0 jadx, paths under com/hollyland/; I = iOS larkSound 3.1.0):
 *  - A application/common/protocol/ProtocolV2.getData: bytes 0..3 = Integer.decode("0x05"/"0x03"/"0xAA"/"0xDD"),
 *    byte 4 = getCmd(), NumberUtil.intToByte2(payload.length) (big-endian) at 5..6 and the payload at 7 only when
 *    the payload is not empty, byte 7+n = 0xEF; buffer size UsbHandlerManager.getControlTransSize() = 64
 *    (USB_PKT_SIZE_6108_NORMAL).
 *  - A ProtocolV2.parse: command = data[4]; length = data[5]*16 + data[6]; fails when data.length < 7, the length
 *    is 0, or the length exceeds data.length - 7; OTA replies 0x1A..0x1C take [data[5]], 0x1D/0x1E [data[9]].
 *  - A ProtocolV2.crcCalculate (XOR) exists but has no caller: there is no checksum on HID.
 *  - A usb/core/HlUsbManagerImpl.executeControlTransfer: a reply is dispatched only when GET_REPORT returns exactly
 *    controlTransSize (64) bytes, byte 0 being the report id.
 *  - I +[NSData(HL6902Data) headerWithCommand:payload:] @0x10027a9ac: the iAP2 form `AA DD cmd len16 payload XOR`
 *    (reference only; a browser cannot use it), -[HL6108PacketParser parseMessageFromData:] @0x1002e06e0.
 */
import { CodecError } from '../../codec'
import { concatBytes, xor8 } from '../../core/bytes'
import type { MessageAssembler } from '../../core/types'

/** Feature report id of every A1 command (A UsbHandlerManager.REPORT_ID_NORMAL = 0x0305 → wValue low byte). */
export const A1_REPORT_ID = 0x05
/** Feature report id of firmware upload (A UsbHandlerManager.REPORT_ID_UPGRADE = 0x0306). Never sent by Mic Console. */
export const A1_OTA_REPORT_ID = 0x06
/** Report size including the id byte (A UsbHandlerManager.USB_PKT_SIZE_6108_NORMAL = 64). */
export const A1_REPORT_SIZE = 64
/** OTA report size including the id byte (A USB_PKT_SIZE_6108_UPGRADE = 160). Documentation only. */
export const A1_OTA_REPORT_SIZE = 160
/** Header bytes before the payload: id, 0x03, AA, DD, cmd, lenHi, lenLo (A ProtocolV2.HEAD_LENGTH = 7). */
export const A1_HEADER_SIZE = 7
/** Constant byte 1 of every request (A ProtocolV2.getData `Integer.decode("0x03")`); not a length, meaning unknown. */
export const A1_REQUEST_BYTE1 = 0x03
/** End marker after the payload (A ProtocolV2.getData `Integer.decode("0xEF")`). */
export const A1_END_MARKER = 0xef
/** Largest payload that fits one 64-byte report: 64 - 7 - 1 (a1-6108.md §3.1). No A1 command needs more than 2. */
export const A1_MAX_PAYLOAD = A1_REPORT_SIZE - A1_HEADER_SIZE - 1
/** Byte offset of the command in requests and replies (A ProtocolV2.getData b[4], ProtocolV2.parse data[4]). */
export const A1_COMMAND_OFFSET = 4

const REQUEST_MAGIC0 = 0xaa
const RESPONSE_MAGIC0 = 0xbb
const MAGIC1 = 0xdd

function checkByte(name: string, v: number): number {
  if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new CodecError(`${name} must be a byte (0..255), got ${v}`)
  return v
}

/**
 * One request frame on Feature report 5, byte-exact to A ProtocolV2.getData: 64 bytes, the report id
 * included (the transport sends bytes 1..63 with sendFeatureReport(5, …)).
 */
export function encodeA1Frame(cmd: number, payload: ArrayLike<number> = []): Uint8Array<ArrayBuffer> {
  checkByte('A1 command', cmd)
  if (payload.length > A1_MAX_PAYLOAD) throw new CodecError(`A1 payload too long: ${payload.length} > ${A1_MAX_PAYLOAD} bytes`)
  const b = new Uint8Array(A1_REPORT_SIZE)
  b[0] = A1_REPORT_ID
  b[1] = A1_REQUEST_BYTE1
  b[2] = REQUEST_MAGIC0
  b[3] = MAGIC1
  b[4] = cmd
  if (payload.length) {
    // NumberUtil.intToByte2: big-endian; written only for a non-empty payload (empty → 00 00 from the zeroed buffer).
    b[5] = (payload.length >> 8) & 0xff
    b[6] = payload.length & 0xff
    for (let i = 0; i < payload.length; i++) b[A1_HEADER_SIZE + i] = checkByte(`A1 payload[${i}]`, payload[i])
  }
  b[A1_HEADER_SIZE + payload.length] = A1_END_MARKER
  return b
}

/**
 * The iOS iAP2 External Accessory form of the same request (I +[NSData(HL6902Data) headerWithCommand:payload:]
 * @0x10027a9ac; bare variant headerWithCommand: @0x10027ab54): `AA DD cmd lenHi lenLo payload XOR`, the XOR
 * covering every preceding byte from 0xAA (-[NSData getOrData:]). Reference only, for Android ↔ iOS cross-checks:
 * never send it over HID (a1-6108.md §3.4).
 */
export function encodeA1EaFrame(cmd: number, payload: ArrayLike<number> = []): Uint8Array<ArrayBuffer> {
  checkByte('A1 command', cmd)
  const out = new Uint8Array(6 + payload.length)
  out[0] = REQUEST_MAGIC0
  out[1] = MAGIC1
  out[2] = cmd
  out[3] = (payload.length >> 8) & 0xff
  out[4] = payload.length & 0xff
  for (let i = 0; i < payload.length; i++) out[5 + i] = checkByte(`A1 payload[${i}]`, payload[i])
  out[out.length - 1] = xor8(out, 0, out.length - 1)
  return out
}

/** A decoded GET_REPORT(Feature 5) reply. */
export interface A1Reply {
  /** Echoed command (byte 4). */
  cmd: number
  /** Reply body ("payload" in ProtocolV2.parse), `length` bytes from offset 7. */
  payload: Uint8Array
  /** Length field, big-endian (bytes 5..6), as the builder writes it. */
  length: number
  /** Byte 0 as delivered (expected 0x05; not checked by Android). */
  reportId: number
  /** Byte 1 (requests carry 0x03; the reply's value is unknown, a1-6108.md §8 #2). */
  byte1: number
  /** Bytes 2..3 are `BB DD` (or `AA DD`). Android never checks them, so neither does the decoder. */
  magicOk: boolean
  /** The byte after the payload is 0xEF (requests end with it; unknown for replies). */
  endMarker: boolean
  /** OTA reply layout (commands 0x1A..0x1E, ProtocolV2.parse special cases). Mic Console never sends those. */
  ota: boolean
  /** The whole report (64 bytes on the feature link). */
  raw: Uint8Array
}

const OTA_STATUS_AT_5 = new Set([0x1a, 0x1b, 0x1c])
const OTA_STATUS_AT_9 = new Set([0x1d, 0x1e])

/**
 * Decode one report the way A ProtocolV2.parse does (lenient on bytes 0..3). Returns null where Android's parse
 * returns false: fewer than 7 bytes, length 0, or a length that does not fit the report.
 *
 * Length: the builder writes it big-endian (NumberUtil.intToByte2) while the parser computes data[5]*16 + data[6].
 * The two agree whenever data[5] is 0, which is always the case for a frame that fits 64 bytes; a non-zero
 * data[5] makes the big-endian length exceed the report, so such bytes are rejected instead of being misread.
 */
export function decodeA1Reply(report: Uint8Array): A1Reply | null {
  if (report.length <= A1_COMMAND_OFFSET) return null
  const cmd = report[A1_COMMAND_OFFSET]
  const base = {
    cmd,
    reportId: report[0],
    byte1: report[1],
    magicOk: (report[2] === RESPONSE_MAGIC0 || report[2] === REQUEST_MAGIC0) && report[3] === MAGIC1,
    raw: report,
  }
  // A ProtocolV2.parse: OTA replies (Feature 6) carry a status byte at a fixed offset, no length field.
  if (OTA_STATUS_AT_5.has(cmd) && report.length >= 6) return { ...base, payload: report.slice(5, 6), length: 1, endMarker: false, ota: true }
  if (OTA_STATUS_AT_9.has(cmd) && report.length >= 10) return { ...base, payload: report.slice(9, 10), length: 1, endMarker: false, ota: true }
  if (report.length < A1_HEADER_SIZE) return null
  const length = (report[5] << 8) | report[6]
  if (length === 0 || length > report.length - A1_HEADER_SIZE) return null
  const end = A1_HEADER_SIZE + length
  return { ...base, payload: report.slice(A1_HEADER_SIZE, end), length, endMarker: report[end] === A1_END_MARKER, ota: false }
}

/** A request frame classified for the safety rules (sendRaw, traffic log, tests). */
export interface A1RequestFrame {
  /** 5 = command report, 6 = firmware-upload report (classified only, so the catalogue can refuse it). */
  report: number
  cmd: number
  payload: Uint8Array
}

/**
 * Inverse of encodeA1Frame. Also recognises Feature-6 OTA frames (A usbmic/messenger/UsbMessengerV2.sendRxUpgrade,
 * sendTxUpgrade, enterDfu, sendOTAPkg, verifyCrc: `06 N 00 00 service cmd …`, service 0 handshake / 2 OTA,
 * commands 0x1A..0x1E) so that the engine classifies them as 'ota' and refuses them; nothing here builds one.
 * Frames may be shorter than 64 bytes (console input without the zero padding).
 */
export function parseA1Request(frame: Uint8Array): A1RequestFrame | null {
  if (
    frame.length >= A1_HEADER_SIZE + 1 && frame[0] === A1_REPORT_ID && frame[1] === A1_REQUEST_BYTE1 &&
    frame[2] === REQUEST_MAGIC0 && frame[3] === MAGIC1
  ) {
    const length = (frame[5] << 8) | frame[6]
    const end = A1_HEADER_SIZE + length
    if (length > A1_MAX_PAYLOAD || end >= frame.length || frame[end] !== A1_END_MARKER) return null
    return { report: A1_REPORT_ID, cmd: frame[4], payload: frame.slice(A1_HEADER_SIZE, end) }
  }
  if (
    frame.length >= 6 && frame[0] === A1_OTA_REPORT_ID && frame[2] === 0 && frame[3] === 0 && (frame[4] === 0 || frame[4] === 2) &&
    frame[5] >= 0x1a && frame[5] <= 0x1e
  ) {
    return { report: A1_OTA_REPORT_ID, cmd: frame[5], payload: frame.slice(6, Math.min(frame.length, 3 + frame[1])) }
  }
  return null
}

/** Command id of a request frame (FamilyDriver.commandOfFrame), or null. */
export function a1CommandOfFrame(frame: Uint8Array): number | null {
  return parseA1Request(frame)?.cmd ?? null
}

/**
 * Report-aligned assembler. The feature link delivers whole reports (WebHidFeatureTransport normalises every
 * GET_REPORT to the report size with the id byte first); packets split by a relay or by the simulator's
 * chunk fault are re-assembled by report size. Each complete report decodes to one message, or is reported
 * as garbage (all-zero "nothing ready" reports, a length of 0, a length that does not fit).
 */
export class A1Assembler implements MessageAssembler<A1Reply> {
  onGarbage?: (bytes: Uint8Array) => void
  readonly reportSize: number
  private buf: Uint8Array = new Uint8Array(0)

  constructor(reportSize = A1_REPORT_SIZE) {
    this.reportSize = reportSize
  }

  push(chunk: Uint8Array): A1Reply[] {
    const data = this.buf.length ? concatBytes(this.buf, chunk) : chunk
    const out: A1Reply[] = []
    let pos = 0
    while (data.length - pos >= this.reportSize) {
      const report = data.slice(pos, pos + this.reportSize)
      pos += this.reportSize
      const msg = decodeA1Reply(report)
      if (msg) out.push(msg)
      else this.onGarbage?.(report)
    }
    this.buf = data.slice(pos)
    return out
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }
}
