/**
 * Browser bit-identity check for the voice-FX AudioWorklet.
 *
 * Serves tools/dsp-harness/browser/ with a temporary Vite server, opens it in
 * headless Chrome (puppeteer-core with the installed Google Chrome) and
 * renders every test signal through the app's AudioWorklet
 * (src/lib/audio/voice-fx.worklet.ts via the VoiceFx wrapper) in an
 * OfflineAudioContext. The output, shifted by the documented latency
 * (VOICE_FX_LATENCY = 224 samples), is compared bit for bit with
 *   - the same TS code run in Node directly on 240-sample frames, and
 *   - the app's native library (when `npm run dsp:prepare` has been run).
 *
 *   npm run dsp:browser -- [options]
 *
 * Options
 *   --mode dev|build|both   worklet served by the Vite dev server (ES modules),
 *                           from a production `vite build` (bundled IIFE), or
 *                           both (default)
 *   --signals <a,b>         signal names (default: all)
 *   --input <file.wav>      add a recording as a signal (repeatable; local only)
 *   --speech-seconds <s>    length of each app speech excerpt (default 10)
 *   --concurrency <n>       offline renders in flight per page (default 3)
 *   --no-native             skip the comparison with the native library
 *   --no-engine             skip the real-time AudioEngine smoke test
 *   --no-report             do not rewrite the Browser section of docs/dsp/parity-report.md
 *   --chrome <path>         Chrome binary (default: $CHROME_PATH or /Applications/Google Chrome.app)
 *   --headful               show the browser window
 *
 * Jobs per signal (each one OfflineAudioContext render of a 2-channel node):
 *   pair:<a>+<b>  two presets side by side, one per channel (all 8 presets)
 *   bypass        channel 0 without a preset next to Clean Voice: must be the
 *                 input delayed by the latency, bit for bit
 *   switch        live preset changes posted to the worklet while the context
 *                 is suspended at render-quantum boundaries (ch0 Clean Voice ->
 *                 Rich & Full -> Vocal Boost; ch1 off -> Warm & Solid -> off)
 *
 * Afterwards the app's AudioEngine runs in a real-time AudioContext with
 * Chrome's fake microphone (a beep every 0.5 s) as a smoke test of the engine
 * graph: presets per channel, processed/raw recording, bypass. (Chrome's
 * --use-file-for-fake-audio-capture delivered only silence here.)
 *
 * Exit code 1 unless every channel output is bit-identical and the smoke test passes.
 */
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'
import { build, createServer, preview, type Plugin } from 'vite'
import { VoiceProcessor, findTemplate, VOICE_STREAM_LATENCY, PRESET_TEMPLATES } from '../../src/lib/dsp/index.ts'
import type { BrowserJob, BrowserJobResult, EngineSmoke, EngineSmokeResult, RunJobs } from './browser/protocol.ts'
import { compare, type Metrics } from './metrics.ts'
import { NATIVE_DIR, REPO, RUNNER, pool, runScript } from './native.ts'
import { writeBrowserSection } from './report.ts'
import { nativeLines } from './scenarios.ts'
import { FRAME, FS, fileSignal, speechSignals, syntheticSignals, type Signal } from './signals.ts'
import { readF32, writeF32 } from './wav.ts'

type Mode = 'dev' | 'build'

interface Options {
  modes: Mode[]
  signals: string[]
  inputs: string[]
  speechSeconds: number
  concurrency: number
  native: boolean
  engine: boolean
  report: boolean
  chrome: string
  headful: boolean
}

function parseArgs(argv: string[]): Options {
  const o: Options = {
    modes: ['dev', 'build'], signals: [], inputs: [], speechSeconds: 10, concurrency: 3, native: true, engine: true, report: true,
    chrome: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headful: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => argv[++i] ?? ''
    if (a === '--mode') {
      const m = v()
      o.modes = m === 'both' ? ['dev', 'build'] : m === 'dev' || m === 'build' ? [m] : (() => { throw new Error(`--mode ${m}: expected dev, build or both`) })()
    } else if (a === '--signals') o.signals.push(...v().split(',').filter(Boolean))
    else if (a === '--input') o.inputs.push(v())
    else if (a === '--speech-seconds') o.speechSeconds = Number(v())
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(v()) | 0)
    else if (a === '--no-native') o.native = false
    else if (a === '--no-engine') o.engine = false
    else if (a === '--no-report') o.report = false
    else if (a === '--chrome') o.chrome = v()
    else if (a === '--headful') o.headful = true
    else throw new Error(`unknown option ${a}`)
  }
  return o
}

const L = VOICE_STREAM_LATENCY
const PAGE_ROOT = path.join(REPO, 'tools/dsp-harness/browser')
const WORK = path.join(NATIVE_DIR, 'work', 'browser')
const MODE_LABEL: Record<Mode, string> = { dev: 'Vite dev server (worklet as ES modules)', build: '`vite build` + `vite preview` (bundled IIFE worklet)' }

// ---------------------------------------------------------------------------
// jobs

/**
 * Browser-only edge case: audio threads often run with flush-to-zero, which
 * would zero float32 subnormals (|x| < 2^-126) on the way into and out of the
 * worklet and inside the DSP. Subnormal noise, then a tiny impulse whose
 * filter tails decay through the subnormal range.
 */
function subnormalSignal(): Signal {
  const n = 2 * FS, x = new Float32Array(n)
  let s = 0x9e3779b9
  for (let i = 0; i < FS; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    x[i] = Math.fround((s / 4294967296 - 0.5) * 4e-39)
  }
  x[FS] = 1e-30
  return { name: 'subnormal', description: 'float32 subnormal noise for 1 s, then a 1e-30 impulse decaying into the subnormal range, 2 s', x, local: false }
}

function buildJobs(sig: Signal): BrowserJob[] {
  const ids = PRESET_TEMPLATES.map((t) => t.id)
  const jobs: BrowserJob[] = []
  for (let i = 0; i < ids.length; i += 2) {
    const pair = [ids[i], ids[i + 1] ?? null]
    jobs.push({ id: `${sig.name}/pair:${pair.join('+')}`, signal: sig.name, presets: pair, switches: [] })
  }
  jobs.push({ id: `${sig.name}/bypass`, signal: sig.name, presets: [null, 'clean'], switches: [] })
  const q = (frac: number) => 128 * Math.floor((frac * sig.x.length) / 128)
  const [t1, t2] = [q(1 / 3), q(2 / 3)]
  if (t1 > 0 && Math.floor(t2 / FRAME) > Math.floor(t1 / FRAME)) {
    jobs.push({
      id: `${sig.name}/switch`, signal: sig.name, presets: ['clean', null],
      switches: [
        { at: t1, channel: 0, preset: 'rich-full' }, { at: t1, channel: 1, preset: 'warm-solid' },
        { at: t2, channel: 0, preset: 'boost' }, { at: t2, channel: 1, preset: null },
      ],
    })
  }
  return jobs
}

interface Segment { frame: number; preset: string | null }

/** Per-channel preset timeline in frames; switch positions come from what the processor reported. */
function segmentsFor(job: BrowserJob, c: number, applied?: BrowserJobResult['applied']): Segment[] {
  const segs: Segment[] = [{ frame: 0, preset: job.presets[c] ?? null }]
  for (const s of job.switches.filter((s) => s.channel === c).sort((a, b) => a.at - b.at)) {
    const consumed = applied?.find((a) => a.at === s.at && a.channel === c)?.consumed ?? s.at
    segs.push({ frame: Math.floor(consumed / FRAME), preset: s.preset })
  }
  return segs
}
const segKey = (segs: Segment[]) => segs.map((s) => `${s.frame}:${s.preset ?? '-'}`).join(',')

/**
 * The reference: the TS DSP run directly on 240-sample frames, the way the
 * parity harness runs it, with the same processor lifecycle as one worklet
 * channel (one VoiceProcessor, created on the first preset and reconfigured on
 * each later one; frames without a preset copied through).
 */
function referenceChannel(x: Float32Array, segs: Segment[]): Float32Array {
  const y = new Float32Array(x.length)
  const out = new Float32Array(FRAME)
  let vp: VoiceProcessor | null = null
  let active: string | null = null
  let s = 0
  for (let k = 0; (k + 1) * FRAME <= x.length; k++) {
    while (s < segs.length && segs[s].frame <= k) {
      active = segs[s].preset
      if (active) (vp ??= new VoiceProcessor()).configure(findTemplate(active)!)
      s++
    }
    const frame = x.subarray(k * FRAME, (k + 1) * FRAME)
    if (active && vp) {
      vp.processFrame(frame, out)
      y.set(out, k * FRAME)
    } else y.set(frame, k * FRAME)
  }
  return y
}

/** The same timeline through the native library: one fresh library load (runner process) per channel. */
async function nativeChannel(sig: Signal, sigFile: string, segs: Segment[], tag: string): Promise<{ y: Float32Array | null; error?: string }> {
  const total = Math.floor(sig.x.length / FRAME)
  const lines = ['init .']
  const parts: { from: number; to: number; file: string | null }[] = []
  segs.forEach((seg, i) => {
    const to = Math.min(total, segs[i + 1]?.frame ?? total)
    if (seg.preset) lines.push(...nativeLines(['preset', seg.preset, 'ios']))
    const from = Math.min(seg.frame, total)
    if (to <= from) return
    const file = seg.preset ? path.join(WORK, `${tag}.${i}.f32`) : null
    if (file) lines.push(`process ${sigFile} ${file} - ${from} ${to - from}`)
    parts.push({ from, to, file })
  })
  const r = await runScript(lines)
  if (r.errors.length) return { y: null, error: r.errors.join('; ') }
  const y = new Float32Array(sig.x.length)
  for (const p of parts) {
    if (!p.file) {
      y.set(sig.x.subarray(p.from * FRAME, p.to * FRAME), p.from * FRAME)
      continue
    }
    y.set(readF32(p.file).subarray(0, (p.to - p.from) * FRAME), p.from * FRAME)
    fs.rmSync(p.file, { force: true })
  }
  return { y }
}

// ---------------------------------------------------------------------------
// servers

const signalStore = new Map<string, Float32Array>()
const resultStore = new Map<string, Float32Array>()

function middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const url = req.url ?? ''
  const sig = /^\/__dsp\/signal\/([^/?]+)/.exec(url)
  if (req.method === 'GET' && sig) {
    const x = signalStore.get(decodeURIComponent(sig[1]))
    if (!x) {
      res.statusCode = 404
      res.end('unknown signal')
      return
    }
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('cache-control', 'no-store')
    res.end(Buffer.from(x.buffer, x.byteOffset, x.byteLength))
    return
  }
  const result = /^\/__dsp\/result\/([^/?]+)\/([^/?]+)/.exec(url)
  if (req.method === 'POST' && result) {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const b = Buffer.concat(chunks)
      const y = new Float32Array(b.length >>> 2)
      new Uint8Array(y.buffer).set(b.subarray(0, y.length * 4))
      resultStore.set(`${decodeURIComponent(result[1])}/${decodeURIComponent(result[2])}`, y)
      res.end('ok')
    })
    return
  }
  next()
}

const harnessPlugin: Plugin = {
  name: 'dsp-browser-check',
  configureServer: (server) => void server.middlewares.use(middleware),
  configurePreviewServer: (server) => void server.middlewares.use(middleware),
}

interface Served { mode: Mode; url: string; close: () => Promise<void> }

async function serve(mode: Mode): Promise<Served> {
  const common = {
    root: PAGE_ROOT,
    configFile: false as const,
    logLevel: 'warn' as const,
    cacheDir: path.join(NATIVE_DIR, 'vite-cache'),
    plugins: [harnessPlugin],
  }
  if (mode === 'dev') {
    const server = await createServer({ ...common, server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [REPO] } } })
    await server.listen()
    const url = server.resolvedUrls?.local[0]
    if (!url) throw new Error('dev server has no URL')
    return { mode, url, close: () => server.close() }
  }
  const outDir = path.join(NATIVE_DIR, 'browser-dist')
  await build({ ...common, build: { outDir, emptyOutDir: true, reportCompressedSize: false } })
  const worklets = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => /^voice-fx\.worklet-.*\.js$/.test(f))
  if (worklets.length !== 1) throw new Error(`vite build emitted ${worklets.length} voice-fx worklet files`)
  const server = await preview({ ...common, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } })
  const url = server.resolvedUrls?.local[0]
  if (!url) throw new Error('preview server has no URL')
  return { mode, url, close: () => new Promise<void>((r) => server.httpServer.close(() => r())) }
}

// ---------------------------------------------------------------------------

interface ChannelCheck {
  mode: Mode
  job: string
  kind: string
  signal: string
  channel: number
  preset: string
  /** First L output samples all +0. */
  zeroPrefix: boolean
  vsNode: Metrics
  vsNative: Metrics | null
  nodeVsNative: Metrics | null
  notes: string[]
}

const exact = (m: Metrics | null) => m !== null && m.maxAbsErr === 0 && m.bitExactPct === 100
const fmtErr = (x: number) => (x === 0 ? '0' : Number.isFinite(x) ? x.toExponential(2) : String(x))

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let signals: Signal[] = [...syntheticSignals(), subnormalSignal(), ...speechSignals(opts.speechSeconds), ...opts.inputs.map((f, i) => fileSignal(`input${i + 1}_${path.basename(f, path.extname(f))}`, f, 600))]
  if (opts.signals.length) signals = signals.filter((s) => opts.signals.includes(s.name))
  if (!signals.length) throw new Error('no signals selected')
  const useNative = opts.native && fs.existsSync(RUNNER)
  if (opts.native && !useNative) console.log(`native library comparison skipped: ${path.relative(REPO, RUNNER)} not found (run \`npm run dsp:prepare\`)`)
  fs.mkdirSync(WORK, { recursive: true })

  console.log(`modes: ${opts.modes.join(', ')}; ${signals.length} signals; latency ${L} samples`)
  const served: Served[] = []
  let browser: Browser | null = null
  const checks: ChannelCheck[] = []
  const pageResults: { mode: Mode; r: BrowserJobResult }[] = []
  let chromeVersion = ''
  let smoke: EngineSmokeResult | null = null
  try {
    for (const m of opts.modes) {
      served.push(await serve(m))
      console.log(`${m}: ${served.at(-1)!.url}`)
    }
    browser = await puppeteer.launch({
      executablePath: opts.chrome,
      headless: !opts.headful,
      protocolTimeout: 1_800_000,
      args: [
        '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ],
    })
    chromeVersion = await browser.version()
    console.log(`browser: ${chromeVersion}`)
    const pages = await Promise.all(
      served.map(async (s) => {
        const page = await browser!.newPage()
        page.on('console', (msg) => {
          if (msg.type() === 'error' || msg.type() === 'warn') console.log(`[${s.mode}] console.${msg.type()}: ${msg.text()}`)
        })
        page.on('pageerror', (e) => console.log(`[${s.mode}] page error: ${(e as Error).message}`))
        await page.goto(s.url, { waitUntil: 'load' })
        await page.waitForFunction(() => typeof (globalThis as unknown as { runJobs?: unknown }).runJobs === 'function', { timeout: 30_000 })
        return { mode: s.mode, page }
      }),
    )

    for (const sig of signals) {
      const t0 = Date.now()
      signalStore.clear()
      signalStore.set(sig.name, sig.x)
      const jobs = buildJobs(sig)
      const byMode = await Promise.all(
        pages.map(async ({ mode, page }) => ({
          mode,
          results: await page.evaluate((j: BrowserJob[], m: string, n: number) => (globalThis as unknown as { runJobs: RunJobs }).runJobs(j, m, n), jobs, mode, opts.concurrency),
        })),
      )
      const sigFile = path.join(WORK, `${sig.name.replace(/[^\w.-]+/g, '_')}.f32`)
      if (useNative) writeF32(sigFile, sig.x)
      const refCache = new Map<string, Float32Array>()
      const nativeCache = new Map<string, Promise<{ y: Float32Array | null; error?: string }>>()
      const reference = (segs: Segment[]) => {
        const k = segKey(segs)
        let y = refCache.get(k)
        if (!y) refCache.set(k, (y = referenceChannel(sig.x, segs)))
        return y
      }
      // Native runs for every distinct timeline, in parallel.
      if (useNative) {
        const timelines = new Map<string, Segment[]>()
        for (const { results } of byMode) {
          for (const r of results) {
            const job = jobs.find((j) => j.id === r.id)!
            job.presets.forEach((_, c) => {
              const segs = segmentsFor(job, c, r.applied)
              if (segs.some((s) => s.preset)) timelines.set(segKey(segs), segs)
            })
          }
        }
        const list = [...timelines.entries()]
        const outs = await pool(list.map(([k, segs], i) => () => nativeChannel(sig, sigFile, segs, `${sig.name.replace(/[^\w.-]+/g, '_')}.${i}`).then((r) => [k, r] as const)), Math.max(2, os.cpus().length - 2))
        for (const [k, r] of outs) nativeCache.set(k, Promise.resolve(r))
      }

      for (const { mode, results } of byMode) {
        for (const r of results) {
          pageResults.push({ mode, r })
          const job = jobs.find((j) => j.id === r.id)!
          const kind = job.id.slice(sig.name.length + 1).split(':')[0]
          const raw = resultStore.get(`${mode}/${job.id}`)
          resultStore.delete(`${mode}/${job.id}`)
          if (r.error) console.log(`[${mode}] ${job.id}: ${r.error}`)
          for (let c = 0; c < job.presets.length; c++) {
            const segs = segmentsFor(job, c, r.applied)
            const ref = reference(segs)
            const notes: string[] = []
            if (r.error) notes.push(r.error)
            for (const s of job.switches.filter((s) => s.channel === c)) {
              const a = r.applied.find((x) => x.at === s.at && x.channel === c)
              if (!a) notes.push(`switch at ${s.at} not acknowledged`)
              else if (a.consumed !== s.at) notes.push(`switch planned at sample ${s.at} applied after ${a.consumed}`)
            }
            let got: Float32Array = new Float32Array(0), zeroPrefix = false
            if (raw && r.length) {
              const ch = raw.subarray(c * r.length, (c + 1) * r.length)
              got = ch.subarray(L, L + sig.x.length)
              zeroPrefix = ch.subarray(0, L).every((v) => Object.is(v, 0))
            } else notes.push('no output received')
            const vsNode = compare(ref, got)
            let vsNative: Metrics | null = null, nodeVsNative: Metrics | null = null
            if (useNative && segs.some((s) => s.preset)) {
              const n = await nativeCache.get(segKey(segs))!
              if (n.y) {
                vsNative = compare(n.y, got)
                nodeVsNative = compare(n.y, ref)
              } else notes.push(`native: ${n.error}`)
            } else if (useNative) {
              vsNative = compare(sig.x, got) // pass-through: the native reference is the input itself
              nodeVsNative = compare(sig.x, ref)
            }
            const preset = segs.map((s) => s.preset ?? 'off').join('→')
            checks.push({ mode, job: job.id, kind, signal: sig.name, channel: c, preset, zeroPrefix, vsNode, vsNative, nodeVsNative, notes })
          }
        }
      }
      const mine = checks.filter((k) => k.signal === sig.name)
      const ok = mine.filter((k) => exact(k.vsNode) && k.zeroPrefix && (!useNative || exact(k.vsNative))).length
      console.log(`${sig.name.padEnd(16)} ${ok}/${mine.length} channel outputs bit-identical${useNative ? ' (vs Node TS and vs native)' : ' (vs Node TS)'}  ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      for (const k of mine.filter((k) => !(exact(k.vsNode) && k.zeroPrefix && (!useNative || exact(k.vsNative))))) {
        console.log(`  ✗ [${k.mode}] ${k.job} ch${k.channel} (${k.preset}): vs Node max ${fmtErr(k.vsNode.maxAbsErr)}, ${k.vsNode.bitExactPct.toFixed(3)}% bit-exact, first diff ${k.vsNode.firstDiff}, lag ${k.vsNode.bestLag}${k.vsNative ? `; vs native max ${fmtErr(k.vsNative.maxAbsErr)}` : ''}${k.zeroPrefix ? '' : '; latency prefix not zero'}${k.notes.length ? `; ${k.notes.join('; ')}` : ''}`)
      }
      if (useNative) fs.rmSync(sigFile, { force: true })
    }

    if (opts.engine) {
      const target = pages.find((p) => p.mode === 'build') ?? pages[0]
      smoke = await target.page.evaluate(() => (globalThis as unknown as { engineSmoke: EngineSmoke }).engineSmoke())
      console.log(`engine smoke test (${target.mode}): ${smoke.ok ? 'ok' : 'FAILED'}`)
      for (const st of smoke.steps) console.log(`  ${st.ok ? '✓' : '✗'} ${st.step}: ${st.detail}`)
    }
  } finally {
    await browser?.close()
    for (const s of served) await s.close().catch(() => {})
  }

  const allOk = checks.length > 0 && checks.every((k) => exact(k.vsNode) && k.zeroPrefix && k.notes.length === 0 && (!useNative || exact(k.vsNative))) && (smoke?.ok ?? true)
  const md = renderMarkdown({ opts, signals, checks, pageResults, chromeVersion, useNative, smoke })
  if (opts.report) {
    const partial = opts.signals.length > 0 || opts.inputs.length > 0 || opts.modes.length < 2
    if (partial) {
      const file = path.join(NATIVE_DIR, 'out', 'browser-report.partial.md')
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, `## Browser\n\n${md}\n`)
      console.log(`partial run: wrote ${path.relative(REPO, file)} (the committed report is only rewritten by a full run)`)
    } else console.log(`wrote the Browser section of ${path.relative(REPO, writeBrowserSection(md))}`)
  }
  console.log(allOk ? `all ${checks.length} channel outputs bit-identical` : `${checks.filter((k) => !(exact(k.vsNode) && k.zeroPrefix && k.notes.length === 0 && (!useNative || exact(k.vsNative)))).length} of ${checks.length} channel outputs differ`)
  process.exitCode = allOk ? 0 : 1
}

// ---------------------------------------------------------------------------
// report

function renderMarkdown(a: { opts: Options; signals: Signal[]; checks: ChannelCheck[]; pageResults: { mode: Mode; r: BrowserJobResult }[]; chromeVersion: string; useNative: boolean; smoke: EngineSmokeResult | null }): string {
  const { opts, signals, checks, pageResults, chromeVersion, useNative, smoke } = a
  const L2: string[] = []
  const now = new Date().toISOString().replace('T', ' ').slice(0, 16)
  const ok = (k: ChannelCheck) => exact(k.vsNode) && k.zeroPrefix && k.notes.length === 0
  L2.push(
    `Generated by \`npm run dsp:browser\` on ${now} UTC with ${chromeVersion.replace(/^(Headless)?Chrome\//, 'Chrome ')} (headless, puppeteer-core), ${os.platform()} ${os.arch()}.`,
    '',
    'The app\'s voice-FX AudioWorklet (`src/lib/audio/voice-fx.worklet.ts`, loaded through the same `VoiceFx` wrapper the app uses) renders each signal in an `OfflineAudioContext`. The worklet regroups Web Audio\'s 128-sample render quanta into the library\'s 240-sample frames (`src/lib/dsp/stream.ts`), which delays every channel by ' +
      `**${L} samples (${((1000 * L) / FS).toFixed(2)} ms at 48 kHz)**: the smallest delay at which the output never runs dry, 240 − gcd(128, 240). ` +
      'Each channel output must start with exactly that many zero samples and then match, bit for bit, the same TS code run in Node on 240-sample frames' +
      (useNative ? ', and the app\'s native library run on the same input (one fresh library load per channel).' : '.'),
    '',
    'Jobs per signal, each a 2-channel render: the 8 presets in pairs (one per channel); **bypass** (channel 0 without a preset, which must be the input delayed by the latency, next to Clean Voice); **switch** (live changes posted to the worklet port while the context is suspended at render-quantum boundaries: channel 0 Clean Voice → Rich & Full → Vocal Boost, channel 1 off → Warm & Solid → off).',
    '',
  )
  const head = useNative
    ? '| worklet served by | renders | channel outputs | latency reported | zero prefix | bit-identical vs Node TS | bit-identical vs native library | worst max\\|err\\| | summed render time |'
    : '| worklet served by | renders | channel outputs | latency reported | zero prefix | bit-identical vs Node TS | worst max\\|err\\| | summed render time |'
  L2.push(head, useNative ? '|---|---:|---:|---|---:|---:|---:|---:|---:|' : '|---|---:|---:|---|---:|---:|---:|---:|')
  for (const mode of opts.modes) {
    const ks = checks.filter((k) => k.mode === mode)
    const rs = pageResults.filter((p) => p.mode === mode).map((p) => p.r)
    const lat = [...new Set(rs.map((r) => (r.latency === null ? 'n/a' : `${r.latency} (quantum ${r.blockSize})`)))].join(', ')
    const worst = Math.max(0, ...ks.map((k) => Math.max(k.vsNode.maxAbsErr, k.vsNative?.maxAbsErr ?? 0)))
    const audioSec = rs.reduce((s, r) => s + r.length / FS, 0)
    const ms = rs.reduce((s, r) => s + r.ms, 0)
    const cells = [
      MODE_LABEL[mode], String(rs.length), String(ks.length), lat,
      `${ks.filter((k) => k.zeroPrefix).length}/${ks.length}`,
      `${ks.filter(ok).length}/${ks.length}`,
      ...(useNative ? [`${ks.filter((k) => exact(k.vsNative)).length}/${ks.length}`] : []),
      fmtErr(worst),
      `${(ms / 1000).toFixed(1)} s for ${audioSec.toFixed(0)} s of 2-channel audio`,
    ]
    L2.push(`| ${cells.join(' | ')} |`)
  }
  if (useNative) {
    const refs = checks.filter((k) => k.mode === opts.modes[0])
    L2.push('', `Node TS vs native library on the same timelines: ${refs.filter((k) => exact(k.nodeVsNative)).length}/${refs.length} channel outputs bit-identical.`)
  }
  L2.push('', '| signal | seconds | channel outputs (all builds) | bit-identical | worst max\\|err\\| |', '|---|---:|---:|---:|---:|')
  for (const s of signals) {
    const ks = checks.filter((k) => k.signal === s.name)
    const good = ks.filter((k) => ok(k) && (!useNative || exact(k.vsNative))).length
    const worst = Math.max(0, ...ks.map((k) => Math.max(k.vsNode.maxAbsErr, k.vsNative?.maxAbsErr ?? 0)))
    L2.push(`| ${s.name}${s.local ? ' (local)' : ''} | ${(s.x.length / FS).toFixed(1)} | ${ks.length} | ${good}/${ks.length} | ${fmtErr(worst)} |`)
  }
  const bad = checks.filter((k) => !(ok(k) && (!useNative || exact(k.vsNative))))
  if (bad.length) {
    L2.push('', 'Differences:', '')
    for (const k of bad.slice(0, 30)) {
      L2.push(`- [${k.mode}] ${k.job} channel ${k.channel} (${k.preset}): vs Node max|err| ${fmtErr(k.vsNode.maxAbsErr)}, ${k.vsNode.bitExactPct.toFixed(3)} % bit-exact, first difference at sample ${k.vsNode.firstDiff}, best lag ${k.vsNode.bestLag}${k.vsNative ? `; vs native max|err| ${fmtErr(k.vsNative.maxAbsErr)}` : ''}${k.zeroPrefix ? '' : '; the latency prefix is not all zeros'}${k.notes.length ? `; ${k.notes.join('; ')}` : ''}`)
    }
  } else {
    L2.push('', `**All ${checks.length} channel outputs are bit-identical** to the Node run${useNative ? ' and to the native library' : ''}, after the ${L}-sample latency, in every build.`)
  }
  if (smoke) {
    L2.push('', `Real-time smoke test of the app's \`AudioEngine\` (production build, real-time \`AudioContext\`, Chrome's fake microphone, a beep every 0.5 s): **${smoke.ok ? 'passed' : 'FAILED'}**. It is not a bit-identity check, since live capture has no fixed frame phase.`, '')
    for (const st of smoke.steps) L2.push(`- ${st.ok ? '✓' : '✗'} ${st.step}: ${st.detail.replace(/\|/g, '\\|')}`)
  }
  L2.push('', 'Reproduce: `npm run dsp:browser` (needs Google Chrome; the native comparison needs `npm run dsp:prepare`). "(local)" signals are the app\'s speech samples, read from the installed app and never committed.')
  return L2.join('\n')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
