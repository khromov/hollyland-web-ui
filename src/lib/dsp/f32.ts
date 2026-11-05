/**
 * Float32 arithmetic helpers that mirror the arm64 code in cmsis_api_ios.
 *
 * The native library is built at -O0 with FP contraction on, so many
 * `a * b + c` expressions compile to fused FMADD/FMSUB. To be bit-faithful
 * we need a correctly rounded single-precision FMA (fma32) and, in a few
 * places, a correctly rounded double-precision FMA (fma64); both live in
 * fma.ts and are re-exported here.
 *
 * Plain float32 + - * / sqrt are exact as `Math.fround(op in double)`.
 *
 * libm: the native code calls the platform libm (powf, sinf, cosf, expf,
 * logf, log10f, and double sin/cos/tan/exp/tanh). By default the float
 * functions here are bit-exact emulations of Apple's arm64 libm
 * (applelibm.ts), which is what the iOS app runs on. `setLibm('cr')` switches
 * them to correctly rounded `fround(Math.fn(double))`, which the parity
 * harness pairs with the native library rebound to correctly rounded libm, to
 * check the DSP arithmetic independently of libm. The double functions are
 * V8's (they matched Apple's on all 4M tested inputs after rounding), except
 * tanh64 below.
 */

import * as apple from './applelibm'

export { fma32, fma64, fmsub32, fnmsub32 } from './fma'

export const f = Math.fround

// ---------------------------------------------------------------------------
// Integer conversions with AArch64 semantics.

/** FCVTZS w, s: truncate toward zero, saturate to int32, NaN -> 0. */
export function fcvtzs(x: number): number {
  if (x !== x) return 0
  if (x >= 2147483647) return 2147483647
  if (x <= -2147483648) return -2147483648
  return Math.trunc(x) | 0
}

// ---------------------------------------------------------------------------
// libm (see header note about last-ulp differences from Apple's libm).

/**
 * Double tanh as the native GRU uses it (its result feeds a double FMA before
 * rounding to float, so double-level accuracy matters). V8's Math.tanh is off
 * by one double ulp on ~30% of inputs; below 2^-11 the odd Taylor series to
 * x^5 is correctly rounded (it matched Apple's tanh on every tested input) and
 * this is where it matters most: decaying GRU tails land on float midpoints
 * that the tanh correction term decides.
 */
export function tanh64(x: number): number {
  const ax = x < 0 ? -x : x
  if (ax < 0.00048828125) {
    const x2 = x * x
    return x + x * x2 * (-1 / 3 + (2 / 15) * x2)
  }
  return Math.tanh(x)
}

export type LibmMode = 'apple' | 'cr'

const crPowf = (x: number, y: number): number => f(Math.pow(x, y))
const crSinf = (x: number): number => f(Math.sin(x))
const crCosf = (x: number): number => f(Math.cos(x))
const crExpf = (x: number): number => f(Math.exp(x))
const crLogf = (x: number): number => f(Math.log(x))
const crLog10f = (x: number): number => f(Math.log10(x))

// Live bindings: importers always call the currently selected implementation.
export let powf: (x: number, y: number) => number = apple.powf
export let sinf: (x: number) => number = apple.sinf
export let cosf: (x: number) => number = apple.cosf
export let expf: (x: number) => number = apple.expf
export let logf: (x: number) => number = apple.logf
export let log10f: (x: number) => number = apple.log10f
let mode: LibmMode = 'apple'

/** Current float libm: 'apple' (default, bit-exact Apple arm64) or 'cr' (correctly rounded). */
export const libmMode = (): LibmMode => mode

/** Selects the float libm for the whole DSP port (process-wide). */
export function setLibm(m: LibmMode): void {
  mode = m
  const a = m === 'apple'
  powf = a ? apple.powf : crPowf
  sinf = a ? apple.sinf : crSinf
  cosf = a ? apple.cosf : crCosf
  expf = a ? apple.expf : crExpf
  logf = a ? apple.logf : crLogf
  log10f = a ? apple.log10f : crLog10f
}
