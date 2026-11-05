/**
 * AudioWorklet processor that runs the TypeScript port of HollyAudio's voice
 * DSP (src/lib/dsp) on each input channel independently.
 *
 * Web Audio delivers 128-sample render quanta; the DSP works on the native
 * 240-sample frames. VoiceStream (src/lib/dsp/stream.ts) buffers one into the
 * other so each channel sees exactly the frame sequence cmsis_process_frame
 * would see, at a constant extra delay of 224 samples (4.67 ms at 48 kHz) on
 * every channel, processed or not.
 *
 * Loaded through Vite as `voice-fx.worklet.ts?worker&url` (see voicefx.ts).
 */
import { RENDER_QUANTUM, VoiceStream } from '../dsp/stream'
import { VOICE_FX_PROCESSOR, type VoiceFxEvent, type VoiceFxProcessorOptions, type VoiceFxRequest } from './voice-fx-shared'

// AudioWorkletGlobalScope (not part of TypeScript's DOM lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
}
declare function registerProcessor(name: string, ctor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor): void

/** Render quantum of this context: the spec's `renderQuantumSize` global where it exists, else 128. */
const blockSize = ((globalThis as { renderQuantumSize?: number }).renderQuantumSize ?? RENDER_QUANTUM) | 0

class VoiceFxProcessor extends AudioWorkletProcessor {
  private readonly streams: VoiceStream[]
  private alive = true

  constructor(options: AudioWorkletNodeOptions) {
    super(options)
    const po = (options.processorOptions ?? {}) as Partial<VoiceFxProcessorOptions>
    const channels = Math.max(1, po.channels ?? options.outputChannelCount?.[0] ?? 2)
    this.streams = Array.from({ length: channels }, (_, c) => {
      const s = new VoiceStream(blockSize)
      s.setTemplate(po.templates?.[c] ?? null, po.options)
      return s
    })
    this.port.onmessage = (e: MessageEvent<VoiceFxRequest>) => this.onRequest(e.data)
    this.post({ type: 'ready', latency: this.streams[0].latency, blockSize })
  }

  private post(m: VoiceFxEvent): void {
    this.port.postMessage(m)
  }

  private onRequest(m: VoiceFxRequest): void {
    if (m.type === 'dispose') {
      this.alive = false
      this.port.close()
      return
    }
    if (m.type === 'set') {
      const s = this.streams[m.channel]
      if (!s) return
      s.setTemplate(m.template, m.options)
      if (m.id !== undefined) this.post({ type: 'applied', id: m.id, channel: m.channel, consumed: s.samplesIn })
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0]
    const output = outputs[0]
    if (!output) return this.alive
    for (let c = 0; c < output.length; c++) {
      const s = this.streams[c]
      if (s) s.process(input?.[c], output[c])
      else output[c].fill(0)
    }
    return this.alive
  }
}

registerProcessor(VOICE_FX_PROCESSOR, VoiceFxProcessor)
