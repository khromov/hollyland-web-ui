/**
 * MELO P1 wire layer: request builders against the doc's frames (moma/__tests__/vectors.ts) and independently
 * computed frames (./vectors.ts), payload parsers and encoders, the command catalogue.
 */
import { describe, expect, it } from 'vitest'
import { decodeMomaFrame } from '../../../moma/codec'
import { MOMA_6201_BLE, MOMA_6201_IOS, MOMA_6201_USB } from '../../../moma/profiles'
import { encodeMomaRequest, momaBatch, momaRequest } from '../../../moma/spec'
import { MELO_VECTORS } from '../../../moma/__tests__/vectors'
import { toHex } from '../../../codec'
import {
  MELO_CMD, MELO_COMMANDS, encodeMeloDeviceInfo, encodeMeloHeartbeat, encodeMeloStreamIn, meloCommandOfFrame, meloDeviceInfoRequest, meloFrameLength,
  meloGet, meloHeartbeatRequest, meloNoiseGateSetPayload, meloNotifyStartRequest, meloNotifyStopRequest, meloUnitOfDeviceType, meloVuSourceRequest,
  parseMeloAllLevels, parseMeloDeviceInfo, parseMeloHeartbeat, parseMeloLeds, parseMeloNoiseGate, parseMeloStreamIn, parseMeloStreamOut,
} from '..'
import { ANDROID_COMMAND6201_IDS, MELO_DRIVER_VECTORS as V, bytes } from './vectors'

const hex = (b: Uint8Array) => toHex(b).toUpperCase()
const doc = (name: string) => MELO_VECTORS.find((v) => v.name.startsWith(name))!.bytes

describe('MELO P1 request builders', () => {
  it('match the frames of melo-6201.md §3.4 (USB, BLE, iOS)', () => {
    expect(encodeMomaRequest(MOMA_6201_USB, meloHeartbeatRequest())).toEqual(doc('MELO 1 '))
    expect(encodeMomaRequest(MOMA_6201_BLE, meloHeartbeatRequest())).toEqual(doc('MELO 2 '))
    expect(encodeMomaRequest(MOMA_6201_IOS, meloHeartbeatRequest())).toEqual(doc('MELO 3 '))
    expect(encodeMomaRequest(MOMA_6201_USB, meloDeviceInfoRequest(0))).toEqual(doc('MELO 4 '))
    expect(encodeMomaRequest(MOMA_6201_USB, momaRequest(MELO_CMD.NC_SET, [1, 15]))).toEqual(doc('MELO 5 '))
    expect(encodeMomaRequest(MOMA_6201_USB, meloNotifyStartRequest())).toEqual(doc('MELO 6 '))
    expect(encodeMomaRequest(MOMA_6201_USB, momaBatch([MELO_CMD.HEARTBEAT, MELO_CMD.NC_GET]))).toEqual(doc('MELO 10 '))
  })

  it('match the independently computed driver frames', () => {
    expect(hex(encodeMomaRequest(MOMA_6201_USB, meloVuSourceRequest()))).toBe(V.vuSourceUsb.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_BLE, meloVuSourceRequest()))).toBe(V.vuSourceBle.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_BLE, meloNotifyStartRequest([MELO_CMD.VU_ALL_GET], 20)))).toBe(V.notifyStart20Ble.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_BLE, meloNotifyStopRequest()))).toBe(V.notifyStopBle.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_BLE, meloDeviceInfoRequest(5)))).toBe(V.deviceInfoTx1Ble.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_IOS, meloDeviceInfoRequest(0)))).toBe(V.iosDeviceInfo.hex)
    expect(hex(encodeMomaRequest(MOMA_6201_USB, momaRequest(MELO_CMD.NOISE_GATE_SET, meloNoiseGateSetPayload(true, -60))))).toBe(V.noiseGateOn60.hex)
    expect(() => meloNotifyStartRequest([], 100)).toThrow(RangeError)
    expect(() => meloNotifyStartRequest([MELO_CMD.VU_ALL_GET], 0)).toThrow(RangeError)
  })

  it('classifies frames of all three framings by command (batches by their riskiest item)', () => {
    expect(meloCommandOfFrame(doc('MELO 1 '))).toBe(MELO_CMD.HEARTBEAT)
    expect(meloCommandOfFrame(doc('MELO 2 '))).toBe(MELO_CMD.HEARTBEAT)
    expect(meloCommandOfFrame(doc('MELO 3 '))).toBe(MELO_CMD.HEARTBEAT)
    expect(meloCommandOfFrame(encodeMomaRequest(MOMA_6201_BLE, momaBatch([MELO_CMD.HEARTBEAT, { cmd: MELO_CMD.FACTORY_RESET }])))).toBe(MELO_CMD.FACTORY_RESET)
    expect(meloCommandOfFrame(Uint8Array.of(0xde, 0xad))).toBeNull()
  })

  it('meloFrameLength finds frame boundaries for the BLE write joiner', () => {
    const f = bytes(V.vuSourceUsb.hex)
    expect(meloFrameLength(f)).toBe(f.length)
    expect(meloFrameLength(f.subarray(0, 20))).toBeNull()
    expect(meloFrameLength(Uint8Array.of(0x00, 0xaa))).toBe(0)
    expect(meloFrameLength(new Uint8Array(0))).toBeNull()
  })
})

describe('MELO P1 payloads', () => {
  it('heartbeat: 31 bytes, field order of A HLSoundHeartEntitySerializer; shorter payloads are rejected', () => {
    const r1 = MELO_VECTORS.find((v) => v.name.startsWith('MELO R1'))!.items[0].payload
    const hb = parseMeloHeartbeat(Uint8Array.from(r1))!
    expect(hb).toMatchObject({
      rxPower: 0x50, boxPower: 0x3c, mic1Power: 0x5a, mic2Power: 0x55, mic1Charge: false, mic2Charge: true, mic1Online: true, mic2Online: true,
      mic1SamDepth: 0, mic2SamDepth: 0, conn35Online: true, conn35DirOut: false, owsOnline: false, rxOutSwitch: true, rxSamDepth: 1,
      rxNoiseSwitch: true, rxNoiseMode: 2, earConnectState: 0, micTypeRaw: 5, mic1Type: 1, mic2Type: 1, rcConnState: false, length: 31,
    })
    expect(parseMeloHeartbeat(Uint8Array.from(r1).subarray(0, 30))).toBeNull()
    const { length: _l, mic1Type: _a, mic2Type: _b, ...fields } = hb
    expect(encodeMeloHeartbeat(fields)).toEqual(Uint8Array.from(r1))
  })

  it('device info: type, SN without 00 / FF, byte-reversed versions; < 20 bytes → null', () => {
    const f = decodeMomaFrame(bytes(V.deviceInfoReply.hex))
    expect(f.status).toBe('ok')
    const payload = f.status === 'ok' ? f.frame.items[0].payload : new Uint8Array(0)
    expect(parseMeloDeviceInfo(payload)).toEqual({ deviceType: 0, serial: 'MP1RX000001', swVersion: '4.0.1.2', hwVersion: '1.0.0.0' })
    const withPad = Uint8Array.from([5, 0x4d, 0xff, 0x50, 0, 0, 0, 0, 0, 0, 0, 0, 9, 7, 0, 3, 0, 0, 0, 1])
    expect(parseMeloDeviceInfo(withPad)).toMatchObject({ deviceType: 5, serial: 'MP', swVersion: '3.0.7.9' })
    expect(parseMeloDeviceInfo(payload.subarray(0, 19))).toBeNull()
    expect(encodeMeloDeviceInfo({ deviceType: 0, serial: 'MP1RX000001', swVersion: '4.0.1.2', hwVersion: '1.0.0.0' })).toEqual(payload)
    expect(meloUnitOfDeviceType(5)).toBe('tx1')
    expect(meloUnitOfDeviceType(9)).toBe('tx2')
    expect(meloUnitOfDeviceType(2)).toBeUndefined()
  })

  it('VU 0x11EB: 5 inputs then 8 outputs, i16 LE dB', () => {
    const f = decodeMomaFrame(bytes(V.vuPush.hex))
    expect(f.status === 'ok' && f.frame.items[0].type).toBe(0)
    const l = parseMeloAllLevels(f.status === 'ok' ? f.frame.items[0].payload : new Uint8Array(0))!
    expect(l.inputs).toEqual({ mic1: -24, mic2: -30, instrument: -28, bgmL: -20, bgmR: -21 })
    expect(l.outputs).toEqual({ usbL: -18, usbR: -19, usb2L: -96, usb2R: -96, wiredL: -96, wiredR: -96, wirelessL: -25, wirelessR: -25 })
    expect(parseMeloAllLevels(new Uint8Array(25))).toBeNull()
  })

  it('mixer and settings structs', () => {
    const si = parseMeloStreamIn(Uint8Array.from([12, 10, 12, 8, 0xfa, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]))!
    expect(si).toEqual({ vol: [12, 10, 12, 8, -6], mute: [0, 1, 0, 0, 0], solo: [0, 0, 1, 0, 0] })
    expect(encodeMeloStreamIn(si)).toEqual(Uint8Array.from([12, 10, 12, 8, 0xfa, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]))
    expect(parseMeloStreamIn(new Uint8Array(14))).toBeNull()
    expect(parseMeloStreamOut(Uint8Array.from([20, 0, 30, 1, 40, 0]))).toEqual({ owsVol: 20, owsMute: 0, conn35OutVol: 30, conn35OutMute: 1, uacUpstreamVol: 40, uacUpstreamMute: 0 })
    // A CmdGetLed6201: groups of three; a trailing partial group is ignored.
    expect(parseMeloLeds(Uint8Array.from([1, 0, 2, 0, 1, 1, 1, 2]))).toEqual([{ on: true, device: 0, brightness: 2 }, { on: false, device: 1, brightness: 1 }])
    const g = parseMeloNoiseGate(meloNoiseGateSetPayload(true, -60))!
    expect(g).toEqual({ paramChange: 1, enable: true, streamType: 2, algoIndex: 0, threshold: -60, attack: 0, release: 0, floor: 0 })
  })
})

describe('MELO P1 command catalogue', () => {
  it('covers every A Command6201 id, classes the dangerous ones and cites a source for each', () => {
    for (const id of ANDROID_COMMAND6201_IDS) expect(MELO_COMMANDS[id], `0x${id.toString(16)}`).toBeDefined()
    // iOS-only UAC channel layout: catalogued so a forced sendRaw is classified (it re-enumerates the RX).
    expect(MELO_COMMANDS[0x131b].safety).toBe('disruptive')
    const by = (s: string) => Object.entries(MELO_COMMANDS).filter(([, c]) => c.safety === s).map(([id]) => Number(id)).sort((a, b) => a - b)
    expect(by('destructive')).toEqual([0x001c, 0x001f, 0x0022, 0x2007, 0x6045, 0x6046, 0x6047, 0x700a])
    expect(by('ota')).toEqual([0x4000, 0x4001, 0x4002, 0x4003, 0x4004, 0x4005, 0x4006, 0x4007, 0x4008])
    expect(by('disruptive')).toEqual([0x112a, 0x1304, 0x1310, 0x131b])
    expect(by('notify')).toEqual([])
    for (const c of Object.values(MELO_COMMANDS)) {
      expect(c.source.length).toBeGreaterThan(10)
      expect(c.toggle ?? false, c.name).toBe(false) // every 6201 SET carries absolute values
    }
    // Every GET the driver sends is a catalogued read.
    for (const cmd of [MELO_CMD.HEARTBEAT, MELO_CMD.DEVICE_INFO, MELO_CMD.NC_GET, MELO_CMD.STREAM_IN_GET, MELO_CMD.LED_GET, MELO_CMD.NOISE_GATE_GET]) {
      expect(MELO_COMMANDS[meloGet(cmd).items[0].cmd].safety).toBe('read')
    }
  })
})
