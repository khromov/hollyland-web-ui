import { describe, expect, it } from 'vitest'
import { FRAME, VoiceProcessor } from '../pipeline'
import { PRESET_TEMPLATES, findTemplate } from '../presets'
import { RENDER_QUANTUM, VOICE_STREAM_LATENCY, VoiceStream, streamLatency } from '../stream'

const f = Math.fround

function signal(n: number, seed = 7): Float32Array {
  const x = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    x[i] = f(0.4 * Math.sin((2 * Math.PI * 330 * i) / 48000) * (i % 9600 < 4800 ? 1 : 0.02) + (s / 4294967296 - 0.5) * 0.1)
  }
  return x
}

/** Feeds `x` through a stream in `block`-sample blocks, plus enough zeros to flush. */
function stream(s: VoiceStream, x: Float32Array, block: number, onBlock?: (start: number) => void): Float32Array {
  const total = Math.ceil((x.length + s.latency) / block) * block
  const y = new Float32Array(total)
  const inBuf = new Float32Array(block)
  for (let o = 0; o < total; o += block) {
    onBlock?.(o)
    inBuf.fill(0)
    inBuf.set(x.subarray(o, Math.min(o + block, x.length)))
    s.process(inBuf, y.subarray(o, o + block))
  }
  return y
}

const u32 = (a: Float32Array) => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length))

describe('VoiceStream', () => {
  it('has the minimal latency FRAME - gcd(block, FRAME)', () => {
    expect(VOICE_STREAM_LATENCY).toBe(224)
    expect(streamLatency(RENDER_QUANTUM)).toBe(224)
    expect(streamLatency(240)).toBe(0)
    expect(streamLatency(480)).toBe(0)
    expect(streamLatency(160)).toBe(160)
    expect(streamLatency(256)).toBe(224)
    expect(streamLatency(1)).toBe(239)
  })

  it.each([128, 256, 160, 240, 64, 100])('is the native frame sequence delayed by the latency, bit for bit (block %i)', (block) => {
    const t = findTemplate('rich-full')!
    const x = signal(FRAME * 120)
    const ref = new Float32Array(x.length)
    const vp = new VoiceProcessor()
    vp.configure(t)
    const out = new Float32Array(FRAME)
    for (let k = 0; k < x.length; k += FRAME) {
      vp.processFrame(x.subarray(k, k + FRAME), out)
      ref.set(out, k)
    }
    const s = new VoiceStream(block)
    s.setTemplate(t)
    const y = stream(s, x, block)
    const L = s.latency
    expect(u32(y.subarray(0, L))).toEqual(new Array(L).fill(0))
    expect(u32(y.subarray(L, L + x.length))).toEqual(u32(ref))
  })

  it('passes channels without a template through with the same delay', () => {
    const x = signal(FRAME * 20)
    const s = new VoiceStream(128)
    const y = stream(s, x, 128)
    expect(u32(y.subarray(224, 224 + x.length))).toEqual(u32(x))
  })

  it('applies a template change at the next frame boundary, reusing the processor', () => {
    const x = signal(FRAME * 60)
    const [a, b] = [PRESET_TEMPLATES[0], PRESET_TEMPLATES[7]]
    const switchAt = 128 * 37 // a block boundary inside frame 19
    const k = Math.floor(switchAt / FRAME)
    // reference: one processor, frames < k with a, then reconfigured to b; frames after 2k bypassed
    const ref = new Float32Array(x.length)
    const vp = new VoiceProcessor()
    vp.configure(a)
    const out = new Float32Array(FRAME)
    for (let j = 0; j * FRAME < x.length; j++) {
      if (j === k) vp.configure(b)
      const frame = x.subarray(j * FRAME, (j + 1) * FRAME)
      if (j >= 2 * k + 1) {
        ref.set(frame, j * FRAME)
        continue
      }
      vp.processFrame(frame, out)
      ref.set(out, j * FRAME)
    }
    const s = new VoiceStream(128)
    s.setTemplate(a)
    const off = 128 * Math.ceil(((2 * k + 1) * FRAME) / 128) // first block boundary after frame 2k starts
    const y = stream(s, x, 128, (start) => {
      if (start === switchAt) s.setTemplate(b)
      if (start === off) s.setTemplate(null)
    })
    expect(Math.floor(off / FRAME)).toBe(2 * k + 1)
    expect(u32(y.subarray(224, 224 + x.length))).toEqual(u32(ref))
  })

  it('treats a missing input as silence', () => {
    const s = new VoiceStream(128)
    s.setTemplate(PRESET_TEMPLATES[1])
    const y = new Float32Array(128)
    for (let i = 0; i < 20; i++) s.process(undefined, y)
    expect(s.samplesIn).toBe(2560)
    expect(y.every((v) => Number.isFinite(v))).toBe(true)
  })
})
