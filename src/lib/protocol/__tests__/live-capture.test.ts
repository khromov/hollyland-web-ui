/**
 * Regression vectors from a real LARK A2 (PID 0x0411, firmware 3.0.2.008), captured on
 * 2026-11-05 with root libusb on macOS (interface 0, interrupt IN 0x82 / OUT 0x03).
 * One 64-byte reply arrived per request. Serial numbers are replaced by fake values of the
 * same length; every other byte is as captured.
 */
import { describe, expect, it } from 'vitest'
import { decodeFrame, encodeRequest, Target } from '../codec'
import {
  parseButtonColors,
  parseDeviceInfo,
  parseHeartbeat,
  parseNoiseLevelGet6118,
  parseSerial,
  parseVersion6118,
  parseVersionLegacy,
  parseVersionLegacy6118,
  Requests,
} from '../commands'

const pkt = (hex: string): Uint8Array => {
  const b = new Uint8Array(64)
  hex
    .trim()
    .split(/\s+/)
    .forEach((x, i) => (b[i] = parseInt(x, 16)))
  return b
}
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ')

const CAPTURE = {
  heartbeat: 'bb dd 10 80 00 10 01 01 5b 5c 00 00 00 05 00 00 00 00 00 00 04 00',
  versionRx: 'bb dd 41 80 00 06 03 00 02 00 00 08',
  versionTx1: 'bb dd 41 81 00 06 03 00 02 00 00 08',
  versionTx2: 'bb dd 41 82 00 06 03 00 02 00 00 08',
  serialRx: `bb dd 15 80 00 0b ${ascii('TESTRX00001')}`,
  serialTx1: `bb dd 15 81 00 0b ${ascii('TESTTX10001')}`,
  versionLegacy: 'bb dd 03 80 00 04 03 00 02 08',
  deviceInfo: 'bb dd 16 80 00 09 00 00 00 06 01 01 5b 5c 00',
  noiseGet: 'bb dd 11 80 00 01 00',
  volumeGet: 'bb dd 04 80 00 01 05',
  speakerGet: 'bb dd 13 80 00 01 00',
  micIdentifyGet: 'bb dd 3c 80 00 01 01',
  smartBatteryGet: 'bb dd 3e 80 00 01 00',
  voiceLockGet: 'bb dd 35 80 00 01 00',
  buttonColorsGet: 'bb dd 38 80 00 02 00 00',
}

describe('live LARK A2 capture', () => {
  it('requests are the exact bytes the receiver answered', () => {
    expect(Array.from(encodeRequest(Requests.heartbeat()).subarray(0, 6))).toEqual([0xaa, 0xdd, 0x10, 0x40, 0, 0])
    const req = encodeRequest(Requests.heartbeat())
    expect(req.length).toBe(64)
    expect(req.subarray(6).every((b) => b === 0)).toBe(true)
  })

  it('decodes the reply header (command echo, source unit, big-endian length)', () => {
    const f = decodeFrame(pkt(CAPTURE.heartbeat))!
    expect(f.direction).toBe('response')
    expect(f.cmd).toBe(0x10)
    expect(f.payload.length).toBe(16)
    const tx2 = decodeFrame(pkt(CAPTURE.versionTx2))!
    expect(tx2.cmd).toBe(0x41)
    expect(tx2.target).toBe(Target.TX2)
  })

  it('parses the heartbeat exactly as the official app does', () => {
    const hb = parseHeartbeat('6118', decodeFrame(pkt(CAPTURE.heartbeat))!.payload)
    expect(hb.family).toBe('6118')
    if (hb.family !== '6118') return
    expect(hb.tx[0]).toMatchObject({ online: true, battery: 91, muted: false, charging: false })
    expect(hb.tx[1]).toMatchObject({ online: true, battery: 92, muted: false, charging: false })
    expect(hb.noiseLevel).toBe(0)
    expect(hb.noiseEnabled).toBe(false)
    expect(hb.volume).toBe(5)
    expect(hb.channelMode).toBe(0)
    expect(hb.autoPowerOff).toBe(true)
    expect(hb.ledOn).toBe(true)
    expect(hb.voicePreset).toEqual({ enabled: false, preset: 2 })
  })

  it('parses firmware versions and serials', () => {
    for (const k of ['versionRx', 'versionTx1', 'versionTx2'] as const) {
      expect(parseVersion6118(decodeFrame(pkt(CAPTURE[k]))!.payload)).toBe('3.0.2.008')
    }
    expect(parseVersionLegacy6118(decodeFrame(pkt(CAPTURE.versionLegacy))!.payload)).toBe('3.0.2.008')
    expect(parseSerial(decodeFrame(pkt(CAPTURE.serialRx))!.payload)).toBe('TESTRX00001')
    expect(parseSerial(decodeFrame(pkt(CAPTURE.serialTx1))!.payload)).toBe('TESTTX10001')
  })

  it('parses the GET-only settings replies', () => {
    expect(parseNoiseLevelGet6118(decodeFrame(pkt(CAPTURE.noiseGet))!.payload)).toMatchObject({ enabled: false, level: 0 })
    expect(decodeFrame(pkt(CAPTURE.volumeGet))!.payload[0]).toBe(5)
    expect(decodeFrame(pkt(CAPTURE.micIdentifyGet))!.payload[0]).toBe(1)
    expect(decodeFrame(pkt(CAPTURE.smartBatteryGet))!.payload[0]).toBe(0)
    expect(decodeFrame(pkt(CAPTURE.voiceLockGet))!.payload[0]).toBe(0)
    expect(decodeFrame(pkt(CAPTURE.speakerGet))!.payload[0]).toBe(0)
    expect(parseButtonColors(decodeFrame(pkt(CAPTURE.buttonColorsGet))!.payload)).toEqual({ tx1: 0, tx2: 0 })
    expect(parseDeviceInfo(decodeFrame(pkt(CAPTURE.deviceInfo))!.payload)).toMatchObject({ variant: 0, cameraRx: false })
  })
})

/**
 * Lark M2 mobile receiver (PID 0x0007, family 6301), RX firmware 2.0.0.33, TX firmware 2.1.0.33,
 * captured through the local bridge on 2026-11-06 (PROTOCOL.md §11.8). Serials are fake.
 */
const M2 = {
  heartbeat: 'bb dd 10 80 00 09 01 01 62 64 00 00 00 05 00',
  versionRx: 'bb dd 03 80 00 04 02 00 00 21',
  versionTx1: 'bb dd 03 81 00 04 02 01 00 21',
  serialTx2: `bb dd 15 82 00 0b ${ascii('TESTM2TX201')}`,
  deviceInfo: 'bb dd 16 80 00 09 00 00 00 06 01 01 62 64 00',
  noiseGet: 'bb dd 11 80 00 01 00',
  volumeGet: 'bb dd 04 80 00 01 05',
  speakerGet: 'bb dd 13 80 00 01 00',
  voiceLockGet: 'bb dd 35 80 00 01 00',
}

describe('live Lark M2 capture', () => {
  it('parses the 9-byte 6301 heartbeat', () => {
    const hb = parseHeartbeat('6301', decodeFrame(pkt(M2.heartbeat))!.payload)
    expect(hb.family).toBe('6301')
    expect(hb.tx[0]).toMatchObject({ online: true, battery: 98 })
    expect(hb.tx[1]).toMatchObject({ online: true, battery: 100 })
    expect(hb).toMatchObject({ noiseLevel: 0, volume: 5, voiceLocked: false, payloadLength: 9 })
  })

  it('parses legacy versions, serial and device info', () => {
    expect(parseVersionLegacy(decodeFrame(pkt(M2.versionRx))!.payload)).toBe('2.0.0.33')
    expect(parseVersionLegacy(decodeFrame(pkt(M2.versionTx1))!.payload)).toBe('2.1.0.33')
    const tx2 = decodeFrame(pkt(M2.serialTx2))!
    expect(tx2.target).toBe(Target.TX2)
    expect(parseSerial(tx2.payload)).toBe('TESTM2TX201')
    expect(parseDeviceInfo(decodeFrame(pkt(M2.deviceInfo))!.payload)).toMatchObject({ variant: 0, cameraRx: false })
  })

  it('decodes the GET-only replies', () => {
    expect(decodeFrame(pkt(M2.noiseGet))!.payload[0]).toBe(0)
    expect(decodeFrame(pkt(M2.volumeGet))!.payload[0]).toBe(5)
    expect(decodeFrame(pkt(M2.speakerGet))!.payload[0]).toBe(0)
    expect(decodeFrame(pkt(M2.voiceLockGet))!.payload[0]).toBe(0)
  })
})
