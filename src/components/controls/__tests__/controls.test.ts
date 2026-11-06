import { describe, expect, it } from 'vitest'
import { CONTROL, findMockPreset, type ControlSpec } from '../../../lib/protocol'
import {
  buildModules,
  choiceOptions,
  cleanLabel,
  formatValue,
  isShown,
  keyColumns,
  moduleNeed,
  optionReason,
  pageOf,
  stripColumns,
  subLabel,
  type ControlContext,
} from '../controls'
import { deviceReading, usbChannelCount, usbChannelLabel } from '../../overview/family/meters'

function controlsOf(id: string): readonly ControlSpec[] {
  const found = findMockPreset(id)
  if (!found) throw new Error(`no preset ${id}`)
  return found.driver.controls.filter((c) => !c.perUnit || c.perUnit.length > 0)
}

const spec = (p: Partial<ControlSpec> & Pick<ControlSpec, 'id' | 'kind'>): ControlSpec => ({
  label: p.id,
  group: 'audio',
  safety: 'write',
  readBack: 'status',
  confidence: 'high',
  source: 'test',
  ...p,
})

describe('placement', () => {
  it('sends settings, timecode and monitoring groups to their pages', () => {
    expect(pageOf(spec({ id: 'led', kind: 'switch', group: 'settings' }), '6108')).toBe('settings')
    expect(pageOf(spec({ id: 'a1.signalMode', kind: 'choice', group: 'advanced' }), '6108')).toBe('settings')
    expect(pageOf(spec({ id: 'max2.tc.fps', kind: 'choice', group: 'timecode' }), '6701')).toBe('timecode')
    expect(pageOf(spec({ id: 'max2.wireless', kind: 'switch', group: 'monitoring' }), '6701')).toBe('monitoring')
    expect(pageOf(spec({ id: 'noise.enabled', kind: 'switch', group: 'audio' }), '6303')).toBe('overview')
  })
  it('sends set-and-forget controls to Settings on every family', () => {
    for (const [id, group] of [
      ['max2.micLock', 'mics'],
      ['mic.recognition', 'mics'],
      ['max2.bitDepth', 'audio'],
      ['max2.usbOutput', 'audio'],
      ['melo.mic.bitDepth', 'mics'],
      ['speaker.passthrough', 'receiver'],
      ['max2.fourMic', 'receiver'],
      ['max2.rxPair', 'receiver'],
      ['m3.hotShoeSync', 'receiver'],
    ] as const) {
      expect(pageOf(spec({ id, kind: 'switch', group }), '6701'), id).toBe('settings')
    }
    expect(pageOf(spec({ id: 'max2.gain.type', kind: 'choice', group: 'audio' }), '6701')).toBe('overview')
    expect(pageOf(spec({ id: 'channel.mode', kind: 'choice', group: 'audio' }), '6701')).toBe('overview')
    expect(pageOf(spec({ id: 'm3.smartMix', kind: 'switch', group: 'audio' }), '6303')).toBe('overview')
  })
  it('puts the MELO P1 faders, mutes, scenario and outputs on the Mixer page', () => {
    expect(pageOf(spec({ id: 'melo.mic.volume', kind: 'steps', group: 'mics' }), '6201')).toBe('mixer')
    expect(pageOf(spec({ id: 'melo.workMode', kind: 'choice', group: 'audio' }), '6201')).toBe('mixer')
    expect(pageOf(spec({ id: 'melo.out.usb.volume', kind: 'steps', group: 'monitoring' }), '6201')).toBe('mixer')
    expect(pageOf(spec({ id: 'melo.noise.depth', kind: 'range', group: 'audio' }), '6201')).toBe('overview')
  })
})

describe('labels and values', () => {
  it('drops Toggle / Switch / Settings suffixes and uses sentence case', () => {
    expect(cleanLabel('Indicator Light Switch')).toBe('Indicator light')
    expect(cleanLabel('Noise Cancellation Toggle')).toBe('Noise cancellation')
    expect(cleanLabel('Settings')).toBe('Settings')
    expect(cleanLabel('TX Recognition')).toBe('TX recognition')
    expect(cleanLabel('EQ Adjustment')).toBe('EQ')
    expect(cleanLabel('Camera Power On/Off')).toBe('Camera power')
    expect(cleanLabel('4 Mic & 1 RX')).toBe('4 Mic & 1 RX')
    expect(cleanLabel(cleanLabel('Lock Mic'))).toBe('Lock mic')
  })
  it('drops the module title from a sub-label', () => {
    expect(subLabel('RX volume Level 1', 'RX volume')).toBe('Level 1')
    expect(subLabel('NC level', 'NC')).toBe('Level')
    expect(subLabel('USB Output', 'Bit depth')).toBe('USB output')
  })
  it('prints values with their display offset, sign and unit', () => {
    const gain = spec({ id: 'mic.gain', kind: 'range', range: { min: 0, max: 40, step: 1, unit: 'dB', displayOffset: -20 } })
    expect(formatValue(gain, 24)).toBe('+4 dB')
    expect(formatValue(gain, 16)).toBe('−4 dB')
    expect(formatValue(gain, 20)).toBe('0 dB')
    const depth = spec({ id: 'max2.nc.depth', kind: 'range', range: { min: 0, max: 20, step: 1, unit: 'dB', displayOffset: 5 } })
    expect(formatValue(depth, 10)).toBe('15 dB')
    const vol = spec({ id: 'volume', kind: 'steps', range: { min: 0, max: 5, step: 1, displayOffset: 1 } })
    expect(formatValue(vol, 3)).toBe('4')
    expect(formatValue(spec({ id: 'x', kind: 'choice', options: [{ value: 1, label: 'Weak' }] }), 1)).toBe('Weak')
    expect(formatValue(spec({ id: 'x', kind: 'switch' }), true)).toBe('On')
    expect(formatValue(vol, undefined)).toBeNull()
  })
})

describe('options', () => {
  const m3 = findMockPreset('m3')!
  const max2Usb = findMockPreset('max2')!
  const max2Box = findMockPreset('max2box')!
  const bitDepth = m3.driver.controls.find((c) => c.id === 'm3.bitDepth')!
  const channel = max2Usb.driver.controls.find((c) => c.id === CONTROL.CHANNEL_MODE)!

  it('refuses the M3 32-bit float and the safety track off the MAX 2 case', () => {
    expect(optionReason('6303', m3.product, bitDepth, 1, {})).toBe('apple-only')
    expect(optionReason('6303', m3.product, bitDepth, 0, {})).toBeNull()
    expect(optionReason('6701', max2Usb.product, channel, 2, {})).toBe('box-only')
    expect(optionReason('6701', max2Box.product, channel, 2, {})).toBeNull()
  })
  it('keeps box-only ahead of the timecode refusal', () => {
    const cam = findMockPreset('max2cam')!
    const values = { 'max2.tc.enabled': true, 'max2.tc.mode': 0 }
    expect(optionReason('6701', cam.product, channel, 2, values)).toBe('box-only')
    expect(optionReason('6701', cam.product, channel, 1, values)).toBe('timecode-on')
  })
  it('leaves permanent refusals out and draws the others flat', () => {
    const opts = choiceOptions(channel, (v) =>
      v === 2 ? { code: 'box-only', text: 'Charging case only' } : v === 1 ? { code: 'timecode-on', text: 'Timecode is on' } : null,
    )
    expect(opts.map((o) => o.value)).toEqual([0, 1])
    expect(opts[1]).toMatchObject({ disabled: true, hint: 'Timecode is on' })
  })
  it('leaves 32-bit float out unless it is the current value', () => {
    const refuse = (v: number) => (v === 1 ? { code: 'apple-only', text: 'iOS app only' } : null)
    expect(choiceOptions(bitDepth, refuse, 0).map((o) => o.value)).toEqual([0])
    expect(choiceOptions(bitDepth, refuse, 1)).toEqual([
      { value: 0, label: '24bit' },
      { value: 1, label: '32bit float', disabled: true, hint: 'iOS app only' },
    ])
  })
  it('wraps long key rows onto two columns', () => {
    expect(keyColumns([{ label: 'Mono' }, { label: 'Stereo' }, { label: 'Secure audio track' }])).toBe(2)
    expect(keyColumns([{ label: 'Weak' }, { label: 'Medium' }, { label: 'Strong' }])).toBeUndefined()
    expect(keyColumns(Array.from({ length: 9 }, (_, i) => ({ label: String(i) })))).toBe(4)
  })
})

describe('visibility', () => {
  const ctx = (values: Record<string, unknown>, reasons: Record<string, string> = {}, family: ControlContext['family'] = '6701'): ControlContext => ({
    family,
    value: (id) => values[id] as never,
    availability: (id) => (reasons[id] ? { ok: false, reason: reasons[id] } : null),
  })
  it('hides controls a newer firmware replaced', () => {
    const preset = spec({ id: 'melo.mic.gainPreset', kind: 'choice' })
    expect(isShown(preset, ctx({}, { 'melo.mic.gainPreset': 'firmware-too-new' }, '6201'))).toBe(false)
    expect(isShown(preset, ctx({}, { 'melo.mic.gainPreset': 'firmware-too-old' }, '6201'))).toBe(true)
  })
  it('shows either MAX 2 dynamic gain or per-mic gain', () => {
    const dyn = spec({ id: 'max2.gain.dynamic', kind: 'choice' })
    const per = spec({ id: 'mic.gain', kind: 'range', perUnit: ['tx1'] })
    expect(isShown(dyn, ctx({ 'max2.gain.type': 1 }))).toBe(true)
    expect(isShown(per, ctx({ 'max2.gain.type': 1 }), 'tx1')).toBe(false)
    expect(isShown(dyn, ctx({ 'max2.gain.type': 0 }))).toBe(false)
    expect(isShown(per, ctx({ 'max2.gain.type': 0 }), 'tx1')).toBe(true)
    expect(isShown(dyn, ctx({}))).toBe(true)
    expect(isShown(per, ctx({}), 'tx1')).toBe(true)
  })
})

describe('modules', () => {
  it('groups the A1 home screen like the receiver strip', () => {
    const specs = controlsOf('a1').filter((c) => pageOf(c, '6108') === 'overview' && !c.perUnit)
    const mods = buildModules(specs)
    expect(mods.map((m) => m.key)).toEqual(['noise.enabled', 'volume', 'channel.mode', 'a1.eq', 'a1.reverb.enabled'])
    expect(mods[0].head?.id).toBe('noise.enabled')
    expect(mods[0].body.map((s) => s.id)).toEqual(['noise.level'])
    expect(mods[4].body.map((s) => s.id)).toEqual(['a1.reverb.level'])
  })
  it('merges the M3 camera volume levels, the MAX 2 gain and bit depth', () => {
    const cam = buildModules(controlsOf('m3cam').filter((c) => c.id.startsWith('m3.cameraVolume')))
    expect(cam).toHaveLength(1)
    expect(cam[0].title).toBe('RX volume')
    expect(cam[0].body).toHaveLength(3)
    const max2 = buildModules(controlsOf('max2').filter((c) => pageOf(c, '6701') === 'overview' && !c.perUnit))
    const gain = max2.find((m) => m.key === 'max2.gain.type')!
    expect(gain.body.map((s) => s.id)).toEqual(['max2.gain.type', 'max2.gain.dynamic'])
    // Noise first, then gain and the channel mode; the set-and-forget controls are on Settings.
    expect(max2.map((m) => m.key)).toEqual(['noise.enabled', 'max2.gain.type', 'channel.mode'])
    const bits = buildModules(controlsOf('max2').filter((c) => c.id === 'max2.bitDepth' || c.id === 'max2.usbOutput'))
    expect(bits).toHaveLength(1)
    expect(bits[0].title).toBe('Bit depth')
    expect(bits[0].body.map((s) => s.id)).toEqual(['max2.bitDepth', 'max2.usbOutput'])
  })
  it('sizes a two-column key row by its widest row, with a lone key on its own row', () => {
    const channel = spec({
      id: 'channel.mode',
      kind: 'choice',
      label: 'Channel mode',
      options: [
        { value: 0, label: 'Mono' },
        { value: 1, label: 'Stereo' },
        { value: 2, label: 'Secure audio track' },
      ],
    })
    const [def] = buildModules([channel])
    // "Secure audio track" (18 characters) alone on the second row decides the width.
    expect(moduleNeed(def)).toBeGreaterThanOrEqual(Math.ceil(18 * 6.9 + 18 + 40))
  })
  it('lays a strip out in balanced rows and keeps a lone module narrow', () => {
    expect(stripColumns([200, 200, 200, 200, 200, 200, 200, 200, 200], 1100)).toHaveLength(5)
    expect(stripColumns([300, 300], 1200)).toEqual([300, 300, 300])
    expect(stripColumns([300, 300], 500)).toEqual([300])
    expect(stripColumns([300], 1200)).toEqual([300, 300, 300])
    expect(stripColumns([300], 500)).toEqual([300])
    const mods = buildModules(controlsOf('a1').filter((c) => pageOf(c, '6108') === 'overview' && !c.perUnit))
    const w = stripColumns(mods.map((m) => moduleNeed(m)), 1208)
    expect(w).toHaveLength(5)
  })
})

describe('meters', () => {
  it('expects four USB channels only in M3 4-track', () => {
    expect(usbChannelCount('6303', 2)).toBe(4)
    expect(usbChannelCount('6701', 2)).toBe(2)
    expect(usbChannelCount('6108', 1)).toBe(2)
  })
  it('labels a USB channel by what it carries', () => {
    expect(usbChannelLabel('6108', 1, 0, 'Host')).toEqual({ label: 'Host', caption: null })
    expect(usbChannelLabel('6303', 2, 3, 'Mic 4')).toEqual({ label: 'Mic 4', caption: null })
    expect(usbChannelLabel('6108', 0, 1, 'Mic 2')).toEqual({ label: 'Mix · R', caption: 'Mix · R' })
    expect(usbChannelLabel('6701', 2, 0, 'Mic 1')).toEqual({ label: 'USB L', caption: 'USB L' })
    expect(usbChannelLabel('6701', undefined, 1, 'Mic 2')).toEqual({ label: 'USB R', caption: 'USB R' })
  })
  it('drops stale device levels', () => {
    expect(deviceReading(-20, 1000, 1500)).toEqual({ rmsDb: -20, peakDb: -20 })
    expect(deviceReading(-20, 1000, 4000)).toBeNull()
    expect(deviceReading(undefined, 1000, 1000)).toBeNull()
  })
})
