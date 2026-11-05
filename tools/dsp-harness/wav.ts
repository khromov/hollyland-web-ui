/** Minimal RIFF/WAVE reader and float32 writer for the parity harness. */
import fs from 'node:fs'

export interface Wav {
  sampleRate: number
  channels: number
  format: number
  bits: number
  /** One Float64Array per channel. int PCM is scaled by exactly 1/2^(bits-1). */
  data: Float64Array[]
}

export function readWav(file: string): Wav {
  const b = fs.readFileSync(file)
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a RIFF/WAVE file`)
  let o = 12
  let format = 0, channels = 0, sampleRate = 0, bits = 0
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4)
    const size = b.readUInt32LE(o + 4)
    const body = o + 8
    if (id === 'fmt ') {
      format = b.readUInt16LE(body)
      channels = b.readUInt16LE(body + 2)
      sampleRate = b.readUInt32LE(body + 4)
      bits = b.readUInt16LE(body + 14)
      if (format === 0xfffe) format = b.readUInt16LE(body + 24)
    } else if (id === 'data') {
      const bps = bits / 8
      const len = Math.min(size, b.length - body)
      const frames = Math.floor(len / (bps * channels))
      const data = Array.from({ length: channels }, () => new Float64Array(frames))
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          const p = body + (i * channels + c) * bps
          let v: number
          if (format === 3 && bits === 32) v = b.readFloatLE(p)
          else if (format === 3 && bits === 64) v = b.readDoubleLE(p)
          else if (format === 1 && bits === 16) v = b.readInt16LE(p) / 32768
          else if (format === 1 && bits === 24) v = b.readIntLE(p, 3) / 8388608
          else if (format === 1 && bits === 32) v = b.readInt32LE(p) / 2147483648
          else if (format === 1 && bits === 8) v = (b[p] - 128) / 128
          else throw new Error(`${file}: unsupported WAV format ${format}/${bits}`)
          data[c][i] = v
        }
      }
      return { sampleRate, channels, format, bits, data }
    }
    o = body + size + (size & 1)
  }
  throw new Error(`${file}: no data chunk`)
}

/** Interleaved float32 samples as stored in a float WAV (no conversion). */
export function readWavF32Interleaved(file: string): { channels: number; sampleRate: number; samples: Float32Array } {
  const w = readWav(file)
  if (w.format !== 3 || w.bits !== 32) throw new Error(`${file}: expected float32 WAV, got ${w.format}/${w.bits}`)
  const n = w.data[0].length
  const out = new Float32Array(n * w.channels)
  for (let i = 0; i < n; i++) for (let c = 0; c < w.channels; c++) out[i * w.channels + c] = w.data[c][i]
  return { channels: w.channels, sampleRate: w.sampleRate, samples: out }
}

/** Bit-exact float32 WAV writer (interleaved samples). */
export function writeWavF32(file: string, samples: Float32Array, channels = 1, sampleRate = 48000): void {
  const h = Buffer.alloc(44)
  const bytes = samples.length * 4
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + bytes, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(3, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * channels * 4, 28)
  h.writeUInt16LE(channels * 4, 32)
  h.writeUInt16LE(32, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(bytes, 40)
  fs.writeFileSync(file, Buffer.concat([h, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]))
}

export function readF32(file: string): Float32Array {
  const b = fs.readFileSync(file)
  const out = new Float32Array(b.length >>> 2)
  new Uint8Array(out.buffer).set(b.subarray(0, out.length * 4))
  return out
}

export function writeF32(file: string, x: Float32Array): void {
  fs.writeFileSync(file, Buffer.from(x.buffer, x.byteOffset, x.byteLength))
}
