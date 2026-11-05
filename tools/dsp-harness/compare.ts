/**
 * DSP parity harness: runs HollyAudio's own DSP library (via cmsis-runner)
 * and the TypeScript port (src/lib/dsp) on identical input, per stage in
 * isolation and per preset for the full chain, and reports how close they are.
 *
 *   npm run dsp:prepare            # once: builds .dsp-native/ from the installed app
 *   npm run dsp:compare -- [options]
 *
 * Options
 *   --only <p1,p2>        scenario id prefixes (e.g. full:,eq:clean,comp:)
 *   --signals <a,b>       signal names (default: all)
 *   --input <file.wav>    add your own recording as a signal (repeatable; local only)
 *   --speech-seconds <s>  length of each app speech excerpt (default 10)
 *   --wav listen|all|none WAV output into .dsp-native/out/ (default listen)
 *   --random-bands <n>    single-band EQ coefficient sweep size (default 4000)
 *   --jobs <n>            parallel native runner processes
 *   --note "<text>"       append a changelog entry to the report
 *   --no-report           do not rewrite docs/dsp/parity-report.md
 *
 * Exit code 1 if any scenario misses its target.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PRESET_TEMPLATES, VoiceProcessor } from '../../src/lib/dsp/index.ts'
import * as appleLibm from '../../src/lib/dsp/applelibm.ts'
import { setLibm } from '../../src/lib/dsp/f32.ts'
import { bitsOf, compare, ulpDistance, type Metrics } from './metrics.ts'
import { NATIVE_DIR, REPO, RUNNER, num, pool, runScript } from './native.ts'
import { writeReport, type CoeffRow, type LibmStat, type PresetCheck, type Report, type Row, type SweepResult } from './report.ts'
import { applyTs, buildScenarios, concat, frameRange, nativeLines, presetFile, randomBand, runTsFrames, runTsLufs, type Scenario } from './scenarios.ts'
import { FRAME, fileSignal, speechSignals, syntheticSignals, type Signal } from './signals.ts'
import { readF32, readWavF32Interleaved, writeF32, writeWavF32 } from './wav.ts'

interface Options {
  only: string[]
  signals: string[]
  inputs: string[]
  speechSeconds: number
  wav: 'listen' | 'all' | 'none'
  randomBands: number
  jobs: number
  note: string | null
  report: boolean
}

function parseArgs(argv: string[]): Options {
  const o: Options = { only: [], signals: [], inputs: [], speechSeconds: 10, wav: 'listen', randomBands: 4000, jobs: Math.max(2, os.cpus().length - 2), note: null, report: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i] ?? ''
    if (a === '--only') o.only.push(...v().split(',').filter(Boolean))
    else if (a === '--signals') o.signals.push(...v().split(',').filter(Boolean))
    else if (a === '--input') o.inputs.push(v())
    else if (a === '--speech-seconds') o.speechSeconds = Number(v())
    else if (a === '--wav') o.wav = v() as Options['wav']
    else if (a === '--random-bands') o.randomBands = Number(v())
    else if (a === '--jobs') o.jobs = Number(v())
    else if (a === '--note') o.note = v()
    else if (a === '--no-report') o.report = false
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

const WORK = path.join(NATIVE_DIR, 'work')
const OUT = path.join(NATIVE_DIR, 'out')
const LISTEN_SIGNALS = new Set(['speech_default', 'speech_en_f', 'speech_zh_m', 'sweep', 'sibilant', 'bursts'])
const safe = (s: string) => s.replace(/[^\w.-]+/g, '_')

function passes(m: Metrics, t: Scenario['target']): boolean {
  if (!(m.maxAbsErr <= t.maxAbsErr) || m.nonFinite > 0) return false
  if (t.snrDb === undefined) return true
  return m.snrDb >= t.snrDb || (Number.isNaN(m.snrDb) && m.maxAbsErr <= t.maxAbsErr)
}

// ---------------------------------------------------------------------------

type Libm = 'apple' | 'cr'
interface NativeOut { a: string[]; b: string[]; file?: string }

/** Runner script lines per signal, writing into `dir`. */
function nativePlan(s: Scenario, signals: Signal[], sigFiles: Map<string, { f32: string; wav: string }>, dir: string) {
  const groups: string[][] = []
  const outputs = new Map<string, NativeOut>()
  for (const sig of signals) {
    const files = sigFiles.get(sig.name)!
    const lines: string[] = []
    groups.push(lines)
    const rec: NativeOut = { a: [], b: [] }
    outputs.set(sig.name, rec)
    if (s.kind === 'lufs') {
      const p = s.lufs!
      rec.file = path.join(dir, `${safe(sig.name)}.f32`)
      lines.push(`lufs_stage ${files.f32} ${rec.file} ${num(p.time)} ${num(p.scale)} ${num(p.alpha)} ${num(p.targetLoud)}`)
      continue
    }
    const total = Math.floor(sig.x.length / FRAME)
    let k = 0
    for (const st of s.steps) {
      if ('calls' in st) {
        for (const c of st.calls) lines.push(...nativeLines(c))
        continue
      }
      const [from, to] = frameRange(st.process, total)
      const a = path.join(dir, `${safe(sig.name)}.${k}.a.f32`), b = path.join(dir, `${safe(sig.name)}.${k}.b.f32`)
      lines.push(`process ${files.f32} ${a} ${b} ${from} ${to - from}`)
      rec.a.push(a)
      rec.b.push(b)
      k++
    }
    if (s.kind === 'wav') {
      rec.file = path.join(dir, `${safe(sig.name)}.out.wav`)
      lines.push(`wav ${files.wav} ${rec.file}`)
    }
  }
  return { groups, outputs }
}

function readNative(s: Scenario, rec: NativeOut): { ref: Float32Array; channels: number; abDiffer: boolean } {
  if (s.kind === 'lufs') return { ref: readF32(rec.file!), channels: 1, abDiffer: false }
  if (s.kind === 'wav') {
    const w = readWavF32Interleaved(rec.file!)
    return { ref: w.samples, channels: w.channels, abDiffer: false }
  }
  const cat = (files: string[]) => concat(files.map(readF32))
  const ref = cat(rec.a), refB = cat(rec.b)
  const ua = new Uint32Array(ref.buffer), ub = new Uint32Array(refB.buffer)
  return { ref, channels: 1, abDiffer: ua.length !== ub.length || ua.some((v, i) => v !== ub[i]) }
}

async function runScenario(s: Scenario, signals: Signal[], sigFiles: Map<string, { f32: string; wav: string }>, opts: Options): Promise<Row[]> {
  const dir = path.join(WORK, safe(s.id))
  fs.rmSync(dir, { recursive: true, force: true })

  // native, with Apple's libm (the real thing) and with correctly rounded float
  // libm (diagnostic). One runner process (one library load) for all signals,
  // except cmsis_process_wav, whose WAV writer keeps the first call's length
  // for every later call in the same process: one process per signal there.
  const plans = {} as Record<Libm, ReturnType<typeof nativePlan>>
  const results = {} as Record<Libm, { lines: string[]; errors: string[] }>
  await Promise.all(
    (['apple', 'cr'] as Libm[]).map(async (libm) => {
      const d = path.join(dir, libm)
      fs.mkdirSync(d, { recursive: true })
      const plan = (plans[libm] = nativePlan(s, signals, sigFiles, d))
      const runs = s.kind === 'wav' ? await Promise.all(plan.groups.map((g) => runScript(g, d, libm))) : [await runScript(plan.groups.flat(), d, libm)]
      results[libm] = { lines: runs.flatMap((r) => r.lines), errors: runs.flatMap((r) => r.errors) }
    }),
  )
  const res = results.apple
  const initRange = res.lines.find((l) => l.includes('esser_range_after_init='))?.split('=')[1]

  // TS: one VoiceProcessor (one emulated library instance) for all signals
  // (per signal for the offline render, mirroring the native side). The port
  // runs twice: with its default Apple libm emulation against the shipping
  // library, and switched to correctly rounded libm against the library with
  // its libm imports rebound (the diagnostic). No await happens while the
  // process-wide libm switch is flipped.
  const vps: Record<Libm, VoiceProcessor> = { apple: new VoiceProcessor(), cr: new VoiceProcessor() }
  const runTs = (libm: Libm, x: Float32Array): Float32Array => {
    setLibm(libm)
    try {
      if (s.kind === 'wav') vps[libm] = new VoiceProcessor()
      const vp = vps[libm]
      if (s.kind === 'lufs') return runTsLufs(s.lufs!, x)
      if (s.kind === 'wav') {
        for (const st of s.steps) if ('calls' in st) for (const c of st.calls) applyTs(vp, c)
        return vp.native.processWavSamples(x)
      }
      return runTsFrames(vp, x, s.steps)
    } finally {
      setLibm('apple')
    }
  }
  const rows: Row[] = []
  for (const sig of signals) {
    let got: Float32Array, gotCr: Float32Array
    const notes: string[] = []
    let ref: Float32Array = new Float32Array(0), refCr: Float32Array = new Float32Array(0), channels = 1
    try {
      const n = readNative(s, plans.apple.outputs.get(sig.name)!)
      ref = n.ref
      channels = n.channels
      if (n.abDiffer) notes.push('native outA != outB')
      refCr = readNative(s, plans.cr.outputs.get(sig.name)!).ref
      got = runTs('apple', sig.x)
      gotCr = runTs('cr', sig.x)
    } catch (e) {
      got = gotCr = new Float32Array(1)
      notes.push(`error: ${(e as Error).message}`)
    }
    const m = compare(ref, got)
    const mCr = compare(refCr, gotCr)
    if (m.bestLag !== 0 && m.lagGain < 0.5) notes.push(`TS output fits better shifted by ${m.bestLag} samples (error energy x${m.lagGain.toFixed(3)})`)
    if (m.signedZeroDiffs) notes.push(`${m.signedZeroDiffs} samples differ only in the sign of zero`)
    if (m.nonFinite) notes.push(`${m.nonFinite} non-finite samples`)
    const pass = passes(m, s.target) && res.errors.length === 0
    rows.push({ scenario: s.id, stage: s.stage, title: s.title, signal: sig.name, local: sig.local, target: s.target, metrics: m, metricsCr: mCr, pass, informational: !!s.informational, notes })

    const listen = opts.wav === 'all' || (opts.wav === 'listen' && ((s.listen || !pass) && (LISTEN_SIGNALS.has(sig.name) || (!sig.name.startsWith('speech_') && sig.local))))
    if (listen && ref.length && got.length === ref.length) {
      const od = path.join(OUT, safe(s.id))
      fs.mkdirSync(od, { recursive: true })
      writeWavF32(path.join(od, `${safe(sig.name)}.native.wav`), ref, channels)
      writeWavF32(path.join(od, `${safe(sig.name)}.ts.wav`), got, channels)
      if (m.maxAbsErr > 0) {
        const d = new Float32Array(ref.length)
        for (let i = 0; i < d.length; i++) d[i] = got[i] - ref[i]
        writeWavF32(path.join(od, `${safe(sig.name)}.diff.wav`), d, channels)
      }
    }
  }
  const errs = [...res.errors, ...results.cr.errors.map((e) => `(cr libm) ${e}`)]
  if (errs.length) for (const r of rows) r.notes.push(`runner: ${errs.slice(0, 3).join('; ')}`)
  if (initRange && initRange !== '0x00000000') for (const r of rows) r.notes.push(`de-esser range field after cmsis_init was ${initRange}`)
  fs.rmSync(dir, { recursive: true, force: true })
  return rows
}

// ---------------------------------------------------------------------------

async function eqCoefficients(randomBands: number): Promise<{ presets: CoeffRow[]; sweep: SweepResult }> {
  const presets: CoeffRow[] = []
  for (const t of PRESET_TEMPLATES) {
    const res = await runScript(['init .', 'esser_range 0', `preset ${presetFile(t)} ios`, 'coeffs'])
    const line = res.lines.find((l) => l.startsWith('ok coeffs'))
    if (!line) throw new Error(`no coefficients for ${t.id}: ${res.errors.join('; ')}`)
    const [, , , ns, ...hex] = line.split(' ')
    const nat = Float32Array.from(hex.map((h) => new Float32Array(new Uint32Array([parseInt(h, 16)]).buffer)[0]))
    const vp = new VoiceProcessor()
    vp.configure(t)
    const { numStages, coeffs } = vp.native.getEqCoefficients()
    let maxUlp = 0, same = 0
    const where: string[] = []
    for (let i = 0; i < Math.max(nat.length, coeffs.length); i++) {
      const u = i < nat.length && i < coeffs.length ? ulpDistance(nat[i], coeffs[i]) : Infinity
      if (bitsOf(nat[i]) === bitsOf(coeffs[i])) same++
      else where.push(`stage ${Math.floor(i / 5)} ${['b0', 'b1', 'b2', 'a1', 'a2'][i % 5]}: ${u} ulp`)
      maxUlp = Math.max(maxUlp, u)
    }
    presets.push({ preset: t.id, name: t.name, nativeStages: Number(ns), tsStages: numStages, coefficients: nat.length, identical: same, maxUlp, where })
  }

  // single-band sweep over every filter type and the whole clamp range
  const r = (() => {
    let s = 0x5eed
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  })()
  const bands = Array.from({ length: randomBands }, (_, i) => randomBand(r, i % 2 === 1))
  const off = ['init .', 'default', ...Array.from({ length: 10 }, (_, i) => `eq ${i} 0 3 0 1000 1`)]
  const lines = [...off]
  for (const [t, g, f0, q] of bands) lines.push(`eq 0 1 ${t} ${num(g)} ${num(f0)} ${num(q)}`, 'coeffs')
  const [res, resCr] = await Promise.all([runScript(lines), runScript(lines, NATIVE_DIR, 'cr')])
  const coeffLines = res.lines.filter((l) => l.startsWith('ok coeffs'))
  const coeffLinesCr = resCr.lines.filter((l) => l.startsWith('ok coeffs'))
  let identicalCr = 0, maxUlpCr = 0
  const emu = (libm: Libm) => {
    setLibm(libm)
    const e = new VoiceProcessor().native
    e.init()
    e.defaultConfigs()
    for (let i = 0; i < 10; i++) e.setEqBand(i, false, 3, 0, 1000, 1)
    setLibm('apple')
    return e
  }
  const e = emu('apple'), eCr = emu('cr')
  const byType = new Map<number, { n: number; identical: number; maxUlp: number }>()
  const worst: SweepResult['worst'] = []
  let identical = 0, maxUlp = 0
  bands.forEach(([t, g, f0, q], k) => {
    e.setEqBand(0, true, t, g, f0, q)
    const ts = e.getEqCoefficients().coeffs
    setLibm('cr')
    eCr.setEqBand(0, true, t, g, f0, q)
    setLibm('apple')
    const tsCr = eCr.getEqCoefficients().coeffs
    const diff = (line: string, ts: Float32Array) => {
      let max = 0, same = true
      line.split(' ').slice(4).forEach((h, j) => {
        const nb = parseInt(h, 16)
        if (nb !== bitsOf(ts[j])) same = false
        max = Math.max(max, ulpDistance(new Float32Array(new Uint32Array([nb]).buffer)[0], ts[j]))
      })
      return { max, same }
    }
    const { max: bandMax, same: bandSame } = diff(coeffLines[k], ts)
    const cr = diff(coeffLinesCr[k], tsCr)
    if (cr.same) identicalCr++
    maxUlpCr = Math.max(maxUlpCr, cr.max)
    const s = byType.get(t) ?? { n: 0, identical: 0, maxUlp: 0 }
    s.n++
    if (bandSame) (s.identical++, identical++)
    s.maxUlp = Math.max(s.maxUlp, bandMax)
    byType.set(t, s)
    maxUlp = Math.max(maxUlp, bandMax)
    if (!bandSame && worst.length < 12) worst.push({ type: t, gain: g, f0, q, maxUlp: bandMax })
  })
  return { presets, sweep: { bands: bands.length, identical, maxUlp, identicalCr, maxUlpCr, byType: [...byType.entries()].sort((a, b) => a[0] - b[0]).map(([type, v]) => ({ type, ...v })), worst } }
}

/**
 * Apple's float libm on this Mac against the port's emulation of it
 * (src/lib/dsp/applelibm.ts) and against correctly rounded results, on the
 * input ranges each DSP call site sees, plus random bit patterns over the
 * whole float32 domain (zeros, subnormals, infinities and NaNs included).
 */
async function libmStats(n: number): Promise<LibmStat[]> {
  const r = (() => {
    let s = 0x11b
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296)
  })()
  const F = Math.fround
  const uni = (lo: number, hi: number) => () => lo + (hi - lo) * r()
  const logu = (lo: number, hi: number) => () => lo * Math.pow(hi / lo, r())
  const bitsU = new Uint32Array(1), bitsF = new Float32Array(bitsU.buffer)
  const anyFloat = () => ((bitsU[0] = (Math.floor(r() * 65536) << 16) | Math.floor(r() * 65536)), bitsF[0])
  const A = appleLibm
  type Case = { fn: string; use: string; gen: () => number; ts: (x: number) => number; cr: (x: number) => number; arity?: 2 }
  const whole = 'whole float32 domain (random bit patterns)'
  const cases: Case[] = [
    { fn: 'sinf', use: 'EQ / de-esser biquad design, w0 = 2π·f0/48000 for f0 20 Hz–24 kHz', gen: uni(0.0026, 3.1416), ts: A.sinf, cr: (x) => F(Math.sin(x)) },
    { fn: 'cosf', use: 'EQ / de-esser biquad design', gen: uni(0.0026, 3.1416), ts: A.cosf, cr: (x) => F(Math.cos(x)) },
    { fn: 'pow10f', use: 'powf(10, x): EQ/peaking A = 10^(dB/40), dB2line, LUFS gain', gen: uni(-6, 1.2), ts: (x) => A.powf(10, x), cr: (x) => F(Math.pow(10, x)) },
    { fn: 'cubef', use: 'powf(y, 3): airfresh soft clipper, every sample', gen: uni(-1.5, 1.5), ts: (x) => A.powf(x, 3), cr: (x) => F(Math.pow(x, 3)) },
    { fn: 'sqf', use: 'powf(t, 2): compressor knee, once per frame', gen: uni(0, 1), ts: (x) => A.powf(x, 2), cr: (x) => F(Math.pow(x, 2)) },
    { fn: 'log10f', use: 'de-esser level (per frame), LUFS level (per sample)', gen: logu(1e-8, 1), ts: A.log10f, cr: (x) => F(Math.log10(x)) },
    { fn: 'expf', use: 'compressor attack/release coefficients (config time)', gen: uni(-2.2, 0), ts: A.expf, cr: (x) => F(Math.exp(x)) },
    { fn: 'logf', use: 'logf(9) in the compressor (config time)', gen: logu(1, 100), ts: A.logf, cr: (x) => F(Math.log(x)) },
    ...(['sinf', 'cosf', 'expf', 'logf', 'log10f'] as const).map((fn): Case => ({ fn, use: whole, gen: anyFloat, ts: A[fn], cr: (x) => F((Math as unknown as Record<string, (v: number) => number>)[fn.slice(0, -1)](x)) })),
    { fn: 'powf', use: `${whole}, (x, y) pairs`, gen: anyFloat, ts: () => 0, cr: () => 0, arity: 2 },
  ]
  fs.mkdirSync(path.join(WORK, 'libm'), { recursive: true })
  const same = (a: number, b: number) => bitsOf(a) === bitsOf(b) || (a !== a && b !== b)
  const out: LibmStat[] = []
  for (const [k, c] of cases.entries()) {
    const m = c.arity === 2 ? 2 * n : n
    const x = Float32Array.from({ length: m }, c.gen)
    const inF = path.join(WORK, 'libm', `${k}.in.f32`), outF = path.join(WORK, 'libm', `${k}.out.f32`)
    writeF32(inF, x)
    const res = await runScript([`libm ${c.fn} ${inF} ${outF}`])
    if (res.errors.length) throw new Error(res.errors.join('; '))
    const y = readF32(outF)
    let diff = 0, maxUlp = 0, diffCr = 0, maxUlpCr = 0
    for (let i = 0; i < n; i++) {
      const t = c.arity === 2 ? A.powf(x[2 * i], x[2 * i + 1]) : c.ts(x[i])
      const cr = c.arity === 2 ? F(Math.pow(x[2 * i], x[2 * i + 1])) : c.cr(x[i])
      if (!same(t, y[i])) {
        diff++
        maxUlp = Math.max(maxUlp, ulpDistance(t, y[i]))
      }
      if (!same(cr, y[i])) {
        diffCr++
        maxUlpCr = Math.max(maxUlpCr, ulpDistance(cr, y[i]))
      }
    }
    out.push({ fn: c.fn, use: c.use, n, differPct: (100 * diff) / n, maxUlp, crDifferPct: (100 * diffCr) / n, crMaxUlp: maxUlpCr })
  }
  return out
}

/** Re-extracts Apple's libm tables from this Mac (native/libm_tables.c) and compares them with the committed ones. */
function checkLibmTables(): Report['libmTables'] {
  const exe = path.join(NATIVE_DIR, 'bin/libm-tables')
  const committed = path.join(REPO, 'src/lib/dsp/applelibm-data.ts')
  if (!fs.existsSync(exe)) return { status: 'unavailable', detail: 'libm-tables not built; rerun npm run dsp:prepare' }
  let text: string
  try {
    text = execFileSync(exe, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    return { status: 'differ', detail: (err.stderr || err.message).trim().split('\n')[0] }
  }
  if (text === fs.readFileSync(committed, 'utf8')) return { status: 'match', detail: '' }
  const fresh = path.join(WORK, 'applelibm-data.ts')
  fs.writeFileSync(fresh, text)
  return { status: 'differ', detail: `this Mac's tables differ from the committed ones; see ${path.relative(REPO, fresh)}` }
}

function checkPresetData(): PresetCheck[] {
  const F = Math.fround
  return PRESET_TEMPLATES.map((t) => {
    const diffs: string[] = []
    let j: Record<string, unknown>
    try {
      j = JSON.parse(fs.readFileSync(presetFile(t), 'utf8'))
    } catch (e) {
      return { preset: t.id, file: t.file, ok: false, diffs: [`cannot read: ${(e as Error).message}`] }
    }
    const cmp = (where: string, a: unknown, b: unknown) => {
      const eq = typeof a === 'number' && typeof b === 'number' ? Object.is(F(a), F(b)) : a === b
      if (!eq) diffs.push(`${where}: app ${JSON.stringify(a)} vs TS ${JSON.stringify(b)}`)
    }
    const obj = (k: string) => (j[k] ?? {}) as Record<string, unknown>
    cmp('comment', j.comment, t.nameZh)
    for (const [k, v] of Object.entries(t.compress)) cmp(`compress.${k}`, obj('compress')[k], v)
    for (const [k, v] of Object.entries(t.exciter)) cmp(`exciter.${k}`, obj('exciter')[k], v)
    for (const [k, v] of Object.entries(t.esser)) cmp(`esser.${k}`, obj('esser')[k], v)
    for (const [k, v] of Object.entries(t.lufs)) cmp(`lufs.${k}`, obj('lufs')[k], v)
    const jb = (j.eqBands ?? []) as Record<string, unknown>[]
    if (jb.length !== t.eqBands.length) diffs.push(`eqBands length: app ${jb.length} vs TS ${t.eqBands.length}`)
    t.eqBands.forEach((band, i) => {
      for (const [k, v] of Object.entries(band)) cmp(`eqBands[${i}].${k}`, jb[i]?.[k], v)
    })
    return { preset: t.id, file: t.file, ok: diffs.length === 0, diffs }
  })
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(RUNNER)) {
    console.error(`${path.relative(REPO, RUNNER)} not found. Run \`npm run dsp:prepare\` first.`)
    process.exit(2)
  }
  const t0 = Date.now()
  let signals = [...syntheticSignals(), ...speechSignals(opts.speechSeconds)]
  if (opts.signals.length) signals = signals.filter((s) => opts.signals.includes(s.name))
  // --input files are always included, whatever --signals says
  signals.push(...opts.inputs.map((f, i) => fileSignal(`input${i + 1}`, f, 1e9)))
  if (!signals.length) {
    console.error(`no signals selected; known: ${[...syntheticSignals(), ...speechSignals(1)].map((s) => s.name).join(', ')}`)
    process.exit(2)
  }
  fs.mkdirSync(path.join(WORK, 'sig'), { recursive: true })
  fs.mkdirSync(path.join(OUT, 'input'), { recursive: true })
  const sigFiles = new Map<string, { f32: string; wav: string }>()
  for (const s of signals) {
    const f32 = path.join(WORK, 'sig', `${s.name}.f32`), wav = path.join(WORK, 'sig', `${s.name}.wav`)
    writeF32(f32, s.x)
    writeWavF32(wav, s.x)
    if (opts.wav !== 'none') writeWavF32(path.join(OUT, 'input', `${s.name}.wav`), s.x)
    sigFiles.set(s.name, { f32, wav })
  }
  console.log(`signals: ${signals.map((s) => `${s.name} (${(s.x.length / 48000).toFixed(1)} s)`).join(', ')}`)

  const presetChecks = checkPresetData()
  for (const p of presetChecks) if (!p.ok) console.log(`preset data ${p.preset}: ${p.diffs.join('; ')}`)

  const libmTables = checkLibmTables()
  console.log(`Apple libm tables vs src/lib/dsp/applelibm-data.ts: ${libmTables.status}${libmTables.detail ? ` (${libmTables.detail})` : ''}`)
  const libm = await libmStats(1_000_000)
  console.log(`Apple float libm vs port emulation: ${libm.map((l) => `${l.fn}${l.use.startsWith('whole') ? '(all)' : ''} ${l.differPct}%`).join(', ')}; vs correctly rounded: ${libm.map((l) => `${l.fn}${l.use.startsWith('whole') ? '(all)' : ''} ${l.crDifferPct.toFixed(2)}%`).join(', ')}`)
  const coeffs = await eqCoefficients(opts.randomBands)
  console.log(`EQ coefficients: presets max ${Math.max(...coeffs.presets.map((p) => p.maxUlp))} ulp; random sweep ${coeffs.sweep.identical}/${coeffs.sweep.bands} bit-identical, max ${coeffs.sweep.maxUlp} ulp`)

  let scenarios = buildScenarios()
  if (opts.only.length) scenarios = scenarios.filter((s) => opts.only.some((p) => s.id.startsWith(p)))
  const results = await pool(
    scenarios.map((s) => async () => {
      const t = Date.now()
      const rows = await runScenario(s, signals, sigFiles, opts)
      const worst = rows.reduce((w, r) => (r.metrics.maxAbsErr > w.metrics.maxAbsErr ? r : w), rows[0])
      const minSnr = Math.min(...rows.map((r) => (Number.isNaN(r.metrics.snrDb) ? Infinity : r.metrics.snrDb)))
      const ok = rows.every((r) => r.pass)
      console.log(`${ok ? 'PASS' : 'FAIL'} ${s.id.padEnd(28)} max|err| ${worst.metrics.maxAbsErr === 0 ? '0' : worst.metrics.maxAbsErr.toExponential(2)} (${worst.signal})  min SNR ${Number.isFinite(minSnr) ? minSnr.toFixed(1) : 'inf'} dB  min bit-exact ${Math.min(...rows.map((r) => r.metrics.bitExactPct)).toFixed(3)}%  ${((Date.now() - t) / 1000).toFixed(1)} s`)
      return rows
    }),
    opts.jobs,
  )
  const rows = results.flat()
  const report: Report = {
    generatedAt: new Date().toISOString(),
    manifest: fs.existsSync(path.join(NATIVE_DIR, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(NATIVE_DIR, 'manifest.json'), 'utf8')) : null,
    signals: signals.map((s) => ({ name: s.name, description: s.description, seconds: s.x.length / 48000, local: s.local })),
    presetChecks,
    libm,
    libmTables,
    coeffs,
    rows,
    scenarios: scenarios.map((s) => ({ id: s.id, stage: s.stage, title: s.title, target: s.target })),
    partial: opts.only.length > 0 || opts.signals.length > 0,
    note: opts.note,
  }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v), 1))
  if (opts.report) {
    const file = writeReport(report)
    console.log(`report: ${path.relative(REPO, file)}`)
  }
  const failed = rows.filter((r) => !r.pass && !r.informational)
  const coeffFail = coeffs.presets.some((p) => p.maxUlp !== 0 || p.nativeStages !== p.tsStages) || presetChecks.some((p) => !p.ok)
  console.log(`${rows.length - failed.length}/${rows.length} rows pass; ${((Date.now() - t0) / 1000).toFixed(0)} s; WAVs in ${path.relative(REPO, OUT)}/`)
  process.exit(failed.length || coeffFail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
