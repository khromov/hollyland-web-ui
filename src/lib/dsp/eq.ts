/**
 * 10-band parametric EQ: IIR_coef_compute (0x7a4c), IIR_coef_init/update
 * (0x75bc / 0x81e4) and arm_biquad_cascade_df2T_f32 (0x8924).
 *
 * Coefficients are RBJ "Audio EQ Cookbook" designs computed entirely in
 * float32, with the FMA contractions the native build emitted. Shelves use
 * the Q form (alpha = sin(w0) / (2Q)), not the slope S form. fs is always
 * 48000 (cmsis_set_eq_band overwrites the band's fs).
 */
import { cosf, f, fma32, fmsub32, powf, sinf } from './f32'

export const FilterType = {
  LowShelf: 1,
  HighShelf: 2,
  Peaking: 3,
  Notch: 4,
  LowPass: 5,
  HighPass: 6,
  BandPass: 7,
} as const

export interface EqBandParams {
  enable: boolean
  filterType: number
  gain: number
  f0: number
  q: number
}

export const EQ_MAX_BANDS = 10
export const EQ_MAX_STAGES = 24
const PI_F = f(Math.PI) // 0x40490fdb
const FS = 48000

/**
 * Returns [b0, b1, b2, -a1, -a2] normalised by a0, in CMSIS sign convention
 * (feedback coefficients negated). All zeros if a0 == 0.
 */
export function designBiquad(band: EqBandParams, fs = FS): Float32Array {
  const out = new Float32Array(5)
  const fs32 = f(fs)
  const f0 = f(band.f0)
  const gain = f(band.gain)
  const q = f(band.q)
  const w0 = f(f(f(f0 * 2) * PI_F) / fs32)
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0
  const A = powf(10, f(gain / 40))
  const sn = sinf(w0)
  const cs = cosf(w0)
  const alpha = f(sn / f(2 * q))
  const Ap1 = f(A + 1)
  const Am1 = f(A - 1)
  switch (band.filterType) {
    case FilterType.LowShelf: {
      const s2a = f(2 * Math.sqrt(A))
      b0 = f(A * fma32(s2a, alpha, fmsub32(Am1, cs, Ap1)))
      b1 = f(f(2 * A) * fmsub32(Ap1, cs, Am1))
      b2 = f(A * fmsub32(s2a, alpha, fmsub32(Am1, cs, Ap1)))
      a0 = fma32(s2a, alpha, fma32(Am1, cs, Ap1))
      a1 = f(-2 * fma32(Ap1, cs, Am1))
      a2 = fmsub32(s2a, alpha, fma32(Am1, cs, Ap1))
      break
    }
    case FilterType.HighShelf: {
      const s2a = f(2 * Math.sqrt(A))
      b0 = f(A * fma32(s2a, alpha, fma32(Am1, cs, Ap1)))
      b1 = f(f(-2 * A) * fma32(Ap1, cs, Am1))
      b2 = f(A * fmsub32(s2a, alpha, fma32(Am1, cs, Ap1)))
      a0 = fma32(s2a, alpha, fmsub32(Am1, cs, Ap1))
      a1 = f(2 * fmsub32(Ap1, cs, Am1))
      a2 = fmsub32(s2a, alpha, fmsub32(Am1, cs, Ap1))
      break
    }
    case FilterType.Peaking:
      b0 = fma32(alpha, A, 1)
      b1 = f(-2 * cs)
      b2 = fmsub32(alpha, A, 1)
      a0 = f(1 + f(alpha / A))
      a1 = f(-2 * cs)
      a2 = f(1 - f(alpha / A))
      break
    case FilterType.Notch:
      b0 = 1
      b1 = f(-2 * cs)
      b2 = 1
      a0 = f(1 + alpha)
      a1 = f(-2 * cs)
      a2 = f(1 - alpha)
      break
    case FilterType.LowPass:
      b0 = f(f(1 - cs) / 2)
      b1 = f(1 - cs)
      b2 = f(f(1 - cs) / 2)
      a0 = f(1 + alpha)
      a1 = f(-2 * cs)
      a2 = f(1 - alpha)
      break
    case FilterType.HighPass:
      b0 = f(f(1 + cs) / 2)
      b1 = f(-1 - cs)
      b2 = f(f(1 + cs) / 2)
      a0 = f(1 + alpha)
      a1 = f(-2 * cs)
      a2 = f(1 - alpha)
      break
    case FilterType.BandPass:
      b0 = alpha
      b1 = 0
      b2 = -alpha
      a0 = f(1 + alpha)
      a1 = f(-2 * cs)
      a2 = f(1 - alpha)
      break
    default:
      break
  }
  if (a0 !== 0) {
    out[0] = b0 / a0
    out[1] = b1 / a0
    out[2] = b2 / a0
    out[3] = -a1 / a0
    out[4] = -a2 / a0
  }
  return out
}

/** EQ stage: band table + df2T cascade state (pState is never cleared on update). */
export class Equalizer {
  readonly bands: EqBandParams[] = []
  numStages = 0
  /** CMSIS coefficients, 5 per stage: b0 b1 b2 -a1 -a2. */
  readonly coeffs = new Float32Array(EQ_MAX_STAGES * 5)
  /** Exported coefficients (cmsis_get_eq_coefficients): b0 b1 b2 a1 a2. */
  readonly rCoeffs = new Float32Array(EQ_MAX_STAGES * 5)
  readonly state = new Float32Array(EQ_MAX_STAGES * 2)

  constructor() {
    this.paramsInit()
    this.init()
  }

  /** params_init (0x8440): all bands disabled, type 10, f0 10, gain 1, q 1. */
  paramsInit(): void {
    this.bands.length = 0
    for (let i = 0; i < EQ_MAX_BANDS; i++) this.bands.push({ enable: false, filterType: 10, gain: 1, f0: 10, q: 1 })
  }

  /** IIR_coef_init: clears state and coefficients, then designs. */
  init(): void {
    this.state.fill(0)
    this.coeffs.fill(0)
    this.coeffs[0] = 1
    this.rCoeffs.fill(0)
    this.rCoeffs[0] = 1
    this.update()
  }

  /** IIR_coef_update: re-designs enabled bands into consecutive stages; keeps state. */
  update(): void {
    let stage = 0
    for (let i = 0; i < EQ_MAX_BANDS; i++) {
      const b = this.bands[i]
      if (!b.enable) continue
      const c = designBiquad(b)
      for (let j = 0; j < 5; j++) {
        this.coeffs[stage * 5 + j] = c[j]
        this.rCoeffs[stage * 5 + j] = j < 3 ? c[j] : -c[j]
      }
      stage = (stage + 1) & 0xff
    }
    this.numStages = stage
  }

  setBand(index: number, band: EqBandParams): void {
    if (index < 0 || index >= EQ_MAX_BANDS) return
    this.bands[index] = {
      enable: !!band.enable,
      filterType: band.filterType | 0,
      gain: f(band.gain),
      f0: f(band.f0),
      q: f(band.q),
    }
    this.update()
  }

  /** arm_biquad_cascade_df2T_f32, in place. Caller skips when numStages == 0. */
  process(buf: Float32Array, n = buf.length): void {
    const c = this.coeffs
    const st = this.state
    for (let s = 0; s < this.numStages; s++) {
      const b0 = c[s * 5], b1 = c[s * 5 + 1], b2 = c[s * 5 + 2], a1 = c[s * 5 + 3], a2 = c[s * 5 + 4]
      let d1 = st[s * 2], d2 = st[s * 2 + 1]
      for (let i = 0; i < n; i++) {
        const x = buf[i]
        const acc = fma32(b0, x, d1)
        d1 = fma32(a1, acc, fma32(b1, x, d2))
        d2 = fma32(a2, acc, f(b2 * x))
        buf[i] = acc
      }
      st[s * 2] = d1
      st[s * 2 + 1] = d2
    }
  }
}
