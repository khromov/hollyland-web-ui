/**
 * 6303 command catalogue and request builders: the Android ↔ iOS id tables (FAMILIES.md §5.2), the safety classes
 * (§2.3) and the golden request frames of m3-6303.md §3.3 (moma/__tests__/vectors.ts M3_VECTORS).
 */
import { describe, expect, it } from 'vitest'
import { bytesEqual } from '../../../core/bytes'
import { encodeMomaRequest, MOMA_6303, parseMomaRequest, type MomaRequest } from '../../../moma'
import { M3_VECTORS } from '../../../moma/__tests__/vectors'
import { M3Cmd, M3Requests, M3_COMMANDS, m3CommandName } from '..'
import { ANDROID_COMMAND6303, IOS_HL6303_COMMAND_TYPE } from './command-tables'

const ids = (t: readonly (readonly [string, number])[]) => new Set(t.map(([, id]) => id))
const hex = (n: number) => `0x${n.toString(16).padStart(4, '0')}`

describe('6303 catalogue = Android Command6303 ∪ iOS HL6303CommandType', () => {
  const android = ids(ANDROID_COMMAND6303)
  const ios = ids(IOS_HL6303_COMMAND_TYPE)
  const catalogue = new Set(Object.keys(M3_COMMANDS).map(Number))

  it('catalogues every id of both apps and nothing else', () => {
    expect([...catalogue].sort((a, b) => a - b).map(hex)).toEqual([...new Set([...android, ...ios])].sort((a, b) => a - b).map(hex))
    expect(catalogue.size).toBe(100)
  })

  it('pins the ids only one app knows', () => {
    expect([...android].filter((i) => !ios.has(i)).map(hex)).toEqual(['0x0039', '0x0040', '0x1f08', '0x1f09', '0x1f11', '0x1f14', '0x4002', '0x6013'])
    expect([...ios].filter((i) => !android.has(i)).map(hex)).toEqual([
      '0x001b', '0x0024', '0x0025', '0x0026', '0x0037', '0x0038', '0x11e0', '0x11e1', '0x11e9', '0x1f00', '0x1f03', '0x4008', '0x400b',
    ])
  })

  it('names each entry after the Android constant (iOS case for iOS-only ids) and cites both tables', () => {
    for (const [name, id] of ANDROID_COMMAND6303) {
      const e = M3_COMMANDS[id]!
      // 0x4007 has two Android names; the catalogue keeps …_DOWNLOAD_TX and mentions the other.
      if (name === 'CMD_APP_OTA_NOTIFY_DOWNLOAD_REMOTE') expect(e.description).toMatch(name)
      else expect(e.name, hex(id)).toBe(name)
      expect(e.source, hex(id)).toMatch(new RegExp(`Command6303\\.${e.name}`))
    }
    for (const [name, id] of IOS_HL6303_COMMAND_TYPE) {
      expect(M3_COMMANDS[id]!.source, hex(id)).toContain(`HL6303CommandType.${name} @0x100c1a318`)
      if (!android.has(id)) expect(M3_COMMANDS[id]!.name).toBe(name)
    }
    // The name conflict of m3-6303.md §5.6: Android "GET_BEL_PARAM" is used as a setter, iOS calls 0x1F02 a getter.
    expect(M3_COMMANDS[M3Cmd.BEL_PARAM]).toMatchObject({ name: 'CMD_HL_AUDIO_GET_BEL_PARAM', safety: 'write' })
    expect(M3_COMMANDS[M3Cmd.BEL_PARAM]!.source).toContain('getAudioBelParms')
    expect(m3CommandName(0x6000)).toBe('CMD_APP_HEART_BEAT_GET')
    expect(m3CommandName(0x7777)).toBe('0x7777')
  })
})

describe('6303 safety classes (FAMILIES.md §2.3)', () => {
  const by = (s: string) => Object.entries(M3_COMMANDS).filter(([, c]) => c.safety === s).map(([id]) => hex(Number(id)))

  it('firmware update is OTA (never sent), factory reset / unpair / BT MAC write are destructive', () => {
    expect(by('ota')).toEqual(['0x4000', '0x4001', '0x4002', '0x4003', '0x4005', '0x4006', '0x4007', '0x4008', '0x4009', '0x400a', '0x400b', '0x4011', '0x4012', '0x4013'])
    expect(by('destructive')).toEqual(['0x0024', '0x002f', '0x0030', '0x6003', '0x600d'])
  })

  it('restart-causing and role-changing commands are disruptive; device events are notify-only', () => {
    expect(by('disruptive')).toEqual(['0x0034', '0x1007', '0x1009', '0x6007', '0x600e'])
    expect(by('notify')).toEqual(['0x0029', '0x002a', '0x0031', '0x0032', '0x0036'])
  })

  it('every read is retry-safe, nothing else is; there are no toggles (every setter takes an absolute value)', () => {
    for (const [id, c] of Object.entries(M3_COMMANDS)) {
      expect(c.retrySafe, hex(Number(id))).toBe(c.safety === 'read')
      expect(c.toggle, hex(Number(id))).toBeUndefined()
    }
  })

  it('the start-up and status reads are catalogued reads', () => {
    for (const id of [M3Cmd.HEART_BEAT_GET, M3Cmd.GET_DEV_INFO, M3Cmd.GET_FIRMWARE_VER, M3Cmd.GET_SETTING_INFO, M3Cmd.GET_GAIN_LEVEL_DETAIL, M3Cmd.GET_MUTE]) {
      expect(M3_COMMANDS[id]!.safety, hex(id)).toBe('read')
    }
    // The voice-page heartbeats "enter" a page: never polled in the background.
    expect(M3_COMMANDS[M3Cmd.ENTER_BEL_PAGE]!.safety).toBe('write')
    expect(M3_COMMANDS[M3Cmd.BEL_SET_PAGE_HEART]!.safety).toBe('write')
  })
})

describe('request builders = golden frames of m3-6303.md §3.3', () => {
  const golden: Record<string, MomaRequest> = {
    'M3 heartbeat GET 0x6000 (64 B)': M3Requests.heartbeat(),
    'M3 NC on, Medium 0x1003 [dev 0, level 1, on 1]': M3Requests.setNoise(1, true),
    'M3 channel mode Stereo 0x1005 [dev 0, mode 1]': M3Requests.setSoundMode(1),
    'M3 phone-RX volume step 4 of 6 0x100D [dev 0, level 3]': M3Requests.setGainLevel(3),
    'M3 mute TX2 0x1001 [tx 2, mute 1]': M3Requests.setMute(2, true),
    'M3 device info of RX1 0x600A [deviceId 6]': M3Requests.deviceInfo(6),
    'M3 firmware versions, 4T4R system 0x6012 [0]': M3Requests.firmwareVersions(0),
  }

  for (const [name, req] of Object.entries(golden)) {
    it(name, () => {
      const v = M3_VECTORS.find((x) => x.name === name)!
      expect(v, name).toBeDefined()
      expect(bytesEqual(encodeMomaRequest(MOMA_6303, req), v.bytes)).toBe(true)
    })
  }

  it('payloads as the generated serializers write them (A *EntityExtKt.cmdSerialize)', () => {
    const p = (r: MomaRequest) => [r.items[0].cmd, ...Array.from(r.items[0].payload ?? [])]
    expect(p(M3Requests.setGainDetailAll(6, 10, 14))).toEqual([0x1010, 0, 6, 10, 14])
    expect(p(M3Requests.gainLevelDetail())).toEqual([0x100e, 0])
    expect(p(M3Requests.setMicLedOff(true))).toEqual([0x6009, 1])
    expect(p(M3Requests.setMicLinkKnowLed(false))).toEqual([0x600c, 0])
    expect(p(M3Requests.setSyncHotshoe(true))).toEqual([0x6014, 1])
    expect(p(M3Requests.setSoundOut(true))).toEqual([0x1007, 0, 1])
    expect(p(M3Requests.setSampling(1))).toEqual([0x1009, 0, 1])
    expect(p(M3Requests.setMixEnable(true))).toEqual([0x100b, 0, 1])
    expect(p(M3Requests.setKeyLock(true))).toEqual([0x6005, 1])
    expect(p(M3Requests.setAutoPowerOff(false))).toEqual([0x6002, 0])
    expect(p(M3Requests.getMute(3))).toEqual([0x1000, 3])
    expect(p(M3Requests.settingInfo())).toEqual([0x6011])
    expect(p(M3Requests.setBelAppUpdate())).toEqual([0x6015])
  })

  it('every builder frame is a 64-byte report-8 packet that parses back to the same request', () => {
    for (const [name, build] of Object.entries(M3Requests)) {
      const req = (build as (...a: number[]) => MomaRequest)(1, 1, 1)
      const f = encodeMomaRequest(MOMA_6303, req)
      expect(f.length, name).toBe(64)
      expect(Array.from(f.subarray(0, 6)), name).toEqual([0x08, 0xaa, 0xdd, 0x06, 0x00, 0x00])
      expect(parseMomaRequest(MOMA_6303, f), name).toEqual({ items: req.items.map((i) => ({ cmd: i.cmd, type: 1, payload: Array.from(i.payload ?? []) })) })
      expect(M3_COMMANDS[req.items[0].cmd], name).toBeDefined()
    }
  })
})
