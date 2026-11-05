/**
 * Distortion / exciter: distInit 0x1087c, distUpdate 0x108dc, distProcess
 * 0x10930, air_process 0x58c4, airInit 0x5a98, dist 0x59c0, gru_process
 * 0x601c, init_gru 0x6120.
 *
 * Native type numbering (differs from the Java constant names):
 *   0 -> GRU saturator, mixed with gruWet
 *   1 -> "airfresh": fixed +16 dB high shelf at 7 kHz (Q 1.7) in TDF2 with a
 *        soft clipper (x - x^3/4, clamped to +/-0.7) in the feedback path,
 *        mixed with airfreshWet
 *   2 -> pass-through copy
 * out = fx(x) * wet + x * (1 - wet)   (fused)
 * cmsis_set_distortion ignores the input/output gain arguments.
 */
import { f, fma32, fma64, fnmsub32, fmsub32, powf, tanh64 } from './f32'

/** dist(): soft clip used in the airfresh feedback path. */
export function softClip(x: number, thr: number): number {
  let r = f(x - powf(x, 3) * 0.25) // x - c^3*0.25 in double (product exact), then float
  if (r > thr) r = thr
  else if (r < -thr) r = -thr
  return r
}

export class AirFresh {
  thr = f(0.7)
  gainDb = 16
  q = f(1.7)
  f0 = 7000
  d1 = 0
  d2 = 0
  b0 = 0; b1 = 0; b2 = 0; a1 = 0; a2 = 0

  constructor() {
    this.init()
  }

  init(): void {
    this.d1 = 0
    this.d2 = 0
    this.f0 = 7000
    this.q = f(1.7)
    this.gainDb = 16
    this.thr = f(0.7)
    const w0 = f((f(f(this.f0) * 2) * Math.PI) / 48000)
    const sn = f(Math.sin(w0))
    const cs = f(Math.cos(w0))
    const alpha = f(sn / f(2 * this.q))
    const A = powf(10, f(this.gainDb / 40))
    const Ap1 = f(A + 1), Am1 = f(A - 1)
    const s2a = f(2 * Math.sqrt(A))
    const a0 = fma32(s2a, alpha, fmsub32(Am1, cs, Ap1))
    this.b0 = f(f(A * fma32(s2a, alpha, fma32(Am1, cs, Ap1))) / a0)
    this.b1 = f(f(f(-2 * A) * fma32(Ap1, cs, Am1)) / a0)
    this.b2 = f(f(A * fmsub32(s2a, alpha, fma32(Am1, cs, Ap1))) / a0)
    this.a1 = f(f(2 * fmsub32(Ap1, cs, Am1)) / a0)
    this.a2 = f(fmsub32(s2a, alpha, fmsub32(Am1, cs, Ap1)) / a0)
  }

  step(x: number): number {
    const y = fma32(this.b0, x, this.d1)
    const c = softClip(y, this.thr) // native calls dist() twice with identical args
    this.d1 = f(fnmsub32(this.b1, x, f(this.a1 * c)) + this.d2)
    this.d2 = fnmsub32(this.b2, x, f(this.a2 * c))
    return y
  }
}

export class Gru {
  wz = 0.5; wh = 1; uz = 0.5; uh = 0.5; bz = 0; h = 0
  init(): void {
    this.wz = 0.5; this.wh = 1; this.uz = 0.5; this.uh = 0.5; this.bz = 0; this.h = 0
  }
  step(x: number): number {
    const t = f(fma32(this.wz, x, f(this.uz * this.h)) + this.bz)
    const z = f(1 / (1 + Math.exp(t)))
    const a = f(z * this.h)
    const b = f(1 - z)
    const c = fma32(this.wh, x, f(f(this.uh * z) * this.h))
    this.h = f(fma64(b, tanh64(c), a))
    return this.h
  }
}

export interface DistortionParams {
  enable: boolean
  type: number
  airfreshWet: number
  gruWet: number
}

export class Distortion {
  airWet = 1
  gruWet = 1
  type = 0
  readonly gru = new Gru()
  readonly air = new AirFresh()

  init(): void {
    this.type = 0
    this.gruWet = 1
    this.airWet = 1
    this.gru.init()
    this.air.init()
  }

  update(p: DistortionParams): void {
    this.type = p.type | 0
    this.gruWet = f(p.gruWet)
    this.airWet = f(p.airfreshWet)
  }

  process(x: Float32Array, out: Float32Array, n: number): void {
    switch (this.type) {
      case 0: {
        const w = this.gruWet
        for (let i = 0; i < n; i++) out[i] = fma32(this.gru.step(x[i]), w, f(x[i] * f(1 - w)))
        break
      }
      case 1: {
        const w = this.airWet
        for (let i = 0; i < n; i++) out[i] = fma32(this.air.step(x[i]), w, f(x[i] * f(1 - w)))
        break
      }
      case 2:
        for (let i = 0; i < n; i++) out[i] = x[i]
        break
      default:
        break // native leaves the output buffer untouched
    }
  }
}
