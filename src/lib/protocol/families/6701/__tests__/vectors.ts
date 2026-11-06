/**
 * LARK MAX 2 test vectors (FAMILIES.md §5.1). Request frames: the golden Moma vectors of max2-6701.md §3.3
 * (moma/__tests__/vectors.ts MAX2_VECTORS, built with re-implementations of A BleMicCmd.cmdSingleSend /
 * cmdMultiSend / cmdMultiMapSend and checked against I +[HLCommandFrameBuilder frameWithSource:…]). Status payloads
 * are CONSTRUCTED to pin the parser offsets (A BleMicCommUtil.generateHeartInfo / generateDeviceVersionInfo; I
 * -[HLBleHeartEntity initEntityWithData:] @0x1001fb0ac): every field has a distinct value, so a shifted offset fails.
 */
export { MAX2_VECTORS } from '../../../moma/__tests__/vectors'

/** Hex string → bytes (spaces ignored). */
export function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '')
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16))
}

/**
 * Constructed 49-byte heartbeat payload (max2-6701.md §4.2 table):
 *  0 rx 90 · 1 box 77 · 2/3 mic batt 81 62 · 4/5 charge 1 0 · 6/7 online 1 1 · 8 speaker 1 · 9 depth 0 (32-bit float)
 *  10 lock 1 · 11 NC on 1 · 12 depth 13 · 13 gain type 0 (custom) · 14 level 2 · 15/16 gains 25 14 · 17 channel 1
 *  18 deviceType 2 (camera RX, as iOS reads it) · 19 recording 0 · 20 tc mode 2 · 21 fps 4 · 22 timing 1 · 23/24 L 55 1 · 25/26 R 44 0 · 27 ears 3
 *  28 tx identify 1 · 29 tc on 1 · 30/31 remain 7 8 · 32 reset 0 · 33 wireless 1 · 34..36 tc 12 34 21
 *  37/38 gains 3/4 30 10 · 39/40 batt 3/4 66 33 · 41/42 charge 0 1 · 43/44 online 1 0 · 45/46 remain 5 6
 *  47 four mic 1 · 48 monitor 1
 */
export const HEARTBEAT_49 = hexBytes(`
  5A 4D 51 3E 01 00 01 01 01 00 01 01 0D 00 02 19 0E 01 02 00 02 04 01 37 01 2C 00 03 01 01 07 08 00
  01 0C 22 15 1E 0A 42 21 00 01 01 00 05 06 01 01`)

/** The same heartbeat cut to the 33-byte base layout (len < 34: no bytes 33..48). */
export const HEARTBEAT_33 = HEARTBEAT_49.slice(0, 33)

/** Constructed 0x600A payload: TX1 online, SN "H2MTX0000001" NUL padded, version "V3.0.0.21" 0xFF padded, battery 64, hw "H1.0", charging. */
export function versionPayload(): Uint8Array {
  const p = new Uint8Array(52)
  const put = (off: number, s: string, pad: number) => {
    for (let i = 0; i < 16; i++) p[off + i] = i < s.length ? s.charCodeAt(i) : pad
  }
  p[0] = 2
  p[1] = 1
  put(2, 'H2MTX0000001', 0x00)
  put(18, 'V3.0.0.21', 0xff)
  p[34] = 64
  put(35, ' H1.0 ', 0x00)
  p[51] = 2
  return p
}
