/**
 * Wire codec for the Hollyland "legacy USB" control protocol used by LARK A2 (6118),
 * Lark M2 (6301) and LARK M2S (6302). See docs/PROTOCOL.md §3.
 *
 * Request  (host -> device), one 64-byte packet, zero padded:
 *   AA DD <cmd> <dst> <lenHi> <lenLo> <payload…> [xor] 00…
 *   dst = 0x40 RX, 0x41 TX1, 0x42 TX2
 * Response (device -> host):
 *   BB DD <cmd> <src> <lenHi> <lenLo> <payload…>
 *   src = 0x80 RX, 0x81 TX1, 0x82 TX2
 *
 * There is no sequence number, no escaping and no fragmentation: every frame fits in one packet
 * (max payload 58 bytes). The XOR byte is what the iOS app appends after the payload; the
 * Android app (the reference for the USB-HID path) does not send it. Because it sits outside
 * LEN the firmware ignores it either way (both forms answered on the live A2, PROTOCOL.md §11).
 */

export const PACKET_SIZE = 64
export const HEADER_SIZE = 6
export const MAX_PAYLOAD = PACKET_SIZE - HEADER_SIZE // 58

export const REQUEST_MAGIC0 = 0xaa
export const RESPONSE_MAGIC0 = 0xbb
export const MAGIC1 = 0xdd
/** First byte of a firmware-upload data packet (HID output report 0x55). */
export const OTA_DATA_MAGIC = 0x55
export const OTA_CHUNK_SIZE = 63

/** Logical unit addressed by a frame. */
export const Target = {
  RX: 0,
  TX1: 1,
  TX2: 2,
} as const
export type Target = (typeof Target)[keyof typeof Target]

export const TARGET_NAMES: Record<Target, string> = { 0: 'RX', 1: 'TX1', 2: 'TX2' }

/** Request address byte: 0x40 | target (Android LegacyUsb6118ProtocolCodec.mapRequestDeviceType). */
export function targetToRequestAddress(target: Target): number {
  return 0x40 | target
}

/**
 * Response source byte -> logical unit, exactly as the Android HID reference does it
 * (LegacyUsb6118ProtocolCodec.mapResponseDeviceType: 0x81 -> TX1, 0x82 -> TX2, anything else
 * RX; application/common/protocol/Protocol.parse does the same for M2/M2S).
 *
 * iOS (-[NSData judgeCurrentDevTypeWithData:] @0x10027a898) maps differently: 0x00 -> 5,
 * 0x01 -> RX, 0x02 -> TX1, 0x03 -> TX2, 0x04 -> 3 (TX3), 0x05 -> 4 (TX4), 0x81/0x82 -> TX1/TX2,
 * everything else RX. Those low values belong to the iAP2 stream; on USB HID the A2 answers
 * with 0x80/0x81/0x82 (libusb capture, PROTOCOL.md §11.6), so the iOS extras are not used.
 * Use `isKnownSourceAddress` to tell a real RX source (0x80) from an unexpected byte.
 */
export function responseAddressToTarget(address: number): Target {
  switch (address & 0xff) {
    case 0x81:
      return Target.TX1
    case 0x82:
      return Target.TX2
    default:
      return Target.RX
  }
}

/** True for the three source bytes the firmware is known to send on USB HID (0x80/0x81/0x82). */
export function isKnownSourceAddress(address: number): boolean {
  const a = address & 0xff
  return a === 0x80 || a === 0x81 || a === 0x82
}

/** XOR of all bytes, initial value 0 (iOS -[NSData getOrData:] @0x10027a6f8). */
export function xorChecksum(bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let acc = 0
  for (let i = start; i < end; i++) acc ^= bytes[i] & 0xff
  return acc
}

export interface EncodeOptions {
  /** Append the iOS-style XOR byte after the payload (inside the zero padding). Default false. */
  appendXor?: boolean
  /** Pad to 64 bytes (default true). The live A2 treats short HID writes as invalid. */
  pad?: boolean
}

export interface RequestFrame {
  cmd: number
  target: Target
  payload?: ArrayLike<number>
}

export class CodecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodecError'
  }
}

export function encodeRequest(frame: RequestFrame, options: EncodeOptions = {}): Uint8Array {
  const payload = frame.payload ?? []
  const { appendXor = false, pad = true } = options
  if (!Number.isInteger(frame.cmd) || frame.cmd < 0 || frame.cmd > 0xff) {
    throw new CodecError(`command out of range: ${frame.cmd}`)
  }
  if (frame.target !== 0 && frame.target !== 1 && frame.target !== 2) {
    throw new CodecError(`invalid target: ${String(frame.target)}`)
  }
  const maxPayload = appendXor ? MAX_PAYLOAD - 1 : MAX_PAYLOAD
  if (payload.length > maxPayload) {
    // Fragmentation does not exist in this protocol (PROTOCOL.md §3.4).
    throw new CodecError(`payload too long: ${payload.length} > ${maxPayload}`)
  }
  const used = HEADER_SIZE + payload.length + (appendXor ? 1 : 0)
  const out = new Uint8Array(pad ? PACKET_SIZE : used)
  out[0] = REQUEST_MAGIC0
  out[1] = MAGIC1
  out[2] = frame.cmd
  out[3] = targetToRequestAddress(frame.target)
  out[4] = (payload.length >> 8) & 0xff
  out[5] = payload.length & 0xff
  for (let i = 0; i < payload.length; i++) {
    const v = payload[i]
    if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new CodecError(`payload byte ${i} out of range: ${v}`)
    out[HEADER_SIZE + i] = v
  }
  if (appendXor) out[HEADER_SIZE + payload.length] = xorChecksum(out, 0, HEADER_SIZE + payload.length)
  return out
}

export interface DecodedFrame {
  /** 0xAA request or 0xBB response. */
  direction: 'request' | 'response'
  cmd: number
  /** Raw address byte (0x40..0x42 request, 0x80..0x82 response). */
  address: number
  target: Target
  /** Response only: the source byte is 0x80/0x81/0x82. False means `target` is only Android's RX fallback. */
  sourceKnown: boolean
  /** Value of the LEN field. */
  length: number
  payload: Uint8Array
  /** True when LEN claims more bytes than the packet holds (payload was truncated). */
  truncated: boolean
  /** Byte right after the payload, if present (may be an XOR byte or zero padding). */
  trailer: number | undefined
  /** Whether `trailer` equals the XOR of the frame (only meaningful if the sender appends one). */
  trailerIsXor: boolean
  raw: Uint8Array
}

export function isResponsePacket(p: ArrayLike<number>): boolean {
  return p.length >= HEADER_SIZE && p[0] === RESPONSE_MAGIC0 && p[1] === MAGIC1
}

export function isRequestPacket(p: ArrayLike<number>): boolean {
  return p.length >= HEADER_SIZE && p[0] === REQUEST_MAGIC0 && p[1] === MAGIC1
}

/**
 * Decode one frame (request or response). Returns null when the bytes do not start with a
 * valid magic. Mirrors LegacyUsb6118ProtocolCodec.parseValidatedPacket: payload =
 * data[6 .. min(6+len, data.length)).
 */
export function decodeFrame(packet: Uint8Array): DecodedFrame | null {
  const isResp = isResponsePacket(packet)
  if (!isResp && !isRequestPacket(packet)) return null
  const length = (packet[4] << 8) | packet[5]
  const end = Math.min(HEADER_SIZE + length, packet.length)
  const payload = packet.slice(HEADER_SIZE, end)
  const trailer = end < packet.length ? packet[end] : undefined
  const address = packet[3]
  return {
    direction: isResp ? 'response' : 'request',
    cmd: packet[2],
    address,
    target: isResp ? responseAddressToTarget(address) : ((address & 0x03) as Target),
    sourceKnown: isResp ? isKnownSourceAddress(address) : (address & 0xfc) === 0x40 && (address & 0x03) <= 2,
    length,
    payload,
    truncated: HEADER_SIZE + length > packet.length,
    trailer,
    trailerIsXor: trailer !== undefined && trailer === xorChecksum(packet, 0, end),
    raw: packet,
  }
}

/**
 * Reassembles response frames.
 *
 * Packet mode (default, USB HID) follows Android: Protocol6118Provider.checkDataComplete +
 * usb/core/packet/DefaultPacketProcessor.processReceivedData.
 *  - A packet that starts with `BB DD` is buffered until 6 + LEN bytes are present, then one
 *    frame is emitted and the rest of the packet (zero padding / iOS XOR byte) is discarded.
 *  - With nothing buffered, a packet that does not start with `BB DD` is not a frame. Android
 *    passes it on as "complete" and its parser rejects it; here it goes to `onGarbage`.
 *    Nothing is scanned or resynchronised.
 *  - Library deviation: a complete `BB DD` packet that arrives while a partial frame is
 *    buffered replaces the stale partial (Android would concatenate). Real HID replies never
 *    span packets (LEN <= 58; libusb capture PROTOCOL.md §11.6), so this only matters for
 *    corrupt input.
 *
 * Stream mode is a library extension for byte streams (iAP2-style transports, replayed logs):
 * bytes before a `BB DD` magic are dropped (reported via `onGarbage`), several frames per chunk
 * are split, and a frame is emitted once 6 + LEN bytes are buffered. Neither app does this.
 */
export class FrameAssembler {
  private buf: Uint8Array = new Uint8Array(0)
  private readonly mode: 'packet' | 'stream'
  onGarbage?: (bytes: Uint8Array) => void

  constructor(mode: 'packet' | 'stream' = 'packet') {
    this.mode = mode
  }

  /** Feed one chunk; returns all complete frames it completed. */
  push(chunk: Uint8Array): DecodedFrame[] {
    return this.mode === 'packet' ? this.pushPacket(chunk) : this.pushStream(chunk)
  }

  private pushPacket(chunk: Uint8Array): DecodedFrame[] {
    const complete = (b: Uint8Array) => b.length >= HEADER_SIZE && HEADER_SIZE + ((b[4] << 8) | b[5]) <= b.length
    if (isResponsePacket(chunk) && (complete(chunk) || this.buf.length === 0)) {
      // A fresh frame start. Any buffered partial frame is stale (library deviation, see above).
      if (this.buf.length) this.onGarbage?.(this.buf)
      this.buf = new Uint8Array(0)
      if (!complete(chunk)) {
        this.buf = chunk.slice()
        return []
      }
      const f = decodeFrame(chunk)
      return f ? [f] : []
    }
    if (this.buf.length === 0) {
      // Not a frame (Android: complete -> rejected by isValidPacket).
      if (chunk.some((b) => b !== 0)) this.onGarbage?.(chunk)
      return []
    }
    // Continuation of a buffered frame (DefaultPacketProcessor concatenates currentBuffer + newData).
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf, 0)
    merged.set(chunk, this.buf.length)
    if (!complete(merged)) {
      this.buf = merged
      return []
    }
    this.buf = new Uint8Array(0)
    const f = decodeFrame(merged.slice(0, HEADER_SIZE + ((merged[4] << 8) | merged[5])))
    return f ? [f] : []
  }

  private pushStream(chunk: Uint8Array): DecodedFrame[] {
    const out: DecodedFrame[] = []
    const merged = new Uint8Array(this.buf.length + chunk.length)
    merged.set(this.buf, 0)
    merged.set(chunk, this.buf.length)
    let pos = 0
    for (;;) {
      // find magic
      let start = -1
      for (let i = pos; i + 1 < merged.length; i++) {
        if (merged[i] === RESPONSE_MAGIC0 && merged[i + 1] === MAGIC1) {
          start = i
          break
        }
      }
      if (start < 0) {
        // keep a trailing 0xBB that may be the first half of a magic
        const keepFrom = merged.length > 0 && merged[merged.length - 1] === RESPONSE_MAGIC0 ? merged.length - 1 : merged.length
        const garbage = merged.slice(pos, keepFrom)
        if (garbage.some((b) => b !== 0)) this.onGarbage?.(garbage)
        this.buf = merged.slice(keepFrom)
        return out
      }
      if (start > pos) {
        const garbage = merged.slice(pos, start)
        if (garbage.some((b) => b !== 0)) this.onGarbage?.(garbage)
      }
      if (merged.length - start < HEADER_SIZE) {
        this.buf = merged.slice(start)
        return out
      }
      const len = (merged[start + 4] << 8) | merged[start + 5]
      if (len > MAX_PAYLOAD + 512) {
        // implausible length: skip this magic
        pos = start + 2
        continue
      }
      const total = HEADER_SIZE + len
      if (merged.length - start < total) {
        this.buf = merged.slice(start)
        return out
      }
      const frameBytes = merged.slice(start, start + total)
      const f = decodeFrame(frameBytes)
      if (f) out.push(f)
      pos = start + total
    }
  }

  reset(): void {
    this.buf = new Uint8Array(0)
  }

  get pending(): number {
    return this.buf.length
  }
}

/**
 * Firmware-upload data packet `i` (documented only; nothing in this library sends it).
 * Android FileUtils.getDataWithIndex: p[0] = 0x55, p[1..63] = fw[i*63 ..], zero padded.
 */
export function encodeOtaDataPacket(image: Uint8Array, index: number): Uint8Array {
  const p = new Uint8Array(PACKET_SIZE)
  p[0] = OTA_DATA_MAGIC
  const off = index * OTA_CHUNK_SIZE
  p.set(image.subarray(off, Math.min(off + OTA_CHUNK_SIZE, image.length)), 1)
  return p
}

export function otaPacketCount(imageLength: number): number {
  return Math.ceil(imageLength / OTA_CHUNK_SIZE)
}

// ---------------------------------------------------------------------------------- hex utils

export function toHex(bytes: ArrayLike<number>, sep = ' '): string {
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i++) parts.push((bytes[i] & 0xff).toString(16).padStart(2, '0'))
  return parts.join(sep)
}

/** Hex dump trimmed of trailing zero padding (keeps at least `minBytes`). */
export function toHexTrimmed(bytes: Uint8Array, minBytes = HEADER_SIZE): string {
  if (isRequestPacket(bytes) || isResponsePacket(bytes)) {
    minBytes = Math.max(minBytes, Math.min(bytes.length, HEADER_SIZE + ((bytes[4] << 8) | bytes[5])))
  }
  let end = bytes.length
  while (end > minBytes && bytes[end - 1] === 0) end--
  const s = toHex(bytes.subarray(0, end))
  return end < bytes.length ? `${s} …(${bytes.length - end}×00)` : s
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
  if (clean.length % 2) throw new CodecError(`odd number of hex digits in "${hex}"`)
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function hex8(n: number): string {
  return '0x' + (n & 0xff).toString(16).padStart(2, '0').toUpperCase()
}
