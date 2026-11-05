/**
 * Plays back takes in the browser. A take with two mono files (one per channel) plays both
 * together, started and seeked in step. One take at a time.
 */
import type { Take } from '../../lib/state/audio.svelte'

class TakePlayer {
  /** Take loaded for playback (null: none). */
  takeId: number | null = $state(null)
  playing = $state(false)
  /** Position in seconds, refreshed a few times a second (draw from currentTime() per frame). */
  position = $state(0)
  duration = $state(0)

  private els: HTMLAudioElement[] = []
  private tick: ReturnType<typeof setInterval> | null = null

  /** Exact position for per-frame drawing. */
  currentTime(): number {
    return this.els[0]?.currentTime ?? this.position
  }

  isPlaying(id: number): boolean {
    return this.playing && this.takeId === id
  }

  load(take: Take) {
    if (this.takeId === take.id && this.els.length) return
    this.unload()
    this.takeId = take.id
    this.duration = take.files[0]?.durationSec ?? 0
    this.position = 0
    this.els = take.files.map((f) => {
      const el = new Audio(f.url)
      el.preload = 'auto'
      return el
    })
    const first = this.els[0]
    first?.addEventListener('ended', () => {
      this.playing = false
      this.stopTick()
      this.position = 0
      this.els.forEach((e) => {
        e.pause()
        e.currentTime = 0
      })
    })
    first?.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(first.duration)) this.duration = first.duration
    })
  }

  async toggle(take: Take) {
    if (this.takeId === take.id && this.playing) {
      this.pause()
      return
    }
    this.load(take)
    await this.play()
  }

  async play() {
    if (!this.els.length) return
    const t = this.els[0].currentTime
    this.els.forEach((e) => (e.currentTime = t))
    try {
      await Promise.all(this.els.map((e) => e.play()))
      this.playing = true
      this.startTick()
    } catch {
      this.playing = false
    }
  }

  pause() {
    this.els.forEach((e) => e.pause())
    this.playing = false
    this.stopTick()
    this.position = this.currentTime()
  }

  seek(take: Take, sec: number) {
    this.load(take)
    const t = Math.max(0, Math.min(this.duration || sec, sec))
    this.els.forEach((e) => (e.currentTime = t))
    this.position = t
  }

  unload() {
    this.els.forEach((e) => {
      e.pause()
      e.removeAttribute('src')
      e.load()
    })
    this.els = []
    this.takeId = null
    this.playing = false
    this.position = 0
    this.stopTick()
  }

  private startTick() {
    this.stopTick()
    this.tick = setInterval(() => (this.position = this.currentTime()), 200)
  }

  private stopTick() {
    if (this.tick) clearInterval(this.tick)
    this.tick = null
  }
}

export const player = new TakePlayer()
