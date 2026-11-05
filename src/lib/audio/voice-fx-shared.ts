/**
 * Names and message shapes shared by the voice-FX AudioWorklet
 * (voice-fx.worklet.ts) and its main-thread wrapper (voicefx.ts).
 */
import type { ConfigureOptions } from '../dsp/pipeline'
import type { PresetTemplate } from '../dsp/presets'

export const VOICE_FX_PROCESSOR = 'hollyland-voice-fx'

export interface VoiceFxProcessorOptions {
  /** Channels processed independently (one VoiceProcessor each). */
  channels: number
  /** Initial template per channel; null passes the channel through (delayed by the same latency). */
  templates: (PresetTemplate | null)[]
  options?: ConfigureOptions
}

/** Main thread -> processor. */
export type VoiceFxRequest =
  | { type: 'set'; channel: number; template: PresetTemplate | null; options?: ConfigureOptions; id?: number }
  | { type: 'dispose' }

/** Processor -> main thread. */
export type VoiceFxEvent =
  | { type: 'ready'; latency: number; blockSize: number }
  /** Acknowledges a 'set' with an id; `consumed` is the number of input samples the channel had read when it applied. */
  | { type: 'applied'; id: number; channel: number; consumed: number }
