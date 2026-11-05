/** Style-guide signal simulator: speech-like bursts in dBFS, deterministic per seed. */
export function simSignal(seed: number, level = -22, opts: { clipEvery?: number } = {}) {
  let s = seed >>> 0 || 1
  const rng = () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return (s % 10000) / 10000
  }
  let target = -55
  let cur = -55
  let until = 0
  let nextClip = performance.now() + (opts.clipEvery ?? Infinity)
  return () => {
    const t = performance.now()
    if (t > until) {
      until = t + 120 + rng() * 420
      target = rng() < 0.24 ? -56 + rng() * 4 : level - 7 + rng() * 14
    }
    cur += (target - cur) * 0.25
    const rmsDb = Math.min(-1, cur + (rng() - 0.5) * 2.5)
    let peakDb = Math.min(-0.8, rmsDb + 5 + rng() * 4)
    if (t > nextClip) {
      peakDb = 0
      nextClip = t + (opts.clipEvery ?? Infinity)
    }
    return { rmsDb, peakDb }
  }
}
