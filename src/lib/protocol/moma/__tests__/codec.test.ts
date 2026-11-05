/**
 * Moma envelope codec: golden vectors from the three research docs (encode = exact bytes, decode = every
 * field), the control byte and the Android parser quirk, lenient checksum handling, the streaming
 * assembler (chunking, padding, report id, resync, truncated frames) and property loops (FAMILIES.md §5.4).
 */
import { describe, expect, it } from 'vitest'
import { toHex } from '../../codec'
import { xor8 } from '../../core/bytes'
import {
  androidParserTrailerLength, decodeMomaControl, decodeMomaFrame, encodeMomaControl, encodeMomaFrame, MomaCodecError, MomaFrameAssembler,
  momaTrailerLength, MOMA_TYPE, parseMomaPacket, type MomaFrame, type MomaItemInput,
} from '../codec'
import * as P from '../profiles'
import { encodeMomaRequest, parseMomaRequest } from '../spec'
import { encodeMomaReply } from '../sim'
import { MAX2_VECTORS, MELO_VECTORS, M3_VECTORS, MOMA_VECTORS, type MomaVector } from './vectors'

const profileOf = (v: MomaVector) => (v.profile ? P[v.profile] : undefined)
const padOf = (v: MomaVector) => (v.reportId === 8 ? P.MOMA_6303.padTo : [])
const itemsOf = (f: MomaFrame) => f.items.map((i) => ({ cmd: i.cmd, type: i.type, payload: Array.from(i.payload) }))
const vItems = (v: MomaVector) => v.items.map((i) => ({ cmd: i.cmd, type: i.type, payload: [...i.payload] }))

/** Deterministic PRNG (mulberry32) for the property loops. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function feed(asm: MomaFrameAssembler, bytes: Uint8Array, cuts: number[]): MomaFrame[] {
  const out: MomaFrame[] = []
  let prev = 0
  for (const c of [...cuts, bytes.length]) {
    out.push(...asm.push(bytes.slice(prev, c)))
    prev = c
  }
  return out
}

describe('golden vectors (m3-6303.md §3.3, max2-6701.md §3.3, melo-6201.md §3.4)', () => {
  it('cover every example frame of the three docs', () => {
    expect(M3_VECTORS).toHaveLength(12) // 9 requests + 2 illustrative replies + the 6201 frame quoted in §3.4
    expect(MAX2_VECTORS).toHaveLength(9) // 7 requests + 2 constructed replies
    expect(MELO_VECTORS).toHaveLength(13) // 11 requests + 2 hypothetical replies
  })

  for (const v of MOMA_VECTORS) {
    describe(`${v.name}${v.hypothetical ? ' (hypothetical reply: pins the parser layout only)' : ''}`, () => {
      it('encodes to the exact bytes', () => {
        const bytes = encodeMomaFrame(v.items, {
          head: v.head, source: v.source, target: v.target, control: v.control, reportId: v.reportId, padTo: padOf(v),
        })
        expect(toHex(bytes)).toBe(toHex(v.bytes))
        const p = profileOf(v)
        if (p) {
          const req = { items: v.items, ...(v.target !== p.target ? { target: v.target } : {}) }
          expect(toHex(encodeMomaRequest(p, req)), `${p.name} request`).toBe(toHex(v.bytes))
        }
      })

      it('decodes every header field and item', () => {
        const r = decodeMomaFrame(v.bytes, { reportId: v.reportId })
        expect(r.status).toBe('ok')
        if (r.status !== 'ok') return
        const f = r.frame
        expect(f.head).toBe(v.head)
        expect(f.reportId).toBe(v.reportId)
        expect([f.source, f.target, f.control]).toEqual([v.source, v.target, v.control])
        expect(itemsOf(f)).toEqual(vItems(v))
        expect(f.count).toBe(v.items.length + (v.control & 1) + ((v.control >> 1) & 1))
        expect(f.markers).toEqual({ start: (v.control & 1) === 1, end: (v.control & 2) === 2 })
        expect(f.anomalies).toEqual([])
        if ((v.control >> 2) & 3) expect(f.checksum).toMatchObject({ kind: 'xor', present: true, ok: true })
        else expect(f.checksum).toMatchObject({ kind: 'none', present: false, ok: null })
        // Everything after the frame is zero padding.
        expect(r.length).toBe(f.raw.length + (v.reportId === null ? 0 : 1))
        expect(Array.from(v.bytes.slice(r.length)).every((b) => b === 0)).toBe(true)
        expect(parseMomaPacket(v.bytes, { reportId: v.reportId })).not.toBeNull()
      })

      it('assembles identically whole, at every split point and in 1/7/20-byte chunks', () => {
        const whole = new MomaFrameAssembler({ reportId: v.reportId }).push(v.bytes)
        expect(whole).toHaveLength(1)
        expect(itemsOf(whole[0])).toEqual(vItems(v))
        const end = Math.min(v.bytes.length, whole[0].raw.length + 2)
        for (let cut = 1; cut < end; cut++) {
          const got = feed(new MomaFrameAssembler({ reportId: v.reportId }), v.bytes, [cut])
          expect(got.map(itemsOf), `cut at ${cut}`).toEqual([vItems(v)])
        }
        for (const n of [1, 7, 20]) {
          const cuts: number[] = []
          for (let i = n; i < v.bytes.length; i += n) cuts.push(i)
          const garbage: Uint8Array[] = []
          const asm = new MomaFrameAssembler({ reportId: v.reportId })
          asm.onGarbage = (b) => garbage.push(b)
          expect(feed(asm, v.bytes, cuts).map(itemsOf), `chunks of ${n}`).toEqual([vItems(v)])
          expect(garbage, `chunks of ${n}: no garbage`).toEqual([])
        }
      })

      if (v.head === 'down' && v.profile) {
        it('parses back as a request of its profile', () => {
          const p = profileOf(v)!
          const req = parseMomaRequest(p, v.bytes)
          expect(req).not.toBeNull()
          expect(req!.items.map((i) => ({ cmd: i.cmd, type: i.type, payload: Array.from(i.payload ?? []) }))).toEqual(vItems(v))
          expect(toHex(encodeMomaRequest(p, req!))).toBe(toHex(v.bytes))
        })
      }

      if (v.head === 'up') {
        it('is what encodeMomaReply builds for the family profile', () => {
          const p = v.reportId === 8 ? P.MOMA_6303 : v.control === 7 ? P.MOMA_6701_BLE : P.MOMA_6201_USB
          expect(toHex(encodeMomaReply(p, v.items, { source: v.source }))).toBe(toHex(v.bytes))
        })
      }
    })
  }
})

describe('control byte (A CommandPostBuilder.build / CommandStanderParser.parse)', () => {
  it('encodes as (end << 1) + start + (algorithm << 2) + (method << 4)', () => {
    expect(encodeMomaControl({ start: false, end: false, checksum: 'none', reliable: false })).toBe(0x00) // 6303
    expect(encodeMomaControl({ start: false, end: false, checksum: 'xor', reliable: false })).toBe(0x04) // 6201
    expect(encodeMomaControl({ start: true, end: true, checksum: 'xor', reliable: false })).toBe(0x07) // 6701
    expect(encodeMomaControl({ start: false, end: false, checksum: 'crc32', reliable: true })).toBe(0x1c)
    for (let b = 0; b < 0x20; b++) expect(encodeMomaControl(decodeMomaControl(b))).toBe(b)
  })

  it('pins the Android parser quirk: bits 2–3 read reversed, so the builder XOR (0x04) parses as CRC16', () => {
    expect(decodeMomaControl(0x04)).toMatchObject({ checksum: 'xor', parserChecksum: 'crc16' })
    expect(decodeMomaControl(0x08)).toMatchObject({ checksum: 'crc16', parserChecksum: 'xor' })
    expect(decodeMomaControl(0x0c)).toMatchObject({ checksum: 'crc32', parserChecksum: 'crc32' })
    // The builder appends one byte for any algorithm; the Android parser waits for 2 (0x04) or 3 (CRC32).
    expect([0x00, 0x04, 0x07, 0x08, 0x0c].map(momaTrailerLength)).toEqual([0, 1, 1, 1, 1])
    expect([0x00, 0x04, 0x07, 0x08, 0x0c].map(androidParserTrailerLength)).toEqual([0, 2, 2, 1, 3])
  })
})

describe('lenient checksum', () => {
  const R2 = MELO_VECTORS.find((v) => v.name.startsWith('MELO R2'))!
  const item: MomaItemInput = { cmd: 0x600b, type: MOMA_TYPE.DATA, payload: [80, 60, 90] }

  it('decodes a frame whose XOR is wrong, and reports the mismatch', () => {
    const bad = R2.bytes.slice()
    bad[bad.length - 1] ^= 0xff
    const r = decodeMomaFrame(bad)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.frame.checksum).toMatchObject({ kind: 'xor', present: true, ok: false, value: 0x8b, expected: 0x74 })
    expect(r.frame.anomalies.join()).toMatch(/XOR mismatch: got 0x8b, expected 0x74/)
    expect(r.frame.items[0]).toMatchObject({ cmd: 0x1300, type: 2 })
  })

  it('takes checksum presence from each frame: control 0x04 (Android, XOR) and 0x00 (iOS, none) both decode (FAMILIES.md §5.2)', () => {
    const android = encodeMomaFrame([item], { head: 'up', source: 1, target: 6, control: 0x04 })
    const ios = encodeMomaFrame([item], { head: 'up', source: 1, target: 6, control: 0x00 })
    expect(android.length).toBe(ios.length + 1)
    const asm = new MomaFrameAssembler()
    const frames = [...asm.push(android), ...asm.push(ios), ...asm.push(android)]
    expect(frames.map((f) => f.checksum.kind)).toEqual(['xor', 'none', 'xor'])
    expect(frames.map(itemsOf)).toEqual([itemsOf(frames[0]), itemsOf(frames[0]), itemsOf(frames[0])])
  })

  it('a device that follows the Android parser (two trailing bytes for 0x04) costs one skipped byte, no frame', () => {
    const one = encodeMomaFrame([item], { head: 'up', source: 1, target: 6, control: 0x04 })
    const extra = Uint8Array.from([...one, 0x5c])
    const garbage: Uint8Array[] = []
    const asm = new MomaFrameAssembler()
    asm.onGarbage = (b) => garbage.push(b)
    const frames = [...asm.push(extra), ...asm.push(one)]
    expect(frames).toHaveLength(2)
    expect(frames.every((f) => f.checksum.ok)).toBe(true)
    expect(garbage.map((g) => toHex(g))).toEqual(['5c'])
  })

  it('emits a frame whose items end at a packet end without waiting for the checksum; a late XOR byte is swallowed', () => {
    const f = encodeMomaFrame([item], { head: 'up', source: 1, target: 6, control: 0x04 })
    const garbage: Uint8Array[] = []
    const asm = new MomaFrameAssembler()
    asm.onGarbage = (b) => garbage.push(b)
    const first = asm.push(f.slice(0, -1))
    expect(first).toHaveLength(1)
    expect(first[0].checksum).toMatchObject({ present: false, ok: null, expected: f[f.length - 1] })
    expect(first[0].anomalies).toContain('checksum byte not received with the frame')
    expect(asm.push(f.slice(-1))).toEqual([])
    expect(asm.pending).toBe(0)
    expect(garbage).toEqual([])
  })

  it('a device that sets the XOR bit but sends no byte does not block the next frame', () => {
    const f = encodeMomaFrame([item], { head: 'up', source: 1, target: 6, control: 0x04 })
    const asm = new MomaFrameAssembler()
    const got = [...asm.push(f.slice(0, -1)), ...asm.push(f.slice(0, -1)), ...asm.push(f)]
    expect(got).toHaveLength(3)
    expect(got.map((x) => x.checksum.present)).toEqual([false, false, true])
  })

  it('does not swallow a new frame whose first byte equals the late XOR (0xBB)', () => {
    // Find a payload whose XOR is 0xBB, so the "late checksum" and the next frame's magic collide.
    let payload = [0]
    for (let b = 0; b < 256; b++) {
      const f = encodeMomaFrame([{ cmd: 0x600b, type: 3, payload: [b] }], { head: 'up', source: 1, target: 6, control: 0x04 })
      if (f[f.length - 1] === 0xbb) {
        payload = [b]
        break
      }
    }
    const f = encodeMomaFrame([{ cmd: 0x600b, type: 3, payload }], { head: 'up', source: 1, target: 6, control: 0x04 })
    expect(f[f.length - 1]).toBe(0xbb)
    const asm = new MomaFrameAssembler()
    expect(asm.push(f.slice(0, -1))).toHaveLength(1)
    const next = asm.push(f)
    expect(next).toHaveLength(1)
    expect(next[0].checksum.ok).toBe(true)
  })
})

describe('markers', () => {
  it('drops start/end marker items and reports disagreement with the control byte', () => {
    // control 0x07 but no markers: lenient decode, two anomalies.
    const noMarkers = encodeMomaFrame([{ cmd: 0x600b }], { target: 1, control: 0x04 })
    noMarkers[4] = 0x07
    noMarkers[noMarkers.length - 1] = xor8(noMarkers, 0, noMarkers.length - 1)
    const r = decodeMomaFrame(noMarkers)
    expect(r.status).toBe('ok')
    if (r.status === 'ok') {
      expect(r.frame.items.map((i) => i.cmd)).toEqual([0x600b])
      expect(r.frame.anomalies).toEqual(['control bit 0 set but no start marker', 'control bit 1 set but no end marker'])
    }
  })

  it('a markers-only frame has no command items', () => {
    const f = encodeMomaFrame([], { head: 'up', source: 2, target: 6, control: 0x07 })
    expect(toHex(f)).toBe('bb dd 02 06 07 00 02 5a fa 00 00 00 5e fe 00 00 00 ' + toHex([xor8(f, 0, f.length - 1)]))
    const r = decodeMomaFrame(f)
    expect(r.status === 'ok' && r.frame.items).toEqual([])
  })
})

describe('encoder', () => {
  it('pads 6303 packets: < 64 → 64, < 512 → 512, ≥ 512 as is (Protocol6303Provider.buildPacket)', () => {
    const size = (n: number) => encodeMomaRequest(P.MOMA_6303, { items: [{ cmd: 0x1f16, payload: new Array<number>(n).fill(1) }] }).length
    // 13 bytes of overhead incl. the report id (cmdSingleStandardSize). The app's comparisons are strict:
    // a 64-byte packet (payload 51) is padded to 512, a 512-byte packet (payload 499) is sent as is.
    expect([size(0), size(50), size(51), size(52), size(498), size(499), size(500), size(600)])
      .toEqual([64, 64, 512, 512, 512, 512, 513, 613])
  })

  it('writes unpadded 6201/6701 frames', () => {
    expect(encodeMomaRequest(P.MOMA_6201_BLE, { items: [{ cmd: 0x600b }] })).toHaveLength(13)
    expect(encodeMomaRequest(P.MOMA_6701_BLE, { items: [{ cmd: 0x600b }] })).toHaveLength(23)
  })

  it('rejects out-of-range fields and the unused CRC algorithms', () => {
    const o = { target: 0, control: 0x04 }
    expect(() => encodeMomaFrame([{ cmd: 0x10000 }], o)).toThrow(MomaCodecError)
    expect(() => encodeMomaFrame([{ cmd: 1, type: 256 }], o)).toThrow(MomaCodecError)
    expect(() => encodeMomaFrame([{ cmd: 1, payload: [256] }], o)).toThrow(MomaCodecError)
    expect(() => encodeMomaFrame([{ cmd: 1, payload: [1.5] }], o)).toThrow(MomaCodecError)
    expect(() => encodeMomaFrame([{ cmd: 1 }], { target: 300, control: 4 })).toThrow(MomaCodecError)
    expect(() => encodeMomaFrame([{ cmd: 1 }], { target: 0, control: 0x08 })).toThrow(/crc16 is not implemented/)
  })
})

describe('decoder', () => {
  it('needs more bytes for partial frames and rejects non-frames', () => {
    const f = MAX2_VECTORS[0].bytes
    for (let n = 1; n < f.length; n++) {
      const r = decodeMomaFrame(f.slice(0, n))
      expect(r.status, `${n} bytes`).toBe('incomplete')
    }
    expect(decodeMomaFrame(f.slice(0, -1))).toEqual({ status: 'incomplete', itemsComplete: true })
    expect(decodeMomaFrame(Uint8Array.of(0xde, 0xad))).toMatchObject({ status: 'invalid' })
    expect(decodeMomaFrame(Uint8Array.of(0xbb, 0x00, 1, 2, 3, 4, 5))).toMatchObject({ status: 'invalid' })
    expect(decodeMomaFrame(Uint8Array.of(0xbb, 0xdd, 1, 6, 0, 0xff, 0xff))).toMatchObject({ status: 'invalid', reason: /item count/ })
    // An item that would exceed maxFrameBytes.
    expect(decodeMomaFrame(Uint8Array.of(0xbb, 0xdd, 1, 6, 0, 0, 1, 0x60, 0, 3, 0xff, 0xff), { maxFrameBytes: 4096 })).toMatchObject({
      status: 'invalid', reason: /longer than 4096/,
    })
  })

  it('accepts a 6303 frame with or without the report id byte', () => {
    const v = M3_VECTORS[0]
    const a = decodeMomaFrame(v.bytes, { reportId: 8 })
    const b = decodeMomaFrame(v.bytes.subarray(1), { reportId: 8 })
    expect(a.status === 'ok' && b.status === 'ok').toBe(true)
    if (a.status === 'ok' && b.status === 'ok') {
      expect(itemsOf(a.frame)).toEqual(itemsOf(b.frame))
      expect([a.frame.reportId, b.frame.reportId]).toEqual([8, null])
    }
  })

  it('heads option: simulators read AA DD only', () => {
    const reply = MELO_VECTORS.find((v) => v.head === 'up')!.bytes
    expect(decodeMomaFrame(reply, { heads: 'down' }).status).toBe('invalid')
    expect(new MomaFrameAssembler({ heads: 'down' }).push(reply)).toEqual([])
    expect(new MomaFrameAssembler({ heads: 'up' }).push(MELO_VECTORS[0].bytes)).toEqual([])
  })
})

describe('streaming assembler', () => {
  const hb = MELO_VECTORS.find((v) => v.name.startsWith('MELO R1'))!.bytes
  const ack = MELO_VECTORS.find((v) => v.name.startsWith('MELO R2'))!.bytes

  it('resyncs past leading junk and reports it; zero padding is silent', () => {
    const garbage: Uint8Array[] = []
    const asm = new MomaFrameAssembler()
    asm.onGarbage = (b) => garbage.push(b)
    const frames = asm.push(Uint8Array.from([0x01, 0x02, 0xbb, 0x00, ...hb, 0, 0, 0, 0, ...ack, 0, 0]))
    expect(frames.map((f) => f.items[0].cmd)).toEqual([0x600b, 0x1300])
    // One contiguous junk run (BB not followed by DD is junk too); the padding between frames is not reported.
    expect(garbage.map((g) => toHex(g))).toEqual(['01 02 bb 00'])
  })

  it('splits back-to-back frames in one notification and frames spread over many', () => {
    const both = Uint8Array.from([...hb, ...ack])
    for (let cut = 1; cut < both.length; cut++) {
      const got = feed(new MomaFrameAssembler(), both, [cut])
      expect(got.map((f) => f.items[0].cmd), `cut ${cut}`).toEqual([0x600b, 0x1300])
    }
  })

  it('strips the 6303 report id only where a frame starts (continuations are raw bytes)', () => {
    // A long reply whose payload has 0x08 at a chunk boundary.
    const payload = Array.from({ length: 120 }, (_, i) => (i % 9 === 2 ? 0x08 : i & 0xff))
    const f = encodeMomaFrame([{ cmd: 0x1f04, type: 3, payload }], { head: 'up', source: 1, target: 6, control: 0, reportId: 8, padTo: [64, 512] })
    for (let cut = 1; cut < 140; cut++) {
      const got = feed(new MomaFrameAssembler({ reportId: 8 }), f, [cut])
      expect(got.map(itemsOf), `cut ${cut}`).toEqual([[{ cmd: 0x1f04, type: 3, payload }]])
    }
  })

  it('drops a frame truncated by the transport when the next report starts a new frame (63-byte input report, FAMILIES.md §6 #3)', () => {
    const long = encodeMomaFrame([{ cmd: 0x1f18, type: 3, payload: new Array<number>(400).fill(7) }], {
      head: 'up', source: 1, target: 6, control: 0, reportId: 8, padTo: [64, 512],
    })
    const hb3 = M3_VECTORS.find((v) => v.name.startsWith('M3 heartbeat reply'))!.bytes
    const garbage: Uint8Array[] = []
    const asm = new MomaFrameAssembler({ reportId: 8 })
    asm.onGarbage = (b) => garbage.push(b)
    expect(asm.push(long.slice(0, 64))).toEqual([]) // only the first report arrived
    const got = asm.push(hb3)
    expect(got.map((x) => x.items[0].cmd)).toEqual([0x6000])
    expect(garbage).toHaveLength(1)
    expect(garbage[0].length).toBe(63)
  })

  it('keeps a pending frame when a continuation merely looks like a frame start but completes it with a valid XOR', () => {
    // Payload bytes that form "BB DD 01 06 04 00 01" exactly at the chunk boundary.
    const payload = [1, 2, 3, 0xbb, 0xdd, 0x01, 0x06, 0x04, 0x00, 0x01, 9, 9]
    const f = encodeMomaFrame([{ cmd: 0x11eb, type: 0, payload }], { head: 'up', source: 1, target: 6, control: 0x04 })
    const boundary = 7 + 5 + 3
    const got = feed(new MomaFrameAssembler(), f, [boundary])
    expect(got.map(itemsOf)).toEqual([[{ cmd: 0x11eb, type: 0, payload }]])
  })

  it('skips a false header with an absurd length and finds the real frame after it', () => {
    const fake = [0xbb, 0xdd, 0x01, 0x06, 0x00, 0x00, 0x01, 0x60, 0x00, 0x03, 0xff, 0xff]
    const asm = new MomaFrameAssembler({ maxFrameBytes: 4096 })
    expect(asm.push(Uint8Array.from([...fake, ...ack])).map((f) => f.items[0].cmd)).toEqual([0x1300])
  })

  it('reset() forgets a partial frame', () => {
    const asm = new MomaFrameAssembler()
    asm.push(hb.slice(0, 10))
    expect(asm.pending).toBe(10)
    asm.reset()
    expect(asm.pending).toBe(0)
    expect(asm.push(ack)).toHaveLength(1)
  })
})

describe('properties (seeded loops, FAMILIES.md §5.4)', () => {
  const profiles = P.MOMA_PROFILES
  const randomFrame = (r: () => number) => {
    const p = profiles[Math.floor(r() * profiles.length)]
    const n = 1 + Math.floor(r() * 4)
    const items: MomaItemInput[] = Array.from({ length: n }, () => ({
      cmd: Math.floor(r() * 0x10000),
      type: Math.floor(r() * 4),
      payload: Array.from({ length: Math.floor(r() * 80) }, () => Math.floor(r() * 256)),
    }))
    const head = r() < 0.5 ? ('up' as const) : ('down' as const)
    const bytes = encodeMomaFrame(items, { head, source: 1, target: p.target, control: p.control, reportId: p.reportId, padTo: p.padTo })
    return { p, items, bytes }
  }
  const norm = (items: readonly MomaItemInput[]) =>
    items.filter((i) => !((i.cmd === 0x5afa || i.cmd === 0x5efe) && !i.payload?.length)).map((i) => ({ cmd: i.cmd, type: i.type, payload: Array.from(i.payload ?? []) }))

  it('random frames round-trip through encode → decode for every profile', () => {
    const r = rng(1)
    for (let k = 0; k < 400; k++) {
      const { p, items, bytes } = randomFrame(r)
      const d = decodeMomaFrame(bytes, { reportId: p.reportId })
      expect(d.status).toBe('ok')
      if (d.status === 'ok') {
        expect(itemsOf(d.frame)).toEqual(norm(items))
        expect(d.frame.anomalies).toEqual([])
      }
    }
  })

  it('random chunk splits and leading junk never change the decoded frames', () => {
    const r = rng(2)
    for (let k = 0; k < 300; k++) {
      const { p, items, bytes } = randomFrame(r)
      // Junk without magic bytes (a magic in junk legitimately starts a resync attempt).
      const junk = Array.from({ length: Math.floor(r() * 6) }, () => 1 + Math.floor(r() * 0x9f))
      const stream = Uint8Array.from([...junk, ...bytes])
      const cuts = new Set<number>()
      const nCuts = Math.floor(r() * 5)
      for (let i = 0; i < nCuts; i++) cuts.add(1 + Math.floor(r() * (stream.length - 1)))
      const got = feed(new MomaFrameAssembler({ reportId: p.reportId }), stream, [...cuts].sort((a, b) => a - b))
      // A junk-only first chunk ending in the report id would be stripped as one: never changes the frame.
      expect(got.map(itemsOf), `case ${k}`).toEqual([norm(items)])
    }
  })

  it('random bytes never throw from the decoder or the assembler', () => {
    const r = rng(3)
    for (const reportId of [null, 8]) {
      const asm = new MomaFrameAssembler({ reportId })
      for (let k = 0; k < 500; k++) {
        const b = Uint8Array.from({ length: Math.floor(r() * 40) }, () => (r() < 0.2 ? [0xbb, 0xdd, 0xaa, 0x08][Math.floor(r() * 4)] : Math.floor(r() * 256)))
        expect(() => decodeMomaFrame(b, { reportId })).not.toThrow()
        expect(() => asm.push(b)).not.toThrow()
      }
    }
  })
})
