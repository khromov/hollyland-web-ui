/** Writes docs/dsp/parity-report.md (or a partial report under .dsp-native/out/). */
import fs from 'node:fs'
import path from 'node:path'
import type { Metrics } from './metrics.ts'
import { NATIVE_DIR, REPO } from './native.ts'
import type { Target } from './scenarios.ts'

export interface Row {
  scenario: string
  stage: string
  title: string
  signal: string
  local: boolean
  target: Target
  metrics: Metrics
  /** The port switched to correctly rounded libm (`setLibm('cr')`) against the native library with its float libm rebound to correctly rounded functions (diagnostic). */
  metricsCr: Metrics
  pass: boolean
  informational: boolean
  notes: string[]
}

export interface CoeffRow {
  preset: string
  name: string
  nativeStages: number
  tsStages: number
  coefficients: number
  identical: number
  maxUlp: number
  where: string[]
}

export interface SweepResult {
  bands: number
  identical: number
  maxUlp: number
  /** Against the library with correctly rounded float libm. */
  identicalCr: number
  maxUlpCr: number
  byType: { type: number; n: number; identical: number; maxUlp: number }[]
  worst: { type: number; gain: number; f0: number; q: number; maxUlp: number }[]
}

export interface LibmStat {
  fn: string
  use: string
  n: number
  /** Apple's libm vs the port's emulation (src/lib/dsp/applelibm.ts). */
  differPct: number
  maxUlp: number
  /** Apple's libm vs correctly rounded results (why the emulation is needed). */
  crDifferPct: number
  crMaxUlp: number
}

export interface PresetCheck {
  preset: string
  file: string
  ok: boolean
  diffs: string[]
}

export interface Report {
  generatedAt: string
  manifest: Record<string, string> | null
  signals: { name: string; description: string; seconds: number; local: boolean }[]
  presetChecks: PresetCheck[]
  libm: LibmStat[]
  /** The committed applelibm-data.ts against the tables read out of this Mac's libsystem_m. */
  libmTables: { status: 'match' | 'differ' | 'unavailable'; detail: string }
  coeffs: { presets: CoeffRow[]; sweep: SweepResult }
  rows: Row[]
  scenarios: { id: string; stage: string; title: string; target: Target }[]
  partial: boolean
  note: string | null
}

export const REPORT_FILE = path.join(REPO, 'docs/dsp/parity-report.md')
const START = '<!-- changelog:start -->'
const END = '<!-- changelog:end -->'
const BROWSER_START = '<!-- browser:start -->'
const BROWSER_END = '<!-- browser:end -->'

const err = (x: number) => (x === 0 ? '0' : Number.isFinite(x) ? x.toExponential(2) : '∞')
const db = (x: number) => (Number.isNaN(x) ? 'n/a' : x === Infinity ? '∞' : x === -Infinity ? '−∞' : x.toFixed(1).replace('-', '−'))
const pct = (x: number) => (x === 100 ? '100' : x.toFixed(3))
const tgt = (t: Target) => `max\\|err\\| ≤ ${t.maxAbsErr.toExponential(0)}${t.snrDb !== undefined ? `, SNR ≥ ${t.snrDb} dB` : ''}`
const FILTER = ['', 'low shelf', 'high shelf', 'peaking', 'notch', 'low pass', 'high pass', 'band pass']
const LIBM_NAMES: Record<string, string> = { pow10f: 'powf(10, x)', sqf: 'powf(x, 2)', cubef: 'powf(x, 3)' }

const STAGES: [stage: string, title: string][] = [
  ['eq', 'EQ only'],
  ['compressor', 'Compressor only'],
  ['deesser', 'De-esser only'],
  ['distortion', 'Distortion / exciter only'],
  ['lufs', 'LUFS / loudness gain only'],
  ['pipe', 'Pipe params (vocalLevelDb, channelEnable)'],
  ['full', 'Full real-time chain per preset (iOS app behaviour)'],
  ['full-android', 'Full chain with the template de-esser range (Android library behaviour)'],
  ['offline', 'Offline render (cmsis_process_wav: LUFS gain + chain)'],
  ['sequence', 'Live reconfiguration sequences'],
  ['fuzz', 'Random configurations of every stage (informational)'],
]

export interface StageSummary {
  stage: string
  scenarios: number
  rows: number
  maxAbsErr: number
  worstRmsDbfs: number
  minSnrDb: number
  minBitExactPct: number
  crMaxAbsErr: number
  crMinBitExactPct: number
  pass: boolean
  informational: boolean
  worst: Row | null
}

export function summarise(rows: Row[]): StageSummary {
  let worst: Row | null = null
  for (const r of rows) if (r.metrics.maxAbsErr > 0 && (!worst || r.metrics.maxAbsErr > worst.metrics.maxAbsErr)) worst = r
  return {
    stage: rows[0]?.stage ?? '',
    scenarios: new Set(rows.map((r) => r.scenario)).size,
    rows: rows.length,
    maxAbsErr: Math.max(...rows.map((r) => r.metrics.maxAbsErr)),
    worstRmsDbfs: Math.max(...rows.map((r) => r.metrics.rmsErrDbfs)),
    minSnrDb: Math.min(...rows.map((r) => (Number.isNaN(r.metrics.snrDb) ? Infinity : r.metrics.snrDb))),
    minBitExactPct: Math.min(...rows.map((r) => r.metrics.bitExactPct)),
    crMaxAbsErr: Math.max(...rows.map((r) => r.metricsCr.maxAbsErr)),
    crMinBitExactPct: Math.min(...rows.map((r) => r.metricsCr.bitExactPct)),
    pass: rows.every((r) => r.pass),
    informational: rows.every((r) => r.informational),
    worst,
  }
}

function signalTable(rows: Row[]): string[] {
  const out = [
    '| signal | max\\|err\\| | RMS err (dBFS) | SNR (dB) | bit-exact % | lag | met | CR libm: max\\|err\\| | CR libm: bit-exact % |',
    '|---|---:|---:|---:|---:|---:|:-:|---:|---:|',
  ]
  for (const r of rows) {
    const m = r.metrics, c = r.metricsCr
    out.push(`| ${r.signal} | ${err(m.maxAbsErr)} | ${db(m.rmsErrDbfs)} | ${db(m.snrDb)} | ${pct(m.bitExactPct)} | ${m.bestLag} | ${r.pass ? '✓' : r.informational ? '–' : '✗'} | ${err(c.maxAbsErr)} | ${pct(c.bitExactPct)} |`)
  }
  const notes = [...new Set(rows.flatMap((r) => r.notes.map((n) => `${r.signal}: ${n}`)))]
  if (notes.length) out.push('', ...notes.slice(0, 8).map((n) => `- ${n}`))
  return out
}

function readBlock(start: string, end: string): string {
  if (!fs.existsSync(REPORT_FILE)) return ''
  const text = fs.readFileSync(REPORT_FILE, 'utf8')
  const a = text.indexOf(start), b = text.indexOf(end)
  return a >= 0 && b > a ? text.slice(a + start.length, b).trim() : ''
}
const readChangelog = () => readBlock(START, END)

/**
 * Replaces the "Browser" section (written by `npm run dsp:browser`) in the
 * committed report, inserting it before the changelog if it is missing.
 * writeReport keeps it as it is.
 */
export function writeBrowserSection(markdown: string): string {
  const block = `${BROWSER_START}\n${markdown.trim()}\n${BROWSER_END}`
  let text = fs.existsSync(REPORT_FILE) ? fs.readFileSync(REPORT_FILE, 'utf8') : '# DSP parity report: HollyAudio native library vs TypeScript port\n\n## Changelog\n'
  const a = text.indexOf(BROWSER_START), b = text.indexOf(BROWSER_END)
  if (a >= 0 && b > a) text = text.slice(0, a) + block + text.slice(b + BROWSER_END.length)
  else {
    const at = text.indexOf('## Changelog')
    const section = `## Browser\n\n${block}\n\n`
    text = at >= 0 ? text.slice(0, at) + section + text.slice(at) : `${text.trimEnd()}\n\n${section}`
  }
  fs.writeFileSync(REPORT_FILE, text)
  return REPORT_FILE
}

function summaryRow(label: string, s: StageSummary, target: Target): string {
  const met = s.informational ? '–' : s.pass ? '✓' : '✗'
  return `| ${label} | ${s.scenarios > 1 ? `${s.scenarios} × ${s.rows / s.scenarios}` : s.rows} | ${err(s.maxAbsErr)} | ${db(s.worstRmsDbfs)} | ${db(s.minSnrDb)} | ${pct(s.minBitExactPct)} | ${s.informational ? 'informational' : tgt(target)} | ${met} | ${err(s.crMaxAbsErr)} | ${pct(s.crMinBitExactPct)} |`
}

export function writeReport(rep: Report): string {
  const byStage = new Map<string, Row[]>()
  for (const r of rep.rows) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r])
  const byScenario = new Map<string, Row[]>()
  for (const r of rep.rows) byScenario.set(r.scenario, [...(byScenario.get(r.scenario) ?? []), r])
  const L: string[] = []
  const sw = rep.coeffs.sweep
  const cp = rep.coeffs.presets
  const coefOk = cp.every((p) => p.maxUlp === 0 && p.nativeStages === p.tsStages)

  L.push('# DSP parity report: HollyAudio native library vs TypeScript port', '')
  L.push(`Generated by \`npm run dsp:compare\` on ${rep.generatedAt.replace('T', ' ').slice(0, 16)} UTC. Everything above the Browser section is regenerated on every run; the Browser section (\`npm run dsp:browser\`) and the changelog are kept.`, '')
  L.push('Reproduce: `npm run dsp:prepare` (once; needs larkSound.app installed on an Apple Silicon Mac), then `npm run dsp:compare`. Listen to native output, TS output and their difference in `.dsp-native/out/<scenario>/`.', '')

  // summary
  L.push('## Summary', '')
  L.push('The first columns compare the port, with its default emulation of Apple\'s arm64 float libm (`src/lib/dsp/applelibm.ts`), against the library exactly as it ships, running on Apple\'s libm. The two **CR libm** columns are a diagnostic that takes libm out of the picture: the same library with its float libm imports rebound to correctly rounded functions, against the port switched to correctly rounded libm (`setLibm(\'cr\')`). A row that is clean there but not in the first columns would point at the libm emulation; one that differs in both, at the DSP port.', '')
  L.push('| stage | scenarios × signals | worst max\\|err\\| | worst RMS err (dBFS) | min SNR (dB) | min bit-exact % | target | met | CR libm: max\\|err\\| | CR libm: min bit-exact % |', '|---|---:|---:|---:|---:|---:|---|:-:|---:|---:|')
  const idPct = (100 * cp.reduce((s, p) => s + p.identical, 0)) / Math.max(1, cp.reduce((s, p) => s + p.coefficients, 0))
  L.push(`| EQ coefficients, 8 presets | ${cp.length} | ${Math.max(...cp.map((p) => p.maxUlp))} ulp | | | ${pct(idPct)} | bit-identical (0 ulp) | ${coefOk ? '✓' : '✗'} | | |`)
  L.push(`| EQ coefficients, random single bands | ${sw.bands} | ${sw.maxUlp} ulp | | | ${pct((100 * sw.identical) / Math.max(1, sw.bands))} of bands | informational | – | ${sw.maxUlpCr} ulp | ${pct((100 * sw.identicalCr) / Math.max(1, sw.bands))} of bands |`)
  for (const [stage, title] of STAGES) {
    const rows = byStage.get(stage)
    if (!rows) continue
    if (stage === 'full') {
      for (const [id, rs] of byScenario) if (rs[0].stage === 'full') L.push(summaryRow(id, summarise(rs), rs[0].target))
      continue
    }
    L.push(summaryRow(title, summarise(rows), rows[0].target))
  }
  const failing = rep.rows.filter((r) => !r.pass && !r.informational)
  const total = rep.rows.filter((r) => !r.informational).length
  L.push('', failing.length ? `**${failing.length} of ${total} target rows miss their target** (see [Remaining differences](#remaining-differences)).` : `All ${total} target rows meet their targets.`, '')
  L.push('max\\|err\\| is the largest absolute sample difference (full scale = 1.0); RMS err is the RMS of the difference signal in dBFS; SNR is 10·log10(Σnative² / Σ(ts − native)²) (∞ when identical, n/a when the native output is silent); bit-exact % counts samples whose float32 bit patterns are identical; lag is the offset of the TS output that fits the native output best (0 = aligned).', '')

  // remaining differences
  L.push('## Remaining differences', '')
  const libmOnly = failing.filter((r) => r.metricsCr.maxAbsErr === 0)
  const portIssues = failing.filter((r) => r.metricsCr.maxAbsErr !== 0)
  const crRows = rep.rows.filter((r) => r.metricsCr.maxAbsErr !== 0)
  const libmExact = rep.libm.every((l) => l.differPct === 0)
  const libmCalls = rep.libm.reduce((s, l) => s + l.n, 0)
  L.push(crRows.length === 0
    ? `With correctly rounded libm on both sides, **every row (${rep.rows.length}, including the informational ones) is bit-identical**, and ${sw.identicalCr} of ${sw.bands} random EQ bands give bit-identical coefficients: the DSP arithmetic of the port matches the library independently of libm.`
    : `${crRows.length} rows differ even with correctly rounded libm on both sides: ${[...new Set(crRows.map((r) => r.scenario))].join(', ')}. Those are DSP port issues to investigate.`, '')
  if (failing.length) {
    L.push('| scenario | signal | max\\|err\\| | SNR (dB) | bit-exact % | CR libm max\\|err\\| | cause |', '|---|---|---:|---:|---:|---:|---|')
    for (const r of failing) L.push(`| ${r.scenario} | ${r.signal} | ${err(r.metrics.maxAbsErr)} | ${db(r.metrics.snrDb)} | ${pct(r.metrics.bitExactPct)} | ${err(r.metricsCr.maxAbsErr)} | ${r.metricsCr.maxAbsErr === 0 ? 'libm emulation' : 'port'} |`)
    L.push('')
  }
  L.push(`Rows missing a target because of libm: ${libmOnly.length}; because of the DSP port: ${portIssues.length}.`, '')
  L.push(`### Apple float libm emulation`, '')
  L.push(
    'Apple\'s float `powf`, `sinf`, `cosf`, `expf`, `logf` and `log10f` are not correctly rounded: each is a short table-driven routine that evaluates in double precision with fused multiply-adds and rounds once at the end, and about 0.6–1.3% of its results are one ulp away from `Math.fround(Math.fn(x))`. ' +
      'Where the DSP calls one per sample (the airfresh soft clipper, the LUFS gain of the offline render) such a one-ulp step is enough to decorrelate the float32 rounding noise of the high-Q, low-frequency EQ sections that follow, so earlier versions of the port, which used correctly rounded libm, missed the targets there (up to 1.7e-5 on the exciter, 74 dB SNR offline). ' +
      'The port now reproduces each routine instruction for instruction from the disassembly of libsystem_m (same tables, same polynomial, same FMA order, exact `fma64`), so its double intermediate and float result are the library\'s.',
    '',
  )
  const lt = rep.libmTables
  L.push(
    (libmExact
      ? `Check against this Mac's libm: **${libmCalls.toLocaleString('en-US')} calls, every result bit-identical** to the emulation.`
      : `Check against this Mac's libm: **some results differ from the emulation** (table below). Apple may have changed its libm; re-derive \`src/lib/dsp/applelibm.ts\` from the new disassembly.`) +
      ` Tables: ${lt.status === 'match' ? 'the committed `src/lib/dsp/applelibm-data.ts` is identical to what `.dsp-native/bin/libm-tables` reads out of this Mac\'s libsystem_m' : lt.status === 'differ' ? `**${lt.detail}**` : `not checked (${lt.detail})`}.`,
    '',
  )
  L.push('| function | inputs | calls | differ from port emulation | max ULP | differ from correctly rounded | max ULP |', '|---|---|---:|---:|---:|---:|---:|')
  const smallPct = (x: number) => (x === 0 ? '0' : x < 0.01 ? x.toPrecision(2) : x.toFixed(2))
  for (const l of rep.libm) L.push(`| \`${LIBM_NAMES[l.fn] ?? l.fn}\` | ${l.use} | ${l.n.toLocaleString('en-US')} | ${smallPct(l.differPct)}% | ${l.maxUlp} | ${smallPct(l.crDifferPct)}% | ${l.crMaxUlp} |`)
  L.push('')
  const allExact = rep.rows.every((r) => r.metrics.maxAbsErr === 0)
  L.push(`The double-precision \`exp\`, \`tanh\` (GRU, per sample) and \`sin\`/\`cos\` (airfresh design, once) still come from V8 (\`tanh64\` adds a series below 2^-11). Their results go through a float rounding before they reach a sample, so a last-bit difference from Apple's double libm rarely survives${allExact ? '; in this run no row shows one' : ''}.`, '')

  // setup
  L.push('## How it is measured', '')
  const m = rep.manifest
  L.push(`- **Native reference:** \`cmsis_api_ios\` from the installed larkSound.app${m ? ` (sha256 \`${m.sourceSha256}\`)` : ''}, retagged as a macOS arm64 dylib and ad-hoc signed by \`npm run dsp:prepare\`, called through \`.dsp-native/bin/cmsis-runner\` (\`tools/dsp-harness/native/runner.c\`). The library is never committed; the prepare script regenerates it from the user's install.`)
  L.push('- **CR libm diagnostic:** the same runner with `--libm cr` rewrites the library\'s `__got` slots for `powf sinf cosf tanf expf logf log10f` to wrappers that evaluate the double function and round once (the vendor code is otherwise untouched), and the port runs with `setLibm(\'cr\')`, which uses `Math.fround(Math.fn(x))`.')
  L.push('- **Port under test:** `VoiceProcessor` / `CmsisEmulator` from `src/lib/dsp`, run in Node by `tools/dsp-harness/compare.ts`.')
  L.push('- **Same calls on both sides.** Each scenario is a list of API calls (init, default_configs, setters, process) interpreted by both sides. One runner process (one library load) and one `VoiceProcessor` per scenario; every signal starts from `cmsis_init` or a preset (which begins with `cmsis_default_configs`).')
  L.push('- **Presets.** Native side: the runner reads the app\'s own template JSON and applies it with a C re-implementation of the iOS app\'s mapping (clamps, `lroundf` of attack/release, exciter type 2 disables, `default_configs` first). TS side: `VoiceProcessor.configure()` with `PRESET_TEMPLATES`. The two template sources are cross-checked below.')
  L.push('- **De-esser range on iOS.** `cmsis_set_esser` in the iOS build never stores its range argument, and `cmsis_init` leaves that field as uninitialised heap memory. The runner reports the value it finds after `cmsis_init` (a note appears below if it is ever non-zero) and pins it to 0 for iOS-behaviour scenarios, which is what the port assumes. The `full-android` scenarios write the template range (−15 dB) into the field instead, which is what the Android library does.')
  L.push('- **Frames.** `cmsis_process_frame` takes 240-sample frames; both sides process whole frames on the same grid, and the runner copies each input frame first because the native EQ runs in place on its input. Both native outputs (A and B) are checked to be identical.')
  L.push('- **Alignment.** Nothing is shifted before measuring. For every row the error energy at lag 0 is compared against lags ±1 and ±240 (one frame), and against every lag within ±480 around the worst error when SNR < 80 dB. The lag column shows the best one; a non-zero lag would be noted and still counted as a failure at lag 0.')
  L.push('- **Offline render.** `cmsis_process_wav` reads a float32 WAV written by the harness and writes stereo float32; the port\'s `processWavSamples` is compared on both channels (interleaved). Its WAV writer reuses the first call\'s length for later calls in the same process, so each signal gets its own runner process there.')
  L.push('- **LUFS stage alone.** The runner calls the library\'s own `lufs_init` and `dsp_integrated_loudness` per sample; this stage is not part of the real-time path.', '')

  L.push('### Signals', '')
  L.push('| name | description | seconds |', '|---|---|---:|')
  for (const s of rep.signals) L.push(`| ${s.name} | ${s.description}${s.local ? ' (local only, never committed)' : ''} | ${s.seconds.toFixed(2)} |`)
  L.push('')

  // preset data
  L.push('## Preset data: app JSON vs `src/lib/dsp/presets.ts`', '')
  L.push('| preset | file | match |', '|---|---|:-:|')
  for (const p of rep.presetChecks) L.push(`| ${p.preset} | ${p.file} | ${p.ok ? '✓' : `✗ ${p.diffs.slice(0, 4).join('; ')}`} |`)
  L.push('')

  // coefficients
  L.push('## EQ coefficients: `cmsis_get_eq_coefficients` vs TS design', '')
  L.push('| preset | stages (native / TS) | coefficients | bit-identical | max ULP |', '|---|---:|---:|---:|---:|')
  for (const p of cp) L.push(`| ${p.preset} (${p.name}) | ${p.nativeStages} / ${p.tsStages} | ${p.coefficients} | ${p.identical} | ${p.maxUlp} |`)
  L.push('')
  L.push(`Random single-band sweep: ${sw.bands} bands, half at UI resolution (integer Hz, 0.1 dB, Q to 0.01) and half raw float32; f0 log-uniform over 20 Hz–23999 Hz, Q 0.1–20, gain ±24 dB. With correctly rounded libm on both sides: ${sw.identicalCr} of ${sw.bands} bit-identical, max ${sw.maxUlpCr} ulp.`, '')
  L.push('| filter type | bands | bit-identical | max ULP |', '|---|---:|---:|---:|')
  for (const t of sw.byType) L.push(`| ${t.type} ${FILTER[t.type] ?? ''} | ${t.n} | ${t.identical} | ${t.maxUlp} |`)
  if (sw.worst.length) {
    L.push('', 'First differing bands (Apple libm):', '')
    for (const w of sw.worst) L.push(`- type ${w.type}, gain ${w.gain.toPrecision(6)} dB, f0 ${w.f0.toPrecision(7)} Hz, Q ${w.q.toPrecision(6)}: ${w.maxUlp} ulp`)
  }
  L.push('')

  // per stage / scenario
  for (const [stage, title] of STAGES) {
    const rows = byStage.get(stage)
    if (!rows) continue
    L.push(`## ${title}`, '')
    for (const [id, rs] of byScenario) {
      if (rs[0].stage !== stage) continue
      L.push(`### ${id}`, '', `${rs[0].title}. Target: ${rs[0].informational ? 'informational' : tgt(rs[0].target)}.`, '', ...signalTable(rs), '')
    }
  }

  // browser (kept from the existing report; written by browser-check.ts)
  const browser = readBlock(BROWSER_START, BROWSER_END)
  if (browser) L.push('## Browser', '', BROWSER_START, browser, BROWSER_END, '')

  // changelog
  let log = readChangelog()
  if (rep.note) {
    const pass = rep.rows.filter((r) => r.pass && !r.informational).length
    const crExact = rep.rows.filter((r) => r.metricsCr.maxAbsErr === 0).length
    const exact = rep.rows.filter((r) => r.metrics.maxAbsErr === 0).length
    log += `${log ? '\n' : ''}- ${rep.generatedAt.slice(0, 16).replace('T', ' ')} UTC: ${rep.note} (run: ${pass}/${total} target rows met; ${exact}/${rep.rows.length} rows bit-identical against the shipping library, ${crExact}/${rep.rows.length} with CR libm on both sides)`
  }
  L.push('## Changelog', '', START, log, END, '')

  const file = rep.partial ? path.join(NATIVE_DIR, 'out', 'parity-report.partial.md') : REPORT_FILE
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, L.join('\n'))
  return file
}
