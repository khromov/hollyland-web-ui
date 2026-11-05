/**
 * LARK A1 reply parsers. The heartbeat test is one table over the body lengths 17 / 22 / 23 comparing the iOS
 * reading (-[HLHeartEntity initA1HeartInfo:] @0x1001fa798, LEN branch) with Android's (ProGetHearInfo.receiveData),
 * as FAMILIES.md §5.2 asks: they agree on 17 and 23 and disagree on 22, where this library follows iOS.
 */
import { describe, expect, it } from 'vitest'
import { fromHex } from '../../../codec'
import { CONTROL } from '../../../core/controls'
import {
  A1_CONTROL, a1AsciiString, a1HeartbeatHasFourMics, a1HeartbeatUnits, a1HeartbeatValues, formatA1Version, isA1FourMicFirmware,
  isA1NewDevice, parseA1Ack, parseA1Heartbeat, parseA1OnLevel, parseA1PerformanceMode, parseA1RxMac, parseA1Serial, parseA1TxMac,
  parseA1Version,
} from '../status'
import { A1_HEARTBEAT_BODY_HEX } from './vectors'

/** Settings bytes 6..15 shared by every row: NC on Strong, vol 3, Stereo, 15 min, LED on, EQ Bright, reverb on Medium, recognition on. */
const SETTINGS = [1, 2, 3, 1, 0, 0, 2, 1, 1, 1]
const TX12 = [1, 1, 85, 60, 0, 1]
/** TX3 on 72 % muted, TX4 on 40 %. */
const TX34 = [1, 1, 72, 40, 1, 0]

describe('heartbeat 0x1F: iOS vs Android per body length', () => {
  const rows: {
    len: number
    body: number[]
    ios: { layout: string; signalMode?: number; tx3?: object; tx4?: object }
    android: { signalMode?: number; tx3?: object; tx4?: object }
  }[] = [
    {
      len: 17, body: [...TX12, ...SETTINGS, 1],
      ios: { layout: '2mic', signalMode: 1 },
      android: { signalMode: 1 },
    },
    {
      len: 23, body: [...TX12, ...SETTINGS, 1, ...TX34],
      ios: { layout: '4mic', signalMode: 1, tx3: { online: true, battery: 72, muted: true }, tx4: { online: true, battery: 40, muted: false } },
      android: { signalMode: 1, tx3: { online: true, battery: 72, muted: true }, tx4: { online: true, battery: 40, muted: false } },
    },
    {
      // older 4-mic firmware: no signal-mode byte, TX3/TX4 one byte earlier (iOS only; a1-6108.md §4.2)
      len: 22, body: [...TX12, ...SETTINGS, ...TX34],
      ios: { layout: '4mic-old', signalMode: undefined, tx3: { online: true, battery: 72, muted: true }, tx4: { online: true, battery: 40, muted: false } },
      // Android reads body[16] (TX3 online) as signal mode and shifts every TX3/TX4 field by one
      android: { signalMode: 1, tx3: { online: true, battery: 40, muted: false }, tx4: { online: false, battery: 1, muted: false } },
    },
  ]

  for (const r of rows) {
    it(`LEN ${r.len}`, () => {
      expect(r.body).toHaveLength(r.len)
      const body = Uint8Array.from(r.body)
      const ios = parseA1Heartbeat(body)
      const android = parseA1Heartbeat(body, { layout: 'android' })
      for (const hb of [ios, android]) {
        expect(hb.length).toBe(r.len)
        expect(hb.tx[0]).toEqual({ online: true, battery: 85, muted: false })
        expect(hb.tx[1]).toEqual({ online: true, battery: 60, muted: true })
        expect(hb).toMatchObject({
          noiseOn: true, noiseLevel: 2, volume: 3, channelMode: 1, shutdownTime: 0, ledOn: true, eq: 2, reverbOn: true, reverbLevel: 1,
          micRecognition: true,
        })
      }
      expect(ios.layout).toBe(r.ios.layout)
      expect(ios.signalMode).toBe(r.ios.signalMode)
      expect(ios.tx[2]).toEqual(r.ios.tx3)
      expect(ios.tx[3]).toEqual(r.ios.tx4)
      expect(android.signalMode).toBe(r.android.signalMode)
      expect(android.tx[2]).toEqual(r.android.tx3)
      expect(android.tx[3]).toEqual(r.android.tx4)
      expect(a1HeartbeatHasFourMics(ios)).toBe(r.len > 17)
    })
  }

  it('decodes the documented example body (a1-6108.md §3.6)', () => {
    const hb = parseA1Heartbeat(fromHex(A1_HEARTBEAT_BODY_HEX))
    expect(hb).toMatchObject({
      layout: '4mic', length: 23, noiseOn: true, noiseLevel: 2, volume: 3, channelMode: 1, shutdownTime: 0, ledOn: true, eq: 2,
      reverbOn: true, reverbLevel: 1, micRecognition: true, signalMode: 0,
    })
    expect(hb.tx).toEqual([
      { online: true, battery: 85, muted: false },
      { online: true, battery: 60, muted: true },
      { online: false, battery: 0, muted: false },
      { online: false, battery: 0, muted: false },
    ])
  })

  it('reads short bodies field by field (iOS stops after body[15] when LEN < 17)', () => {
    const hb = parseA1Heartbeat(Uint8Array.from([...TX12, 1, 2, 3, 1, 0, 0]))
    expect(hb.layout).toBe('short')
    expect(hb).toMatchObject({ noiseOn: true, noiseLevel: 2, volume: 3, channelMode: 1, shutdownTime: 0, ledOn: true })
    expect(hb.eq).toBeUndefined()
    expect(hb.signalMode).toBeUndefined()
    expect(parseA1Heartbeat(Uint8Array.of(1, 1, 50)).tx[0]).toBeUndefined() // < 6 bytes: Android skips the mic block
    expect(parseA1Heartbeat(new Uint8Array(0)).noiseOn).toBeUndefined()
  })

  it('maps onto MicState values and units', () => {
    const hb = parseA1Heartbeat(Uint8Array.from([...TX12, ...SETTINGS, 1, ...TX34]))
    expect(a1HeartbeatValues(hb)).toEqual({
      [CONTROL.NOISE_ENABLED]: true, [CONTROL.NOISE_LEVEL]: 3, [CONTROL.VOLUME]: 3, [CONTROL.CHANNEL_MODE]: 1, [CONTROL.AUTO_OFF]: true,
      [CONTROL.LED]: true, [CONTROL.MIC_RECOGNITION]: true, [A1_CONTROL.EQ]: 2, [A1_CONTROL.REVERB_ENABLED]: true,
      [A1_CONTROL.REVERB_LEVEL]: 1, [A1_CONTROL.SIGNAL_MODE]: 1,
      'mic.mute:tx1': false, 'mic.mute:tx2': true, 'mic.mute:tx3': true, 'mic.mute:tx4': false,
    })
    expect(a1HeartbeatUnits(hb)).toEqual({
      tx1: { online: true, battery: 85, muted: false },
      tx2: { online: true, battery: 60, muted: true },
      tx3: { online: true, battery: 72, muted: true },
      tx4: { online: true, battery: 40, muted: false },
    })
    // 2-mic body: TX3/TX4 offline, no mute values for them; offline / 0 % batteries hidden
    const two = parseA1Heartbeat(Uint8Array.from([1, 0, 0, 77, 0, 0, ...SETTINGS, 0]))
    expect(a1HeartbeatUnits(two)).toEqual({
      tx1: { online: true, battery: undefined, muted: false },
      tx2: { online: false, battery: undefined, muted: false },
      tx3: { online: false, battery: undefined, muted: undefined },
      tx4: { online: false, battery: undefined, muted: undefined },
    })
    expect(Object.keys(a1HeartbeatValues(two))).not.toContain('mic.mute:tx3')
    expect(a1HeartbeatValues(two)[A1_CONTROL.SIGNAL_MODE]).toBe(0)
  })
})

describe('identity replies', () => {
  it('version: [unit, parts…], Android display padding, 4-mic detection and the 1.0.1.3 gate', () => {
    expect(parseA1Version(Uint8Array.of(0, 1, 0, 1, 3))).toEqual({ unit: 'rx', version: '1.0.1.3', display: '1.0.1.03', parts: [1, 0, 1, 3] })
    expect(parseA1Version(Uint8Array.of(2, 1, 1, 0, 12))).toMatchObject({ unit: 'tx2', version: '1.1.0.12', display: '1.1.0.12' })
    expect(parseA1Version(Uint8Array.of(0, 1))).toBeNull() // <= 2 bytes: ignored by Android
    expect(parseA1Version(Uint8Array.of(9, 1, 2))?.unit).toBe('tx4') // coerceIn(0, 4)
    expect(formatA1Version('1.0.3')).toBe('1.0.3')
    expect(isA1FourMicFirmware('1.1.1.3')).toBe(true)
    expect(isA1FourMicFirmware('1.0.1.3')).toBe(false)
    expect(isA1FourMicFirmware('1.1.3')).toBeUndefined() // fewer than 4 parts: Android does not decide
    expect(isA1FourMicFirmware(undefined)).toBeUndefined()
    expect(isA1NewDevice('1.0.1.2')).toBe(false)
    expect(isA1NewDevice('1.0.1.3')).toBe(true) // inclusive (HexUtil.compareVersions >= 0)
    expect(isA1NewDevice('1.0.1.03')).toBe(true) // Android display form
    expect(isA1NewDevice('1.1.0.0')).toBe(true)
    expect(isA1NewDevice(undefined)).toBe(false)
  })

  it('serial: [unit, ASCII…] with 0x00 and 0xFF dropped', () => {
    expect(parseA1Serial(Uint8Array.of(1, 0x41, 0x31, 0x00, 0xff, 0x42))).toEqual({ unit: 'tx1', serial: 'A1B' })
    expect(parseA1Serial(Uint8Array.of(0, 0xff, 0xff))).toEqual({ unit: 'rx', serial: '' })
    expect(parseA1Serial(Uint8Array.of(0, 0x41))).toBeNull()
    expect(a1AsciiString(Uint8Array.of(0x53, 0x4e))).toBe('SN')
  })

  it('MACs: RX without a unit byte, TX with its index; all-zero means none', () => {
    expect(parseA1RxMac(Uint8Array.of(0x50, 0xc0, 0xf0, 0x01, 0x02, 0xab))).toBe('50:C0:F0:01:02:AB')
    expect(parseA1RxMac(new Uint8Array(6))).toBe('')
    expect(parseA1RxMac(Uint8Array.of(1, 2))).toBe('')
    expect(parseA1TxMac(Uint8Array.of(2, 0x50, 0xc0, 0xf0, 0x13, 0x22, 0x33))).toEqual({ unit: 'tx3', mac: '50:C0:F0:13:22:33' })
    expect(parseA1TxMac(Uint8Array.of(0, 0, 0, 0, 0, 0, 0))).toEqual({ unit: 'tx1', mac: '' })
    expect(parseA1TxMac(Uint8Array.of(0, 1))).toBeNull()
  })
})

describe('acks and GETs', () => {
  it('ack 0 = OK (inverted relative to the A2/M2 rule)', () => {
    expect(parseA1Ack(Uint8Array.of(0))).toEqual({ ok: true, code: 0, iosOk: true })
    // Android: 1 = CmdSetResult.FAILURE; iOS: anything but 0xFF is success (handleEvent: @0x1002040e8). Android wins.
    expect(parseA1Ack(Uint8Array.of(1))).toEqual({ ok: false, code: 1, iosOk: true })
    expect(parseA1Ack(Uint8Array.of(0xff))).toEqual({ ok: false, code: 0xff, iosOk: false })
    expect(parseA1Ack(new Uint8Array(0))).toEqual({ ok: false, code: null, iosOk: false })
  })

  it('reads [on, level] and the performance flag', () => {
    expect(parseA1OnLevel(Uint8Array.of(1, 2))).toEqual({ on: true, level: 2 })
    expect(parseA1OnLevel(Uint8Array.of(1))).toBeNull()
    expect(parseA1PerformanceMode(Uint8Array.of(1))).toBe(true)
    expect(parseA1PerformanceMode(Uint8Array.of(2))).toBe(false)
    expect(parseA1PerformanceMode(new Uint8Array(0))).toBeNull()
  })
})
