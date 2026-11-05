import { describe, expect, it } from 'vitest'
import { fma32, fma64, libmMode, powf, setLibm, sinf, tanh64 } from '../f32'
import * as appleLibm from '../applelibm'
import { AirFresh } from '../exciter'
import { Gru } from '../exciter'
import { designBiquad, Equalizer, FilterType } from '../eq'
import { Compressor } from '../compressor'
import { CmsisEmulator, FRAME, VoiceProcessor } from '../pipeline'
import { PRESET_TEMPLATES, iosSetterCalls } from '../presets'

const f = Math.fround
const bits = (x: number) => new Uint32Array(new Float32Array([x]).buffer)[0]

/** |H(e^jw)| of a CMSIS-convention biquad [b0 b1 b2 -a1 -a2]. */
function mag(c: Float32Array, w: number): number {
  const re = (k: number[]) => k[0] + k[1] * Math.cos(-w) + k[2] * Math.cos(-2 * w)
  const im = (k: number[]) => k[1] * Math.sin(-w) + k[2] * Math.sin(-2 * w)
  const num = [c[0], c[1], c[2]]
  const den = [1, -c[3], -c[4]]
  return Math.hypot(re(num), im(num)) / Math.hypot(re(den), im(den))
}
const W = (hz: number) => (2 * Math.PI * hz) / 48000
const dB = (x: number) => 20 * Math.log10(x)

function signal(n: number, seed = 1): Float32Array {
  const x = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    const noise = (s / 4294967296 - 0.5) * 0.2
    x[i] = f(0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000) * (i % 24000 < 12000 ? 1 : 0.01) + noise)
  }
  return x
}

function run(vp: VoiceProcessor, x: Float32Array): Float32Array {
  const y = new Float32Array(x.length)
  const out = new Float32Array(FRAME)
  for (let k = 0; k + FRAME <= x.length; k += FRAME) {
    vp.processFrame(x.subarray(k, k + FRAME), out)
    y.set(out, k)
  }
  return y
}

/**
 * Apple arm64 libsystem_m results (macOS 27.2) where Apple's float libm is
 * NOT correctly rounded: [input bits, Apple result bits]. pow10f is
 * powf(10, x), cubef powf(x, 3). Collected by calling the system libm.
 */
const APPLE_LIBM_VECTORS: Record<string, [number, number][]> = {
  sinf: [[0x401cc08b, 0x3f236a4d], [0x40283d85, 0x3efb36bb], [0x3dd1c6ab, 0x3dd168d0], [0x40288b1b, 0x3ef9192c], [0x3ebe473e, 0x3eb9edad], [0x3effa03c, 0x3ef52334]],
  cosf: [[0x4004f263, 0xbef86159], [0x3ff275e1, 0xbea2b8e4], [0x400532a4, 0xbefa225a], [0x3fe5b0d7, 0xbe632044], [0x3f89126b, 0x3ef56e43], [0x400ba96f, 0xbf12f3af]],
  expf: [[0xbf5a4d50, 0x3eda3cb8], [0xbfbc5f38, 0x3e6b0dde], [0xbeb94128, 0x3f32478a], [0xbfc144f0, 0x3e623b13], [0xbece363c, 0x3f2b211f], [0xbe7262c8, 0x3f4a0a98]],
  logf: [[0x422b1b41, 0x4070622a], [0x409fa0e5, 0x3fcdb5e3], [0x426bb658, 0x40827131], [0x42449d05, 0x407946c6]],
  log10f: [[0x3f7fa166, 0xba24755e], [0x3f7fb891, 0xb9f85232], [0x3f40dcf2, 0xbdfbe2a6]],
  pow10f: [[0x3f7fcdf0, 0x411fb804], [0x3f4c8658, 0x40c9683b], [0xbff0bc60, 0x3c579c74], [0xc02d132a, 0x3b01798d], [0xc01424b0, 0x3b9ebfb7], [0xc008d96f, 0x3bee547f]],
  cubef: [[0xbc730c80, 0xb65b1437], [0xbded11f0, 0xbacb4e57], [0xbf9b2ba3, 0xbfe409b8], [0x3fa80b48, 0x4010d128], [0x3f9327d4, 0x3fc27eee], [0xbe8fe5b0, 0xbcb5dc2a]],
}
const fromBits = (u: number) => new Float32Array(new Uint32Array([u]).buffer)[0]

describe('Apple float libm emulation', () => {
  const fns: Record<string, (x: number) => number> = {
    sinf: appleLibm.sinf,
    cosf: appleLibm.cosf,
    expf: appleLibm.expf,
    logf: appleLibm.logf,
    log10f: appleLibm.log10f,
    pow10f: (x) => appleLibm.powf(10, x),
    cubef: (x) => appleLibm.powf(x, 3),
  }
  for (const [name, vec] of Object.entries(APPLE_LIBM_VECTORS)) {
    it(`${name} reproduces Apple's results where they are not correctly rounded`, () => {
      for (const [xb, yb] of vec) {
        const x = fromBits(xb)
        expect(bits(fns[name](x)).toString(16)).toBe(yb.toString(16))
      }
    })
  }

  it('follows the IEEE special cases of powf, logf and expf', () => {
    const P = appleLibm.powf
    expect(P(-8, 1 / 3)).toBeNaN()
    expect(P(-2, 3)).toBe(-8)
    expect(P(-2, 2)).toBe(4)
    expect(Object.is(P(-0, 3), -0)).toBe(true)
    expect(P(0, -1)).toBe(Infinity)
    expect(P(-0, -3)).toBe(-Infinity)
    expect(P(2, Infinity)).toBe(Infinity)
    expect(P(0.5, Infinity)).toBe(0)
    expect(P(-1, Infinity)).toBe(1)
    expect(P(NaN, 0)).toBe(1)
    expect(P(1, NaN)).toBe(1)
    expect(P(2, 128)).toBe(Infinity)
    expect(P(2, -150)).toBe(0)
    expect(P(1e-45, 0.5)).toBe(f(Math.sqrt(1.401298464324817e-45)))
    expect(appleLibm.logf(0)).toBe(-Infinity)
    expect(appleLibm.logf(-1)).toBeNaN()
    expect(appleLibm.log10f(Infinity)).toBe(Infinity)
    expect(appleLibm.expf(-Infinity)).toBe(0)
    expect(appleLibm.expf(200)).toBe(Infinity)
    expect(appleLibm.sinf(Infinity)).toBeNaN()
    expect(Object.is(appleLibm.sinf(-0), -0)).toBe(true)
    expect(appleLibm.cosf(0)).toBe(1)
  })

  it('setLibm switches the DSP between Apple emulation (default) and correctly rounded', () => {
    expect(libmMode()).toBe('apple')
    const x = fromBits(0x3f9327d4)
    expect(bits(powf(x, 3))).toBe(0x3fc27eee)
    setLibm('cr')
    try {
      expect(bits(powf(x, 3))).toBe(bits(f(Math.pow(x, 3))))
      expect(bits(sinf(fromBits(0x401cc08b)))).toBe(bits(f(Math.sin(fromBits(0x401cc08b)))))
    } finally {
      setLibm('apple')
    }
    expect(bits(powf(x, 3))).toBe(0x3fc27eee)
  })

  it('airfresh at wet 1 follows Apple powf(y, 3) in its feedback path', () => {
    // A 1-ulp powf difference in the clipper feeds back through the shelf;
    // the outputs must match the Apple-libm run and differ from a CR-libm run.
    const run = () => {
      const a = new AirFresh()
      const out = new Float32Array(4800)
      let seed = 1
      for (let i = 0; i < out.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        out[i] = a.step(f((seed / 4294967296 - 0.5) * 0.4))
      }
      return out
    }
    const apple = run()
    setLibm('cr')
    let cr: Float32Array
    try {
      cr = run()
    } finally {
      setLibm('apple')
    }
    expect(apple.some((v, i) => bits(v) !== bits(cr[i]))).toBe(true)
    expect(run().every((v, i) => bits(v) === bits(apple[i]))).toBe(true)
  })
})

describe('f32 helpers', () => {
  it('fma32 rounds once (midpoint cases)', () => {
    // 1 + 2^-24 is a float32 midpoint; the tiny addend decides the direction
    const a = f(1 + 2 ** -12)
    const b = f(1 + 2 ** -12) // a*b = 1 + 2^-11 + 2^-24 exactly
    expect(fma32(a, b, 0)).toBe(f(1 + 2 ** -11)) // tie -> even
    expect(fma32(a, b, f(2 ** -60))).toBe(f(1 + 2 ** -11 + 2 ** -23))
    expect(fma32(a, b, f(-(2 ** -60)))).toBe(f(1 + 2 ** -11))
  })
  it('fma64 matches an exact BigInt-free identity', () => {
    // (1 + 2^-30)^2 - 1 = 2^-29 + 2^-60, exact only with a fused op
    const a = 1 + 2 ** -30
    expect(fma64(a, a, -1)).toBe(2 ** -29 + 2 ** -60)
    expect(fma64(0.1, 10, -1)).toBe(5.551115123125783e-17)
  })
})

describe('EQ coefficient design', () => {
  it('matches the native library for the Clean Voice HP/peak stages (bit-exact fixture)', () => {
    const vp = new VoiceProcessor()
    vp.configure(PRESET_TEMPLATES[0])
    const { numStages, coeffs } = vp.native.getEqCoefficients()
    expect(numStages).toBe(10)
    const want = [0x3f7df06f, 0xbffdf06f, 0x3f7df06f, 0xbffdec39, 0x3f7be94d, 0x3f7e541e, 0xbffc217f, 0x3f7a24e9, 0xbffc217f, 0x3f787909]
    expect(Array.from(coeffs.subarray(15, 25), bits)).toEqual(want)
  })

  const band = (filterType: number, gain: number, f0: number, q: number) => ({ enable: true, filterType, gain, f0, q })
  it('shelves and peaks hit their nominal gains', () => {
    expect(dB(mag(designBiquad(band(FilterType.LowShelf, 6, 200, 0.7)), W(5)))).toBeCloseTo(6, 1)
    expect(dB(mag(designBiquad(band(FilterType.HighShelf, -6, 5000, 0.7)), W(23000)))).toBeCloseTo(-6, 1)
    expect(dB(mag(designBiquad(band(FilterType.Peaking, 9, 2600, 2)), W(2600)))).toBeCloseTo(9, 2)
    expect(dB(mag(designBiquad(band(FilterType.Peaking, 0, 2600, 2)), W(1000)))).toBeCloseTo(0, 5)
  })
  it('pass/stop types behave', () => {
    expect(mag(designBiquad(band(FilterType.LowPass, 4, 1000, 0.707)), 0)).toBeCloseTo(1, 5)
    expect(mag(designBiquad(band(FilterType.HighPass, 4, 1000, 0.707)), Math.PI)).toBeCloseTo(1, 5)
    expect(mag(designBiquad(band(FilterType.Notch, 0, 1000, 2)), W(1000))).toBeLessThan(1e-3)
    expect(mag(designBiquad(band(FilterType.BandPass, 0, 1000, 2)), W(1000))).toBeCloseTo(1, 4)
  })
  it('unknown types are identity (with -0 feedback terms, as fneg(0)/a0 gives natively)', () => {
    expect(Array.from(designBiquad(band(10, 3, 1000, 1)))).toEqual([1, 0, 0, -0, -0])
  })
  it('every preset band is stable (poles inside the unit circle)', () => {
    for (const t of PRESET_TEMPLATES) {
      for (const [, enable, type, gain, f0, q] of iosSetterCalls(t).eqBands) {
        if (!enable) continue
        const c = designBiquad({ enable, filterType: type, gain, f0, q })
        // denominator 1 - c3 z^-1 - c4 z^-2 ; stable iff |a2| < 1 and |a1| < 1 + a2
        const a1 = -c[3], a2 = -c[4]
        expect(Math.abs(a2)).toBeLessThan(1)
        expect(Math.abs(a1)).toBeLessThan(1 + a2)
      }
    }
  })
  it('updating bands keeps the cascade state (native IIR_coef_update)', () => {
    const eq = new Equalizer()
    eq.setBand(0, { enable: true, filterType: 3, gain: 6, f0: 1000, q: 1 })
    const x = signal(FRAME)
    eq.process(x)
    const before = eq.state.slice(0, 2)
    eq.setBand(0, { enable: true, filterType: 3, gain: 3, f0: 1000, q: 1 })
    expect(eq.state.slice(0, 2)).toEqual(before)
    expect(eq.numStages).toBe(1)
  })
})

describe('exciter', () => {
  it('tanh64 is correctly rounded for small arguments (where V8 Math.tanh is one ulp off)', () => {
    // value from macOS libm tanh(), which is correctly rounded here: c - c^3/3 rounds to c - 3 ulp
    expect(tanh64(3.7210206471627316e-8)).toBe(3.7210206471627296e-8)
    expect(tanh64(-3.7210206471627316e-8)).toBe(-3.7210206471627296e-8)
    expect(tanh64(0)).toBe(0)
    expect(tanh64(0.5)).toBe(Math.tanh(0.5))
  })
  it('GRU decaying tail matches the native library (float midpoint decided by tanh)', () => {
    // dist:gru-1 on speech, sample 1336: input 0, previous state from the native run
    const g = new Gru()
    g.init()
    g.h = f(1.4884084009736398e-7)
    expect(g.step(0)).toBe(f(9.302551262635461e-8))
  })
  it('distInit runs once per instance, not again after cmsis_init (static flag)', () => {
    const e = new CmsisEmulator()
    e.defaultConfigs()
    for (let i = 0; i < 10; i++) e.setEqBand(i, false, 3, 0, 1000, 1)
    e.setCompressor(false, -12, 4, 3, 10, 0, 0.5, 0, -45)
    e.setEsser(false, 6500, 4500, -45, -15)
    e.setDistortion(true, 0, 0, 1, 0.5, 0)
    e.processFrame(signal(FRAME), new Float32Array(FRAME))
    const d1 = e.dist.air.d1
    expect(d1).not.toBe(0)
    e.init()
    e.setDistortion(true, 0, 0, 1, 0.5, 0)
    expect(e.dist.air.d1).toBe(d1)
  })
})

describe('compressor', () => {
  const params = { enable: true, thresholdDb: -12, ratio: 4, attackMs: 3, releaseMs: 10, gainDb: 0, knee: 0.5, holdMs: 0, rangeDb: -45 }
  it('is unity below the knee and compresses above it', () => {
    const c = new Compressor()
    c.update(params)
    expect(c.gainCompute(0.01)).toBe(1)
    const g = c.gainCompute(1)
    expect(g).toBeLessThan(0.5)
    expect(g).toBeGreaterThan(0.25)
  })
  it('only applies parameter changes larger than the native step', () => {
    const c = new Compressor()
    c.update(params)
    const thr = c.thr
    c.update({ ...params, thresholdDb: -12.001 })
    expect(c.thr).toBe(thr)
  })
})

describe('VoiceProcessor', () => {
  it('has the eight templates with English names', () => {
    expect(PRESET_TEMPLATES.map((p) => p.name)).toEqual([
      'Clean Voice', 'Vocal Boost', 'Warm & Solid', 'Warm & Resonant', 'Bright Youthful', 'Mellow & Full-bodied', 'Bright & Energetic', 'Rich & Full',
    ])
  })
  it('is deterministic across reset() and across instances', () => {
    const x = signal(FRAME * 200)
    for (const t of PRESET_TEMPLATES) {
      const a = new VoiceProcessor()
      a.configure(t)
      const y1 = run(a, x)
      a.reset()
      const y2 = run(a, x)
      const b = new VoiceProcessor()
      b.configure(t)
      const y3 = run(b, x)
      expect(y2).toEqual(y1)
      expect(y3).toEqual(y1)
      expect(y1.every(Number.isFinite)).toBe(true)
    }
  })
  it('does not modify the caller input buffer', () => {
    const x = signal(FRAME)
    const copy = x.slice()
    const vp = new VoiceProcessor()
    vp.configure(PRESET_TEMPLATES[1])
    vp.processFrame(x, new Float32Array(FRAME))
    expect(x).toEqual(copy)
  })
  it('silence stays silent', () => {
    const vp = new VoiceProcessor()
    vp.configure(PRESET_TEMPLATES[3])
    const y = run(vp, new Float32Array(FRAME * 20))
    expect(y.every((v) => v === 0)).toBe(true)
  })
  it('channelEnable=false outputs zeros', () => {
    const e = new CmsisEmulator()
    e.defaultConfigs()
    e.setPipeParams(0, false)
    const out = new Float32Array(FRAME).fill(1)
    e.processFrame(signal(FRAME), out)
    expect(out.every((v) => v === 0)).toBe(true)
  })
  it("iOS de-esser range quirk: 'ios' is near-identity, 'preset' attenuates sibilance", () => {
    // 6 kHz burst through the de-esser alone
    const x = new Float32Array(FRAME * 100)
    for (let i = 0; i < x.length; i++) x[i] = f(0.3 * Math.sin((2 * Math.PI * 5400 * i) / 48000))
    const make = () => {
      const e = new CmsisEmulator()
      e.defaultConfigs()
      for (let i = 0; i < 10; i++) e.setEqBand(i, false, 3, 0, 1000, 1)
      e.setCompressor(false, -12, 4, 3, 10, 0, 0.5, 0, -45)
      e.setDistortion(false, 0, 0, 1, 0, 0)
      return e
    }
    const energy = (e: CmsisEmulator) => {
      let s = 0
      const out = new Float32Array(FRAME)
      for (let k = 0; k < x.length; k += FRAME) {
        e.processFrame(x.subarray(k, k + FRAME), out)
        if (k > x.length / 2) for (const v of out) s += v * v
      }
      return s
    }
    const ios = make()
    ios.setEsser(true, 6500, 4500, -45, -15)
    const android = make()
    android.storeEsserRange = true
    android.setEsser(true, 6500, 4500, -45, -15)
    const ref = make()
    ref.setEsser(false, 6500, 4500, -45, -15)
    const eRef = energy(ref)
    expect(Math.abs(dB(energy(ios) / eRef))).toBeLessThan(0.01)
    expect(dB(energy(android) / eRef)).toBeLessThan(-3)
  })
})
