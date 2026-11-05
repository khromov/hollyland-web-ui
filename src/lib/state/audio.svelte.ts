/** Reactive wrapper around AudioEngine for the UI. */
import { AudioEngine, type AudioEngineState, type RecordingFile, type RecordingOptions } from '../audio/engine'
import { toasts } from '../ui/toast.svelte'

export interface Take {
  id: number
  createdAt: Date
  files: RecordingFile[]
  options: RecordingOptions
}

let takeId = 1

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
  fx: (string | null)[] = $state([null, null])
  /** Apply the same preset to both mics. */
  fxLinked = $state(true)
  monitor = $state(0)
  recording = $state(false)
  recordSeconds = $state(0)
  recordOptions: RecordingOptions = $state({ processed: false, split: false, bitDepth: 24 })
  takes: Take[] = $state([])

  private timer: ReturnType<typeof setInterval> | null = null
  private levelCache: { at: number; levels: { rmsDb: number; peakDb: number }[] } = { at: 0, levels: [] }

  /** Level of one input channel (pre-FX), cached per animation frame. Null when not capturing. */
  readChannel(c: number): { rmsDb: number; peakDb: number } | null {
    if (this.engine.state !== 'running') return null
    const now = performance.now()
    if (now - this.levelCache.at > 8) this.levelCache = { at: now, levels: this.engine.readLevels() }
    return this.levelCache.levels[c] ?? null
  }

  constructor() {
    this.engine.onStateChange = (s) => {
      this.state = s
      this.error = this.engine.error
      this.fxError = this.engine.fxError
      this.deviceLabel = this.engine.deviceLabel
      this.channelCount = this.engine.channelCount
      if (s !== 'running') {
        this.stopTimer()
        this.recording = false
      }
    }
    this.engine.onRecordingSalvaged = (files, options) => {
      this.takes = [{ id: takeId++, createdAt: new Date(), files, options }, ...this.takes]
      this.recording = false
      this.stopTimer()
      toasts.warning('The audio input was disconnected. The recording up to that point was saved below.')
    }
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener?.('devicechange', () => void this.refreshInputs())
    }
  }

  get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined'
  }

  get isHollyland(): boolean {
    return /wireless microphone|hollyland|lark/i.test(this.deviceLabel)
  }

  async refreshInputs() {
    this.inputs = await AudioEngine.listInputs()
  }

  async start(deviceId: string | null = this.selectedInput) {
    await this.engine.start(deviceId ?? undefined)
    await this.refreshInputs()
    if (this.engine.state === 'running') {
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

  setMonitor(v: number) {
    this.monitor = v
    this.engine.setMonitor(v)
  }

  startRecording() {
    this.engine.startRecording({ ...this.recordOptions })
    this.recording = true
    this.recordSeconds = 0
    this.timer = setInterval(() => (this.recordSeconds = this.engine.recordingSeconds), 250)
  }

  async stopRecording() {
    const opts = { ...this.recordOptions }
    this.stopTimer()
    const stamp = new Date()
    const base = `mic-console-${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const files = await this.engine.stopRecording(base)
    this.recording = false
    if (files.length) this.takes = [{ id: takeId++, createdAt: stamp, files, options: opts }, ...this.takes]
  }

  deleteTake(id: number) {
    const t = this.takes.find((x) => x.id === id)
    t?.files.forEach((f) => URL.revokeObjectURL(f.url))
    this.takes = this.takes.filter((x) => x.id !== id)
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

export const audio = new AudioStore()
