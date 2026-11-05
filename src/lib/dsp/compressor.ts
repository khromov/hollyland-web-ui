/**
 * Compressor: CompressInit 0x6510, CompressUpdate 0x66c0, CompressProcess
 * 0x6a78, gainCompute 0x6b8c, gainSmooth 0x6d80, magCompute 0x9304.
 *
 * Per 240-sample frame:
 *   level = mean(|x|) over the frame (linear, float32 running sum / 240)
 *   gain  = static curve in the LINEAR domain (see gainCompute)
 *   gain is smoothed per sample with a one-pole whose direction (attack vs
 *   release) is chosen once per frame; hold freezes the gain while releasing.
 *   y = x * g[i] * makeup
 */
import { expf, f, fcvtzs, fma32, fmsub32, logf, powf } from './f32'

export const FRAME = 240

export interface CompressorParams {
  enable: boolean
  thresholdDb: number
  ratio: number
  attackMs: number // int
  releaseMs: number // int
  gainDb: number
  knee: number
  holdMs: number
  rangeDb: number
}

/** dB2line (0x9044): powf(10, x * 0.05f). */
export const dB2line = (db: number): number => powf(10, f(f(db) * f(0.05)))
const EPS = f(0.001) // 0x3a83126f
const LN9 = () => logf(9)

export class Compressor {
  readonly out = new Float32Array(FRAME)
  readonly gainBuf = new Float32Array(FRAME)
  thr = 0
  invRatio = 0
  attSamples = 0
  attCoef = 0
  relSamples = 0
  relCoef = 0
  holdSamples = 0
  holdCount = 0
  knee = 0
  prevGain = 0
  makeup = 0
  range = 0

  constructor() {
    this.init()
  }

  /** CompressInit: fresh state (the native callocs a new out buffer). */
  init(): void {
    this.out.fill(0)
    this.gainBuf.fill(f(2.3694278e-38)) // memset(..., 1, 960) -> 0x01010101
    this.thr = f(0.8)
    this.invRatio = 1
    this.attSamples = 48
    this.attCoef = expf(f(-LN9() / 48))
    this.relSamples = 48
    this.relCoef = expf(f(-LN9() / 48))
    this.knee = f(0.1)
    this.holdSamples = 48
    this.holdCount = 48
    this.prevGain = 1
    this.makeup = 1
    this.range = 0
  }

  /** CompressUpdate: each field only changes when it moved by more than a step. */
  update(p: CompressorParams): void {
    const thr = dB2line(p.thresholdDb)
    if (Math.abs(f(this.thr - thr)) > EPS) this.thr = thr
    const range = dB2line(p.rangeDb)
    if (Math.abs(f(this.range - range)) > EPS) this.range = range
    const inv = f(1 / f(p.ratio))
    if (Math.abs(f(this.invRatio - inv)) > EPS) this.invRatio = inv
    const knee = f(p.knee)
    if (Math.abs(f(this.knee - knee)) > EPS) this.knee = knee
    const toSamples = (ms: number) => fcvtzs(f(f(Math.imul(ms | 0, 48000)) * EPS))
    const hold = toSamples(fcvtzs(f(p.holdMs)))
    if (Math.abs((this.holdSamples - hold) | 0) > 1) {
      this.holdSamples = hold
      this.holdCount = hold
    }
    const att = toSamples(p.attackMs)
    if (Math.abs((this.attSamples - att) | 0) > 1) {
      this.attSamples = att
      this.attCoef = expf(f(-LN9() / f(att)))
    }
    const rel = toSamples(p.releaseMs)
    if (Math.abs((this.relSamples - rel) | 0) > 1) {
      this.relSamples = rel
      this.relCoef = expf(f(-LN9() / f(rel)))
    }
    const mk = dB2line(p.gainDb)
    if (Math.abs(f(this.makeup - mk)) > EPS) this.makeup = mk
  }

  /** gainCompute: linear-domain static curve with a quadratic knee. */
  gainCompute(x: number): number {
    let R = this.invRatio
    const T = this.thr
    const K = this.knee
    let g = 1
    if (R > f(0.999)) R = f(0.999)
    if (x > f(f(1 + K) * T)) {
      g = fma32(f(1 - R), f(T / x), R)
    } else if (x < f(f(1 - K) * T)) {
      g = 1
    } else {
      const t = fmsub32(T, f(1 - K), x) // x - T*(1-K)
      const p2 = powf(t, 2)
      g = f(1 + f(f(f(R - 1) * p2) / f(f(f(4 * K) * T) * x)))
    }
    if (g < this.range) g = this.range
    return g
  }

  gainSmooth(g: number): void {
    const buf = this.gainBuf
    let prev = this.prevGain
    if (prev > g) {
      this.holdCount = this.holdSamples
      const c = this.attCoef
      const k = f(1 - c)
      for (let i = 0; i < FRAME; i++) {
        prev = fma32(k, g, f(c * prev))
        buf[i] = prev
      }
    } else if (g > prev) {
      if (this.holdCount !== 0) {
        for (let i = 0; i < FRAME; i++) {
          buf[i] = prev
          this.holdCount = (this.holdCount - 1) | 0
        }
      } else {
        const c = this.relCoef
        const k = f(1 - c)
        for (let i = 0; i < FRAME; i++) {
          prev = fma32(k, g, f(c * prev))
          buf[i] = prev
        }
      }
    } else {
      this.holdCount = this.holdSamples
      buf.fill(g)
    }
    this.prevGain = prev
  }

  /** Writes into this.out and returns it. */
  process(x: Float32Array): Float32Array {
    const level = magCompute(x, true)
    this.gainSmooth(this.gainCompute(level))
    const out = this.out
    const gb = this.gainBuf
    const mk = this.makeup
    for (let i = 0; i < FRAME; i++) out[i] = f(f(x[i] * gb[i]) * mk)
    return out
  }
}

/** magCompute: mean |x| (mode != 0) or peak |x| (mode 0) over one frame. */
export function magCompute(x: Float32Array, mean: boolean): number {
  let acc = 0
  if (mean) {
    for (let i = 0; i < FRAME; i++) acc = f(acc + Math.abs(x[i]))
    return f(acc / 240)
  }
  for (let i = 0; i < FRAME; i++) {
    const a = Math.abs(x[i])
    if (a > acc || acc !== acc) acc = a
  }
  return acc
}
