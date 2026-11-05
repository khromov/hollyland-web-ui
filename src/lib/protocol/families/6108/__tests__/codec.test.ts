/**
 * LARK A1 codec: golden request vectors (Android Feature-5 frame + iOS EA form from the same request), the reply
 * decoder's Android rules, the request parser (incl. OTA classification) and the report assembler.
 */
import { describe, expect, it } from 'vitest'
import { CodecError, fromHex, toHex } from '../../../codec'
import { chunkBytes, padBytes } from '../../../core/bytes'
import {
  A1Assembler, A1_MAX_PAYLOAD, A1_REPORT_SIZE, a1CommandOfFrame, decodeA1Reply, encodeA1EaFrame, encodeA1Frame, parseA1Request,
} from '../codec'
import { A1_COMMANDS } from '../commands'
import { encodeA1SimReply } from '../sim'
import { A1_HEARTBEAT_BODY_HEX, A1_HEARTBEAT_REPLY_HEX, A1_OTA_VECTORS, A1_REQUEST_VECTORS } from './vectors'

const frame64 = (hex: string) => padBytes(fromHex(hex), A1_REPORT_SIZE)

describe('A1 request frames (a1-6108.md §3.6 vectors)', () => {
  for (const v of A1_REQUEST_VECTORS) {
    it(`#${v.n} ${v.name}`, () => {
      const f = encodeA1Frame(v.request.cmd, v.request.payload ?? [])
      expect(f).toHaveLength(64)
      expect(toHex(f)).toBe(toHex(frame64(v.hex)))
      // iOS EA frame from the same request object (FAMILIES.md §5.2 cross-check)
      expect(toHex(encodeA1EaFrame(v.request.cmd, v.request.payload ?? []))).toBe(toHex(fromHex(v.ios)))
      // inverse
      expect(parseA1Request(f)).toEqual({ report: 5, cmd: v.request.cmd, payload: Uint8Array.from(v.request.payload ?? []) })
      expect(parseA1Request(fromHex(v.hex))?.cmd).toBe(v.request.cmd) // trimmed console input
      expect(a1CommandOfFrame(f)).toBe(v.request.cmd)
      expect(A1_COMMANDS[v.request.cmd], 'catalogued').toBeDefined()
    })
  }

  it('writes the length big-endian, only for a non-empty payload, and EF right after the payload', () => {
    const f = encodeA1Frame(0x13, [1, 2])
    expect([...f.subarray(0, 10)]).toEqual([0x05, 0x03, 0xaa, 0xdd, 0x13, 0x00, 0x02, 0x01, 0x02, 0xef])
    expect(f.subarray(10).every((b) => b === 0)).toBe(true)
    const max = encodeA1Frame(0x01, new Array(A1_MAX_PAYLOAD).fill(7))
    expect(max[5]).toBe(0)
    expect(max[6]).toBe(56)
    expect(max[63]).toBe(0xef)
    expect(() => encodeA1Frame(0x01, new Array(A1_MAX_PAYLOAD + 1).fill(0))).toThrow(CodecError)
    expect(() => encodeA1Frame(0x100)).toThrow(CodecError)
    expect(() => encodeA1Frame(1, [256])).toThrow(CodecError)
  })

  it('classifies the Feature-6 OTA frames as OTA commands (never built, always refused)', () => {
    for (const v of A1_OTA_VECTORS) {
      const f = new Uint8Array(160).fill(0xcd)
      f.set(fromHex(v.hex))
      const r = parseA1Request(f)
      expect(r, v.name).toMatchObject({ report: 6, cmd: v.cmd })
      expect(A1_COMMANDS[v.cmd].safety).toBe('ota')
      expect(a1CommandOfFrame(f)).toBe(v.cmd)
    }
    // enter-DFU payload: firmware type, version, size u32 LE (123456 = 0x0001E240)
    const dfu = new Uint8Array(160).fill(0xcd)
    dfu.set(fromHex(A1_OTA_VECTORS[1].hex))
    expect([...parseA1Request(dfu)!.payload]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0xe2, 0x01, 0x00])
  })

  it('rejects frames that are not A1 requests', () => {
    expect(parseA1Request(fromHex('de ad be ef'))).toBeNull()
    expect(parseA1Request(fromHex('aa dd 1f 00 00 68'))).toBeNull() // iOS EA form is not a HID frame
    expect(parseA1Request(fromHex('05 03 aa dd 1f 00 00 00'))).toBeNull() // EF missing
    expect(parseA1Request(fromHex('05 03 aa dd 13 00 02 01'))).toBeNull() // truncated
    expect(parseA1Request(fromHex('05 03 aa dd 13 00 40 01'))).toBeNull() // length > 56
    expect(parseA1Request(fromHex('aa dd 10 40 00 00'))).toBeNull() // legacy A2 heartbeat
  })
})

describe('A1 reply decoder (A ProtocolV2.parse)', () => {
  it('decodes the expected heartbeat reply (hypothetical bytes 1–3)', () => {
    const r = decodeA1Reply(padBytes(fromHex(A1_HEARTBEAT_REPLY_HEX), 64))!
    expect(r.cmd).toBe(0x1f)
    expect(r.length).toBe(23)
    expect(toHex(r.payload)).toBe(toHex(fromHex(A1_HEARTBEAT_BODY_HEX)))
    expect(r).toMatchObject({ reportId: 5, byte1: 3, magicOk: true, ota: false })
    expect(r.endMarker).toBe(false) // the illustrative reply has no EF; the simulator adds one
    expect(decodeA1Reply(encodeA1SimReply(0x1f, fromHex(A1_HEARTBEAT_BODY_HEX)))?.endMarker).toBe(true)
  })

  it('does not check bytes 0..3, like Android', () => {
    const r = decodeA1Reply(padBytes(fromHex('00 77 12 34 13 00 01 00'), 64))!
    expect(r).toMatchObject({ cmd: 0x13, reportId: 0, byte1: 0x77, magicOk: false })
    expect([...r.payload]).toEqual([0])
  })

  it('returns null where ProtocolV2.parse returns false', () => {
    expect(decodeA1Reply(new Uint8Array(64))).toBeNull() // length 0 ("nothing ready")
    expect(decodeA1Reply(fromHex('05 03 bb dd'))).toBeNull() // <= 4 bytes
    expect(decodeA1Reply(fromHex('05 03 bb dd 1f 00'))).toBeNull() // < 7 bytes
    expect(decodeA1Reply(padBytes(fromHex('05 03 bb dd 1f 00 3a'), 64))).toBeNull() // 58 > 64 - 7
    expect(decodeA1Reply(padBytes(fromHex('05 03 bb dd 1f 01 04'), 64))).toBeNull() // data[5] != 0: BE length 260
    expect(decodeA1Reply(padBytes(fromHex('05 03 bb dd 1f 00 39'), 64))?.length).toBe(57) // exactly fits
  })

  it('applies the OTA reply special cases (commands 0x1A..0x1E)', () => {
    expect(decodeA1Reply(fromHex('06 00 00 00 1a 07'))).toMatchObject({ cmd: 0x1a, ota: true, payload: Uint8Array.of(7) })
    expect(decodeA1Reply(fromHex('06 00 00 00 1d 00 00 00 00 09'))).toMatchObject({ cmd: 0x1d, ota: true, payload: Uint8Array.of(9) })
  })

  it('never throws on random bytes', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) & 0xff
    for (let i = 0; i < 500; i++) {
      const b = Uint8Array.from({ length: rnd() % 80 }, rnd)
      expect(() => decodeA1Reply(b)).not.toThrow()
      expect(() => parseA1Request(b)).not.toThrow()
    }
  })

  it('round-trips random payloads through the simulator reply builder', () => {
    let seed = 3
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) & 0xff
    for (let i = 0; i < 200; i++) {
      const cmd = 1 + (rnd() % 0x18) // avoid the OTA status layouts 0x1A..0x1E
      const body = Uint8Array.from({ length: 1 + (rnd() % A1_MAX_PAYLOAD) }, rnd)
      const r = decodeA1Reply(encodeA1SimReply(cmd, body))!
      expect(r.cmd).toBe(cmd)
      expect([...r.payload]).toEqual([...body])
      const req = Array.from({ length: rnd() % (A1_MAX_PAYLOAD + 1) }, rnd)
      expect([...parseA1Request(encodeA1Frame(cmd, req))!.payload]).toEqual(req)
    }
  })
})

describe('A1Assembler', () => {
  const replies = [encodeA1SimReply(0x1f, fromHex(A1_HEARTBEAT_BODY_HEX)), encodeA1SimReply(0x0d, [0, 1, 0, 1, 3]), encodeA1SimReply(0x13, [0])]

  it('decodes whole reports, one message each', () => {
    const a = new A1Assembler()
    const msgs = replies.flatMap((r) => a.push(r))
    expect(msgs.map((m) => m.cmd)).toEqual([0x1f, 0x0d, 0x13])
    expect(msgs[0].raw).toHaveLength(64)
  })

  it('re-assembles reports split at every size', () => {
    const want = replies.map((r) => decodeA1Reply(r))
    const stream = new Uint8Array(replies.length * 64)
    replies.forEach((r, i) => stream.set(r, i * 64))
    for (let n = 1; n <= 70; n++) {
      const a = new A1Assembler()
      const got = chunkBytes(stream, n).flatMap((c) => a.push(c))
      expect(got, `chunk ${n}`).toEqual(want)
    }
  })

  it('reports undecodable reports as garbage and keeps going; reset() drops a partial report', () => {
    const a = new A1Assembler()
    const garbage: Uint8Array[] = []
    a.onGarbage = (b) => garbage.push(b)
    expect(a.push(new Uint8Array(64))).toEqual([]) // all-zero report: nothing ready
    expect(garbage).toHaveLength(1)
    expect(a.push(replies[2]).map((m) => m.cmd)).toEqual([0x13])
    expect(a.push(replies[0].subarray(0, 30))).toEqual([])
    a.reset()
    expect(a.push(replies[1]).map((m) => m.cmd)).toEqual([0x0d])
  })
})
