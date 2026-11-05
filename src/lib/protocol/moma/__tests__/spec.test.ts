/**
 * Engine glue: createMomaSpecBase (encode / parseRequest / matches / ack / commandOf / describe / rawOf),
 * MomaAssembler, request builders, profile selection and the simulator helpers.
 */
import { describe, expect, it } from 'vitest'
import { toHex } from '../../codec'
import type { CommandCatalogue } from '../../core/types'
import { encodeMomaFrame, MOMA_TYPE, type MomaItemInput } from '../codec'
import {
  MOMA_6201_BLE, MOMA_6201_USB, MOMA_6303, MOMA_6701_BLE, MOMA_6701_USB, MOMA_6701_USB_CAMERA, momaProfileFor, withTarget,
} from '../profiles'
import { applyMomaFaults, encodeMomaReply, momaAck, momaData, momaNotify, MomaRequestReader } from '../sim'
import {
  createMomaSpecBase, describeMoma, isMomaEcho, MomaAssembler, momaBatch, momaCommandOf, momaCommandOfFrame, momaItemBytes, momaMessages,
  momaRequest, momaStatusAck, type MomaMessage, type MomaRequest,
} from '../spec'
import { MAX2_VECTORS, MELO_VECTORS, M3_VECTORS } from './vectors'

const CAT: CommandCatalogue = {
  0x600b: { name: 'HEART', safety: 'read', retrySafe: true, source: 'test' },
  0x1301: { name: 'GET_NC', safety: 'read', retrySafe: true, source: 'test' },
  0x1300: { name: 'SET_NC', safety: 'write', retrySafe: true, source: 'test' },
  0x2007: { name: 'RESET', safety: 'destructive', retrySafe: false, source: 'test' },
  0x4000: { name: 'OTA', safety: 'ota', retrySafe: false, source: 'test' },
}

/** Messages of one reply frame built with the profile. */
function reply(profile = MOMA_6201_USB, items: MomaItemInput[], o: { source?: number } = {}): MomaMessage[] {
  return new MomaAssembler(profile).push(encodeMomaReply(profile, items, o))
}

describe('request builders and profiles', () => {
  it('momaRequest / momaBatch build what the vectors encode', () => {
    const base = createMomaSpecBase(MOMA_6201_USB, { commands: CAT })
    expect(toHex(base.encode(momaRequest(0x600b)))).toBe(toHex(MELO_VECTORS[0].bytes))
    expect(toHex(base.encode(momaBatch([0x600b, 0x1301])))).toBe(toHex(MELO_VECTORS.find((v) => v.name.startsWith('MELO 10'))!.bytes))
    const ble = createMomaSpecBase(MOMA_6701_BLE)
    expect(toHex(ble.encode(momaRequest(0x600a, [1], { target: 5 })))).toBe(toHex(MAX2_VECTORS[3].bytes))
    expect(() => momaBatch([])).toThrow(RangeError)
  })

  it('momaProfileFor follows the Android routing (BleMicCmd.<init>, provider configs)', () => {
    expect(momaProfileFor('6303', 1036, 'usb')).toBe(MOMA_6303)
    expect(momaProfileFor('6701', 1026, 'usb')).toBe(MOMA_6701_USB)
    expect(momaProfileFor('6701', 1027, 'usb')).toBe(MOMA_6701_USB_CAMERA)
    expect(momaProfileFor('6701', 101, 'ble')).toBe(MOMA_6701_BLE)
    expect(momaProfileFor('6201', 1032, 'usb')).toBe(MOMA_6201_USB)
    expect(momaProfileFor('6201', 1032, 'ble')).toBe(MOMA_6201_BLE)
    expect(withTarget(MOMA_6701_BLE, 5)).toMatchObject({ target: 5, control: 7 })
  })
})

describe('createMomaSpecBase', () => {
  const base = createMomaSpecBase(MOMA_6201_USB, { commands: CAT })

  it('parseRequest is the inverse of encode for the profile and refuses everything else', () => {
    for (const v of MELO_VECTORS.filter((x) => x.profile === 'MOMA_6201_USB')) {
      const r = base.parseRequest(v.bytes)
      expect(r, v.name).not.toBeNull()
      expect(toHex(base.encode(r!))).toBe(toHex(v.bytes))
    }
    // Replies, another profile's framing (BLE target is fine, iOS control is not), junk, trailing junk.
    expect(base.parseRequest(MELO_VECTORS.find((v) => v.head === 'up')!.bytes)).toBeNull()
    expect(base.parseRequest(MELO_VECTORS[2].bytes)).toBeNull() // iOS control 0x00
    expect(base.parseRequest(MELO_VECTORS[1].bytes)).toEqual({ items: [{ cmd: 0x600b, type: 1, payload: [] }], target: 1 })
    expect(base.parseRequest(Uint8Array.of(0xde, 0xad, 0xbe, 0xef))).toBeNull()
    expect(base.parseRequest(Uint8Array.from([...MELO_VECTORS[0].bytes, 0x33]))).toBeNull()
    // 6303: report id required, padding optional (a console frame may be typed unpadded).
    const m3 = createMomaSpecBase(MOMA_6303)
    expect(m3.parseRequest(M3_VECTORS[0].bytes)).toEqual({ items: [{ cmd: 0x6000, type: 1, payload: [] }] })
    expect(m3.parseRequest(M3_VECTORS[0].bytes.slice(0, 13))).not.toBeNull()
    expect(m3.parseRequest(M3_VECTORS[0].bytes.slice(1))).toBeNull()
  })

  it('commandOf: one item → its id; a batch → its riskiest item, an uncatalogued item wins', () => {
    expect(base.commandOf(momaRequest(0x1300, [1, 2]))).toBe(0x1300)
    expect(base.commandOf(momaBatch([0x600b, 0x1301]))).toBe(0x600b)
    expect(base.commandOf(momaBatch([0x600b, 0x1300]))).toBe(0x1300)
    expect(base.commandOf(momaBatch([0x600b, { cmd: 0x2007, payload: [0, 0] }, 0x1300]))).toBe(0x2007)
    expect(base.commandOf(momaBatch([0x600b, 0x4000, 0x2007]))).toBe(0x4000)
    expect(base.commandOf(momaBatch([0x600b, 0x7777]))).toBe(0x7777)
    expect(momaCommandOf(momaBatch([0x600b, 0x2007]))).toBe(0x600b) // no catalogue: first item
    expect(momaCommandOf({ items: [] })).toBe(-1)
    expect(momaCommandOfFrame(MOMA_6201_USB, MELO_VECTORS[0].bytes, CAT)).toBe(0x600b)
    expect(momaCommandOfFrame(MOMA_6201_USB, Uint8Array.of(1, 2, 3), CAT)).toBeNull()
  })

  it('matches a single request by command id only', () => {
    const req = momaRequest(0x1300, [1, 15])
    expect(base.matches(req, reply(MOMA_6201_USB, [momaAck(0x1300)])[0])).toBe('done')
    expect(base.matches(req, reply(MOMA_6201_USB, [momaAck(0x1301)])[0])).toBe(false)
    // Item type is not checked (the apps dispatch by id; reply types are [?]).
    expect(base.matches(req, reply(MOMA_6201_USB, [{ cmd: 0x1300, type: 1, payload: [0] }])[0])).toBe('done')
    // …except our own request coming back: dropped by the engine assembler, never matched if kept.
    const asm = new MomaAssembler(MOMA_6201_USB)
    expect(asm.push(base.encode(req))).toEqual([])
    expect(asm.echoes).toBe(1)
    const echo = new MomaAssembler(MOMA_6201_USB, { keepEchoes: true }).push(base.encode(req))[0]
    expect(isMomaEcho(echo)).toBe(true)
    expect(base.matches(req, echo)).toBe(false)
    expect(base.describe(echo, 'rx')).toMatch(/echo of a request/)
  })

  it('matchItem adds unit correlation', () => {
    const b = createMomaSpecBase(MOMA_6701_BLE, { matchItem: (it, msg) => msg.payload[0] === it.payload?.[0] })
    const req = momaRequest(0x600a, [1], { target: 5 })
    expect(b.matches(req, reply(MOMA_6701_BLE, [momaData(0x600a, [2, 1])])[0])).toBe(false)
    expect(b.matches(req, reply(MOMA_6701_BLE, [momaData(0x600a, [1, 1])])[0])).toBe('done')
  })

  it('batch: partial per item, done when all arrived, in one frame or in several, in any order', () => {
    const req = momaBatch([0x600b, 0x1301, 0x2001])
    const one = reply(MOMA_6201_USB, [momaData(0x2001, [1]), momaData(0x600b, [1]), momaData(0x1301, [1, 2])])
    expect(one.map((m) => base.matches(req, m))).toEqual(['partial', 'partial', 'done'])
    const req2 = momaBatch([0x600b, 0x1301, 0x2001])
    const several = [0x1301, 0x2001, 0x600b].map((c) => reply(MOMA_6201_USB, [momaData(c, [0])])[0])
    expect(several.map((m) => base.matches(req2, m))).toEqual(['partial', 'partial', 'done'])
  })

  it('batch answered in one frame with an item missing completes on the last requested item', () => {
    const req = momaBatch([0x600b, 0x1301, 0x2001])
    const msgs = reply(MOMA_6201_USB, [momaData(0x600b, [1]), momaData(0x1301, [1, 2]), momaNotify(0x11eb, [9])])
    expect(msgs.map((m) => base.matches(req, m))).toEqual(['partial', 'done', false])
  })

  it('ack: payload[0] == 0, whatever the item type; empty payload fails', () => {
    const req = momaRequest(0x1300, [1, 15])
    expect(base.ack(req, reply(MOMA_6201_USB, [momaAck(0x1300)])[0])).toEqual({ ok: true, code: 0 })
    expect(base.ack(req, reply(MOMA_6201_USB, [momaAck(0x1300, 1)])[0])).toEqual({ ok: false, code: 1 })
    expect(base.ack(req, reply(MOMA_6201_USB, [{ cmd: 0x1300, type: 3, payload: [0, 5] }])[0])).toEqual({ ok: true, code: 0 })
    expect(momaStatusAck(reply(MOMA_6201_USB, [{ cmd: 0x1300, type: 2 }])[0])).toEqual({ ok: false, code: null })
  })

  it('coalesceKey: target + ids by default, overridable', () => {
    expect(base.coalesceKey(momaRequest(0x1300, [1, 2]))).toBe('0:4864')
    expect(base.coalesceKey(momaBatch([0x600b, 0x1301], { target: 1 }))).toBe('1:24587,4865')
    const custom = createMomaSpecBase(MOMA_6303, { coalesceKey: (r) => `x${r.items[0].payload?.[0]}` })
    expect(custom.coalesceKey(momaRequest(0x1001, [2, 1]))).toBe('x2')
  })

  it('describe names commands, targets, acks, positions and anomalies', () => {
    expect(base.describe(momaRequest(0x1300, [1, 15]), 'tx')).toBe('SET_NC 0x1300 [01 0f]')
    expect(base.describe(momaBatch([0x600b, 0x1301], { target: 1 }), 'tx')).toBe('batch 2: HEART 0x600B, GET_NC 0x1301 → phone RX')
    expect(base.describe(reply(MOMA_6201_USB, [momaAck(0x1300)])[0], 'rx')).toBe('SET_NC 0x1300 ack ok')
    expect(base.describe(reply(MOMA_6201_USB, [momaAck(0x1300, 1)])[0], 'rx')).toBe('SET_NC 0x1300 ack fail 1')
    const two = reply(MOMA_6201_USB, [momaData(0x600b, [1, 2]), momaData(0x7777, [])])
    expect(two.map((m) => base.describe(m, 'rx'))).toEqual(['HEART 0x600B data [01 02] (1/2)', '0x7777 data (2/2)'])
    const bad = encodeMomaReply(MOMA_6201_USB, [momaAck(0x1300)])
    bad[bad.length - 1] ^= 1
    expect(base.describe(new MomaAssembler(MOMA_6201_USB).push(bad)[0], 'rx')).toMatch(/⚠ XOR mismatch/)
    expect(describeMoma(momaRequest(0x1f16, new Array<number>(20).fill(0x41)))).toBe(`0x1F16 [${new Array(16).fill('41').join(' ')} … 20 B]`)
  })

  it('rawOf: the frame for single-item frames, the item bytes inside multi-item frames', () => {
    const single = reply(MOMA_6201_USB, [momaAck(0x1300)])[0]
    expect(toHex(base.rawOf(single))).toBe(toHex(MELO_VECTORS.find((v) => v.name.startsWith('MELO R2'))!.bytes))
    const [a, b] = reply(MOMA_6201_USB, [momaData(0x600b, [1, 2]), momaAck(0x1300)])
    expect(toHex(base.rawOf(a))).toBe('60 0b 03 00 02 01 02')
    expect(toHex(base.rawOf(b))).toBe('13 00 02 00 01 00')
    expect(toHex(momaItemBytes(b))).toBe('13 00 02 00 01 00')
  })
})

describe('MomaAssembler (engine side)', () => {
  it('splits a multi-item frame into ordered messages and forwards garbage', () => {
    const asm = new MomaAssembler(MOMA_6701_BLE)
    const junk: Uint8Array[] = []
    asm.onGarbage = (b) => junk.push(b)
    const f = encodeMomaReply(MOMA_6701_BLE, [momaNotify(0x6000, [80]), momaNotify(0x6001, [60]), momaNotify(0x6002, [1, 70, 0, 0])], { source: 5 })
    const msgs = asm.push(Uint8Array.from([0x77, ...f]))
    expect(msgs.map((m) => [m.cmd, m.type, m.index, m.count])).toEqual([[0x6000, 0, 0, 3], [0x6001, 0, 1, 3], [0x6002, 0, 2, 3]])
    expect(msgs[0].frame).toBe(msgs[2].frame)
    expect(msgs[0].frame.markers).toEqual({ start: true, end: true })
    expect(junk.map((j) => toHex(j))).toEqual(['77'])
    expect(momaMessages(msgs[0].frame)).toHaveLength(3)
  })

  it('accepts a bare report id number and strips it', () => {
    const msgs = new MomaAssembler(8).push(encodeMomaReply(MOMA_6303, [momaAck(0x1003)]))
    expect(msgs.map((m) => m.cmd)).toEqual([0x1003])
    expect(msgs[0].frame.reportId).toBe(8)
  })
})

describe('simulator helpers', () => {
  it('MomaRequestReader reassembles chunked writes and ignores replies', () => {
    const reader = new MomaRequestReader(MOMA_6701_BLE)
    const all = MAX2_VECTORS.find((v) => v.name.includes('get all'))!.bytes
    const got = applyMomaFaults([all], { chunkSize: 20 }).flatMap((p) => reader.push(p))
    expect(got).toHaveLength(1)
    expect(got[0].items.map((i) => i.cmd)).toEqual([0x6003, 0x6004, 0x6005, 0x6006, 0x6007, 0x6008, 0x6015, 0x600e])
    expect(reader.push(encodeMomaReply(MOMA_6701_BLE, [momaAck(0x6006)]))).toEqual([])
  })

  it('MomaRequestReader reads 6303 padded reports', () => {
    const reader = new MomaRequestReader(MOMA_6303)
    const got = M3_VECTORS.filter((v) => v.head === 'down' && v.reportId === 8).flatMap((v) => reader.push(v.bytes))
    expect(got.map((f) => f.items[0].cmd)).toEqual([0x6000, 0x1003, 0x1005, 0x100d, 0x1001, 0x600a, 0x6012, 0x1f16, 0x1f05])
  })

  it('encodeMomaReply uses the profile framing; applyMomaFaults drops, duplicates and chunks', () => {
    const r = encodeMomaReply(MOMA_6303, [momaAck(0x1003)])
    expect(toHex(r)).toBe(toHex(M3_VECTORS.find((v) => v.name === 'M3 SET ack (illustrative)')!.bytes))
    expect(r[0]).toBe(8)
    expect(toHex(encodeMomaReply(MOMA_6201_USB, [momaAck(0x1300)], { control: 0 }))).toBe('bb dd 01 06 00 00 01 13 00 02 00 01 00')
    expect(applyMomaFaults([r], { dropReplies: true })).toEqual([])
    expect(applyMomaFaults([r], { duplicateReplies: true })).toHaveLength(2)
    expect(applyMomaFaults([r], { chunkSize: 20 }).map((p) => p.length)).toEqual([20, 20, 20, 4])
    expect(momaAck(1, 1)).toEqual({ cmd: 1, type: MOMA_TYPE.EXEC_RESP, payload: [1] })
  })

  it('round-trips through spec encode → reader → reply → assembler for every profile', () => {
    for (const p of [MOMA_6303, MOMA_6701_USB, MOMA_6701_BLE, MOMA_6201_USB, MOMA_6201_BLE]) {
      const base = createMomaSpecBase(p)
      const req: MomaRequest = momaRequest(0x600b, [1, 2, 3])
      const frames = new MomaRequestReader(p).push(base.encode(req))
      expect(frames.map((f) => f.items[0].cmd), p.name).toEqual([0x600b])
      const back = base.createAssembler().push(encodeMomaReply(p, [momaData(0x600b, [9, 8])]))
      expect(back.map((m) => base.matches(req, m)), p.name).toEqual(['done'])
      // Encoded request bytes equal a direct encodeMomaFrame call with the profile fields.
      expect(toHex(base.encode(req))).toBe(toHex(encodeMomaFrame(req.items, { target: p.target, control: p.control, reportId: p.reportId, padTo: p.padTo })))
    }
  })
})
