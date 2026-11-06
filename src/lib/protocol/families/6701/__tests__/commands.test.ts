/**
 * LARK MAX 2 request bytes and the catalogue (max2-6701.md §3.3, §5): golden frames from the doc, the request-form
 * keys (GET vs SET of one id, OWS unpair), batch classification and the safety class of every documented command.
 */
import { describe, expect, it } from 'vitest'
import { encodeMomaRequest } from '../../../moma/spec'
import { MOMA_6701_BLE, MOMA_6701_USB, MOMA_6701_USB_CAMERA } from '../../../moma/profiles'
import {
  driver, isMax2Read, MAX2_CMD, MAX2_COMMANDS, max2CommandOf, max2CommandOfFrame, max2FrameLength, max2Get, max2GetAll, max2GetKey, max2ItemKey,
  MAX2_OWS_UNPAIR_KEY, max2Set, max2SystemTimePayload, max2Version,
} from '..'
import { MAX2_VECTORS } from './vectors'

const vec = (prefix: string) => {
  const v = MAX2_VECTORS.find((x) => x.name.startsWith(prefix))
  if (!v) throw new Error(`no vector ${prefix}`)
  return v.bytes
}

/** XOR over every byte, written out here independently of core/bytes.ts. */
const xorAll = (b: ArrayLike<number>) => Array.from(b).reduce((a, x) => a ^ x, 0)

describe('MAX 2 request frames (max2-6701.md §3.3 golden vectors)', () => {
  it('heartbeat to the mobile (1) and camera (2) RX over USB', () => {
    expect(encodeMomaRequest(MOMA_6701_USB, max2Get(MAX2_CMD.HEART_INFO))).toEqual(vec('MAX 2 heartbeat, USB mobile'))
    expect(encodeMomaRequest(MOMA_6701_USB_CAMERA, max2Get(MAX2_CMD.HEART_INFO))).toEqual(vec('MAX 2 heartbeat, USB camera'))
  })

  it('NC on, depth 10, to the RX over BLE (A BleMicCmd.setNoiseLevelStatus(data, 2))', () => {
    expect(encodeMomaRequest(MOMA_6701_BLE, max2Set(MAX2_CMD.NOISE_LEVEL, [1, 10], 2))).toEqual(vec('MAX 2 NC on'))
  })

  it('0x600A [1] to the BOX (target 5) over BLE', () => {
    expect(encodeMomaRequest(MOMA_6701_BLE, max2Version('rx', 5))).toEqual(vec('MAX 2 version/battery'))
  })

  it('custom gain over USB, and "get all" over BLE in the app\'s source order', () => {
    expect(encodeMomaRequest(MOMA_6701_USB, max2Set(MAX2_CMD.VOICE_GAIN, [0, 0, 20, 14]))).toEqual(vec('MAX 2 custom gain'))
    expect(encodeMomaRequest(MOMA_6701_BLE, max2GetAll(2))).toEqual(vec('MAX 2 "get all"'))
  })

  it('"get all" over USB goes to broadcast target 0 (A BleMicCmd.cmdMultiMapSend: isBle() ? 2 : 0)', () => {
    const f = encodeMomaRequest(MOMA_6701_USB, max2GetAll(0))
    expect(f[3]).toBe(0)
    expect(f[f.length - 1]).toBe(xorAll(f.subarray(0, -1)))
    expect(max2CommandOfFrame(f)).toBe(max2GetKey(MAX2_CMD.RX_OUTSWITCH))
  })

  it('every frame ends with the XOR of all bytes before it, start/end items, count = items + 2', () => {
    for (const req of [max2Get(MAX2_CMD.UAC_OUT_MODE_GET), max2Set(MAX2_CMD.SWITCH_MIC_QUANTITY, [1]), max2Version('tx4')]) {
      const f = encodeMomaRequest(MOMA_6701_USB, req)
      expect(f[f.length - 1]).toBe(xorAll(f.subarray(0, -1)))
      expect(Array.from(f.subarray(0, 12))).toEqual([0xaa, 0xdd, 6, 1, 7, 0, 3, 0x5a, 0xfa, 0, 0, 0])
      expect(Array.from(f.subarray(-6, -1))).toEqual([0x5e, 0xfe, 0, 0, 0])
    }
  })

  it('a set always carries a payload (A BleMicCmd.cmdMultiSend); 0x701E is the one empty-payload set', () => {
    expect(() => max2Set(MAX2_CMD.MIC_LOCK, [])).toThrow(/carries a payload/)
    expect(max2ItemKey({ cmd: MAX2_CMD.MOBILE_RX_PAIR })).toBe(MAX2_CMD.MOBILE_RX_PAIR)
    expect(MAX2_COMMANDS[MAX2_CMD.MOBILE_RX_PAIR].safety).toBe('disruptive')
  })

  it('max2FrameLength joins split BLE writes: null while incomplete, the length when whole, 0 to resync', () => {
    const f = vec('MAX 2 "get all"')
    expect(max2FrameLength(f.subarray(0, 20))).toBeNull()
    expect(max2FrameLength(f)).toBe(58)
    expect(max2FrameLength(Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0, 0, 0, 0))).toBe(0)
  })

  it('system time is BE64 local-time ms (A NumberUtil.longToByte8(Utils.localZoneTime()))', () => {
    // 2026-11-06T12:00:00Z at UTC+1 (getTimezoneOffset −60) → local ms = utc + 3 600 000.
    const utc = Date.UTC(2026, 10, 6, 12)
    const p = max2SystemTimePayload(utc, -60)
    const v = p.reduce((a, b) => a * 256 + b, 0)
    expect(p).toHaveLength(8)
    expect(v).toBe(utc + 3_600_000)
    expect(p[0]).toBe(0)
  })
})

describe('MAX 2 catalogue: keyed by request form', () => {
  it('GET and SET of one id are different keys: the GET is a read, the SET has the write\'s class', () => {
    const get = max2ItemKey({ cmd: MAX2_CMD.RX_OUTSWITCH })
    const set = max2ItemKey({ cmd: MAX2_CMD.RX_OUTSWITCH, payload: [1] })
    expect(get).toBe(max2GetKey(MAX2_CMD.RX_OUTSWITCH))
    expect(set).toBe(MAX2_CMD.RX_OUTSWITCH)
    expect(MAX2_COMMANDS[get].safety).toBe('read')
    expect(MAX2_COMMANDS[set].safety).toBe('disruptive')
    // Pure reads keep their id: 0x600A carries a unit payload and is still a read.
    expect(max2ItemKey({ cmd: MAX2_CMD.DEVICE_VERSION, payload: [1] })).toBe(MAX2_CMD.DEVICE_VERSION)
    expect(isMax2Read(MAX2_CMD.DEVICE_VERSION)).toBe(true)
  })

  it('0x6017: GET read, [0] start pairing disruptive, any other payload is the destructive unpair', () => {
    expect(MAX2_COMMANDS[max2ItemKey({ cmd: MAX2_CMD.EARPHONE_PAIR })].safety).toBe('read')
    expect(MAX2_COMMANDS[max2ItemKey({ cmd: MAX2_CMD.EARPHONE_PAIR, payload: [0] })].safety).toBe('disruptive')
    expect(max2ItemKey({ cmd: MAX2_CMD.EARPHONE_PAIR, payload: [1] })).toBe(MAX2_OWS_UNPAIR_KEY)
    expect(max2ItemKey({ cmd: MAX2_CMD.EARPHONE_PAIR, payload: [7] })).toBe(MAX2_OWS_UNPAIR_KEY)
    expect(MAX2_COMMANDS[MAX2_OWS_UNPAIR_KEY].safety).toBe('destructive')
  })

  it('restart / topology changes are disruptive; reset destructive; firmware upload OTA; pushes notify', () => {
    const cls = (cmd: number) => MAX2_COMMANDS[cmd]?.safety
    const restarts = [MAX2_CMD.RX_OUTSWITCH, MAX2_CMD.WIRELESS_STATUS, MAX2_CMD.SWITCH_MIC_QUANTITY, MAX2_CMD.MOBILE_RX_PAIR, MAX2_CMD.UAC_OUT_MODE_SET]
    expect(restarts.map(cls)).toEqual(Array(restarts.length).fill('disruptive'))
    expect(cls(MAX2_CMD.RESET_FACTORY)).toBe('destructive')
    for (const c of [MAX2_CMD.START_OTA_UPGRADE, MAX2_CMD.FIRMWARE_TRAN_START, MAX2_CMD.FIRMWARE_TRAN_RELOCATION, MAX2_CMD.FIRMWARE_TRAN_PACKAGE, MAX2_CMD.FIRMWARE_TRAN_END, MAX2_CMD.FIRMWARE_TRAN_DEVICE]) {
      expect(cls(c), c.toString(16)).toBe('ota')
    }
    for (const c of [MAX2_CMD.BOX_BATTERY, MAX2_CMD.RX_BATTERY, MAX2_CMD.MIC_BATTERY]) expect(cls(c)).toBe('notify')
    for (const c of [MAX2_CMD.RX_SAMPLING, MAX2_CMD.MIC_LOCK, MAX2_CMD.NOISE_LEVEL, MAX2_CMD.VOICE_GAIN, MAX2_CMD.VOCAL_TRACT, MAX2_CMD.SYSTEM_TIME, MAX2_CMD.TIMING_MODE]) {
      expect(cls(c)).toBe('write')
    }
  })

  it('a batch is ranked by its riskiest item; an uncatalogued item ranks highest', () => {
    expect(max2CommandOf(max2GetAll(2))).toBe(max2GetKey(MAX2_CMD.RX_OUTSWITCH))
    expect(MAX2_COMMANDS[max2CommandOf(max2GetAll(2))].safety).toBe('read')
    const hidden = { items: [{ cmd: MAX2_CMD.HEART_INFO }, { cmd: MAX2_CMD.RESET_FACTORY, payload: [0, 0] }] }
    expect(max2CommandOf(hidden)).toBe(MAX2_CMD.RESET_FACTORY)
    expect(max2CommandOf({ items: [{ cmd: MAX2_CMD.HEART_INFO }, { cmd: 0x7777 }] })).toBe(0x7777)
  })

  it('the registered (stub) driver classifies frames with the real catalogue', () => {
    expect(driver.status).toBe('stub')
    expect(driver.commands).toBe(MAX2_COMMANDS)
    expect(driver.commandOfFrame(vec('MAX 2 factory reset'))).toBe(MAX2_CMD.RESET_FACTORY)
    expect(driver.commandOfFrame(vec('MAX 2 heartbeat, USB camera'))).toBe(MAX2_CMD.HEART_INFO)
    expect(driver.commandOfFrame(Uint8Array.of(1, 2, 3))).toBeNull()
  })

  it('every catalogue entry cites an Android source', () => {
    for (const [k, c] of Object.entries(MAX2_COMMANDS)) expect(c.source, `${c.name} (${k})`).toMatch(/^A /)
  })
})
