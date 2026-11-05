import { describe, expect, it } from 'vitest'
import { LevelHistory, copyHistory } from '../history'
import { curveFrequencies, eqResponseDb } from '../../../components/audio/toneCurve'
import { PRESET_TEMPLATES } from '../../dsp/presets'

const lv = (rmsDb: number, peakDb = rmsDb + 6) => ({ rmsDb, peakDb })

describe('LevelHistory', () => {
  it('keeps the loudest value of each slot', () => {
    const h = new LevelHistory(2, 10, 2)
    h.start(0)
    h.feed(10, [lv(-30), lv(-40)])
    h.feed(50, [lv(-20), lv(-45)])
    h.feed(120, [lv(-50), lv(-10)]) // next slot: closes slot 0
    const v = h.view(0)
    expect(v.count).toBe(1)
    expect(v.rms[0]).toBe(-20)
    expect(h.view(1).rms[0]).toBe(-40)
  })

  it('writes gaps (NaN) for slots without a measurement', () => {
    const h = new LevelHistory(1, 10, 2)
    h.start(0)
    h.feed(0, [lv(-20)])
    h.feed(450, [lv(-25)]) // slots 1..3 had nothing
    const out = new Float32Array(4)
    expect(copyHistory(h.view(0), 4, out)).toBe(4)
    expect(out[0]).toBe(-20)
    expect(Number.isNaN(out[1]) && Number.isNaN(out[2]) && Number.isNaN(out[3])).toBe(true)
  })

  it('wraps and copies the newest slots oldest-first, right-aligned', () => {
    const h = new LevelHistory(1, 10, 0.5) // 5 slots
    h.start(0)
    for (let i = 0; i < 8; i++) h.feed(i * 100 + 1, [lv(-i)])
    h.feed(801, [lv(0)])
    const v = h.view(0)
    expect(v.count).toBe(5)
    const out = new Float32Array(6)
    expect(copyHistory(v, 6, out)).toBe(5)
    expect(Number.isNaN(out[0])).toBe(true)
    expect(Array.from(out.slice(1))).toEqual([-3, -4, -5, -6, -7])
  })

  it('collects a take envelope of peaks while recording', () => {
    const h = new LevelHistory(2, 10, 1)
    h.start(0)
    h.beginEnvelope()
    for (let i = 0; i < 2500; i++) h.feed(i * 100 + 1, [lv(-30, -12), lv(-40, -20)])
    expect(h.envelopeLength()).toBe(2499)
    expect(h.envelopeAt(0, 2000)).toBe(-12)
    const env = h.endEnvelope()!
    expect(env.peak[0].length).toBe(2499)
    expect(env.peak[1][1500]).toBe(-20)
    expect(h.endEnvelope()).toBeNull()
  })
})

describe('tone curves', () => {
  const f = curveFrequencies(32)
  it('come from the real EQ: high-pass presets fall off at the low end', () => {
    const clean = eqResponseDb('clean', f)
    expect(clean[0]).toBeLessThan(-10) // HPF at 123 Hz
    expect(Math.abs(clean[16])).toBeLessThan(8)
  })
  it('are finite for every preset', () => {
    for (const t of PRESET_TEMPLATES) {
      const r = eqResponseDb(t.id, f)
      expect(r.every(Number.isFinite)).toBe(true)
    }
  })
  it('are flat for an unknown preset', () => {
    expect(eqResponseDb('nope', f).every((v) => v === 0)).toBe(true)
  })
})
