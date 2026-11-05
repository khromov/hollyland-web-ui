/**
 * Tone curves for the voice-profile keys: the magnitude response of each profile's EQ, computed
 * from the same biquad coefficients the DSP runs (designBiquad on the iOS setter arguments in
 * src/lib/dsp/presets.ts). The compressor, de-esser and exciter are level-dependent and are not
 * part of the curve.
 */
import { designBiquad } from '../../lib/dsp/eq'
import { findTemplate, iosSetterCalls } from '../../lib/dsp/presets'

const FS = 48000
export const CURVE_F_MIN = 40
export const CURVE_F_MAX = 16000

/** Log-spaced frequencies from CURVE_F_MIN to CURVE_F_MAX. */
export function curveFrequencies(n = 64): number[] {
  const a = Math.log(CURVE_F_MIN)
  const b = Math.log(CURVE_F_MAX)
  return Array.from({ length: n }, (_, i) => Math.exp(a + ((b - a) * i) / (n - 1)))
}

/** EQ gain in dB of a profile at each frequency (0 dB where the profile is unknown). */
export function eqResponseDb(presetId: string, freqs: readonly number[]): number[] {
  const t = findTemplate(presetId)
  if (!t) return freqs.map(() => 0)
  const stages = iosSetterCalls(t)
    .eqBands.filter(([, enable]) => enable)
    .map(([, , filterType, gain, f0, q]) => designBiquad({ enable: true, filterType, gain, f0, q }, FS))
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / FS
    const c1 = Math.cos(w)
    const s1 = Math.sin(w)
    const c2 = Math.cos(2 * w)
    const s2 = Math.sin(2 * w)
    let mag2 = 1
    for (const [b0, b1, b2, na1, na2] of stages) {
      // CMSIS stores -a1, -a2: H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 - na1 z^-1 - na2 z^-2)
      const nr = b0 + b1 * c1 + b2 * c2
      const ni = -(b1 * s1 + b2 * s2)
      const dr = 1 - na1 * c1 - na2 * c2
      const di = na1 * s1 + na2 * s2
      mag2 *= (nr * nr + ni * ni) / (dr * dr + di * di || 1e-30)
    }
    return 10 * Math.log10(mag2 || 1e-30)
  })
}

export interface CurveGeometry {
  /** SVG path of the curve in a width × height box (0 dB in the middle). */
  d: string
  /** y of the 0 dB line. */
  flat: number
}

const cache = new Map<string, CurveGeometry>()

/**
 * Path for a small curve: ±range dB fill the height, values beyond it are clipped to the edge.
 * Cached per profile and size.
 */
export function curvePath(presetId: string, width: number, height: number, range = 15, points = 48): CurveGeometry {
  const key = `${presetId}:${width}:${height}:${range}:${points}`
  const hit = cache.get(key)
  if (hit) return hit
  const freqs = curveFrequencies(points)
  const db = eqResponseDb(presetId, freqs)
  const mid = height / 2
  const pad = 1.5
  const d = db
    .map((v, i) => {
      const x = (i / (points - 1)) * width
      const clamped = Math.max(-range, Math.min(range, v))
      const y = Math.max(pad, Math.min(height - pad, mid - (clamped / range) * (mid - pad)))
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const g = { d, flat: mid }
  cache.set(key, g)
  return g
}
