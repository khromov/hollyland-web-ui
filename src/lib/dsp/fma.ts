/**
 * Correctly rounded fused multiply-add in float32 (fma32) and float64 (fma64),
 * the AArch64 FMADD/FMSUB/FNMSUB the native code is full of. Plain float32
 * + - * / sqrt are exact as `Math.fround(op in double)`; FMA is not.
 */

const f = Math.fround

const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer) // little-endian: U32[0] = low word
const F32 = new Float32Array(1)
const I32 = new Int32Array(F32.buffer)

const MIN_NORMAL_F32 = 1.1754943508222875e-38 // 2^-126

/** Next float32 after `r` in the direction of `toward`. */
function nextF32(r: number, toward: number): number {
  if (r === toward) return r
  if (r === 0) return toward > 0 ? 1.401298464324817e-45 : -1.401298464324817e-45
  F32[0] = r
  if (toward > r === r > 0) I32[0] += 1
  else I32[0] -= 1
  return F32[0]
}

/**
 * Correctly rounded float32 fused multiply-add: round32(a*b + c).
 * a, b, c must already be float32 values.
 */
export function fma32(a: number, b: number, c: number): number {
  const p = a * b // exact: 24x24 bits fits in 53
  const s = p + c
  if (s !== s || s === Infinity || s === -Infinity) return f(s)
  const as = s < 0 ? -s : s
  if (as >= MIN_NORMAL_F32) {
    F64[0] = s
    // s is a float32 midpoint iff its low 29 mantissa bits are 1 then 28 zeros.
    if ((U32[0] & 0x1fffffff) !== 0x10000000) return f(s)
  }
  const r = f(s)
  if (r === s) return r
  const r2 = nextF32(r, s)
  if (s !== (r + r2) / 2) return r
  const bb = s - p
  const e = p - (s - bb) + (c - bb) // exact error of p + c
  if (e === 0) return r // true tie, fround already did ties-to-even
  return e > 0 ? Math.max(r, r2) : Math.min(r, r2)
}

/** AArch64 FMSUB: round32(c - a*b). */
export const fmsub32 = (a: number, b: number, c: number): number => fma32(-a, b, c)
/** AArch64 FNMSUB: round32(a*b - c). */
export const fnmsub32 = (a: number, b: number, c: number): number => fma32(a, b, -c)

// ---------------------------------------------------------------------------
// Exact double FMA: error-free transforms with a BigInt fallback for the rare
// near-halfway cases.

const SPLIT = 134217729 // 2^27 + 1

function decompose(x: number): [bigint, number] {
  F64[0] = x
  const hi = U32[1]
  const lo = U32[0]
  const exp = (hi >>> 20) & 0x7ff
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let e: number
  if (exp === 0) e = -1074
  else {
    m |= 1n << 52n
    e = exp - 1075
  }
  return [hi >>> 31 ? -m : m, e]
}

/** Round m * 2^e to the nearest double (ties to even), handling subnormals. */
function bigToDouble(m: bigint, e: number): number {
  if (m === 0n) return 0
  const neg = m < 0n
  let a = neg ? -m : m
  const len = a.toString(2).length
  // target exponent of the least significant kept bit
  let shift = len - 53
  if (e + shift < -1074) shift = -1074 - e
  if (shift > 0) {
    const sb = BigInt(shift)
    const q = a >> sb
    const rem = a - (q << sb)
    const half = 1n << (sb - 1n)
    a = rem > half || (rem === half && (q & 1n) === 1n) ? q + 1n : q
    e += shift
  }
  const v = Number(a) * Math.pow(2, e) // a has <= 54 bits; scaling is exact or overflows
  return neg ? -v : v
}

function fma64Exact(a: number, b: number, c: number): number {
  const [ma, ea] = decompose(a)
  const [mb, eb] = decompose(b)
  const [mc, ec] = decompose(c)
  let mp = ma * mb
  let ep = ea + eb
  let mcc = mc
  let e = Math.min(ep, ec)
  mp <<= BigInt(ep - e)
  mcc <<= BigInt(ec - e)
  const sum = mp + mcc
  if (sum === 0n) return a * b + c // sign of zero follows IEEE rules
  return bigToDouble(sum, e)
}

/** Correctly rounded double fused multiply-add round64(a*b + c). */
export function fma64(a: number, b: number, c: number): number {
  const p = a * b
  if (!Number.isFinite(p) || !Number.isFinite(c)) return p + c
  const ap = Math.abs(a), bp = Math.abs(b)
  if (ap > 1e290 || bp > 1e290 || (p !== 0 && Math.abs(p) < 1e-290) || a === 0 || b === 0) {
    return a === 0 || b === 0 ? p + c : fma64Exact(a, b, c)
  }
  let t = SPLIT * a
  const ah = t - (t - a)
  const al = a - ah
  t = SPLIT * b
  const bh = t - (t - b)
  const bl = b - bh
  const pl = ah * bh - p + ah * bl + al * bh + al * bl
  // p + pl == a*b exactly
  const s = p + c
  let bb = s - p
  const e = p - (s - bb) + (c - bb)
  const u = e + pl
  bb = u - e
  const v = e - (u - bb) + (pl - bb)
  const r = s + u
  bb = r - s
  const w = s - (r - bb) + (u - bb)
  // exact value = r + w + v
  if (r === 0 || !Number.isFinite(r)) return fma64Exact(a, b, c)
  F64[0] = Math.abs(r)
  const hiExp = U32[1] >>> 20
  if (hiExp <= 1) return fma64Exact(a, b, c)
  let half = Math.pow(2, hiExp - 1076) // ulp(r)/2
  // below a power of two the gap is half as large
  if (U32[0] === 0 && (U32[1] & 0xfffff) === 0 && (w + v < 0) === r > 0) half /= 2
  if (Math.abs(w) + Math.abs(v) < half * (1 - 2 ** -20)) return r
  return fma64Exact(a, b, c)
}
