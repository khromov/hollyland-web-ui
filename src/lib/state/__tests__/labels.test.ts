import { describe, expect, it } from 'vitest'
import type { ControlSpec } from '../../protocol'
import { displayControls, displayLabel, displayOption, displaySpec } from '../labels'

const spec = (p: Partial<ControlSpec> & Pick<ControlSpec, 'id' | 'kind' | 'label'>): ControlSpec => ({
  group: 'audio',
  safety: 'write',
  readBack: 'status',
  confidence: 'high',
  source: 'test',
  ...p,
})

describe('display labels', () => {
  it('uses one casing and drops the official suffixes', () => {
    expect(displayLabel('Volume adjustment')).toBe('Volume')
    expect(displayLabel('Reverb Adjustment')).toBe('Reverb')
    expect(displayLabel('Channel Mode')).toBe('Channel mode')
    expect(displayLabel('Schedule power off')).toBe('Auto power off')
    expect(displayLabel('Indicator Light Switch')).toBe('Indicator light')
    expect(displayLabel('Wireless Monitoring Toggle')).toBe('Wireless monitoring')
    expect(displayLabel('USB Output')).toBe('USB output')
    expect(displayLabel('LED Settings')).toBe('LED')
    expect(displayLabel('NC')).toBe('NC')
    expect(displayLabel('Instr')).toBe('Instrument')
    expect(displayLabel('Mon (2.4G)')).toBe('Wireless monitoring')
    expect(displayLabel('Set gain to')).toBe('Gain')
  })
  it('spells bit depths one way and puts them in one order', () => {
    expect(displayOption('24bit')).toBe('24-bit')
    expect(displayOption('32bit float')).toBe('32-bit float')
    expect(displayOption('Set gain to')).toBe('Fixed')
    const depth = displaySpec(
      spec({ id: 'max2.bitDepth', kind: 'choice', label: 'Internal Recording Depth', options: [{ value: 1, label: '32bit float' }, { value: 0, label: '24bit' }] }),
    )
    expect(depth.label).toBe('Internal recording')
    expect(depth.options).toEqual([
      { value: 0, label: '24-bit' },
      { value: 1, label: '32-bit float' },
    ])
  })
  it('keeps other option orders and caches per control list', () => {
    const list = [spec({ id: 'x', kind: 'choice', label: 'EQ Adjustment', options: [{ value: 2, label: 'Equalization' }, { value: 0, label: 'Low' }] })]
    const out = displayControls(list)
    expect(out[0].options?.map((o) => o.value)).toEqual([2, 0])
    expect(displayControls(list)).toBe(out)
  })
})
