/**
 * 6303 reply parsers and the heartbeat → MicState mapping (m3-6303.md §5.2, §5.1, §5.3): every heartbeat field, the
 * phone RX battery 0xFF, the multi-RX slot map, the app's value mappings, and the 0x600A / 0x6012 / 0x6011 / 0x100E
 * layouts of the generated deserializers.
 */
import { describe, expect, it } from 'vitest'
import { CONTROL } from '../../../core/controls'
import { M3_HEARTBEAT_BODY, M3_VECTORS } from '../../../moma/__tests__/vectors'
import { decodeMomaFrame, MOMA_6303 } from '../../../moma'
import {
  M3_CONTROL, M3_INFO, encodeM3Heartbeat, isM3VersionKnown, m3Availability, m3CameraGainsWith, m3DeviceIdOfUnit, m3HeartbeatUnits,
  m3HeartbeatValues, m3RxSlots, m3UnitOfDeviceId, m3ExperimentalProducts, parseM3CameraGains, parseM3DeviceInfo, parseM3FirmwareVersions,
  parseM3Heartbeat, parseM3SettingInfo, parseM3BtStatus,
} from '..'

const [CAM2, , PHONE2] = m3ExperimentalProducts()

describe('heartbeat 0x6000 (30 B, A HLHeartInfo6303EntitySerializer)', () => {
  it('decodes every field of the illustrative reply (moma vectors, m3-6303.md §5.2 order)', () => {
    const v = M3_VECTORS.find((x) => x.name.startsWith('M3 heartbeat reply'))!
    const r = decodeMomaFrame(v.bytes, { reportId: MOMA_6303.reportId })
    expect(r.status).toBe('ok')
    const hb = parseM3Heartbeat(r.status === 'ok' ? r.frame.items[0].payload : new Uint8Array())
    expect(hb).toMatchObject({
      length: 30, txConnectState: 3, rxConnectState: 1, currentRxDeviceId: 0, txBattery: [80, 60, 0, 0], rxBattery: [-1, 0, 0, 0],
      txMuteStatus: 2, denoiseSwitch: 1, denoiseLevel: 1, volumeLevel: 3, channelMode: 1, autoShutdownEnable: 0, eqMode: 0,
      txRecognitionSwitch: 0, ledSwitch: 0, pairState: 0, masterSlaveMode: 0, deviceMode: 0, mainRxId: 0, hotShoeSwitch: 0, swMixNoise: 1,
      micLockSwitch: 0, micAutoExitSw: 0, isRefreshCanto: 0, earMode: 0,
      txOnline: [true, true, false, false], rxOnline: [true, false, false, false], txMuted: [false, true, false, false], isMainRx: true, is4t4r: true,
    })
  })

  it('zero-extends a short body (A CmdGetHeart6303.decodePayload) and round-trips through encodeM3Heartbeat', () => {
    const short = parseM3Heartbeat([0x01, 0x01])
    expect(short).toMatchObject({ length: 2, txOnline: [true, false, false, false], earMode: 0, isMainRx: true, is4t4r: true })
    const hb = parseM3Heartbeat(M3_HEARTBEAT_BODY)
    expect(encodeM3Heartbeat(hb)).toEqual(M3_HEARTBEAT_BODY)
    for (let i = 0; i < 30; i++) {
      const body = new Array(30).fill(0)
      body[i] = i === 7 ? 0xff : 1
      expect(encodeM3Heartbeat(parseM3Heartbeat(body)), `byte ${i}`).toEqual(body)
    }
  })

  it('maps into values the way the app reads them (phone RX)', () => {
    const hb = parseM3Heartbeat(M3_HEARTBEAT_BODY)
    expect(m3HeartbeatValues(hb, PHONE2)).toEqual({
      [CONTROL.NOISE_ENABLED]: true, [CONTROL.NOISE_LEVEL]: 2, [CONTROL.CHANNEL_MODE]: 1, [CONTROL.MIC_RECOGNITION]: false,
      [CONTROL.LED]: true, [M3_CONTROL.SMART_MIX]: true, [M3_CONTROL.TX_BUTTON_LOCK]: false, [CONTROL.AUTO_OFF]: false,
      [CONTROL.VOLUME]: 3, 'mic.mute:tx1': false, 'mic.mute:tx2': true, 'mic.mute:tx3': false, 'mic.mute:tx4': false,
      [M3_INFO.SYSTEM]: 0, [M3_INFO.RX_NUMBER]: 1, [M3_INFO.PRIMARY_RX_NUMBER]: 1, [M3_INFO.PAIRING]: false, [M3_INFO.PROFILES_CHANGED]: false,
      [M3_INFO.EAR_MODE]: 0,
    })
  })

  it('camera RX: hot-shoe sync instead of the phone volume; the volume byte is the selected level', () => {
    const body = [...M3_HEARTBEAT_BODY]
    body[14] = 2
    body[24] = 1
    const v = m3HeartbeatValues(parseM3Heartbeat(body), CAM2)
    expect(v[CONTROL.VOLUME]).toBeUndefined()
    expect(v[M3_INFO.CAMERA_GEAR]).toBe(2)
    expect(v[M3_CONTROL.HOT_SHOE_SYNC]).toBe(true)
  })

  it('app value rules: NC level 1/2 Medium/Strong else Weak; mode 1/2 else Mono; LED byte inverted; volume clamped', () => {
    const v = (i: number, b: number) => {
      const body = [...M3_HEARTBEAT_BODY]
      body[i] = b
      return m3HeartbeatValues(parseM3Heartbeat(body), PHONE2)
    }
    expect([0, 1, 2, 7].map((b) => v(13, b)[CONTROL.NOISE_LEVEL])).toEqual([1, 2, 3, 1])
    expect([0, 1, 2, 9].map((b) => v(15, b)[CONTROL.CHANNEL_MODE])).toEqual([0, 1, 2, 0])
    expect([0, 1].map((b) => v(19, b)[CONTROL.LED])).toEqual([true, false])
    expect(v(14, 9)[CONTROL.VOLUME]).toBe(5)
    expect(v(28, 1)[M3_INFO.PROFILES_CHANGED]).toBe(true)
    expect(v(22, 1)[M3_INFO.SYSTEM]).toBe(1)
  })
})

describe('topology: receivers, primary / secondary, phone RX battery', () => {
  it('rx = the RX the host is plugged into; rx2..rx4 = the other slots in index order', () => {
    expect(m3RxSlots(0).map((s) => `${s.unit}=${s.index}`)).toEqual(['rx=0', 'rx2=1', 'rx3=2', 'rx4=3'])
    expect(m3RxSlots(2).map((s) => `${s.unit}=${s.index}`)).toEqual(['rx=2', 'rx2=0', 'rx3=1', 'rx4=3'])
    expect(m3UnitOfDeviceId(6, 2)).toBe('rx2')
    expect(m3UnitOfDeviceId(8, 2)).toBe('rx')
    expect(m3UnitOfDeviceId(3, 0)).toBe('tx3')
    expect(m3UnitOfDeviceId(10, 0)).toBeNull()
    expect(m3DeviceIdOfUnit('rx', 2)).toBe(8)
    expect(m3DeviceIdOfUnit('rx3', 2)).toBe(7)
    expect(m3DeviceIdOfUnit('tx4', 2)).toBe(4)
  })

  it('a secondary phone RX in a group of three: roles from masterSlaveMode / mainRxId, phone RX without battery', () => {
    const body = new Array(30).fill(0)
    body[0] = 0b0101 // TX1, TX3
    body[1] = 0b0111 // RX1..RX3
    body[2] = 1 // plugged into RX2
    body[3] = 90
    body[5] = 0xff // TX3 reports no battery
    body[7] = 55 // RX1: camera RX
    body[8] = 0xff // RX2 (this one): phone RX
    body[9] = 0xff // RX3: phone RX
    body[21] = 1 // this RX is secondary
    body[23] = 0 // RX1 is the primary
    const u = m3HeartbeatUnits(parseM3Heartbeat(body), PHONE2)
    expect(u.rx).toEqual({ online: true, battery: undefined, role: 'secondary', kind: 'phone-rx', label: 'RX 2' })
    expect(u.rx2).toEqual({ online: true, battery: 55, role: 'primary', kind: 'camera-rx', label: 'RX 1' })
    expect(u.rx3).toEqual({ online: true, battery: undefined, role: 'secondary', kind: 'phone-rx', label: 'RX 3' })
    expect(u.rx4).toMatchObject({ online: false, label: 'RX 4' })
    expect(u.tx1).toEqual({ online: true, battery: 90, muted: false })
    expect(u.tx2).toEqual({ online: false, battery: undefined, muted: undefined })
    expect(u.tx3).toEqual({ online: true, battery: undefined, muted: false })
  })

  it('preconditions: primary only, a TX online for NC, NC on for its level, 4T4R for smart mix, online TX for mute', () => {
    const body = [...M3_HEARTBEAT_BODY]
    const a = (patch: Record<number, number>) => {
      const b = [...body]
      for (const [i, x] of Object.entries(patch)) b[Number(i)] = x
      const hb = parseM3Heartbeat(b)
      return m3Availability(hb, m3HeartbeatValues(hb, PHONE2))
    }
    expect(a({})[CONTROL.NOISE_ENABLED]).toEqual({ ok: true })
    expect(a({})['mic.mute:tx3']).toMatchObject({ ok: false, reason: 'mic-offline' })
    expect(a({ 21: 1 })[CONTROL.LED]).toMatchObject({ ok: false, reason: 'secondary-rx' })
    expect(a({ 21: 1 })[M3_CONTROL.BIT_DEPTH]).toMatchObject({ ok: false, reason: 'secondary-rx' })
    expect(a({ 21: 1 })[CONTROL.CHANNEL_MODE]).toBeUndefined() // per-RX output: not gated
    expect(a({ 21: 1 })[CONTROL.VOLUME]).toBeUndefined()
    expect(a({ 0: 0 })[CONTROL.NOISE_ENABLED]).toMatchObject({ ok: false, reason: 'mic-disconnected' })
    expect(a({ 12: 0 })[CONTROL.NOISE_LEVEL]).toMatchObject({ ok: false, reason: 'noise-off' })
    expect(a({ 22: 1 })[M3_CONTROL.SMART_MIX]).toMatchObject({ ok: false, reason: 'not-4t4r' })
  })
})

describe('identity, settings and camera-level replies', () => {
  it('0x600A device info: 25 bytes, NUL-cut serial, version bytes, MAC (A HLAudioGetDeviceInfoResponseEntitySerializer)', () => {
    const sn = Array.from('M3RX0000001', (c) => c.charCodeAt(0))
    const p = Uint8Array.from([6, 0, ...sn, 0, 2, 0, 1, 2, 0, 0x50, 0xc0, 0x60, 0x00, 0x0a, 0xff])
    expect(parseM3DeviceInfo(p)).toEqual({ deviceId: 6, serial: 'M3RX0000001', version: '2.0.1.2', mac: '50:C0:60:00:0A:FF' })
    const shortSn = Uint8Array.from([1, 0, 0x41, 0x42, 0, 0x7a, 0x7a, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 9, 0, 1, 2, 3, 4, 5, 6])
    expect(parseM3DeviceInfo(shortSn)).toMatchObject({ deviceId: 1, serial: 'AB', version: '1.0.0.9' })
    expect(parseM3DeviceInfo(p.subarray(0, 24))).toBeNull()
  })

  it('0x6012 firmware list: 9 × {id, version[4]}, bytes unsigned (A VersionUtilKt.getVersionString)', () => {
    const p = Uint8Array.from([1, 2, 0, 0, 9, 6, 2, 0, 1, 200, 10, 0, 0, 0, 0])
    expect(parseM3FirmwareVersions(p)).toEqual([{ id: 1, version: '2.0.0.9' }, { id: 6, version: '2.0.1.200' }, { id: 10, version: '0.0.0.0' }])
    expect(isM3VersionKnown('0.0.0.0')).toBe(false)
    expect(isM3VersionKnown('2.0.1.2')).toBe(true)
  })

  it('0x6011 setting info [isSuccess, sampling, outSound, micLock, micAutoExit] (A HLSettingInfoResponseEntitySerializer)', () => {
    expect(parseM3SettingInfo(Uint8Array.of(0, 1, 1, 0, 1))).toEqual({ isSuccess: 0, sampling: 1, soundOut: true, micLock: false, micAutoExit: true })
    expect(parseM3SettingInfo(Uint8Array.of(0, 1))).toBeNull()
  })

  it('0x100E camera levels: wire − 10 dB, coerced to −10…+10 (A BottomCameraRxDialog.toTextShow, coerceIn)', () => {
    expect(parseM3CameraGains(Uint8Array.of(0, 0, 10, 20))).toEqual([-10, 0, 10])
    expect(parseM3CameraGains(Uint8Array.of(0, 25, 10, 20))).toEqual([10, 0, 10])
    expect(parseM3CameraGains(Uint8Array.of(0, 1))).toBeNull()
  })

  it('setting one camera level keeps Level 1 ≤ Level 2 ≤ Level 3 by moving the others', () => {
    expect(m3CameraGainsWith([-4, 0, 4], 0, 8)).toEqual([8, 8, 8])
    expect(m3CameraGainsWith([-4, 0, 4], 1, -6)).toEqual([-6, -6, 4])
    expect(m3CameraGainsWith([-4, 0, 4], 2, -10)).toEqual([-10, -10, -10])
    expect(m3CameraGainsWith([-4, 0, 4], 1, 2)).toEqual([-4, 2, 4])
  })

  it('0x0039 Bluetooth status {mac[6], name[33]} (A HLBtStatusForHeartEntity)', () => {
    expect(parseM3BtStatus(Uint8Array.from([1, 2, 3, 4, 5, 6, 0x48, 0x69, 0]))).toEqual({ mac: '01:02:03:04:05:06', name: 'Hi' })
  })
})
