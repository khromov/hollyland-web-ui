/**
 * "LUFS" stage: lufs_init 0x4ca8, dsp_integrated_loudness 0x4f84.
 *
 * Despite the name this is a sliding-window RMS AGC, not BS.1770 (no
 * K-weighting, no gating). It is only used by cmsis_process_wav, where it
 * pre-scales the input before the chain and divides the output by the last
 * gain of the frame. cmsis_process_frame (real-time) never calls it, and the
 * enable flag set by cmsis_set_lufs is never read.
 *
 *   window  = time (s; values >= 1 are scaled by 0.1; invalid -> 0.4)
 *             * 48000, clamped to [240, 96000] samples
 *   rms     = sqrt(sum(x^2)/N + 1e-10), floored at 1e-8
 *   level   = 20 log10(rms) - 0.691
 *   g       = 10^((target - level)/20) clamped to [0.1, 10]
 *   smooth  = alpha*smooth + (1-alpha)*g   (per sample)
 *   y       = x * smooth
 */
import { f, fcvtzs, fma32, log10f, powf } from './f32'

export interface LufsParams {
  time: number
  scale: number
  alpha: number
  targetLoud: number
}

export class Loudness {
  target = 0
  alpha = f(0.7)
  gainOut = 1
  sum = 0
  smooth = 1
  winLen = 240
  idx = 0
  buf = new Float32Array(240)

  init(p: LufsParams): void {
    this.target = f(p.targetLoud)
    const a = f(p.alpha)
    this.alpha = a > 0 && a < 1 ? a : f(0.7)
    this.gainOut = 1
    this.smooth = 1
    this.sum = 0
    this.idx = 0
    let t = f(p.time)
    if (t >= 1) t = f(t * f(0.1))
    if (t <= 0 || t > 2) t = f(0.4)
    let n = fcvtzs(f(t * 48000))
    if (n < 240) n = 240
    if (n > 96000) n = 96000
    this.winLen = n
    this.buf = new Float32Array(n)
  }

  step(x: number): number {
    const N = this.winLen
    const old = this.buf[this.idx]
    const oldSq = f(old * old)
    this.buf[this.idx] = x
    this.idx = (this.idx + 1) % N
    let s = fma32(x, x, f(this.sum - oldSq))
    if (s < 0) s = 0
    this.sum = s
    let rms = f(Math.sqrt(f(f(s / f(N)) + f(1e-10))))
    if (rms < f(1e-8)) rms = f(1e-8)
    const level = fma32(20, log10f(rms), f(-0.691))
    let g = powf(10, f(f(this.target - level) * f(0.05)))
    if (g < f(0.1)) g = f(0.1)
    if (g > 10) g = 10
    this.smooth = fma32(this.alpha, this.smooth, f(f(1 - this.alpha) * g))
    this.gainOut = this.smooth
    return f(x * this.smooth)
  }
}
