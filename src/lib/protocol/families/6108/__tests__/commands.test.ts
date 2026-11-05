/**
 * LARK A1 command table: every Android HID_* constant is catalogued with a safety class and a citation; the
 * dangerous ids are flagged; request builders validate their input and address units like UsbMessengerV2.
 */
import { describe, expect, it } from 'vitest'
import {
  A1Cmd, A1Requests, A1_COMMANDS, A1_TX_UNITS, a1CommandName, a1TxIndex, a1TxOfIndex, a1UnitByte, a1UnitOfByte,
} from '../commands'

/** A application/common/protocol/ProtocolV2 HID_* constants (jadx 3.1.0), name → id. */
const ANDROID_HID_CONSTANTS: Record<string, number> = {
  HID_GET_DEVICE_MAC_RX: 48, HID_GET_DEVICE_MAC_TX: 49, HID_GET_DEVICE_SN: 18, HID_GET_DEVICE_VERSION: 13, HID_GET_EQ: 8,
  HID_GET_HEART_INFO: 31, HID_GET_LIGHT: 34, HID_GET_MODE_FAIL_REASON: 65, HID_GET_NOISE: 20, HID_GET_PERFORMANCE_MODE: 70,
  HID_GET_REVERB: 6, HID_GET_SHUTDOWN_TIME: 40, HID_GET_SIGNAL_MODE: 64, HID_GET_SPEAKER: 38, HID_GET_TX_IDENTIFY: 36,
  HID_GET_VOICE_LEVEL: 4, HID_GET_VOICE_MODE: 2, HID_OTA_DEVICE: 44, HID_OTA_DFU_DATA: 29, HID_OTA_DFU_ENTER: 28,
  HID_OTA_DFU_RX_UPGRADE: 26, HID_OTA_DFU_TX_UPGRADE: 27, HID_OTA_DFU_VERIFY: 30, HID_REFRESH_RX: 60, HID_RX_INTO_PAIR: 61,
  HID_SET_DEVICE_REBOOT: 12, HID_SET_EQ: 7, HID_SET_LIGHT: 33, HID_SET_NOISE: 19, HID_SET_PERFORMANCE_MODE: 69, HID_SET_REVERB: 5,
  HID_SET_SHUTDOWN_TIME: 39, HID_SET_SIGNAL_MODE: 63, HID_SET_SPEAKER: 37, HID_SET_TX_IDENTIFY: 35, HID_SET_TX_MUTE: 22,
  HID_SET_VOICE_LEVEL: 3, HID_SET_VOICE_MODE: 1, HID_TX_INTO_OTA: 62, HID_UPGRADE_RESULT: 45,
}

describe('A1 command catalogue', () => {
  it('lists every ProtocolV2 HID_* constant under its Android name, and nothing else', () => {
    for (const [name, id] of Object.entries(ANDROID_HID_CONSTANTS)) {
      expect(A1_COMMANDS[id]?.name, name).toBe(name.replace(/^HID_/, ''))
      expect((A1Cmd as Record<string, number>)[name.replace(/^HID_/, '')], name).toBe(id)
    }
    expect(Object.keys(A1_COMMANDS).length).toBe(Object.keys(ANDROID_HID_CONSTANTS).length)
    expect(Object.keys(A1Cmd).length).toBe(Object.keys(ANDROID_HID_CONSTANTS).length)
  })

  it('cites a source for every command; no toggles (every A1 setter is absolute)', () => {
    for (const [id, c] of Object.entries(A1_COMMANDS)) {
      expect(c.source, c.name).toMatch(/^A /)
      expect(c.toggle ?? false, `${c.name} (${id})`).toBe(false)
    }
  })

  it('flags restart, mode-switch and firmware ids (FAMILIES.md §2.3)', () => {
    const by = (s: string) => Object.entries(A1_COMMANDS).filter(([, c]) => c.safety === s).map(([id]) => Number(id)).sort((a, b) => a - b)
    expect(by('ota')).toEqual([0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x2c, 0x2d, 0x3e])
    expect(by('destructive')).toEqual([0x3c, 0x3d])
    expect(by('disruptive')).toEqual([0x0c, 0x25])
    expect(by('notify')).toEqual([]) // the A1 never pushes (a1-6108.md §2.1)
    expect(A1_COMMANDS[A1Cmd.GET_HEART_INFO]).toMatchObject({ safety: 'read', retrySafe: true })
    for (const c of Object.values(A1_COMMANDS)) if (c.safety !== 'read' && c.safety !== 'write') expect(c.retrySafe, c.name).toBe(false)
  })

  it('names commands, falling back to hex', () => {
    expect(a1CommandName(0x1f)).toBe('GET_HEART_INFO')
    expect(a1CommandName(0x99)).toBe('0x99')
  })
})

describe('A1 units', () => {
  it('maps units like Protocol.HLDeviceType (RX 0, TX1..TX4 1..4) and TX indices 0-based', () => {
    expect(['rx', 'tx1', 'tx2', 'tx3', 'tx4'].map((u) => a1UnitByte(u as 'rx'))).toEqual([0, 1, 2, 3, 4])
    expect(A1_TX_UNITS.map(a1TxIndex)).toEqual([0, 1, 2, 3])
    expect([0, 1, 4, 9, -1].map(a1UnitOfByte)).toEqual(['rx', 'tx1', 'tx4', 'tx4', 'rx']) // coerceIn(0, 4)
    expect([0, 3, 7].map(a1TxOfIndex)).toEqual(['tx1', 'tx4', 'tx4'])
  })
})

describe('A1 request builders (A UsbMessengerV2)', () => {
  it('build the documented payloads', () => {
    expect(A1Requests.setTxMute('tx1', false)).toEqual({ cmd: 0x16, payload: [0, 0] })
    expect(A1Requests.setTxMute('tx4', true)).toEqual({ cmd: 0x16, payload: [3, 1] })
    expect(A1Requests.setLed(true)).toEqual({ cmd: 0x21, payload: [0] }) // 0 = on
    expect(A1Requests.setNoise(false, 1)).toEqual({ cmd: 0x13, payload: [0, 1] })
    expect(A1Requests.setReverb(false, 0)).toEqual({ cmd: 0x05, payload: [0, 0] })
    expect(A1Requests.txMac('tx4')).toEqual({ cmd: 0x31, payload: [3] })
    expect(A1Requests.version('tx4')).toEqual({ cmd: 0x0d, payload: [4] })
    expect(A1Requests.setPerformanceMode(true)).toEqual({ cmd: 0x45, payload: [1] })
  })

  it('refuse out-of-range values and wrong units', () => {
    expect(() => A1Requests.setVolume(6)).toThrow(RangeError)
    expect(() => A1Requests.setEq(0)).toThrow(RangeError)
    expect(() => A1Requests.setEq(4)).toThrow(RangeError)
    expect(() => A1Requests.setNoise(true, 3)).toThrow(RangeError)
    expect(() => A1Requests.setReverb(true, 3)).toThrow(RangeError)
    expect(() => A1Requests.setChannelMode(2)).toThrow(RangeError) // no safety track on the A1
    expect(() => A1Requests.setTxMute('rx' as 'tx1', true)).toThrow(RangeError)
    expect(() => A1Requests.version('tx5' as 'tx1')).toThrow(RangeError)
  })

  it('has no builder for disruptive, destructive or OTA commands', () => {
    const built = new Set(
      Object.values(A1Requests).map((f) => {
        const fn = f as (...a: unknown[]) => { cmd: number }
        try {
          return fn('tx1', true).cmd
        } catch {
          return fn(1, 1).cmd
        }
      }),
    )
    for (const id of built) expect(['read', 'write'], A1_COMMANDS[id].name).toContain(A1_COMMANDS[id].safety)
  })
})
