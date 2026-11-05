/**
 * AudioEngine: captures the receiver's USB audio input (2 channels), feeds
 * level meters, applies optional per-channel voice effects, monitors to the
 * default output and records WAV files.
 *
 * Graph:
 *   source -> inBus(2ch) -> splitter --c--> analyser[c]                (raw meters)
 *             inBus -> [voice FX worklet, 2ch] -> outBus(2ch)            (processed)
 *   outBus -> monitorGain -> destination                                 (opt-in monitor)
 *   inBus | outBus -> capture worklet -> silent -> destination           (recording)
 *
 * The voice-FX worklet (voicefx.ts) is in the graph only while at least one
 * channel has a preset; otherwise inBus feeds outBus directly. While it is in,
 * both channels of outBus are delayed by VOICE_FX_LATENCY (224 samples,
 * 4.67 ms), processed or not, so they stay aligned.
 */
import { ampToDb, blockStats, DB_FLOOR } from './levels'
import { concatChunks, encodeWav, type WavBitDepth } from './wav'
import { loadWorklets } from './worklets'
import { findPreset, loadVoiceFx, VoiceFx } from './voicefx'

export type AudioEngineState = 'idle' | 'starting' | 'running' | 'error'

export interface ChannelLevel {
  rmsDb: number
  peakDb: number
}

export interface RecordingOptions {
  /** Record the voice-FX output instead of the raw input. */
  processed: boolean
  /** Two mono files (one per channel) instead of one stereo file. */
  split: boolean
  bitDepth: WavBitDepth
}

export interface RecordingFile {
  name: string
  blob: Blob
  url: string
  channels: number
  durationSec: number
}

/** Label used by the receivers' USB audio interface. */
export const HOLLYLAND_AUDIO_LABEL = /wireless microphone|hollyland|lark/i

export class AudioEngine {
  state: AudioEngineState = 'idle'
  error: string | null = null
  channelCount = 0
  sampleRate = 0
  deviceLabel = ''

  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private inBus: GainNode | null = null
  private outBus: GainNode | null = null
  private analysers: AnalyserNode[] = []
  private fx: VoiceFx | null = null
  private fxIds: (string | null)[] = [null, null]
  /** Why voice effects are unavailable in the running context (null when they work). */
  fxError: string | null = null
  private monitorGain: GainNode | null = null
  private capture: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private scratch = new Float32Array(2048)

  private recChunks: Float32Array[][] = []
  private recOpts: RecordingOptions | null = null
  private recStartedAt = 0

  onStateChange?: (s: AudioEngineState) => void
  /** Called when the input disappeared mid-recording and the partial take was saved. */
  onRecordingSalvaged?: (files: RecordingFile[], opts: RecordingOptions) => void

  private setState(s: AudioEngineState) {
    this.state = s
    this.onStateChange?.(s)
  }

  /** List audio inputs. Labels are only populated after mic permission. */
  static async listInputs(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput')
  }

  static pickHollyland(inputs: MediaDeviceInfo[]): MediaDeviceInfo | undefined {
    return inputs.find((d) => HOLLYLAND_AUDIO_LABEL.test(d.label))
  }

  /**
   * Start capture. With no deviceId, asks for permission on the default input,
   * then switches to the Hollyland receiver if one is found.
   */
  async start(deviceId?: string): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') await this.stop()
    this.setState('starting')
    this.error = null
    try {
      const constraints = (id?: string): MediaStreamConstraints => ({
        audio: {
          deviceId: id ? { exact: id } : undefined,
          channelCount: { ideal: 2 },
          sampleRate: { ideal: 48000 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      let stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId))
      if (!deviceId) {
        const holly = AudioEngine.pickHollyland(await AudioEngine.listInputs())
        const current = stream.getAudioTracks()[0]?.getSettings().deviceId
        if (holly && holly.deviceId !== current) {
          stream.getTracks().forEach((t) => t.stop())
          stream = await navigator.mediaDevices.getUserMedia(constraints(holly.deviceId))
        }
      }
      this.stream = stream
      const track = stream.getAudioTracks()[0]
      this.deviceLabel = track?.label ?? ''
      track?.addEventListener('ended', () => {
        this.error = 'The audio input was disconnected.'
        void (async () => {
          // Keep whatever was recorded up to the disconnect instead of discarding it.
          const opts = this.recOpts
          if (opts) {
            try {
              const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
              const files = await this.stopRecording(`hollyland-web-ui-${stamp}-interrupted`)
              if (files.length) this.onRecordingSalvaged?.(files, opts)
            } catch (err) {
              console.warn('[audio] could not save the interrupted recording', err)
            }
          }
          await this.stop('error')
        })()
      })

      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
      this.ctx = ctx
      this.sampleRate = ctx.sampleRate
      const fxLoad = loadVoiceFx(ctx).then(
        () => (this.fxError = null),
        (err: unknown) => {
          // Not fatal: levels, monitoring and raw recording still work.
          this.fxError = `Voice effects could not be loaded: ${(err as Error)?.message ?? err}`
          console.warn(this.fxError)
        },
      )
      await Promise.all([loadWorklets(ctx), fxLoad])

      const src = ctx.createMediaStreamSource(stream)
      this.source = src
      const settingsCh = track?.getSettings().channelCount
      this.channelCount = Math.max(1, Math.min(2, settingsCh ?? src.channelCount ?? 2))

      // Up-mix mono to two identical channels so the rest of the graph is uniform.
      const bus = (interpretation: ChannelInterpretation) =>
        new GainNode(ctx, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: interpretation })
      const inBus = bus(this.channelCount === 1 ? 'speakers' : 'discrete')
      const outBus = bus('discrete')
      this.inBus = inBus
      this.outBus = outBus
      src.connect(inBus)
      inBus.connect(outBus)
      const splitter = ctx.createChannelSplitter(2)
      inBus.connect(splitter)

      this.analysers = [0, 1].map((c) => {
        const a = ctx.createAnalyser()
        a.fftSize = 2048
        a.smoothingTimeConstant = 0
        splitter.connect(a, c)
        return a
      })

      this.updateFx()

      this.monitorGain = ctx.createGain()
      this.monitorGain.gain.value = 0
      outBus.connect(this.monitorGain).connect(ctx.destination)

      this.sink = ctx.createGain()
      this.sink.gain.value = 0
      this.sink.connect(ctx.destination)
      // Keep analysers pulled by the graph.
      this.analysers.forEach((a) => a.connect(this.sink!))

      this.capture = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
      })
      this.capture.connect(this.sink)
      this.capture.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'data' && this.recOpts) {
          ;(e.data.channels as Float32Array[]).forEach((ch, c) => (this.recChunks[c] ??= []).push(ch))
        }
      }

      if (ctx.state === 'suspended') await ctx.resume()
      this.setState('running')
    } catch (err) {
      this.error = describeMediaError(err)
      await this.stop('error')
    }
  }

  async stop(finalState: AudioEngineState = 'idle'): Promise<void> {
    this.fx?.dispose()
    this.fx = null
    this.source?.disconnect()
    this.analysers = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.capture?.port.close()
    this.capture = null
    const ctx = this.ctx
    this.ctx = null
    this.source = this.inBus = this.outBus = this.monitorGain = this.sink = null
    this.recOpts = null
    this.recChunks = []
    if (ctx && ctx.state !== 'closed') await ctx.close().catch(() => {})
    this.setState(finalState)
  }

  /** Current per-channel levels (pre-FX). Cheap; call from requestAnimationFrame. */
  readLevels(): ChannelLevel[] {
    if (!this.analysers.length) return [0, 1].map(() => ({ rmsDb: DB_FLOOR, peakDb: DB_FLOOR }))
    return this.analysers.map((a) => {
      if (this.scratch.length !== a.fftSize) this.scratch = new Float32Array(a.fftSize)
      a.getFloatTimeDomainData(this.scratch)
      const { rms, peak } = blockStats(this.scratch)
      return { rmsDb: ampToDb(rms), peakDb: ampToDb(peak) }
    })
  }

  /** Set (or clear with null) the voice preset for one channel. Unknown ids count as null. */
  setFx(channel: number, presetId: string | null): void {
    if (channel !== 0 && channel !== 1) return
    this.fxIds[channel] = findPreset(presetId)?.id ?? null
    this.updateFx()
  }

  getFx(channel: number): string | null {
    return this.fxIds[channel] ?? null
  }

  /** Extra delay of the processed signal in samples (0 while no preset is active). */
  get fxLatency(): number {
    return this.fx ? this.fx.latency : 0
  }

  /** Brings the worklet in or out of the graph and sends it the current presets. */
  private updateFx() {
    const ctx = this.ctx
    const inBus = this.inBus
    const outBus = this.outBus
    if (!ctx || !inBus || !outBus || this.fxError) return
    const wanted = this.fxIds.some((id) => id !== null)
    if (wanted && !this.fx) {
      const fx = new VoiceFx(ctx, this.fxIds)
      this.fx = fx
      inBus.connect(fx.node).connect(outBus)
      try { inBus.disconnect(outBus) } catch { /* not connected */ }
    } else if (wanted && this.fx) {
      const fx = this.fx
      this.fxIds.forEach((id, c) => {
        if (fx.getPreset(c) !== id) void fx.setPreset(c, id)
      })
    } else if (!wanted && this.fx) {
      inBus.connect(outBus)
      try { inBus.disconnect(this.fx.node) } catch { /* not connected */ }
      this.fx.dispose()
      this.fx = null
    }
  }

  /** Monitor the (processed) signal on the default output. 0 disables. */
  setMonitor(volume: number): void {
    if (!this.monitorGain || !this.ctx) return
    this.monitorGain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime, 0.02)
  }

  get recording(): boolean {
    return this.recOpts !== null
  }

  get recordingSeconds(): number {
    return this.recOpts && this.ctx ? this.ctx.currentTime - this.recStartedAt : 0
  }

  startRecording(opts: RecordingOptions): void {
    if (!this.ctx || !this.capture || !this.inBus || !this.outBus) throw new Error('Audio is not running')
    if (this.recOpts) return
    try { this.inBus.disconnect(this.capture) } catch { /* noop */ }
    try { this.outBus.disconnect(this.capture) } catch { /* noop */ }
    ;(opts.processed ? this.outBus : this.inBus).connect(this.capture)
    this.recChunks = []
    this.recOpts = opts
    this.recStartedAt = this.ctx.currentTime
    this.capture.port.postMessage('start')
  }

  async stopRecording(baseName = 'recording'): Promise<RecordingFile[]> {
    const opts = this.recOpts
    const cap = this.capture
    if (!opts || !cap) return []
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 1000)
      const prev = cap.port.onmessage
      cap.port.onmessage = (e: MessageEvent) => {
        prev?.call(cap.port, e)
        if (e.data?.type === 'stopped') {
          clearTimeout(t)
          cap.port.onmessage = prev
          resolve()
        }
      }
      cap.port.postMessage('stop')
    })
    this.recOpts = null
    const chans = this.recChunks.map(concatChunks)
    this.recChunks = []
    if (!chans.length || !chans[0].length) return []
    const sr = this.sampleRate
    const dur = chans[0].length / sr
    const tag = opts.processed ? '-fx' : ''
    const make = (name: string, data: Float32Array[]): RecordingFile => {
      const blob = encodeWav(data, sr, opts.bitDepth)
      return { name, blob, url: URL.createObjectURL(blob), channels: data.length, durationSec: dur }
    }
    if (opts.split) {
      return chans.slice(0, 2).map((ch, i) => make(`${baseName}-mic${i + 1}${tag}.wav`, [ch]))
    }
    return [make(`${baseName}${tag}.wav`, chans.slice(0, 2))]
  }
}

function describeMediaError(err: unknown): string {
  const e = err as { name?: string; message?: string }
  switch (e?.name) {
    case 'NotAllowedError':
      return 'Microphone permission was denied. Allow microphone access for this site to see levels and record.'
    case 'NotFoundError':
      return 'No audio input was found. Check that the receiver is plugged in.'
    case 'NotReadableError':
      return 'The audio input is busy or could not be opened by the browser.'
    case 'OverconstrainedError':
      return 'The selected audio input is no longer available.'
    default:
      return e?.message || String(err)
  }
}
