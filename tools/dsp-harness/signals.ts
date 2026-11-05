/**
 * Deterministic test signals for the parity harness (48 kHz mono float32,
 * whole 240-sample frames). Everything is generated in float64 and rounded
 * to float32 once, so native and TS receive bit-identical input.
 *
 * The app's bundled speech samples are read from the user's install at run
 * time (never copied into the repo): channel 0, int PCM scaled by 1/2^(bits-1),
 * resampled to 48 kHz with a Hann-windowed sinc when needed, first N seconds.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readWav } from './wav.ts'

export const FS = 48000
export const FRAME = 240

export interface Signal {
  name: string
  description: string
  x: Float32Array
  /** True for material that must never leave the machine (app samples, user files). */
  local: boolean
}

const dbToLin = (db: number) => Math.pow(10, db / 20)
const wholeFrames = (seconds: number) => Math.ceil((seconds * FS) / FRAME) * FRAME

function rng(seed: number) {
  let s = seed >>> 0
  const u = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() || 1e-12)) * Math.cos(2 * Math.PI * u()) }
}

function normRms(x: Float64Array, dbfs: number): Float64Array {
  let s = 0
  for (const v of x) s += v * v
  const k = dbToLin(dbfs) / Math.sqrt(s / x.length)
  for (let i = 0; i < x.length; i++) x[i] *= k
  return x
}

export function syntheticSignals(): Signal[] {
  const out: Signal[] = []
  const add = (name: string, description: string, x: Float64Array) => out.push({ name, description, x: Float32Array.from(x), local: false })

  {
    const n = wholeFrames(10), T = n / FS, k = Math.log(20000 / 20)
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = dbToLin(-6) * Math.sin(((2 * Math.PI * 20 * T) / k) * (Math.exp(((i / FS) / T) * k) - 1))
    add('sweep', 'log sine sweep 20 Hz-20 kHz, 10 s, -6 dBFS peak', x)
  }
  {
    const r = rng(0x1234567), x = new Float64Array(wholeFrames(5))
    for (let i = 0; i < x.length; i++) x[i] = r.gauss()
    add('white', 'Gaussian white noise, 5 s, -20 dBFS RMS', normRms(x, -20))
  }
  {
    // Paul Kellet's pink filter on Gaussian white noise
    const r = rng(0x2345678), x = new Float64Array(wholeFrames(5))
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < x.length; i++) {
      const w = r.gauss()
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
      b6 = w * 0.115926
    }
    add('pink', 'pink noise (Kellet filter), 5 s, -20 dBFS RMS', normRms(x, -20))
  }
  {
    const x = new Float64Array(wholeFrames(3))
    for (let i = 0; i < x.length; i += 4801) x[i] = dbToLin(-6)
    add('impulses', 'impulse train, -6 dBFS, every 4801 samples (drifts against the 240-sample frame grid), 3 s', x)
  }
  {
    const levels = [-40, -20, -6, 0], seg = 0.4 * FS
    const x = new Float64Array(wholeFrames(levels.length * 0.8))
    for (let i = 0; i < x.length; i++) {
      const k = Math.floor(i / (2 * seg))
      if (k < levels.length && i % (2 * seg) < seg) x[i] = dbToLin(levels[k]) * Math.sin((2 * Math.PI * 1000 * i) / FS)
    }
    add('bursts', '1 kHz tone bursts stepping -40/-20/-6/0 dBFS, 400 ms on / 400 ms off', x)
  }
  {
    // two-pole resonator at 6 kHz on white noise, 150 ms bursts every 500 ms at -12 dBFS RMS, over a -30 dBFS 200 Hz tone
    const n = wholeFrames(3), r = rng(0x3456789), w = (2 * Math.PI * 6000) / FS, rad = 0.97
    const nb = new Float64Array(n)
    let y1 = 0, y2 = 0
    for (let i = 0; i < n; i++) {
      const y = r.gauss() + 2 * rad * Math.cos(w) * y1 - rad * rad * y2
      y2 = y1
      y1 = y
      nb[i] = y
    }
    normRms(nb, -12)
    const x = new Float64Array(n)
    for (let i = 0; i < n; i++) x[i] = (i % 24000 < 7200 ? nb[i] : 0) + dbToLin(-30) * Math.sin((2 * Math.PI * 200 * i) / FS)
    add('sibilant', 'noise resonant at 6 kHz, 150 ms bursts at -12 dBFS RMS over a -30 dBFS 200 Hz tone, 3 s', x)
  }
  add('silence', 'digital silence, 1 s', new Float64Array(wholeFrames(1)))
  return out
}

/** Hann-windowed sinc resampler (64 taps, cutoff 0.95 x the lower Nyquist). Only used to bring 44.1 kHz files to 48 kHz. */
export function resample(x: Float64Array, from: number, to: number): Float64Array {
  if (from === to) return x
  const n = Math.floor((x.length * to) / from), y = new Float64Array(n), half = 32
  const fc = Math.min(1, to / from) * 0.95
  for (let i = 0; i < n; i++) {
    const t = (i * from) / to, c = Math.floor(t)
    let s = 0
    for (let k = c - half + 1; k <= c + half; k++) {
      if (k < 0 || k >= x.length) continue
      const d = t - k
      const sinc = d === 0 ? fc : Math.sin(Math.PI * fc * d) / (Math.PI * d)
      s += x[k] * sinc * (0.5 + 0.5 * Math.cos((Math.PI * d) / half))
    }
    y[i] = s
  }
  return y
}

export function fileSignal(name: string, file: string, seconds: number, description?: string): Signal {
  const w = readWav(file)
  const y = resample(w.data[0], w.sampleRate, FS)
  const n = Math.min(wholeFrames(seconds), Math.floor(y.length / FRAME) * FRAME)
  const how = w.sampleRate === FS ? 'no resampling' : `resampled ${w.sampleRate} -> 48000 Hz (windowed sinc)`
  return {
    name,
    description: description ?? `${path.basename(file)}: ${w.channels} ch ${w.format === 3 ? 'float' : 'int'}${w.bits} @ ${w.sampleRate} Hz, channel 0, ${how}, first ${(n / FS).toFixed(1)} s`,
    x: Float32Array.from(y.subarray(0, n)),
    local: true,
  }
}

export const APP_DIR = process.env.LARKSOUND_APP ?? '/Applications/larkSound.app/Wrapper/larkSound.app'

export const SPEECH: [name: string, file: string][] = [
  ['speech_default', 'default.wav'],
  ['speech_en_m', '英文_男声_trans.wav'],
  ['speech_en_f', '英文_女声trans.wav'],
  ['speech_zh_m', '中文_男声_trans.wav'],
  ['speech_zh_f', '中文_女声_trans.wav'],
]

export function speechSignals(seconds: number): Signal[] {
  const out: Signal[] = []
  for (const [name, file] of SPEECH) {
    const p = path.join(APP_DIR, file)
    if (fs.existsSync(p)) out.push(fileSignal(name, p, seconds))
  }
  return out
}
