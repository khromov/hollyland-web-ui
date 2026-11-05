/** Reactive wrapper around AudioEngine for the UI. */
import { AudioEngine, type AudioEngineState, type RecordingFile, type RecordingOptions } from '../audio/engine'
import { LevelHistory, type HistoryView, type TakeEnvelope } from '../audio/history'
import { findPreset } from '../audio/voicefx'
import type { MeterState } from '../ui/types'
import { toasts } from '../ui/toast.svelte'
import { session } from './session.svelte'

export type { HistoryView, TakeEnvelope } from '../audio/history'
export { copyHistory, HISTORY_RATE, HISTORY_SECONDS } from '../audio/history'

export interface Take {
  id: number
  /** 1-based number shown as "Take 3" (counts every take of this page load). */
  number: number
  createdAt: Date
  files: RecordingFile[]
  options: RecordingOptions
  /** Voice profiles per channel when the take started (only applied when options.processed). */
  fx: (string | null)[]
  /** Channel mode read from the receiver when the take started (null: not known). */
  channelMode: number | null
  /** Peak level per channel over the take, for the timeline (null for takes without one). */
  envelope: TakeEnvelope | null
  /** The audio input disappeared mid-take; the files hold everything up to that point. */
  interrupted: boolean
  /** Per file: the Save link was used (the page warns before closing while a take is unsaved). */
  saved: boolean[]
}

let takeId = 1

/** Sampler tick for the level history (each analyser read covers 42.7 ms, so 30 Hz misses nothing). */
const SAMPLE_MS = 33

const platform = (): string => {
  if (typeof navigator === 'undefined') return ''
  return (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
}

class AudioStore {
  readonly engine = new AudioEngine()
  state: AudioEngineState = $state('idle')
  error: string | null = $state(null)
  /** Set when the voice-effects worklet failed to load (levels and raw recording still work). */
  fxError: string | null = $state(null)
  inputs: MediaDeviceInfo[] = $state([])
  selectedInput: string | null = $state(null)
  deviceLabel = $state('')
  channelCount = $state(0)
  /** Sample rate of the running capture (0 when stopped). */
  sampleRate = $state(0)
  fx: (string | null)[] = $state([null, null])
  /** Apply the same preset to both mics. */
  fxLinked = $state(true)
  /** Profiles in use before effects were switched off (restored by setFxEnabled(true)). */
  fxLast: (string | null)[] = $state([null, null])
  monitor = $state(0)
  recording = $state(false)
  recordSeconds = $state(0)
  recordOptions: RecordingOptions = $state({ processed: false, split: false, bitDepth: 24 })
  takes: Take[] = $state([])
  /** Number the next (or running) take gets. */
  takeNumber = $state(1)
  /** When the take in progress started (null when not recording). */
  recordStartedAt: Date | null = $state(null)
  /** The last take that ended because the input disappeared (cleared by the next recording). */
  interruptedTake: Take | null = $state(null)
  /** Microphone permission from the Permissions API, when the browser reports it. */
  permission: PermissionState | null = $state(null)

  private timer: ReturnType<typeof setInterval> | null = null
  private sampler: ReturnType<typeof setInterval> | null = null
  private levelCache: { at: number; levels: { rmsDb: number; peakDb: number }[] } = { at: 0, levels: [] }
  private hist = new LevelHistory(2)
  private recMeta: { fx: (string | null)[]; channelMode: number | null } = { fx: [null, null], channelMode: null }

  /** Level of one input channel (pre-FX), cached per animation frame. Null when not capturing. */
  readChannel(c: number): { rmsDb: number; peakDb: number } | null {
    if (this.engine.state !== 'running') return null
    const now = performance.now()
    if (now - this.levelCache.at > 8) this.levelCache = { at: now, levels: this.engine.readLevels() }
    return this.levelCache.levels[c] ?? null
  }

  /**
   * Level history of one USB channel (pre-FX), shared by every page: RMS and peak dBFS per
   * 1/15 s slot, the last 60 s, NaN where nothing was measured. Read it from an animation frame;
   * see src/lib/audio/history.ts (copyHistory) for the layout.
   */
  history(c: 0 | 1): HistoryView {
    return this.hist.view(c)
  }

  /** Slots of the take in progress, and the peak of slot i on channel c (for a live timeline). */
  liveEnvelope = {
    length: (): number => this.hist.envelopeLength(),
    at: (c: number, i: number): number => this.hist.envelopeAt(c, i),
    rate: this.hist.rate,
  }

  constructor() {
    this.engine.onStateChange = (s) => {
      this.state = s
      this.error = this.engine.error
      this.fxError = this.engine.fxError
      this.deviceLabel = this.engine.deviceLabel
      this.channelCount = this.engine.channelCount
      this.sampleRate = s === 'running' ? this.engine.sampleRate : 0
      if (s === 'running') this.startSampler()
      else this.stopSampler()
      if (s !== 'running') {
        this.stopTimer()
        this.recording = false
        this.recordStartedAt = null
        // A stop without a salvaged take (e.g. the input vanished before any audio) still ends the envelope.
        this.hist.endEnvelope()
      }
      if (s === 'error' && /denied/i.test(this.error ?? '')) this.permission = 'denied'
    }
    this.engine.onRecordingSalvaged = (files, options) => {
      const take = this.makeTake(files, options, this.recordStartedAt ?? new Date(), true)
      this.takes = [take, ...this.takes]
      this.interruptedTake = take
      this.recording = false
      this.recordStartedAt = null
      this.stopTimer()
      toasts.warning('The audio input was disconnected. The recording up to that point was saved below.')
    }
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener?.('devicechange', () => void this.refreshInputs())
    }
    void this.watchPermission()
    if (typeof window !== 'undefined') {
      // Takes live only in this tab: ask before a reload or close throws one away.
      window.addEventListener('beforeunload', (e) => {
        if (this.hasUnsaved) e.preventDefault()
      })
    }
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined'
  }

  get isHollyland(): boolean {
    return /wireless microphone|hollyland|lark/i.test(this.deviceLabel)
  }

  /**
   * On macOS (and Windows) the local bridge captures the whole receiver, so its USB audio input
   * is gone while the bridge runs. On Linux the bridge only detaches the HID driver.
   */
  get pausedByBridge(): boolean {
    const linux = /linux/i.test(platform()) && !/android/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')
    return (
      session.transportKind === 'bridge' &&
      (session.phase === 'ready' || session.phase === 'lost' || session.phase === 'restarting') &&
      !linux
    )
  }

  /**
   * What a meter window shows: live levels, or why there are none. Shared by Overview and Audio
   * so both say the same thing.
   */
  get meterState(): MeterState {
    if (this.state === 'running') return 'live'
    if (this.pausedByBridge) return 'paused'
    if (this.state === 'starting') return 'starting'
    if (!this.supported) return 'error'
    if (this.state === 'error') {
      const e = this.error ?? ''
      if (/denied/i.test(e)) return 'denied'
      if (/no audio input was found|no longer available/i.test(e)) return 'nodevice'
      return 'error'
    }
    if (this.permission === 'denied') return 'denied'
    return 'idle'
  }

  /** Sentence for meterState 'error' (and the other states where the engine said more). */
  get meterMessage(): string | undefined {
    if (this.state === 'running' || this.pausedByBridge) return undefined
    if (!this.supported) return "This browser can't capture audio inputs, so there are no live levels here."
    if (this.state === 'error' && this.error && this.meterState === 'error') return this.error
    return undefined
  }

  /** True while any channel has a voice profile. */
  get fxEnabled(): boolean {
    return this.fx.some((id) => id !== null)
  }

  async refreshInputs() {
    this.inputs = await AudioEngine.listInputs()
  }

  async start(deviceId: string | null = this.selectedInput) {
    await this.engine.start(deviceId ?? undefined)
    await this.refreshInputs()
    if (this.engine.state === 'running') {
      this.permission = 'granted'
      const settings = this.inputs.find((d) => d.label === this.engine.deviceLabel)
      this.selectedInput = settings?.deviceId ?? deviceId
      this.fx.forEach((id, c) => this.engine.setFx(c, id))
      this.engine.setMonitor(this.monitor)
    }
  }

  async stop() {
    if (this.recording) await this.stopRecording()
    await this.engine.stop()
  }

  async selectInput(deviceId: string) {
    this.selectedInput = deviceId
    if (this.state === 'running') await this.start(deviceId)
  }

  setFx(channel: 0 | 1, presetId: string | null) {
    const channels = this.fxLinked ? [0, 1] : [channel]
    const next = [...this.fx]
    for (const c of channels) {
      next[c] = presetId
      this.engine.setFx(c, presetId)
    }
    this.fx = next
  }

  /** Link or unlink the two channels' profiles. Linking gives Mic 2 the profile of Mic 1. */
  setFxLinked(linked: boolean) {
    this.fxLinked = linked
    if (linked && this.fx[1] !== this.fx[0]) this.setFx(0, this.fx[0])
  }

  /** Effects off clears both channels (remembering them); on restores them, or Clean Voice. */
  setFxEnabled(on: boolean) {
    if (on === this.fxEnabled) return
    if (!on) {
      this.fxLast = [...this.fx]
      this.fx.forEach((_, c) => this.engine.setFx(c, null))
      this.fx = [null, null]
      return
    }
    const last = this.fxLast.some((id) => id !== null) ? this.fxLast : ['clean', 'clean']
    const next = this.fxLinked ? [last[0] ?? last[1], last[0] ?? last[1]] : last
    next.forEach((id, c) => this.engine.setFx(c, findPreset(id)?.id ?? null))
    this.fx = next.map((id) => findPreset(id)?.id ?? null)
  }

  /** Change recording options (ignored while a take is running). */
  setRecordOptions(patch: Partial<RecordingOptions>) {
    if (this.recording) return
    this.recordOptions = { ...this.recordOptions, ...patch }
  }

  setMonitor(v: number) {
    this.monitor = v
    this.engine.setMonitor(v)
  }

  startRecording() {
    this.engine.startRecording({ ...this.recordOptions })
    this.recording = true
    this.recordSeconds = 0
    this.recordStartedAt = new Date()
    this.interruptedTake = null
    // What the USB channels carried, as the Overview and Audio meters label them (null on a
    // receiver without a channel-mode control, or when the mode isn't read back).
    this.recMeta = { fx: [...this.fx], channelMode: session.live ? session.usbChannelMode : null }
    this.hist.beginEnvelope()
    this.timer = setInterval(() => (this.recordSeconds = this.engine.recordingSeconds), 250)
  }

  async stopRecording() {
    const opts = { ...this.recordOptions }
    this.stopTimer()
    const stamp = this.recordStartedAt ?? new Date()
    const base = `mic-console-${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const files = await this.engine.stopRecording(base)
    this.recording = false
    this.recordStartedAt = null
    const take = this.makeTake(files, opts, stamp, false)
    if (files.length) this.takes = [take, ...this.takes]
  }

  deleteTake(id: number) {
    const t = this.takes.find((x) => x.id === id)
    t?.files.forEach((f) => URL.revokeObjectURL(f.url))
    this.takes = this.takes.filter((x) => x.id !== id)
    if (this.interruptedTake?.id === id) this.interruptedTake = null
  }

  /** The user saved file `i` of a take (its download link was used). */
  markSaved(id: number, i: number) {
    this.takes = this.takes.map((t) => (t.id === id ? { ...t, saved: t.saved.map((v, k) => v || k === i) } : t))
  }

  /** A recording runs, or a take has a file that was never saved: closing the page would lose it. */
  get hasUnsaved(): boolean {
    return this.recording || this.takes.some((t) => t.saved.some((v) => !v))
  }

  dismissInterruption() {
    this.interruptedTake = null
  }

  /** Bytes the take in progress will have, from its length and format. */
  get recordBytes(): number {
    const bytes = this.recordOptions.bitDepth === 16 ? 2 : this.recordOptions.bitDepth === 24 ? 3 : 4
    return Math.round(this.recordSeconds * (this.sampleRate || 48000) * 2 * bytes) + (this.recordOptions.split ? 88 : 44)
  }

  private makeTake(files: RecordingFile[], options: RecordingOptions, createdAt: Date, interrupted: boolean): Take {
    const envelope = this.hist.endEnvelope()
    const take: Take = {
      id: takeId++,
      number: this.takeNumber,
      createdAt,
      files,
      options,
      fx: this.recMeta.fx,
      channelMode: this.recMeta.channelMode,
      envelope,
      interrupted,
      saved: files.map(() => false),
    }
    if (files.length) this.takeNumber++
    return take
  }

  private startSampler() {
    this.stopSampler()
    this.hist.clear()
    this.hist.start(performance.now())
    this.sampler = setInterval(() => {
      if (this.engine.state !== 'running') return
      const now = performance.now()
      this.levelCache = { at: now, levels: this.engine.readLevels() }
      this.hist.feed(now, this.levelCache.levels)
    }, SAMPLE_MS)
  }

  private stopSampler() {
    if (this.sampler) clearInterval(this.sampler)
    this.sampler = null
    this.hist.stop()
  }

  private async watchPermission() {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName })
      if (!status) return
      this.permission = status.state
      status.addEventListener('change', () => (this.permission = status.state))
    } catch {
      /* not supported (Firefox, Safari): the state shows after the first attempt */
    }
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

export const audio = new AudioStore()
