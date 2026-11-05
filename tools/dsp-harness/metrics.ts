/** Difference metrics between the native reference and the TS port. */

export interface Metrics {
  n: number
  maxAbsErr: number
  /** Sample index of the largest error (-1 if identical). */
  maxAt: number
  /** RMS of the difference in dBFS (-Infinity when identical). */
  rmsErrDbfs: number
  /** 10 log10(sum ref^2 / sum err^2); Infinity when identical, NaN when the reference is silent but the port is not. */
  snrDb: number
  /** Percentage of samples whose float32 bit patterns are identical. */
  bitExactPct: number
  /** Samples equal as values but with different bits (only +0 / -0). */
  signedZeroDiffs: number
  refRmsDbfs: number
  firstDiff: number
  nonFinite: number
  /** Sample offset of TS against native that minimises the error (0 = aligned). */
  bestLag: number
  /** Error energy at bestLag relative to lag 0 (1 when lag 0 is best). */
  lagGain: number
}

const u32 = (x: Float32Array) => new Uint32Array(x.buffer, x.byteOffset, x.length)

function sse(ref: Float32Array, got: Float32Array, lag: number, from = 0, to = ref.length): number {
  let s = 0
  const lo = Math.max(from, -lag, 0), hi = Math.min(to, ref.length, got.length - lag)
  for (let i = lo; i < hi; i++) {
    const e = got[i + lag] - ref[i]
    s += e * e
  }
  return hi > lo ? s / (hi - lo) : Infinity
}

export function compare(ref: Float32Array, got: Float32Array): Metrics {
  const n = Math.min(ref.length, got.length)
  const ru = u32(ref), gu = u32(got)
  let maxAbsErr = 0, maxAt = -1, se = 0, ss = 0, same = 0, sz = 0, firstDiff = -1, nonFinite = 0
  for (let i = 0; i < n; i++) {
    const r = ref[i], g = got[i]
    if (!Number.isFinite(g) || !Number.isFinite(r)) nonFinite++
    if (ru[i] === gu[i]) {
      same++
      ss += r * r
      continue
    }
    if (firstDiff < 0) firstDiff = i
    if (r === g) sz++
    const e = Number.isFinite(g - r) ? Math.abs(g - r) : Infinity
    if (e > maxAbsErr || Number.isNaN(g - r)) {
      maxAbsErr = Number.isNaN(g - r) ? Infinity : e
      maxAt = i
    }
    se += e * e
    ss += r * r
  }
  if (ref.length !== got.length) maxAbsErr = Infinity
  const rms = Math.sqrt(se / Math.max(1, n))
  const snrDb = se === 0 ? Infinity : ss === 0 ? NaN : 10 * Math.log10(ss / se)

  // Alignment check: whole-frame and one-sample offsets on everything; a
  // wider search around the worst error when the lag-0 result is poor.
  let bestLag = 0, lagGain = 1
  if (se > 0 && Number.isFinite(se)) {
    const e0 = sse(ref, got, 0)
    const lags = new Set([-240, -1, 1, 240])
    let from = 0, to = n
    if (snrDb < 80) {
      from = Math.max(0, maxAt - 12000)
      to = Math.min(n, maxAt + 12000)
      for (let l = -480; l <= 480; l++) lags.add(l)
    }
    const base = from === 0 && to === n ? e0 : sse(ref, got, 0, from, to)
    for (const l of lags) {
      if (l === 0) continue
      const e = sse(ref, got, l, from, to)
      if (e < base * lagGain) {
        lagGain = e / base
        bestLag = l
      }
    }
  }
  let refE = 0
  for (let i = 0; i < n; i++) refE += ref[i] * ref[i]
  return {
    n,
    maxAbsErr,
    maxAt,
    rmsErrDbfs: se === 0 ? -Infinity : 20 * Math.log10(rms),
    snrDb,
    bitExactPct: (100 * same) / Math.max(1, n),
    signedZeroDiffs: sz,
    refRmsDbfs: refE === 0 ? -Infinity : 10 * Math.log10(refE / Math.max(1, n)),
    firstDiff,
    nonFinite,
    bestLag,
    lagGain,
  }
}

/** Distance in units in the last place between two float32 values (sign-magnitude aware). */
export function ulpDistance(a: number, b: number): number {
  const f = new Float32Array([a, b])
  const i = new Int32Array(f.buffer)
  const key = (v: number) => (v < 0 ? -(v & 0x7fffffff) : v)
  return Math.abs(key(i[0]) - key(i[1]))
}

export const bitsOf = (x: number): number => new Uint32Array(new Float32Array([x]).buffer)[0]
