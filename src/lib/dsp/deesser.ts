/**
 * De-esser: EsserInit 0x42f4, EsserUpdate 0x43dc, EsserProcess 0x4754,
 * easyDeesserProcess 0x4474, DeessergainCal 0x46c4, plus the DF1 biquads
 * LpInit/LpUpdate/LpProcess (0x52f4..), HpInit/HpUpdate/HpProcess (0x10d78..),
 * PeakInit/PeakUpdate/PeakProcess (0x8b1c..).
 *
 * Per frame: the input is band-limited by LP(freqL) then HP(freqH) (both
 * 2nd order, Q 0.707); ratio = sqrt(sum(band^2) / sum(x^2)); the ratio is
 * smoothed per frame (0.7 old + 0.3 new, in double); its level in dB drives
 * gain = range * (1 - level/threshold) when level > threshold (else 0 dB),
 * applied by a peaking filter at sqrt(freqL*freqH), Q = f0/(freqL-freqH).
 *
 * iOS quirk: cmsis_set_esser in cmsis_api_ios never stores its 5th argument,
 * so `range` stays at whatever the params block held (zero after malloc in
 * practice), which makes the peaking gain 0 dB and the stage a near-identity.
 * The Android library stores it. See `rangeOverride` in the pipeline.
 */
import { cosf, f, fma32, fma64, fmsub32, log10f, powf, sinf } from './f32'
import { FRAME } from './compressor'

const TWO_PI_OVER_FS = (hz: number) => f((f(f(hz) * 2) * Math.PI) / 48000)

/** Direct-form-I biquad shared by Lp, Hp and Peak (same op order in all three). */
class Df1 {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0
  x1 = 0; x2 = 0; y1 = 0; y2 = 0
  x = 0; y = 0

  set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
    this.b0 = f(b0 / a0)
    this.b1 = f(b1 / a0)
    this.b2 = f(b2 / a0)
    this.a1 = f(a1 / a0)
    this.a2 = f(a2 / a0)
  }

  step(x: number): number {
    this.x = x
    let y = fma32(this.b0, x, f(this.b1 * this.x1))
    y = fma32(this.b2, this.x2, y)
    y = fmsub32(this.a1, this.y1, y)
    y = fmsub32(this.a2, this.y2, y)
    this.x2 = this.x1
    this.x1 = x
    this.y2 = this.y1
    this.y1 = y
    this.y = y
    return y
  }

  processFrame(buf: Float32Array): void {
    for (let i = 0; i < FRAME; i++) buf[i] = this.step(buf[i])
  }
}

export class LowPass extends Df1 {
  fc = 8000
  constructor(public q: number, public order: number) {
    super()
    this.q = f(q)
  }
  update(fc: number): void {
    this.fc = fc
    if (this.order > 1) {
      const w0 = TWO_PI_OVER_FS(fc)
      const sn = sinf(w0), cs = cosf(w0)
      const alpha = f(sn / f(2 * this.q))
      const b0 = f(f(1 - cs) * 0.5)
      this.set(b0, f(1 - cs), b0, f(1 + alpha), f(-2 * cs), f(1 - alpha))
    } else {
      const t = f(Math.tan((Math.PI * f(fc)) / 48000))
      const d = f(t + 1)
      this.set(f(t / d), f(t / d), 0, 1, f(f(t - 1) / d), 0)
    }
  }
}

export class HighPass extends Df1 {
  fc = 600
  constructor(public q: number, public order: number) {
    super()
    this.q = f(q)
  }
  update(fc: number): void {
    // HpUpdate skips entirely when |(int)(old - new)| <= 1
    const d = Math.trunc(f(this.fc - fc))
    if (Math.abs(d) <= 1) return
    this.fc = fc
    if (this.order > 1) {
      const w0 = TWO_PI_OVER_FS(fc)
      const sn = sinf(w0), cs = cosf(w0)
      const alpha = f(sn / f(2 * this.q))
      const b0 = f(f(1 + cs) * 0.5)
      this.set(b0, f(-1 - cs), b0, f(1 + alpha), f(-2 * cs), f(1 - alpha))
    } else {
      const t = f(Math.tan((Math.PI * f(fc)) / 48000))
      const dd = f(t + 1)
      this.set(f(1 / dd), f(-1 / dd), 0, 1, f(f(t - 1) / dd), 0)
    }
  }
}

export class Peak extends Df1 {
  f0 = 5000
  q = f(0.707)
  gain = 0
  update(f0: number, gain: number, q: number): void {
    this.f0 = f0
    this.gain = gain
    this.q = q
    const A = powf(10, f(gain / 40))
    const w0 = TWO_PI_OVER_FS(f0)
    const sn = sinf(w0), cs = cosf(w0)
    const alpha = f(sn / f(2 * q))
    const aOverA = f(alpha / A)
    this.set(fma32(alpha, A, 1), f(-2 * cs), fmsub32(alpha, A, 1), f(1 + aOverA), f(-2 * cs), f(1 - aOverA))
  }
}

export interface DeesserParams {
  enable: boolean
  freqL: number
  freqH: number
  thresholdDb: number
  /** Peaking gain at 0 dB level; see the iOS quirk above. */
  range: number
}

export class Deesser {
  readonly out = new Float32Array(FRAME)
  private readonly side = new Float32Array(FRAME)
  enabled = 1
  threshold = 0
  level = 0
  range = -14
  freqL = 8000
  freqH = 5000
  lp = new LowPass(0.707, 2)
  hp = new HighPass(0.707, 2)
  peak = new Peak()

  constructor() {
    this.init()
  }

  init(): void {
    this.lp = new LowPass(0.707, 2)
    this.hp = new HighPass(0.707, 2)
    this.peak = new Peak()
    this.freqL = 8000
    this.freqH = 5000
    this.enabled = 1
    this.range = -14
    this.level = 0
    this.out.fill(0)
  }

  update(p: DeesserParams): void {
    this.freqL = f(p.freqL)
    this.freqH = f(p.freqH)
    this.threshold = f(p.thresholdDb)
    this.range = f(p.range)
    this.lp.update(this.freqL)
    this.hp.update(this.freqH)
  }

  private gainCal(levelDb: number): number {
    if (levelDb > this.threshold) return fma32(f(-this.range / this.threshold), levelDb, this.range)
    return 0
  }

  process(x: Float32Array): Float32Array {
    const out = this.out
    out.set(x.subarray(0, FRAME))
    if (this.enabled === 1) {
      const side = this.side
      side.set(x.subarray(0, FRAME))
      this.lp.processFrame(side)
      this.hp.processFrame(side)
      let es = 0, ex = 0
      for (let i = 0; i < FRAME; i++) {
        es = fma32(side[i], side[i], es)
        ex = fma32(x[i], x[i], ex)
      }
      const ratio = ex > 0 ? f(Math.sqrt(f(es / ex))) : 0
      this.level = f(fma64(0.7, this.level, 0.3 * ratio))
      const db = f(20 * log10f(this.level))
      const g = this.gainCal(db)
      const f0 = f(Math.sqrt(f(this.freqL * this.freqH)))
      const q = f(f0 / f(this.freqL - this.freqH))
      this.peak.update(f0, g, q)
      this.peak.processFrame(out)
    }
    return out
  }
}
