/**
 * Test scenarios: a small call language that both sides interpret, so the
 * native library and the TS port see the same sequence of API calls.
 *
 *   native: each call becomes a cmsis-runner script line (one runner process
 *           per scenario, i.e. one fresh library load, all signals in turn)
 *   TS:     each call goes to one VoiceProcessor / CmsisEmulator per scenario
 *
 * Every signal starts with `init` (or a preset, which begins with
 * cmsis_default_configs), so signals do not leak state into each other.
 */
import path from 'node:path'
import { PRESET_TEMPLATES, iosSetterCalls, type CmsisEmulator, type PresetTemplate, type VoiceProcessor } from '../../src/lib/dsp/index.ts'
import { Loudness, type LufsParams } from '../../src/lib/dsp/loudness.ts'
import { num } from './native.ts'
import { APP_DIR, FRAME } from './signals.ts'

export type EsserMode = 'ios' | 'preset' | number

export type Call =
  | ['init']
  | ['default']
  | ['pipe', db: number, enable: number]
  | ['eq', index: number, enable: number, type: number, gainDb: number, f0: number, q: number]
  | ['comp', enable: number, thrDb: number, ratio: number, attackMs: number, releaseMs: number, gainDb: number, knee: number, holdMs: number, rangeDb: number]
  | ['esser', enable: number, freqL: number, freqH: number, thrDb: number, range: number]
  /** Writes the de-esser params block's range field directly (no update). */
  | ['esserRange', range: number]
  | ['dist', enable: number, inGain: number, outGain: number, type: number, airWet: number, gruWet: number]
  | ['lufs', enable: number, target: number]
  /** The iOS app's template application (default_configs + clamped setters). */
  | ['preset', id: string, esser: EsserMode]

/** Process frames [from, to) of the signal, as fractions of its frame count. */
export type Step = { calls: Call[] } | { process: [from: number, to: number] }

export interface Target {
  maxAbsErr: number
  snrDb?: number
}

export const TARGET_EQ: Target = { maxAbsErr: 1e-6 }
export const TARGET_STAGE: Target = { maxAbsErr: 1e-5 }
export const TARGET_FULL: Target = { maxAbsErr: 1e-4, snrDb: 80 }

export interface Scenario {
  id: string
  stage: string
  title: string
  target: Target
  /** frame: cmsis_process_frame; wav: cmsis_process_wav (offline render); lufs: the LUFS stage alone. */
  kind: 'frame' | 'wav' | 'lufs'
  steps: Step[]
  lufs?: LufsParams
  /** Write WAVs for listening by default. */
  listen?: boolean
  /** Not one of the parity targets: reported, but never fails the run. */
  informational?: boolean
}

export const presetFile = (t: PresetTemplate): string => path.join(APP_DIR, t.file)

// ---------------------------------------------------------------------------
// native side

export function nativeLines(c: Call): string[] {
  const [name, ...a] = c
  switch (name) {
    case 'init':
      return ['init .']
    case 'default':
      return ['default']
    case 'pipe':
      return [`pipe ${num(a[0] as number)} ${a[1]}`]
    case 'eq': {
      const [i, en, t, g, f0, q] = a as number[]
      return [`eq ${i} ${en} ${t} ${num(g)} ${num(f0)} ${num(q)}`]
    }
    case 'comp': {
      const [en, th, ra, at, rl, g, k, h, rg] = a as number[]
      return [`comp ${en} ${num(th)} ${num(ra)} ${at | 0} ${rl | 0} ${num(g)} ${num(k)} ${num(h)} ${num(rg)}`]
    }
    case 'esser': {
      const [en, fl, fh, th, rg] = a as number[]
      return [`esser ${en} ${num(fl)} ${num(fh)} ${num(th)} ${num(rg)}`]
    }
    case 'esserRange':
      return [`esser_range ${num(a[0] as number)}`]
    case 'dist': {
      const [en, ig, og, t, aw, gw] = a as number[]
      return [`dist ${en} ${num(ig)} ${num(og)} ${t | 0} ${num(aw)} ${num(gw)}`]
    }
    case 'lufs':
      return [`lufs ${a[0]} ${num(a[1] as number)}`]
    case 'preset': {
      const [id, mode] = a as [string, EsserMode]
      const t = PRESET_TEMPLATES.find((p) => p.id === id)
      if (!t) throw new Error(`unknown preset ${id}`)
      // iOS: the params block's range is never written by the API; pin it to
      // the 0 a fresh process has so runs are deterministic.
      const pin = mode === 'ios' ? ['esser_range 0'] : []
      return [...pin, `preset ${presetFile(t)} ${mode === 'ios' ? 'ios' : mode === 'preset' ? 'preset' : num(mode)}`]
    }
  }
}

// ---------------------------------------------------------------------------
// TS side

export function applyTs(vp: VoiceProcessor, c: Call): void {
  const e: CmsisEmulator = vp.native
  const [name, ...a] = c
  const n = a as number[]
  switch (name) {
    case 'init':
      e.init()
      break
    case 'default':
      e.defaultConfigs()
      break
    case 'pipe':
      e.setPipeParams(n[0], !!n[1])
      break
    case 'eq':
      e.setEqBand(n[0], !!n[1], n[2], n[3], n[4], n[5])
      break
    case 'comp':
      e.setCompressor(!!n[0], n[1], n[2], n[3], n[4], n[5], n[6], n[7], n[8])
      break
    case 'esser':
      e.setEsser(!!n[0], n[1], n[2], n[3], n[4])
      break
    case 'esserRange':
      e.esserParams = { ...e.esserParams, range: Math.fround(n[0]) }
      break
    case 'dist':
      e.setDistortion(!!n[0], n[1], n[2], n[3], n[4], n[5])
      break
    case 'lufs':
      e.setLufs(!!n[0], n[1])
      break
    case 'preset': {
      const [id, mode] = a as [string, EsserMode]
      const t = PRESET_TEMPLATES.find((p) => p.id === id)!
      vp.configure(t, { esserRange: mode })
      break
    }
  }
}

export function runTsFrames(vp: VoiceProcessor, x: Float32Array, steps: Step[]): Float32Array {
  const total = Math.floor(x.length / FRAME)
  const parts: Float32Array[] = []
  const out = new Float32Array(FRAME)
  for (const s of steps) {
    if ('calls' in s) {
      for (const c of s.calls) applyTs(vp, c)
      continue
    }
    const [from, to] = frameRange(s.process, total)
    const y = new Float32Array((to - from) * FRAME)
    for (let k = from; k < to; k++) {
      vp.processFrame(x.subarray(k * FRAME, (k + 1) * FRAME), out)
      y.set(out, (k - from) * FRAME)
    }
    parts.push(y)
  }
  return concat(parts)
}

export function runTsLufs(p: LufsParams, x: Float32Array): Float32Array {
  const l = new Loudness()
  l.init(p)
  const y = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) y[i] = l.step(x[i])
  return y
}

export function frameRange([a, b]: [number, number], total: number): [number, number] {
  return [Math.floor(a * total), Math.floor(b * total)]
}

export function concat(parts: Float32Array[]): Float32Array {
  const y = new Float32Array(parts.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of parts) {
    y.set(p, o)
    o += p.length
  }
  return y
}

// ---------------------------------------------------------------------------
// the scenario list

const b = (x: boolean) => (x ? 1 : 0)
const ALL: [number, number] = [0, 1]

/** Everything off: EQ bands disabled, compressor/de-esser/exciter disabled, unity pipe. */
const OFF: Call[] = [
  ['init'],
  ['default'],
  ['esserRange', 0],
  ...Array.from({ length: 10 }, (_, i): Call => ['eq', i, 0, 3, 0, 1000, 1]),
  ['comp', 0, -12, 4, 3, 10, 0, 0.5, 0, -45],
  ['esser', 0, 6500, 4500, -45, -15],
  ['dist', 0, 0, 0, 1, 0, 0],
  ['pipe', 0, 1],
]
const isolated = (...calls: Call[]): Step[] => [{ calls: [...OFF, ...calls] }, { process: ALL }]

/** Deterministic pseudo-random EQ band values (UI-like resolution plus raw floats). */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function randomBand(r: () => number, raw: boolean): [type: number, gain: number, f0: number, q: number] {
  const type = 1 + Math.floor(r() * 7)
  // log-uniform f0 over 20 Hz .. 23999 Hz (the iOS clamp range), Q 0.1 .. 20
  let f0 = 20 * Math.pow(23999 / 20, r())
  let q = 0.1 * Math.pow(200, r())
  let gain = -24 + 48 * r()
  if (!raw) {
    f0 = Math.round(f0)
    q = Math.round(q * 100) / 100
    gain = Math.round(gain * 10) / 10
  }
  return [type, Math.fround(gain), Math.fround(f0), Math.fround(q)]
}

export function randomEqBands(seed: number, count = 10): Call[] {
  const r = rng(seed)
  return Array.from({ length: count }, (_, i): Call => ['eq', i, 1, ...randomBand(r, i % 2 === 1)])
}

export function buildScenarios(): Scenario[] {
  const list: Scenario[] = []
  const add = (s: Scenario) => list.push(s)

  for (const t of PRESET_TEMPLATES) {
    const bands = iosEqCalls(t)
    add({ id: `eq:${t.id}`, stage: 'eq', title: `EQ only, ${t.name} bands`, target: TARGET_EQ, kind: 'frame', steps: isolated(...bands) })
  }
  for (const seed of [11, 22, 33]) {
    add({ id: `eq:random-${seed}`, stage: 'eq', title: `EQ only, 10 random bands (seed ${seed}, all filter types)`, target: TARGET_EQ, kind: 'frame', steps: isolated(...randomEqBands(seed)) })
  }
  add({
    id: 'eq:retune-midstream', stage: 'eq', title: 'EQ band retuned mid-stream (state kept by IIR_coef_update)', target: TARGET_EQ, kind: 'frame',
    steps: [{ calls: [...OFF, ['eq', 0, 1, 3, 9, 2600, 2], ['eq', 1, 1, 6, 0, 120, 0.7]] }, { process: [0, 0.5] }, { calls: [['eq', 0, 1, 3, -6, 3100, 1.5], ['eq', 2, 1, 2, 4, 9000, 0.8]] }, { process: [0.5, 1] }],
  })

  const COMP_PRESET: Call = ['comp', 1, -12, 4, 3, 10, 0, 0.5, 0, -45]
  add({ id: 'comp:preset', stage: 'compressor', title: 'compressor as in every template (-12 dB, 4:1, 3/10 ms, knee 0.5, range -45)', target: TARGET_STAGE, kind: 'frame', steps: isolated(COMP_PRESET) })
  add({ id: 'comp:hold-makeup', stage: 'compressor', title: 'compressor -30 dB, 8:1, 1/100 ms, +6 dB makeup, knee 0.3, hold 50 ms, range -20', target: TARGET_STAGE, kind: 'frame', steps: isolated(['comp', 1, -30, 8, 1, 100, 6, 0.3, 50, -20]) })
  add({ id: 'comp:hard-knee', stage: 'compressor', title: 'compressor -24 dB, 2:1, 5/50 ms, hard knee', target: TARGET_STAGE, kind: 'frame', steps: isolated(['comp', 1, -24, 2, 5, 50, 0, 0, 0, -60]) })
  add({ id: 'comp:wide-knee', stage: 'compressor', title: 'compressor -40 dB, 30:1, 0/200 ms, knee 0.9 (knee branch dominates)', target: TARGET_STAGE, kind: 'frame', steps: isolated(['comp', 1, -40, 30, 0, 200, -3, 0.9, 0, -120]) })
  add({
    id: 'comp:retune-midstream', stage: 'compressor', title: 'compressor retuned mid-stream (tiny and large changes; CompressUpdate step thresholds)', target: TARGET_STAGE, kind: 'frame',
    steps: [{ calls: [...OFF, COMP_PRESET] }, { process: [0, 0.4] }, { calls: [['comp', 1, -12.004, 4, 3, 11, 0, 0.5, 0, -45]] }, { process: [0.4, 0.7] }, { calls: [['comp', 1, -20, 6, 8, 40, 3, 0.2, 20, -30]] }, { process: [0.7, 1] }],
  })

  add({ id: 'esser:ios', stage: 'deesser', title: 'de-esser as the iOS app runs it (range argument dropped, field 0)', target: TARGET_STAGE, kind: 'frame', steps: isolated(['esserRange', 0], ['esser', 1, 6500, 4500, -45, -15]) })
  add({ id: 'esser:range-15', stage: 'deesser', title: 'de-esser with the template range -15 dB (Android behaviour)', target: TARGET_STAGE, kind: 'frame', steps: isolated(['esserRange', -15], ['esser', 1, 6500, 4500, -45, -15]) })
  add({ id: 'esser:alt', stage: 'deesser', title: 'de-esser 9000/5000 Hz, threshold -30 dB, range -10 dB', target: TARGET_STAGE, kind: 'frame', steps: isolated(['esserRange', -10], ['esser', 1, 9000, 5000, -30, -10]) })

  add({ id: 'dist:preset', stage: 'distortion', title: 'exciter as in every template (type 1 airfresh, wet 0)', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 0, 0, 1, 0, 0]) })
  add({ id: 'dist:air-0.5', stage: 'distortion', title: 'airfresh (type 1), wet 0.5', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 0, 0, 1, 0.5, 0]) })
  add({ id: 'dist:air-1', stage: 'distortion', title: 'airfresh (type 1), wet 1', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 0, 0, 1, 1, 0]) })
  add({ id: 'dist:gru-0.5', stage: 'distortion', title: 'GRU saturator (type 0), wet 0.5', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 0, 0, 0, 0, 0.5]) })
  add({ id: 'dist:gru-1', stage: 'distortion', title: 'GRU saturator (type 0), wet 1', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 0, 0, 0, 0, 1]) })
  add({ id: 'dist:copy', stage: 'distortion', title: 'type 2 (plain copy), in/out gain arguments 6/-6 dB (ignored)', target: TARGET_STAGE, kind: 'frame', steps: isolated(['dist', 1, 6, -6, 2, 0.5, 0.5]) })
  add({
    id: 'dist:reapply-midstream', stage: 'distortion', title: 'airfresh wet 0.5, set_distortion re-sent mid-stream (one-time distInit flag)', target: TARGET_STAGE, kind: 'frame',
    steps: [{ calls: [...OFF, ['dist', 1, 0, 0, 1, 0.5, 0]] }, { process: [0, 0.5] }, { calls: [['dist', 1, 0, 0, 1, 0.25, 0]] }, { process: [0.5, 1] }],
  })

  add({ id: 'lufs:template', stage: 'lufs', title: 'LUFS/AGC stage alone, template params (time 3, alpha 0.7, target 0)', target: TARGET_STAGE, kind: 'lufs', steps: [], lufs: { time: 3, scale: 3, alpha: 0.7, targetLoud: 0 } })
  add({ id: 'lufs:default', stage: 'lufs', title: 'LUFS/AGC stage alone, default params (target -6)', target: TARGET_STAGE, kind: 'lufs', steps: [], lufs: { time: 3, scale: 3, alpha: 0.7, targetLoud: -6 } })
  add({ id: 'lufs:fast', stage: 'lufs', title: 'LUFS/AGC stage alone, time 0.05 s (240-sample floor), alpha 0.95, target -14', target: TARGET_STAGE, kind: 'lufs', steps: [], lufs: { time: 0.05, scale: 3, alpha: 0.95, targetLoud: -14 } })
  add({ id: 'lufs:wav-path', stage: 'lufs', title: 'cmsis_process_wav with every other stage off (LUFS pre-gain, divide-back, dropped last frame)', target: TARGET_STAGE, kind: 'wav', steps: [{ calls: OFF }] })

  add({ id: 'pipe:-6dB', stage: 'pipe', title: 'vocalLevelDb -6', target: TARGET_STAGE, kind: 'frame', steps: isolated(['pipe', -6, 1]) })
  add({ id: 'pipe:+6dB', stage: 'pipe', title: 'vocalLevelDb +6', target: TARGET_STAGE, kind: 'frame', steps: isolated(['pipe', 6, 1]) })
  add({ id: 'pipe:-17.3dB', stage: 'pipe', title: 'vocalLevelDb -17.3', target: TARGET_STAGE, kind: 'frame', steps: isolated(['pipe', -17.3, 1]) })
  add({ id: 'pipe:off', stage: 'pipe', title: 'channelEnable 0', target: TARGET_STAGE, kind: 'frame', steps: isolated(['pipe', 0, 0]) })

  for (const t of PRESET_TEMPLATES) {
    add({ id: `full:${t.id}`, stage: 'full', title: `${t.name}: full real-time chain as the iOS app configures it`, target: TARGET_FULL, kind: 'frame', steps: [{ calls: [['init'], ['preset', t.id, 'ios']] }, { process: ALL }], listen: true })
  }
  for (const t of PRESET_TEMPLATES) {
    add({ id: `full-android:${t.id}`, stage: 'full-android', title: `${t.name}: full chain with the template's de-esser range (Android behaviour)`, target: TARGET_FULL, kind: 'frame', steps: [{ calls: [['init'], ['preset', t.id, 'preset']] }, { process: ALL }] })
  }
  for (const t of PRESET_TEMPLATES) {
    add({ id: `offline:${t.id}`, stage: 'offline', title: `${t.name}: cmsis_process_wav offline render (LUFS + chain)`, target: TARGET_FULL, kind: 'wav', steps: [{ calls: [['init'], ['preset', t.id, 'ios']] }] })
  }
  add({
    id: 'switch:clean-to-rich', stage: 'sequence', title: 'live preset switch mid-stream (Clean Voice -> Rich & Full -> Vocal Boost), no init in between', target: TARGET_FULL, kind: 'frame',
    steps: [{ calls: [['init'], ['preset', 'clean', 'ios']] }, { process: [0, 0.33] }, { calls: [['preset', 'rich-full', 'ios']] }, { process: [0.33, 0.66] }, { calls: [['preset', 'boost', 'ios'], ['pipe', -3, 1]] }, { process: [0.66, 1] }],
  })
  add({
    id: 'tweak:eq-live', stage: 'sequence', title: 'Warm & Solid, then two EQ bands and the compressor changed live without default_configs', target: TARGET_FULL, kind: 'frame',
    steps: [{ calls: [['init'], ['preset', 'warm-solid', 'ios']] }, { process: [0, 0.5] }, { calls: [['eq', 4, 1, 3, 3, 900, 2], ['eq', 9, 0, 5, 4, 10000, 1], ['comp', 1, -18, 3, 5, 30, 2, 0.4, 0, -40]] }, { process: [0.5, 1] }],
  })
  for (const seed of [101, 202, 303, 404]) {
    add({ id: `fuzz:${seed}`, stage: 'fuzz', title: `random configuration of every stage (seed ${seed}): ${describeFuzz(seed)}`, target: TARGET_FULL, kind: 'frame', steps: [{ calls: fuzzCalls(seed) }, { process: ALL }], informational: true })
  }
  return list
}

/** A random but valid configuration of every stage, applied after cmsis_init + cmsis_default_configs. */
export function fuzzCalls(seed: number): Call[] {
  const r = rng(seed)
  const pick = (lo: number, hi: number) => Math.fround(lo + (hi - lo) * r())
  const int = (lo: number, hi: number) => lo + Math.floor((hi - lo + 1) * r())
  const eq = randomEqBands(seed * 7 + 1).map((c, i): Call => (c[0] === 'eq' && r() < 0.2 ? ['eq', i, 0, c[3], c[4], c[5], c[6]] : c))
  const freqL = pick(4000, 12000)
  const freqH = pick(2000, freqL - 500)
  return [
    ['init'],
    ['default'],
    ...eq,
    ['comp', 1, pick(-60, 0), pick(1, 30), int(0, 50), int(0, 500), pick(-12, 12), pick(0, 1), int(0, 100), pick(-60, 0)],
    ['esserRange', pick(-24, 0)],
    ['esser', 1, freqL, freqH, pick(-60, -10), 0],
    ['dist', 1, 0, 0, int(0, 2), pick(0, 1), pick(0, 1)],
    ['pipe', pick(-20, 10), 1],
  ]
}

function describeFuzz(seed: number): string {
  const c = fuzzCalls(seed)
  const find = (n: string) => c.find((x) => x[0] === n) as number[] | undefined
  const comp = find('comp')!, es = find('esser')!, rg = find('esserRange')!, d = find('dist')!, p = find('pipe')!
  const r1 = (x: number) => (Math.round(x * 10) / 10).toString()
  const eqOn = c.filter((x) => x[0] === 'eq' && x[2] === 1).length
  return `${eqOn} EQ bands; comp ${r1(comp[2])} dB ${r1(comp[3])}:1 ${comp[4]}/${comp[5]} ms knee ${r1(comp[7])} hold ${comp[8]}; de-esser ${Math.round(es[2])}/${Math.round(es[3])} Hz thr ${r1(es[4])} range ${r1(rg[1])}; exciter type ${d[4]} wet ${r1(d[5])}/${r1(d[6])}; level ${r1(p[1])} dB`
}

/** The EQ setter calls the iOS app makes for a template (presets.ts iosSetterCalls). */
export function iosEqCalls(t: PresetTemplate): Call[] {
  return iosSetterCalls(t).eqBands.map(([i, en, type, g, f0, q]): Call => ['eq', i, b(en), type, g, f0, q])
}
