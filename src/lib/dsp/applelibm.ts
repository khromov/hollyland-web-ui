/**
 * Bit-exact emulation of Apple's arm64 float libm (libsystem_m) for the
 * functions the HollyAudio DSP library calls: powf, expf, logf, log10f, sinf
 * and cosf.
 *
 * Apple's implementations are short table-driven routines that evaluate in
 * double precision with fused multiply-adds and round to float once at the
 * end. They are not correctly rounded: about 0.6-1.3 % of results differ by
 * one ulp from `Math.fround(Math.fn(x))`. Each function below follows the
 * disassembly instruction for instruction (offsets in the comments are from
 * each function's entry in the macOS 27.2 libsystem_m; the iOS library is
 * assumed to be built from the same source, which has not been checked on a
 * device), using exact float64 FMA (`fma64`) where the native code uses
 * FMADD/FMSUB/FNMSUB, so the double intermediate and therefore the float
 * result are identical. docs/dsp/algorithms.md describes each routine.
 *
 * The tables are in applelibm-data.ts. `npm run dsp:compare` checks every
 * function against the live library on 10^6 inputs per DSP call site.
 */
import { fma32, fma64 } from './fma'
import {
  EXP2_POLY,
  EXP2_TAB,
  EXPF_INVLN2N,
  LOG10F_LOG10_2,
  LOG10F_POLY,
  LOG10F_TAB,
  LOGF_POLY,
  LOGF_TAB,
  POWF_LOG2_POLY,
  POWF_LOG2_TAB,
  TRIGF_CONSTS,
  TRIGF_TAB,
} from './applelibm-data'

const fround = Math.fround

const F64 = new Float64Array(1)
const W64 = new Uint32Array(F64.buffer) // little-endian: [lo, hi]
const F32 = new Float32Array(1)
const W32 = new Uint32Array(F32.buffer)

const bitsF = (x: number): number => ((F32[0] = x), W32[0])
const fromBitsF = (u: number): number => ((W32[0] = u), F32[0])

// exp2 table as raw 64-bit words, because the code adds the integer part of
// the exponent straight into the bit pattern.
const EXP2_HI = new Int32Array(128)
const EXP2_LO = new Uint32Array(128)
for (let i = 0; i < 128; i++) {
  F64[0] = EXP2_TAB[i]
  EXP2_LO[i] = W64[0]
  EXP2_HI[i] = W64[1] | 0
}
const [E0, E1] = EXP2_POLY

/** FRINTN / FCVTNS: round to nearest integer, ties to even (|v| < 2^51). */
function rintn(v: number): number {
  const r = Math.round(v) // ties toward +inf
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r
}

/** FRINTA / FCVTAS: round to nearest integer, ties away from zero. */
function rinta(v: number): number {
  const t = Math.trunc(v)
  const fr = v - t // exact
  return fr >= 0.5 ? t + 1 : fr <= -0.5 ? t - 1 : t
}

/**
 * Shared exp2 tail of powf (+0xd0) and expf (+0x40): `s = 2^(k/128)` from the
 * table with `k` added into the exponent field, then
 * `s + s * r * (C1 + C0 * r)`. `k` is the 32-bit word whose low 19 bits land
 * in bits 45..63 (`add x1, x2, x1, lsl #45`).
 */
function exp2Tail(k: number, r: number): number {
  const idx = k & 0x7f
  W64[0] = EXP2_LO[idx]
  W64[1] = (EXP2_HI[idx] + (k << 13)) | 0
  const s = F64[0]
  const p = fma64(E0, r, E1) * r
  return fma64(p, s, s)
}

// ---------------------------------------------------------------------------
// powf

const [P0, P1, P2, P3] = POWF_LOG2_POLY

/** `(x | 1.0f) - 1.0f`, re-biased by -126: the integer image of a subnormal (+0x1b4). */
function subnormalImage(bits: number): number {
  const v = fromBitsF((bits | 0x3f800000) >>> 0) - 1 // exact in float
  return (bitsF(v) - 0x3f000000) >>> 0
}

/** Is |y| (as bits) an odd integer? Native clamps to 2^24 and uses FRINTZ + FCVTZS. */
function oddInteger(ay: number): number {
  if (ay < 0x3f800000) return -1 // |y| < 1: not an integer (or 0)
  const yy = fromBitsF(ay <= 0x4b800000 ? ay : 0x4b800000)
  if (Math.trunc(yy) !== yy) return -1
  return yy & 1
}

/** powf(x, y). */
export function powf(xIn: number, yIn: number): number {
  const x = fround(xIn), y = fround(yIn)
  if (x === 1) return x
  if (y === 1) return x
  const ix = bitsF(x), iy = bitsF(y)
  let sign = 0
  let img = ix

  const wy = ((iy & 0x7fffffff) - 1) | 0
  if (wy >>> 0 >= 0x7f7fffff) {
    // y is +-0, +-inf or NaN (+0x10c)
    if (wy > 0x7f7fffff) return y // NaN
    if (wy !== 0x7f7fffff) return 1 // y = +-0
    const ax = ix & 0x7fffffff
    if (ax === 0) return iy >>> 31 ? Infinity : 0
    if (ax > 0x7f800000) return x // NaN
    if (ax === 0x3f800000) return 1
    // |x| < 1 xor y < 0 -> 0, else inf
    return ((ax - 0x3f800000) ^ iy) >> 31 ? 0 : Infinity
  }

  if ((ix - 0x00800000) >>> 0 >= 0x7f000000) {
    // x is not a positive normal finite (+0x150)
    const ax = ix & 0x7fffffff
    const wx = (ax - 1) | 0
    if (wx >>> 0 >= 0x7f7fffff) {
      // x is +-0, +-inf or NaN (+0x1d0)
      if (wx > 0x7f7fffff) return x // NaN
      const s0 = oddInteger(iy & 0x7fffffff) === 1 ? x : Math.abs(x)
      return iy >>> 31 ? fround(1 / s0) : s0
    }
    if (ix >>> 31) {
      // negative finite: y must be an integer; odd y keeps the sign
      const odd = oddInteger(iy & 0x7fffffff)
      if (odd < 0) return NaN
      sign = odd
      img = ax >= 0x800000 ? ax : subnormalImage(ax)
    } else img = subnormalImage(ix)
  }

  // log2(x) * 128 (+0x50)
  const tmp = (img - 0x3f338000) | 0
  const i = (tmp >>> 16) & 0x7f
  const top = tmp & 0xff800000
  const z = fromBitsF((img - top) >>> 0)
  const k = top >> 16
  const r = fma64(z, POWF_LOG2_TAB[2 * i], -1)
  const lc = POWF_LOG2_TAB[2 * i + 1] + k
  const r2 = r * r
  const p = fma64(fma64(r, P0, P1), r2, fma64(r, P2, P3))
  const l = fma64(p, r, lc)

  // exp2(y * l / 128) (+0xb0)
  let t = y * l
  if (t > 32768) t = 32768
  else if (t < -32768) t = -32768
  const ki = rinta(t)
  const res = fround(exp2Tail(ki, t - ki))
  return sign ? -res : res
}

// ---------------------------------------------------------------------------
// expf

const EXPF_SHIFT = 6755399441055744 // 0x1.8p52

/** expf(x). */
export function expf(xIn: number): number {
  const x = fround(xIn)
  const ix = bitsF(x)
  if (((ix >>> 23) & 0xff) >= 0x86) {
    // |x| >= 128, inf or NaN (+0x6c)
    if (!(x < 0)) return fround(x * 3.4028234663852886e38) // inf, or NaN
    return 0
  }
  const kd0 = fma64(EXPF_INVLN2N, x, EXPF_SHIFT)
  F64[0] = kd0
  const k = W64[0] | 0
  const kd = kd0 - EXPF_SHIFT
  const r = fma64(EXPF_INVLN2N, x, -kd)
  return fround(exp2Tail(k, r))
}

// ---------------------------------------------------------------------------
// logf and log10f share the special-case structure (+0x84 in both).

const [L0, L1, L2, LN2] = LOGF_POLY
const [G0, G1, G2, G3] = LOG10F_POLY

/** Returns the integer image to run through the main path, or the final result as `special`. */
let special = 0
function logImage(x: number, ix: number): number {
  if (((ix - 0x800000) >>> 0) < 0x7f000000) return ix
  // fcmp s0, #0
  if (x !== x) return ((special = x), -1)
  if (x === 0) return ((special = -Infinity), -1)
  if (x < 0) return ((special = NaN), -1)
  if (((ix - 0x800000) | 0) >= 0) return ((special = x), -1) // +inf
  // positive subnormal: (x | 1.0f) - 1.0f, re-biased by -126
  const v = fromBitsF((ix | 0x3f800000) >>> 0) - 1
  return (bitsF(v) - 0x3f000000) >>> 0
}

/** logf(x). */
export function logf(xIn: number): number {
  const x = fround(xIn)
  const ix = logImage(x, bitsF(x))
  if (ix === -1) return special
  const m = ix & 0x7fffff
  const i = (m + 0x8000) >>> 16
  const z = 1 + m * 1.1920928955078125e-7 // (ix | 0x1ff800000) << 29
  const r = fma64(z, LOGF_TAB[2 * i], -1)
  const k = ((ix - 0x3f3f8000) | 0) >> 23
  const r2 = r * r
  let y = fma64(k, LN2, LOGF_TAB[2 * i + 1])
  const q = fma64(r, L0, L1)
  y = fma64(r, L2, y)
  return fround(fma64(r2, q, y))
}

/** log10f(x). */
export function log10f(xIn: number): number {
  const x = fround(xIn)
  const ix = logImage(x, bitsF(x))
  if (ix === -1) return special
  const k = ((ix + 0xc0c10000) | 0) >> 23
  const m = ix & 0x7fffff
  const i = (m + 0x10000) >>> 17
  const z = 1 + m * 1.1920928955078125e-7 // (float)(m | 0x3f800000)
  const r = fma64(z, LOG10F_TAB[2 * i], -1)
  const q = fma64(r, fma64(r, fma64(r, G0, G1), G2), G3)
  const y = fma64(k, LOG10F_LOG10_2, LOG10F_TAB[2 * i + 1])
  return fround(fma64(r, q, y))
}

// ---------------------------------------------------------------------------
// sinf and cosf

const [TWO_OVER_PI, PIO2, PIO2_LO, C0, C1, C2, C3, S0, S1, S2, T0, T1, T2, T3, T4] = TRIGF_CONSTS

/** Even polynomial: cos(r) on |r| <= pi/4. */
function cosPoly(r: number): number {
  const z = r * r
  const a = fma64(z, C0, C1)
  const b = fma64(z, C2, C3)
  return fma64(z, fma64(z * z, a, b), 1)
}

/** Odd polynomial: sin(r) on |r| <= pi/4. */
function sinPoly(r: number): number {
  const z = r * r
  const r3 = r * z
  const a = fma64(z, S0, S1)
  return fma64(z * r3, a, fma64(r3, S2, r))
}

/** Quadrant dispatch (sinf+0x48, shared by cosf): n odd -> cos, bit 1 of n -> sign. */
function quadrant(n: number, r: number): number {
  const v = n & 1 ? cosPoly(r) : sinPoly(r)
  return fround(n & 2 ? -v : v)
}

/** |x| >= 120 (cosf: >= 2^26): t = x/pi - n (+0.5 for cosf) via the 2^k/pi table, then sin(pi t) (sinf+0xd8). */
function largeArg(x: number, ax: number, half: boolean): number {
  const idx = (ax >>> 24) - 0x40
  let a = x * TRIGF_TAB[2 * idx]
  if (half) a += 0.5
  const b = x * TRIGF_TAB[2 * idx + 1]
  const n = rintn(a)
  const t = a - n + b
  const z = t * t
  const u = n % 2 !== 0 ? -t : t
  return fround(u * fma64(z, z + T0, T2) * (T4 * fma64(z, z + T1, T3)))
}

/** sinf(x). */
export function sinf(xIn: number): number {
  const x = fround(xIn)
  const ax = bitsF(x) & 0x7fffffff
  if (ax >= 0x42f00000) {
    if (ax >= 0x7f800000) return NaN
    return largeArg(x, ax, false)
  }
  if (ax < 0x3f490fdb) {
    if (ax < 0x39800000) return fround(fma32(x, 67108864, x) * 1.4901161193847656e-8)
    return fround(sinPoly(x))
  }
  const n = rintn(x * TWO_OVER_PI)
  return quadrant(n, fma64(-n, PIO2, x))
}

/** cosf(x). */
export function cosf(xIn: number): number {
  const x = Math.abs(fround(xIn))
  const ax = bitsF(x)
  if (ax >= 0x42f00000) {
    if (ax >= 0x4c800000) {
      if (ax >= 0x7f800000) return NaN
      return largeArg(x, ax, true)
    }
    const n = rintn(x * TWO_OVER_PI)
    return quadrant(n + 1, fma64(-n, PIO2_LO, fma64(-n, PIO2, x)))
  }
  if (ax < 0x3f490fdb) {
    if (ax < 0x39800000) return fround(fround(67108864 - x) * 1.4901161193847656e-8)
    return fround(cosPoly(x))
  }
  const n = rintn(x * TWO_OVER_PI)
  return quadrant(n + 1, fma64(-n, PIO2, x))
}
