/**
 * Level history: per-channel ring buffers of RMS and peak dBFS, sampled at a fixed slot rate
 * while USB audio runs. One buffer lives in the audio store (`audio.history(c)`), so the Overview
 * and Audio pages draw the same history and it survives switching pages.
 *
 * A slot holds the loudest value measured during its 1/rate s. Slots in which nothing was
 * measured (tab hidden, timers throttled, audio stopped) hold NaN: draw them as gaps.
 *
 * Reading from a component's animation frame:
 *
 *   const h = audio.history(0)
 *   // newest slot: h.rms[(h.head - 1 + h.length) % h.length], valid when h.count > 0
 *   // or copy the last N slots oldest-first:
 *   const n = copyHistory(h, 10 * h.rate, out)   // out: Float32Array, returns slots written
 *
 * `written` is a monotonic counter: when it hasn't changed since the last frame, nothing new
 * arrived and the drawing can be skipped.
 */
import { DB_FLOOR } from './levels'

/** Slots per second (the Overview meter window uses the same rate). */
export const HISTORY_RATE = 15
/** Seconds kept. */
export const HISTORY_SECONDS = 60

export interface HistoryView {
  /** RMS dBFS per slot (ring buffer). NaN = nothing measured in that slot. */
  readonly rms: Float32Array
  /** Sample peak dBFS per slot (ring buffer). NaN = nothing measured. */
  readonly peak: Float32Array
  /** Index of the next slot to be written; the newest slot is head - 1 (mod length). */
  readonly head: number
  /** Valid slots, at most `length`. */
  readonly count: number
  /** Capacity in slots. */
  readonly length: number
  /** Slots per second. */
  readonly rate: number
  /** Total slots written since the page loaded (monotonic; use it to skip redraws). */
  readonly written: number
}

/**
 * Copy the newest `slots` RMS values (or peaks with `which = 'peak'`) oldest-first into `out`,
 * right-aligned: out[out.length - 1] is the newest slot. Slots older than the history are NaN.
 * Returns how many slots were valid.
 */
export function copyHistory(view: HistoryView, slots: number, out: Float32Array, which: 'rms' | 'peak' = 'rms'): number {
  const src = which === 'peak' ? view.peak : view.rms
  const n = Math.min(slots, out.length)
  const valid = Math.min(n, view.count)
  out.fill(NaN, 0, out.length - valid)
  for (let k = 0; k < valid; k++) {
    const idx = (view.head - valid + k + view.length * 2) % view.length
    out[out.length - valid + k] = src[idx]
  }
  return valid
}

/** Growable per-channel envelope (peak dBFS per slot) of one recording. */
export interface TakeEnvelope {
  rate: number
  /** Peak dBFS per slot for each channel; NaN = nothing measured. */
  peak: Float32Array[]
}

export class LevelHistory {
  readonly rate: number
  readonly length: number
  private readonly rms: Float32Array[]
  private readonly peak: Float32Array[]
  private head = 0
  private count = 0
  private written = 0
  /** Index of the slot currently being accumulated (time-based), or -1 when not running. */
  private slot = -1
  private t0 = 0
  private acc: { rms: number; peak: number }[]
  private accHas = false

  /** Envelope being recorded alongside (null when not recording). */
  private env: { chunks: Float32Array[][]; cur: Float32Array[]; fill: number } | null = null

  constructor(channels = 2, rate = HISTORY_RATE, seconds = HISTORY_SECONDS) {
    this.rate = rate
    this.length = Math.round(rate * seconds)
    this.rms = Array.from({ length: channels }, () => new Float32Array(this.length).fill(NaN))
    this.peak = Array.from({ length: channels }, () => new Float32Array(this.length).fill(NaN))
    this.acc = Array.from({ length: channels }, () => ({ rms: DB_FLOOR, peak: DB_FLOOR }))
  }

  view(c: number): HistoryView {
    return {
      rms: this.rms[c],
      peak: this.peak[c],
      head: this.head,
      count: this.count,
      length: this.length,
      rate: this.rate,
      written: this.written,
    }
  }

  /** Forget everything (new capture). */
  clear(): void {
    for (const a of [...this.rms, ...this.peak]) a.fill(NaN)
    this.head = 0
    this.count = 0
    this.slot = -1
    this.accHas = false
    this.written++
  }

  /** Start the slot clock (capture started). */
  start(now: number): void {
    this.t0 = now
    this.slot = 0
    this.accHas = false
  }

  /** Stop the slot clock: the partial slot is written, later slots are not filled. */
  stop(): void {
    if (this.slot >= 0 && this.accHas) this.commit(false)
    this.slot = -1
  }

  /**
   * Feed one measurement per channel. Slots that passed without a measurement are written as
   * gaps (NaN), so the time axis stays true.
   */
  feed(now: number, levels: readonly ({ rmsDb: number; peakDb: number } | null)[]): void {
    if (this.slot < 0) this.start(now)
    const target = Math.floor(((now - this.t0) * this.rate) / 1000)
    if (target > this.slot) {
      // Close the current slot, then any empty ones in between (capped at the capacity).
      this.commit(!this.accHas)
      const gaps = Math.min(this.length, target - this.slot - 1)
      for (let i = 0; i < gaps; i++) this.commit(true)
      this.slot = target
    }
    for (let c = 0; c < this.acc.length; c++) {
      const l = levels[c]
      if (!l) continue
      const a = this.acc[c]
      if (!this.accHas || l.rmsDb > a.rms) a.rms = l.rmsDb
      if (!this.accHas || l.peakDb > a.peak) a.peak = l.peakDb
    }
    this.accHas = true
  }

  /** Begin collecting a take envelope (recording started). */
  beginEnvelope(): void {
    const ch = this.rms.length
    this.env = { chunks: Array.from({ length: ch }, () => []), cur: Array.from({ length: ch }, () => new Float32Array(1024)), fill: 0 }
  }

  /** Finish the take envelope and return it (null when none was being collected). */
  endEnvelope(): TakeEnvelope | null {
    const e = this.env
    this.env = null
    if (!e) return null
    const peak = e.chunks.map((chunks, c) => {
      const total = chunks.length * 1024 + e.fill
      const out = new Float32Array(total)
      chunks.forEach((ch, i) => out.set(ch, i * 1024))
      out.set(e.cur[c].subarray(0, e.fill), chunks.length * 1024)
      return out
    })
    return { rate: this.rate, peak }
  }

  /** Slots collected for the take in progress (for drawing it live). */
  envelopeLength(): number {
    const e = this.env
    return e ? e.chunks[0].length * 1024 + e.fill : 0
  }

  /** Peak dBFS of slot `i` of the take in progress, channel `c` (NaN when out of range). */
  envelopeAt(c: number, i: number): number {
    const e = this.env
    if (!e) return NaN
    const chunk = Math.floor(i / 1024)
    const off = i % 1024
    if (chunk < e.chunks[c].length) return e.chunks[c][chunk][off]
    if (chunk === e.chunks[c].length && off < e.fill) return e.cur[c][off]
    return NaN
  }

  private commit(gap: boolean): void {
    for (let c = 0; c < this.rms.length; c++) {
      this.rms[c][this.head] = gap ? NaN : this.acc[c].rms
      this.peak[c][this.head] = gap ? NaN : this.acc[c].peak
    }
    if (this.env) {
      const e = this.env
      for (let c = 0; c < e.cur.length; c++) e.cur[c][e.fill] = gap ? NaN : this.acc[c].peak
      e.fill++
      if (e.fill === 1024) {
        e.cur.forEach((buf, c) => e.chunks[c].push(buf))
        e.cur = e.cur.map(() => new Float32Array(1024))
        e.fill = 0
      }
    }
    this.head = (this.head + 1) % this.length
    if (this.count < this.length) this.count++
    this.written++
    this.accHas = false
    for (const a of this.acc) {
      a.rms = DB_FLOOR
      a.peak = DB_FLOOR
    }
  }
}
