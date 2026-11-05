/**
 * Streaming adapter: runs VoiceProcessor, which works on 240-sample frames
 * like cmsis_process_frame, on audio that arrives in blocks of another size
 * (Web Audio's 128-sample render quanta).
 *
 * Framing. The input is cut into consecutive 240-sample frames starting with
 * the first sample the stream sees, so the processor gets exactly the frames
 * the native library would get from the same sample stream. A frame is
 * processed as soon as its last sample arrives.
 *
 * Latency. The output is the processed stream delayed by a constant
 * `latency` samples, the smallest delay for which the output never runs dry:
 *
 *   latency = FRAME - gcd(block, FRAME)
 *
 * After k blocks, k*block samples have been read and 240*floor(k*block/240)
 * processed, so the shortfall is (k*block mod 240), which takes every multiple
 * of gcd(block, 240) below 240. For 128-sample blocks that is 224 samples
 * (4.67 ms at 48 kHz); for 240-sample blocks it is 0. The first `latency`
 * output samples are zero, and output sample n is processed sample
 * n - latency, bit for bit.
 *
 * Configuration changes (setTemplate) take effect at the next frame boundary:
 * the frame being filled when the change arrives is processed with the new
 * settings, as when the app calls the cmsis_* setters between two
 * cmsis_process_frame calls. Like the app, a new template reconfigures the
 * same processor instance (cmsis_default_configs + setters) rather than
 * creating a new one.
 *
 * A stream with no template passes its input through unchanged, with the same
 * delay, so channels that share a node stay aligned whether or not they are
 * processed.
 *
 * Pure TypeScript, no DOM or Web Audio, so it runs in Node and in an
 * AudioWorkletGlobalScope.
 */
import { FRAME } from './compressor'
import { VoiceProcessor, type ConfigureOptions } from './pipeline'
import type { PresetTemplate } from './presets'

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** Output delay in samples of a VoiceStream fed `block`-sample blocks. */
export const streamLatency = (block: number): number => FRAME - gcd(Math.max(1, block | 0), FRAME)

/** Web Audio's render quantum, and the resulting latency (224 samples). */
export const RENDER_QUANTUM = 128
export const VOICE_STREAM_LATENCY = streamLatency(RENDER_QUANTUM)

export class VoiceStream {
  readonly blockSize: number
  readonly latency: number
  /** Created on the first template and reused afterwards, like the app's single library instance. */
  private vp: VoiceProcessor | null = null
  private active: PresetTemplate | null = null
  private readonly frameIn = new Float32Array(FRAME)
  private readonly frameOut = new Float32Array(FRAME)
  private fill = 0
  private ring: Float32Array
  private mask: number
  private head = 0
  private queued = 0
  /** Input samples consumed so far. */
  samplesIn = 0

  constructor(blockSize: number = RENDER_QUANTUM) {
    this.blockSize = Math.max(1, blockSize | 0)
    this.latency = streamLatency(this.blockSize)
    this.ring = new Float32Array(1)
    this.mask = 0
    this.reserve(this.latency + this.blockSize + FRAME)
    this.queued = this.latency // zeros
  }

  get template(): PresetTemplate | null {
    return this.active
  }

  /** Select a template (null: pass through). Applies from the next frame boundary. */
  setTemplate(template: PresetTemplate | null, options?: ConfigureOptions): void {
    this.active = template
    if (template) (this.vp ??= new VoiceProcessor()).configure(template, options)
  }

  /**
   * Consume `output.length` input samples and write as many output samples.
   * A missing input (no connection) counts as silence.
   */
  process(input: Float32Array | null | undefined, output: Float32Array): void {
    const n = output.length
    const inp = input && input.length >= n ? input : null
    const frame = this.frameIn
    let fill = this.fill
    for (let i = 0; i < n; i++) {
      frame[fill++] = inp ? inp[i] : 0
      if (fill === FRAME) {
        this.runFrame()
        fill = 0
      }
    }
    this.fill = fill
    this.samplesIn += n

    const ring = this.ring, mask = this.mask
    let head = this.head
    const take = Math.min(n, this.queued)
    for (let i = 0; i < take; i++) {
      output[i] = ring[head]
      head = (head + 1) & mask
    }
    // Only reachable if the block size changes mid-stream.
    if (take < n) output.fill(0, take)
    this.head = head
    this.queued -= take
  }

  private runFrame(): void {
    let y = this.frameIn
    if (this.active && this.vp) {
      this.vp.processFrame(this.frameIn, this.frameOut)
      y = this.frameOut
    }
    this.reserve(this.queued + FRAME)
    const ring = this.ring, mask = this.mask
    let tail = (this.head + this.queued) & mask
    for (let i = 0; i < FRAME; i++) {
      ring[tail] = y[i]
      tail = (tail + 1) & mask
    }
    this.queued += FRAME
  }

  /** Grow the ring to a power of two that holds `n` samples, keeping its contents. */
  private reserve(n: number): void {
    if (n <= this.ring.length) return
    let size = this.ring.length
    while (size < n) size *= 2
    const next = new Float32Array(size)
    for (let i = 0; i < this.queued; i++) next[i] = this.ring[(this.head + i) & this.mask]
    this.ring = next
    this.mask = size - 1
    this.head = 0
  }
}
