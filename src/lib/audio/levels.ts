/**
 * Level-meter maths.
 *
 * The official app computes VU levels app-side from the receiver's USB audio
 * stream (Android `C6118AudioLevelMonitor` + `C6118VuLevelMapper`). We mirror
 * the same floor and display mapping so meters read the same as the phone app,
 * but we also expose true per-channel RMS/peak for the pro-style meter.
 */

export const DB_FLOOR = -60

/** Linear amplitude (0..1) to dBFS, clamped to the floor. */
export function ampToDb(amp: number, floor = DB_FLOOR): number {
  if (!(amp > 0)) return floor
  const db = 20 * Math.log10(amp)
  return db < floor ? floor : db
}

/** dBFS to linear amplitude. */
export function dbToAmp(db: number): number {
  return Math.pow(10, db / 20)
}

/** RMS and absolute peak of a block of float samples. */
export function blockStats(buf: Float32Array): { rms: number; peak: number } {
  let sum = 0
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]
    sum += v * v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  return { rms: Math.sqrt(sum / (buf.length || 1)), peak }
}

/**
 * Piecewise-linear mapping from raw dB to the 20-segment display used by the
 * official A2 app (`C6118VuLevelMapper.mapRawDbToDisplayLevel`):
 * (-45 dB -> 0), (-17 -> 6), (-10 -> 13), (-4 -> 18), (0 -> 20).
 * Returns a segment count 0..20.
 */
const VU_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-45, 0],
  [-17, 6],
  [-10, 13],
  [-4, 18],
  [0, 20],
]

export function vuSegments(rawDb: number): number {
  if (rawDb <= VU_POINTS[0][0]) return 0
  if (rawDb >= 0) return 20
  for (let i = 1; i < VU_POINTS.length; i++) {
    const [x1, y1] = VU_POINTS[i]
    const [x0, y0] = VU_POINTS[i - 1]
    if (rawDb <= x1) return y0 + ((rawDb - x0) / (x1 - x0)) * (y1 - y0)
  }
  return 20
}

/** Map dBFS onto a 0..1 meter position on a [-60, 0] scale. */
export function dbToMeterPos(db: number, floor = DB_FLOOR): number {
  if (db <= floor) return 0
  if (db >= 0) return 1
  return (db - floor) / -floor
}

/**
 * Ballistics for one meter channel: instant attack, linear release in dB/s,
 * peak hold with timeout, and a clip latch.
 */
export class MeterBallistics {
  level = DB_FLOOR
  peakHold = DB_FLOOR
  clipped = false
  private peakAt = 0

  constructor(
    public releaseDbPerSec = 20,
    public peakHoldMs = 1500,
    public clipDb = -0.5,
  ) {}

  /** Feed a new measurement (dBFS). `now` in ms, `dt` in seconds. */
  update(rmsDb: number, peakDb: number, now: number, dt: number): void {
    const released = this.level - this.releaseDbPerSec * dt
    this.level = rmsDb > released ? rmsDb : Math.max(released, DB_FLOOR)
    if (peakDb >= this.peakHold || now - this.peakAt > this.peakHoldMs) {
      this.peakHold = peakDb
      this.peakAt = now
    }
    if (peakDb >= this.clipDb) this.clipped = true
  }

  reset(): void {
    this.level = DB_FLOOR
    this.peakHold = DB_FLOOR
    this.clipped = false
    this.peakAt = 0
  }
}
