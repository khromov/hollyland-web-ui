/**
 * Browser-side voice effects.
 *
 * HollyAudio bundles eight voice-profile templates (`pure_vocals_0.json`, ...)
 * and previews them with a native DSP library (EQ -> compressor -> de-esser ->
 * exciter -> output gain). The LARK A2 and M2 have no such DSP, so the web app
 * runs a TypeScript port of that library (src/lib/dsp), which the parity
 * harness (tools/dsp-harness) shows to be bit-identical to the app's own
 * library, in an AudioWorklet.
 *
 * The worklet (voice-fx.worklet.ts) processes every channel independently and
 * delays all of them by VOICE_FX_LATENCY = 224 samples (4.67 ms at 48 kHz):
 * the cost of regrouping Web Audio's 128-sample render quanta into the
 * library's 240-sample frames (see src/lib/dsp/stream.ts). Channels without a
 * preset pass through unchanged with the same delay, so channels stay aligned.
 * With no preset on any channel, the engine takes the worklet out of the graph.
 */
import { VOICE_STREAM_LATENCY } from '../dsp/stream'
import type { ConfigureOptions } from '../dsp/pipeline'
import { PRESET_TEMPLATES, findTemplate, type PresetTemplate } from '../dsp/presets'
import { VOICE_FX_PROCESSOR, type VoiceFxEvent, type VoiceFxProcessorOptions, type VoiceFxRequest } from './voice-fx-shared'
import workletUrl from './voice-fx.worklet.ts?worker&url'

export interface VoicePreset {
  id: string
  /** English label as shown in the official app. */
  name: string
  /** Original Chinese label (zh-Hans). */
  nameZh: string
  description: string
}

/** The eight app templates, for the UI. */
export const VOICE_PRESETS: VoicePreset[] = PRESET_TEMPLATES.map(({ id, name, nameZh, description }) => ({ id, name, nameZh, description }))

export function findPreset(id: string | null | undefined): VoicePreset | undefined {
  return id ? VOICE_PRESETS.find((p) => p.id === id) : undefined
}

/** Extra delay of the voice-FX node in samples, at the standard 128-sample render quantum. */
export const VOICE_FX_LATENCY = VOICE_STREAM_LATENCY

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

/** Registers the voice-FX processor with a context (once per context). */
export function loadVoiceFx(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx)
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl)
    p.catch(() => loaded.delete(ctx))
    loaded.set(ctx, p)
  }
  return p
}

export interface VoiceFxOptions {
  /** Channel count of the node (default: the number of presets given, at least 1). */
  channels?: number
  /** Passed to VoiceProcessor.configure; the default reproduces the iOS app. */
  configure?: ConfigureOptions
}

/**
 * One AudioWorkletNode running the voice DSP on each of its channels.
 * Call `loadVoiceFx(ctx)` first.
 */
export class VoiceFx {
  readonly node: AudioWorkletNode
  readonly channels: number
  /** Delay in samples; updated from the processor once it reports its render quantum. */
  latency = VOICE_FX_LATENCY
  /** Render quantum the processor reported (null until it has). */
  blockSize: number | null = null
  /** Resolves when the processor is running and has reported its latency. */
  readonly ready: Promise<void>
  private readonly presets: (string | null)[]
  private readonly configure?: ConfigureOptions
  private nextId = 1
  private readonly pending = new Map<number, (consumed: number) => void>()
  private disposed = false

  constructor(ctx: BaseAudioContext, presets: (string | PresetTemplate | null)[], options: VoiceFxOptions = {}) {
    this.channels = Math.max(1, options.channels ?? presets.length)
    this.configure = options.configure
    const templates = Array.from({ length: this.channels }, (_, c) => resolve(presets[c] ?? null))
    this.presets = templates.map((t) => t?.id ?? null)
    const processorOptions: VoiceFxProcessorOptions = { channels: this.channels, templates, options: this.configure }
    this.node = new AudioWorkletNode(ctx, VOICE_FX_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [this.channels],
      channelCount: this.channels,
      channelCountMode: 'explicit',
      channelInterpretation: 'discrete',
      processorOptions,
    })
    let onReady: () => void = () => {}
    this.ready = new Promise<void>((r) => (onReady = r))
    this.node.port.onmessage = (e: MessageEvent<VoiceFxEvent>) => {
      const m = e.data
      if (m.type === 'ready') {
        this.latency = m.latency
        this.blockSize = m.blockSize
        onReady()
      } else if (m.type === 'applied') {
        this.pending.get(m.id)?.(m.consumed)
        this.pending.delete(m.id)
      }
    }
  }

  getPreset(channel: number): string | null {
    return this.presets[channel] ?? null
  }

  /**
   * Select a preset (id or template) for one channel; null passes it through.
   * Takes effect at the channel's next 240-sample frame boundary. The promise
   * resolves with the number of input samples the channel had consumed when
   * the change applied.
   */
  setPreset(channel: number, preset: string | PresetTemplate | null): Promise<number> {
    if (this.disposed || channel < 0 || channel >= this.channels) return Promise.resolve(-1)
    const template = resolve(preset)
    this.presets[channel] = template?.id ?? null
    const id = this.nextId++
    const done = new Promise<number>((r) => this.pending.set(id, r))
    this.send({ type: 'set', channel, template, options: this.configure, id })
    return done
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.send({ type: 'dispose' })
    this.node.disconnect()
    this.node.port.onmessage = null
    for (const r of this.pending.values()) r(-1)
    this.pending.clear()
  }

  private send(m: VoiceFxRequest): void {
    this.node.port.postMessage(m)
  }
}

function resolve(p: string | PresetTemplate | null): PresetTemplate | null {
  if (!p) return null
  if (typeof p !== 'string') return p
  const t = findTemplate(p)
  if (!t) throw new Error(`Unknown voice preset "${p}"`)
  return t
}
