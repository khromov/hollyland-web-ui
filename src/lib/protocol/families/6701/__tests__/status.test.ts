/**
 * LARK MAX 2 status decoding (max2-6701.md §4.2, §4.3, §5): heartbeat offsets (Android generateHeartInfo = iOS
 * HLBleHeartEntity, byte for byte), the 33 / 49-byte branch, 0x600A, pushes, and the type-dependent item decoders.
 * The replies are constructed (vectors.ts), so these tests pin the parser, not device behaviour.
 */
import { describe, expect, it } from 'vitest'
import { decodeMomaFrame, MOMA_TYPE } from '../../../moma/codec'
import {
  encodeMax2Heartbeat, encodeMax2Version, parseMax2Gain, parseMax2Heartbeat, parseMax2MicPush, parseMax2Noise, parseMax2TcTime, parseMax2Version,
} from '..'
import { HEARTBEAT_33, HEARTBEAT_49, MAX2_VECTORS, versionPayload } from './vectors'

describe('heartbeat 0x600B', () => {
  it('49-byte payload: every field at its offset (max2-6701.md §4.2 table)', () => {
    const hb = parseMax2Heartbeat(HEARTBEAT_49)!
    expect(hb).toMatchObject({
      length: 49, rxBattery: 90, boxBattery: 77, speaker: true, sampleDepth: 0, micLock: true, noiseOn: true, noiseDepth: 13,
      gainType: 0, gainLevel: 2, channelMode: 1, deviceType: 2, isCamera: true, recording: false, tcMode: 2, inputFps: 4, timingMode: 1,
      earL: { battery: 55, charging: true }, earR: { battery: 44, charging: false }, earConnect: 3, txIdentify: true, tcEnabled: true, resetTiming: false,
      extended: { wireless: 1, tcTime: { min: 12, sec: 34, frame: 21 }, fourMic: true, earMonitor: 1 },
    })
    expect(hb.mics).toEqual([
      { battery: 81, charging: true, online: true, gain: 25, remainRecordTime: 7 },
      { battery: 62, charging: false, online: true, gain: 14, remainRecordTime: 8 },
      { battery: 66, charging: false, online: true, gain: 30, remainRecordTime: 5 },
      { battery: 33, charging: true, online: false, gain: 10, remainRecordTime: 6 },
    ])
  })

  it('33-byte payload: base layout only (A generateHeartInfo reads 33..48 when len ≥ 34)', () => {
    const hb = parseMax2Heartbeat(HEARTBEAT_33)!
    expect(hb.extended).toBeUndefined()
    expect(hb.mics).toHaveLength(2)
    expect(hb.tcEnabled).toBe(true)
    // 34 bytes is enough for the extended branch; the missing bytes read as 0.
    const hb34 = parseMax2Heartbeat(HEARTBEAT_49.slice(0, 34))!
    expect(hb34.extended).toMatchObject({ wireless: 1, fourMic: false })
    expect(hb34.mics).toHaveLength(4)
  })

  it('byte 18: 2 is the camera RX, 1 the mobile RX (I +[HLBleHeartEntity initEntityWithData:] cmp #0x2)', () => {
    for (const [b18, camera] of [[2, true], [1, false], [0, false]] as const) {
      const p = HEARTBEAT_49.slice()
      p[18] = b18
      expect(parseMax2Heartbeat(p), String(b18)).toMatchObject({ deviceType: b18, isCamera: camera })
    }
    const { deviceType: _, ...noType } = parseMax2Heartbeat(HEARTBEAT_49)!
    expect(encodeMax2Heartbeat({ ...noType, isCamera: false })[18]).toBe(1)
    expect(encodeMax2Heartbeat({ ...noType, isCamera: true })[18]).toBe(2)
  })

  it('shorter than 33 bytes is refused (Android would throw ArrayIndexOutOfBounds)', () => {
    expect(parseMax2Heartbeat(HEARTBEAT_49.slice(0, 32))).toBeNull()
  })

  it('encodeMax2Heartbeat is the inverse (simulator)', () => {
    expect(encodeMax2Heartbeat(parseMax2Heartbeat(HEARTBEAT_49)!)).toEqual(HEARTBEAT_49)
    expect(encodeMax2Heartbeat(parseMax2Heartbeat(HEARTBEAT_33)!)).toEqual(HEARTBEAT_33)
  })
})

describe('0x600A unit version / battery', () => {
  it('unit, online, SN, version, battery, hw version, charge status; NUL / 0xFF padding stripped and trimmed', () => {
    expect(parseMax2Version(versionPayload())).toEqual({
      unit: 'tx1', unitByte: 2, online: true, serial: 'H2MTX0000001', version: 'V3.0.0.21', battery: 64, hardwareVersion: 'H1.0', charging: true,
    })
  })

  it('short payloads and unknown unit bytes', () => {
    expect(parseMax2Version(versionPayload().slice(0, 51))).toBeNull()
    const p = versionPayload()
    p[0] = 9
    expect(parseMax2Version(p)?.unit).toBeNull()
  })

  it('encodeMax2Version round-trips (simulator)', () => {
    const v = parseMax2Version(versionPayload())!
    expect(parseMax2Version(encodeMax2Version(v))).toMatchObject({ ...v })
  })
})

describe('pushes and per-setting items', () => {
  it('0x6002 [tx1Online, tx1Battery, tx2Online, tx2Battery] (A generateTxInfo)', () => {
    expect(parseMax2MicPush(Uint8Array.of(1, 80, 0, 0))).toEqual([{ online: true, battery: 80 }, { online: false, battery: 0 }])
    expect(parseMax2MicPush(Uint8Array.of(1, 80))).toBeNull()
  })

  it('0x6006: the depth is read from type 3 replies only (A generateNoiseLevelStatus)', () => {
    expect(parseMax2Noise(MOMA_TYPE.DATA, Uint8Array.of(1, 10))).toEqual({ on: true, depth: 10 })
    expect(parseMax2Noise(MOMA_TYPE.NOTIFY, Uint8Array.of(0, 10))).toEqual({ on: false })
  })

  it('0x6007: level and gains in type 3 replies; mic 3/4 when len ≥ 6 (A generateVoiceGainStatus)', () => {
    expect(parseMax2Gain(MOMA_TYPE.DATA, Uint8Array.of(1, 2, 20, 14))).toEqual({ gainType: 1, level: 2, gains: [20, 14] })
    expect(parseMax2Gain(MOMA_TYPE.DATA, Uint8Array.of(0, 0, 20, 14, 30, 5))).toEqual({ gainType: 0, level: 0, gains: [20, 14, 30, 5] })
    expect(parseMax2Gain(MOMA_TYPE.NOTIFY, Uint8Array.of(1, 2, 20, 14))).toEqual({ gainType: 1 })
  })

  it('0x6014 live timecode [h, m, s, frame]', () => {
    expect(parseMax2TcTime(Uint8Array.of(1, 2, 3, 4))).toEqual({ hour: 1, min: 2, sec: 3, frame: 4 })
  })

  it('the constructed replies of max2-6701.md §3.3 decode to an ack and a type 3 NC reply', () => {
    const ack = MAX2_VECTORS.find((v) => v.name.startsWith('MAX 2 set ack'))!
    const nc = MAX2_VECTORS.find((v) => v.name.startsWith('MAX 2 noise get reply'))!
    const a = decodeMomaFrame(ack.bytes)
    const n = decodeMomaFrame(nc.bytes)
    expect(a.status === 'ok' && a.frame.items[0]).toMatchObject({ cmd: 0x6006, type: MOMA_TYPE.EXEC_RESP })
    expect(n.status === 'ok' && parseMax2Noise(n.frame.items[0].type, n.frame.items[0].payload)).toEqual({ on: true, depth: 10 })
  })
})
