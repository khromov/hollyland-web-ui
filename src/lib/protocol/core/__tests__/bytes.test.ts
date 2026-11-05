import { describe, expect, it } from 'vitest'
import { ByteWriter, ascii, bytesEqual, chunkBytes, concatBytes, f32, hex16, i16, or, padBytes, u16, u32, u64, u8, utf8, xor8 } from '../bytes'
import { alternativeValue, compareVersions, controlKey, validateControlValue, versionGate } from '../controls'
import type { ControlSpec } from '../types'

describe('core/bytes', () => {
  it('reads LE / BE and returns undefined past the end', () => {
    const b = Uint8Array.of(0x34, 0x12, 0xff, 0xff, 0x00, 0x00, 0x80, 0x3f)
    expect(u16(b, 0)).toBe(0x1234)
    expect(u16(b, 0, 'be')).toBe(0x3412)
    expect(i16(b, 2)).toBe(-1)
    expect(u32(b, 4)).toBe(0x3f800000)
    expect(f32(b, 4)).toBe(1)
    expect(u8(b, 8)).toBeUndefined()
    expect(u16(b, 7)).toBeUndefined()
    expect(or(u16(b, 7), 0)).toBe(0)
  })

  it('writes the same values back', () => {
    const w = new ByteWriter().u16(0x1234).i16(-1).f32(1).u8(7).u16(0x600b, 'be').ascii('SN', 4).u64(0x0102030405060708n, 'be')
    const b = w.toBytes()
    expect([...b.subarray(0, 13)]).toEqual([0x34, 0x12, 0xff, 0xff, 0, 0, 0x80, 0x3f, 7, 0x60, 0x0b, 0x53, 0x4e])
    expect(u64(b, 15, 'be')).toBe(0x0102030405060708n)
    expect(() => new ByteWriter().u8(256)).toThrow(RangeError)
    expect(() => new ByteWriter().i16(40000)).toThrow(RangeError)
  })

  it('strings, xor, chunks', () => {
    expect(ascii(Uint8Array.of(0x41, 0x42, 0, 0x43), 0, 4)).toBe('AB')
    expect(utf8(new TextEncoder().encode('Mic é'), 0, 10)).toBe('Mic é')
    expect(xor8([0xaa, 0xdd, 0x06])).toBe(0xaa ^ 0xdd ^ 0x06)
    expect(chunkBytes(Uint8Array.of(1, 2, 3, 4, 5), 2).map((c) => [...c])).toEqual([[1, 2], [3, 4], [5]])
    expect([...concatBytes([1], [2, 3])]).toEqual([1, 2, 3])
    expect([...padBytes([1], 3)]).toEqual([1, 0, 0])
    expect(bytesEqual([1, 2], Uint8Array.of(1, 2))).toBe(true)
    expect(hex16(0x600b)).toBe('0x600B')
  })
})

describe('core/controls', () => {
  const steps: ControlSpec = {
    id: 'volume', label: 'Volume', group: 'receiver', kind: 'steps', range: { min: 0, max: 5, step: 1 }, safety: 'write', readBack: 'status',
    confidence: 'high', source: 'test',
  }
  const gain: ControlSpec = { ...steps, id: 'gain', kind: 'range', range: { min: -20, max: 20, step: 0.5, unit: 'dB' }, perUnit: ['tx1', 'tx2'] }

  it('validates values', () => {
    expect(validateControlValue(steps, 3)).toBe(3)
    expect(() => validateControlValue(steps, 6)).toThrow(/outside/)
    expect(() => validateControlValue(steps, 1.5)).toThrow()
    expect(validateControlValue(gain, -2.5, 'tx1')).toBe(-2.5)
    expect(() => validateControlValue(gain, -2.25, 'tx1')).toThrow(/step/)
    expect(() => validateControlValue(gain, 1)).toThrow(/needs a unit/)
    expect(controlKey('gain', 'tx2')).toBe('gain:tx2')
    expect(controlKey('gain', 'rx')).toBe('gain')
    expect(alternativeValue(steps, 0)).toBe(1)
    expect(alternativeValue(steps, 3)).toBe(0)
  })

  it('compares versions and builds gates', () => {
    expect(compareVersions('1.0.1.3', '1.0.1.03')).toBe(0)
    expect(compareVersions('v3.0.0.50', '3.0.0.49')).toBe(1)
    expect(compareVersions('2.0.0.9', '2.0.0.10')).toBe(-1)
    expect(versionGate(undefined, '1.0.1.3')).toMatchObject({ ok: false, reason: 'version-unknown' })
    expect(versionGate('0.0.0.0', '1.0.1.3')).toMatchObject({ ok: false, reason: 'version-unknown' })
    expect(versionGate('1.0.1.3', '1.0.1.3')).toEqual({ ok: true })
    expect(versionGate('1.0.1.3', '1.0.1.3', { exclusive: true })).toMatchObject({ ok: false, reason: 'firmware-too-old' })
    expect(versionGate('1.0.1.2', '1.0.1.3', { ignore: true })).toEqual({ ok: true })
  })
})
