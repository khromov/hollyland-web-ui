/**
 * Test page for `npm run dsp:browser`. Renders signals through the app's
 * voice-FX AudioWorklet (the same VoiceFx wrapper and worklet module the app
 * uses) in an OfflineAudioContext and POSTs the raw float32 output back to
 * the Node script, which compares it bit for bit.
 *
 *   GET  /__dsp/signal/<name>          mono float32 input
 *   POST /__dsp/result/<mode>/<job id> planar float32 output, channel after channel
 */
import { AudioEngine } from '../../../src/lib/audio/engine'
import { VOICE_FX_LATENCY, VoiceFx, loadVoiceFx } from '../../../src/lib/audio/voicefx'
import type { BrowserJob, BrowserJobResult, EngineSmoke, EngineSmokeResult, RunJobs } from './protocol'

const FS = 48000

const signals = new Map<string, Promise<Float32Array<ArrayBuffer>>>()

function getSignal(name: string): Promise<Float32Array<ArrayBuffer>> {
  let p = signals.get(name)
  if (!p) {
    p = fetch(`/__dsp/signal/${encodeURIComponent(name)}`).then(async (r) => {
      if (!r.ok) throw new Error(`signal ${name}: HTTP ${r.status}`)
      return new Float32Array(await r.arrayBuffer())
    })
    signals.set(name, p)
  }
  return p
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms)
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    )
  })
}

async function render(job: BrowserJob, mode: string): Promise<BrowserJobResult> {
  const x = await getSignal(job.signal)
  const channels = job.presets.length
  const length = x.length + VOICE_FX_LATENCY
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate: FS })
  await loadVoiceFx(ctx)
  const buf = new AudioBuffer({ numberOfChannels: channels, length: x.length, sampleRate: FS })
  for (let c = 0; c < channels; c++) buf.copyToChannel(x, c)
  const src = new AudioBufferSourceNode(ctx, { buffer: buf })
  const fx = new VoiceFx(ctx, job.presets)
  src.connect(fx.node).connect(ctx.destination)
  src.start(0)

  const applied: BrowserJobResult['applied'] = []
  const errors: string[] = []
  const times = [...new Set(job.switches.map((s) => s.at))].sort((a, b) => a - b)
  for (const at of times) {
    // Suspend at a render-quantum boundary, post the change, wait until the
    // processor has applied it, resume: the switch lands deterministically.
    void ctx.suspend(at / FS).then(async () => {
      try {
        const done = job.switches
          .filter((s) => s.at === at)
          .map(async (s) => ({ at, channel: s.channel, consumed: await withTimeout(fx.setPreset(s.channel, s.preset), 10000, `switch at ${at}`) }))
        applied.push(...(await Promise.all(done)))
      } catch (e) {
        errors.push((e as Error).message)
      } finally {
        await ctx.resume()
      }
    })
  }

  const t0 = performance.now()
  const out = await ctx.startRendering()
  const ms = performance.now() - t0
  const ready = await withTimeout(fx.ready, 3000, 'processor ready').then(
    () => true,
    () => false,
  )
  const body = new Float32Array(channels * out.length)
  for (let c = 0; c < channels; c++) body.set(out.getChannelData(c), c * out.length)
  const r = await fetch(`/__dsp/result/${encodeURIComponent(mode)}/${encodeURIComponent(job.id)}`, { method: 'POST', body })
  if (!r.ok) errors.push(`upload: HTTP ${r.status}`)
  fx.dispose()
  return {
    id: job.id,
    ms,
    latency: ready ? fx.latency : null,
    blockSize: ready ? fx.blockSize : null,
    applied,
    length: out.length,
    channels,
    error: errors.length ? errors.join('; ') : undefined,
  }
}

const runJobs: RunJobs = async (jobs, mode, concurrency) => {
  const results: BrowserJobResult[] = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      try {
        results[i] = await render(jobs[i], mode)
      } catch (e) {
        results[i] = { id: jobs[i].id, ms: 0, latency: null, blockSize: null, applied: [], length: 0, channels: 0, error: (e as Error).message ?? String(e) }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker))
  return results
}

/** Planar float channels of a 32-bit float WAV from AudioEngine.stopRecording. */
async function decodeFloatWav(blob: Blob): Promise<Float32Array[]> {
  const v = new DataView(await blob.arrayBuffer())
  const ch = v.getUint16(22, true)
  const frames = v.getUint32(40, true) / (4 * ch)
  const out = Array.from({ length: ch }, () => new Float32Array(frames))
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) out[c][i] = v.getFloat32(44 + 4 * (i * ch + c), true)
  return out
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Drives the app's AudioEngine in a real-time AudioContext with Chrome's fake
 * microphone (a short beep every 0.5 s, so every 1 s window holds two): start, presets per channel, processed and raw recordings,
 * bypass, stop. Not a bit-identity check (real-time capture has no fixed
 * frame phase); it checks that the engine graph works with the worklet.
 */
const engineSmoke: EngineSmoke = async () => {
  const steps: EngineSmokeResult['steps'] = []
  const step = (name: string, ok: boolean, detail = '') => steps.push({ step: name, ok, detail })
  const e = new AudioEngine()
  try {
    await e.start()
    step('start', e.state === 'running' && !e.fxError, `${e.state}; "${e.deviceLabel}", ${e.channelCount} ch, ${e.sampleRate} Hz${e.error ? `; ${e.error}` : ''}${e.fxError ? `; ${e.fxError}` : ''}`)
    if (e.state !== 'running') return { ok: false, steps }

    const record = async (processed: boolean, ms: number) => {
      e.startRecording({ processed, split: false, bitDepth: 32 })
      await sleep(ms)
      const files = await e.stopRecording('smoke')
      return files.length === 1 ? decodeFloatWav(files[0].blob) : []
    }
    const levels = (chs: Float32Array[]) => chs.map((c) => `${(20 * Math.log10(rms(c) || 1e-12)).toFixed(1)} dBFS`).join(' / ')
    const finite = (chs: Float32Array[]) => chs.every((c) => c.every(Number.isFinite))

    const raw = await record(false, 1000)
    step('raw recording', raw.length === 2 && raw[0].length > 0 && rms(raw[0]) > 1e-4 && finite(raw), `${raw.length} ch, ${raw[0]?.length ?? 0} frames, ${levels(raw)}`)

    e.setFx(0, 'clean')
    e.setFx(1, null)
    await sleep(200)
    step('preset on one channel', e.getFx(0) === 'clean' && e.getFx(1) === null && e.fxLatency === VOICE_FX_LATENCY, `fx latency ${e.fxLatency} samples`)
    const one = await record(true, 1000)
    step('processed recording, ch0 Clean Voice, ch1 off', one.length === 2 && finite(one) && rms(one[0]) > 1e-4 && rms(one[1]) > 1e-4, levels(one))

    e.setFx(1, 'rich-full')
    e.setFx(0, 'boost')
    await sleep(200)
    const two = await record(true, 1000)
    step('processed recording, ch0 Vocal Boost, ch1 Rich & Full', two.length === 2 && finite(two) && rms(two[0]) > 1e-4 && rms(two[1]) > 1e-4, levels(two))

    e.setFx(0, null)
    e.setFx(1, null)
    await sleep(100)
    const off = await record(true, 1000)
    step('all presets off: worklet removed, processed = raw path', e.fxLatency === 0 && off.length === 2 && finite(off) && rms(off[0]) > 1e-4, `fx latency ${e.fxLatency}; ${levels(off)}`)

    e.setMonitor(0.2)
    const lv = e.readLevels()
    step('levels', lv.length === 2 && lv.every((l) => Number.isFinite(l.rmsDb)), lv.map((l) => `${l.rmsDb.toFixed(1)} dB`).join(' / '))
  } catch (err) {
    step('exception', false, (err as Error)?.stack ?? String(err))
  } finally {
    await e.stop()
    step('stop', e.state === 'idle', e.state)
  }
  return { ok: steps.every((s) => s.ok), steps }
}

;(globalThis as unknown as { runJobs: RunJobs }).runJobs = runJobs
;(globalThis as unknown as { engineSmoke: EngineSmoke }).engineSmoke = engineSmoke
document.getElementById('log')!.textContent = 'ready'
