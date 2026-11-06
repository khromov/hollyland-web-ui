/**
 * Generic control renderer: pure helpers (no session, no Svelte state), shared by the family
 * Overview and any page that renders `ControlSpec`s (docs/FAMILIES.md §4.1).
 *
 *  - placement: which page owns a control (`pageOf`), so pages don't render the same control twice
 *  - modules:   which controls share one faceplate module (NC switch + its level, …) and in what order
 *  - display:   labels without "Toggle" / "Switch" suffixes, values with their unit ("+4 dB")
 *  - options:   key options of a choice, with the values the official app refuses on this product
 *  - visibility: controls that don't exist in the current state (a newer firmware replaced them,
 *               the MAX 2 shows either dynamic gain or per-mic gain)
 */
import {
  CONTROL,
  max2,
  type ControlAvailability,
  type ControlGroup,
  type ControlSpec,
  type ControlValue,
  type FamilyCode,
  type MicState,
  type ProductInfo,
  type UnitId,
} from '../../lib/protocol/app'
import type { KeyOption } from '../../lib/ui/types'
import { displayLabel } from '../../lib/state/labels'

// --------------------------------------------------------------------------------- placement

/** Pages a control can live on. Overview also draws per-mic controls inside the mic modules. */
export type ControlPage = 'overview' | 'settings' | 'mixer' | 'timecode' | 'monitoring'

/** Groups drawn on the Overview (the official apps' home screens). */
export const OVERVIEW_GROUPS: readonly ControlGroup[] = ['mics', 'receiver', 'audio']

/** MELO P1 controls that belong to its Mixer page: track faders and mutes, the scenario. */
const MELO_MIXER = new Set([
  'melo.workMode',
  'melo.mic.volume',
  CONTROL.MIC_MUTE,
  'melo.instrument.volume',
  'melo.instrument.mute',
  'melo.bgm.volume',
  'melo.bgm.mute',
])

/**
 * Set-and-forget controls that some drivers group with the home screen (mics / receiver / audio):
 * locks, mic recognition, every bit depth or output format, the phone speaker, the 4-mic mode,
 * pairing and the camera power. Settings on every family, so the Overview keeps what is changed
 * while recording (NC, gain or volume, channel mode, mixing), like the tested products' strip.
 */
const SET_AND_FORGET = new Set<string>([
  'max2.micLock',
  CONTROL.MIC_RECOGNITION,
  'max2.bitDepth',
  'max2.usbOutput',
  'm3.bitDepth',
  'melo.mic.bitDepth',
  'melo.output.bitDepth',
  CONTROL.SPEAKER,
  'max2.fourMic',
  'max2.rxPair',
  'm3.hotShoeSync',
])

/**
 * The page that owns a control: timecode / monitoring groups get their own pages (the MELO P1's
 * output volumes sit on its Mixer page), settings / advanced and the set-and-forget controls go to
 * Settings, the rest is the Overview. Per-mic controls placed on the Overview are drawn in the mic
 * modules.
 */
export function pageOf(spec: ControlSpec, family: FamilyCode | null): ControlPage {
  if (spec.group === 'timecode') return 'timecode'
  if (spec.group === 'monitoring') return family === '6201' ? 'mixer' : 'monitoring'
  if (family === '6201' && MELO_MIXER.has(spec.id)) return 'mixer'
  if (spec.group === 'settings' || spec.group === 'advanced' || SET_AND_FORGET.has(spec.id)) return 'settings'
  return 'overview'
}

/** Per-mic controls the Overview's mic modules draw (mute and gain), whatever page owns them. */
export const MIC_MODULE_CONTROLS: readonly string[] = [CONTROL.MIC_MUTE, CONTROL.MIC_GAIN]

// ----------------------------------------------------------------------------------- labels

/**
 * Display label: sentence case, no trailing "Toggle" / "Switch" / "Settings" ("Indicator Light Switch"
 * → "Indicator light"). session.controls already carries display labels (lib/state/labels.ts); this
 * is idempotent, for labels from elsewhere.
 */
export function cleanLabel(label: string): string {
  return displayLabel(label)
}

/**
 * Label of a control inside a module titled `title`: the title's words dropped from the front
 * ("RX volume Level 1" in "RX volume" → "Level 1", "NC level" in "NC" → "Level").
 */
export function subLabel(label: string, title: string): string {
  const l = cleanLabel(label)
  if (l.toLowerCase() === title.toLowerCase()) return l
  if (l.toLowerCase().startsWith(`${title.toLowerCase()} `)) {
    const rest = l.slice(title.length + 1).trim()
    return rest.charAt(0).toUpperCase() + rest.slice(1)
  }
  return l
}

/** Key legend of an action control. */
export function actionLabel(spec: ControlSpec): string {
  if (/pair/i.test(spec.id) || /pairing/i.test(spec.label)) return 'Start pairing'
  return 'Start'
}

// ------------------------------------------------------------------------------------ values

/** Number of stops of a steps / range control. */
export function stopCount(spec: ControlSpec): number {
  const r = spec.range
  if (!r || r.step <= 0) return 0
  return Math.round((r.max - r.min) / r.step) + 1
}

/** A steps control drawn as a detent fader with numbered stops (RX volume: 6). More stops get a slider. */
export function isDetent(spec: ControlSpec): boolean {
  const n = stopCount(spec)
  return spec.kind === 'steps' && n >= 2 && n <= 10
}

/** The value as the official app prints it (raw + displayOffset). */
export function displayNumber(spec: ControlSpec, raw: number): number {
  return raw + (spec.range?.displayOffset ?? 0)
}

/** The range crosses zero in display units (gains in dB): signed values, fill from zero. */
export function isBipolar(spec: ControlSpec): boolean {
  const r = spec.range
  if (!r) return false
  const off = r.displayOffset ?? 0
  return r.min + off < 0 && r.max + off > 0
}

/** "+4", "−4", "0" (bipolar) or "15"; real minus sign. */
export function formatNumber(n: number, signed = false): string {
  const v = Math.round(n * 100) / 100
  if (v < 0) return `−${Math.abs(v)}`
  if (signed && v > 0) return `+${v}`
  return `${v}`
}

/** A value for display: option label, "On" / "Off", "4", "+4 dB". Null when unknown. */
export function formatValue(spec: ControlSpec, v: ControlValue | undefined): string | null {
  if (v === undefined) return null
  switch (spec.kind) {
    case 'switch':
      return v === true ? 'On' : 'Off'
    case 'action':
      return null
    case 'choice':
      return spec.options?.find((o) => o.value === v)?.label ?? (typeof v === 'number' ? String(v) : null)
    case 'steps':
    case 'range': {
      if (typeof v !== 'number') return null
      const n = formatNumber(displayNumber(spec, v), isBipolar(spec))
      return spec.range?.unit ? `${n} ${spec.range.unit}` : n
    }
  }
}

// ----------------------------------------------------------------------------------- options

/**
 * A choice value the official app refuses on this product in this state, as a reason code
 * (src/lib/state/reasons.ts REASON_TEXT), or null. The key stays visible, flat, with the reason
 * as its tooltip, instead of failing after the click.
 */
export function optionReason(
  family: FamilyCode | null,
  product: ProductInfo | null,
  spec: ControlSpec,
  value: number,
  values: MicState['values'] | undefined,
): string | null {
  if (family === '6303' && spec.id === 'm3.bitDepth' && value === 1) return 'apple-only'
  if (family === '6701') {
    if (spec.id === max2.MAX2_CONTROL.USB_OUTPUT && value !== 0) return 'apple-only'
    if (spec.id === max2.MAX2_CONTROL.CHANNEL_MODE && product && values) {
      // The safety track exists only through the charging case, whatever the timecode state.
      if (value === 2 && !max2.isMax2Box(product)) return 'box-only'
      return max2.max2ChannelRefusal(product, value, values)?.reason ?? null
    }
    if (spec.id === max2.MAX2_CONTROL.TC_TIMING && value === 2 && values?.[max2.MAX2_CONTROL.TC_TIMING] === 1) return 'real-time-timing'
  }
  return null
}

/**
 * Refusals that are permanent here (the USB receiver has no safety track; 32-bit float USB output is
 * set from the iOS app only): the value is left out rather than drawn as a key that can never be
 * used, unless it is the current value (then a flat key shows it, its reason in the tooltip).
 */
export const HIDDEN_OPTION_REASONS: readonly string[] = ['box-only', 'apple-only']

/** Refusals that never change on this computer: the flat key's tooltip says it; nothing is printed. */
export const QUIET_OPTION_REASONS: readonly string[] = ['box-only', 'apple-only']

/**
 * Key options of a choice. `refuse` gives a value's reason code and its few words: permanent
 * refusals (HIDDEN_OPTION_REASONS) are left out, the others are flat keys with the words as hint.
 */
export function choiceOptions(
  spec: ControlSpec,
  refuse: (value: number) => { code: string; text: string } | null = () => null,
  current?: unknown,
): KeyOption<number>[] {
  const out: KeyOption<number>[] = []
  for (const o of spec.options ?? []) {
    const why = refuse(o.value)
    if (why && HIDDEN_OPTION_REASONS.includes(why.code) && o.value !== current) continue
    out.push(why ? { value: o.value, label: o.label, disabled: true, hint: why.text } : { value: o.value, label: o.label })
  }
  return out
}

/**
 * Columns of a key row: one row, unless the legends are long (then two per row, so a key never
 * runs out of its module: "Mono | Stereo | Secure audio track"), at most four per row. A lone key
 * takes half the row.
 */
export function keyColumns(options: readonly { label: string }[]): number | undefined {
  const n = options.length
  // A lone key (the other values can't be chosen here) keeps the width of a key in a pair.
  if (n === 1) return 2
  if (n > 4) return Math.min(4, Math.ceil(n / 2))
  const chars = options.reduce((a, o) => a + o.label.length, 0)
  if (n >= 3 && chars > 26) return 2
  return undefined
}

// -------------------------------------------------------------------------------- visibility

export interface ControlContext {
  family: FamilyCode | null
  value: (id: string, unit?: UnitId) => ControlValue | undefined
  availability: (id: string, unit?: UnitId) => ControlAvailability | null
}

/**
 * False when the control does not exist in the current state: a newer firmware replaced it
 * ('firmware-too-new'), or the MAX 2 gain mode shows the other one (dynamic gain keys or the
 * per-mic "Set gain to" sliders; both while the mode is unknown).
 */
export function isShown(spec: ControlSpec, ctx: ControlContext, unit?: UnitId): boolean {
  const a = ctx.availability(spec.id, unit)
  if (a?.reason === 'firmware-too-new') return false
  if (ctx.family === '6701') {
    const type = ctx.value(max2.MAX2_CONTROL.GAIN_TYPE)
    if (spec.id === max2.MAX2_CONTROL.GAIN_DYNAMIC && type === 0) return false
    if (spec.id === max2.MAX2_CONTROL.MIC_GAIN && type === 1) return false
  }
  return true
}

// ----------------------------------------------------------------------------------- modules

/** One faceplate module: an optional switch at its head and the controls in its body. */
export interface ModuleDef {
  key: string
  title: string
  /** On/off at the module head (NC, reverb, noise gate, LED). */
  head?: ControlSpec
  body: ControlSpec[]
  description?: string
}

/** Controls drawn in the same module as the first one (the first is the head when it is a switch). */
const COMPANIONS: Readonly<Record<string, readonly string[]>> = {
  [CONTROL.NOISE_ENABLED]: [CONTROL.NOISE_LEVEL, 'max2.nc.depth', 'melo.noise.depth'],
  'a1.reverb.enabled': ['a1.reverb.level'],
  'melo.noiseGate.enabled': ['melo.noiseGate.threshold'],
  [CONTROL.LED]: ['melo.led.brightness'],
  'max2.gain.type': ['max2.gain.dynamic'],
  'max2.bitDepth': ['max2.usbOutput'],
  'm3.cameraVolume.level1': ['m3.cameraVolume.level2', 'm3.cameraVolume.level3'],
}

/** Titles of modules that combine controls with different labels. */
const MODULE_TITLE: Readonly<Record<string, string>> = {
  'max2.gain.type': 'Gain',
  'max2.bitDepth': 'Bit depth',
  'm3.cameraVolume.level1': 'RX volume',
}

/**
 * Order on the faceplate, like the receiver strip of the tested products: noise first, then
 * volume / gain, channel mode, the other audio settings, and the receiver's mode switches
 * (restart, pairing) last. Ties keep the driver's order.
 */
const ORDER: Readonly<Record<string, number>> = {
  [CONTROL.NOISE_ENABLED]: 0,
  [CONTROL.NOISE_LEVEL]: 0,
  'melo.noiseGate.enabled': 0.5,
  [CONTROL.VOLUME]: 1,
  'm3.cameraVolume.level1': 1,
  'max2.gain.type': 1,
  'max2.gain.dynamic': 1,
  'melo.mic.gainPreset': 1,
  [CONTROL.CHANNEL_MODE]: 2,
  'max2.bitDepth': 7,
}

function rank(spec: ControlSpec): number {
  const r = ORDER[spec.id]
  if (r !== undefined) return r
  return spec.safety === 'write' ? 5 : 8
}

/**
 * Group controls into modules (NC switch with its level, reverb with its size, the M3 camera RX
 * volume levels, MAX 2 gain mode with the dynamic gain keys, …) and order them for the faceplate.
 * Every control appears once; a companion without its lead stands on its own.
 */
export function buildModules(specs: readonly ControlSpec[]): ModuleDef[] {
  const byId = new Map(specs.map((s) => [s.id, s]))
  const used = new Set<string>()
  const out: { def: ModuleDef; rank: number; index: number }[] = []
  specs.forEach((spec, index) => {
    if (used.has(spec.id)) return
    used.add(spec.id)
    const companionIds =
      COMPANIONS[spec.id] ??
      (spec.kind === 'switch' && spec.id.endsWith('.enabled')
        ? specs.filter((s) => s.id !== spec.id && s.id.startsWith(spec.id.slice(0, -'enabled'.length))).map((s) => s.id)
        : [])
    const companions = companionIds.map((id) => byId.get(id)).filter((s): s is ControlSpec => !!s && !used.has(s.id))
    companions.forEach((c) => used.add(c.id))
    const head = spec.kind === 'switch' ? spec : undefined
    const body = head ? companions : [spec, ...companions]
    const title = MODULE_TITLE[spec.id] ?? cleanLabel(spec.label)
    out.push({ def: { key: spec.id, title, head, body, description: spec.description }, rank: rank(spec), index })
  })
  return out.sort((a, b) => a.rank - b.rank || a.index - b.index).map((x) => x.def)
}

// ------------------------------------------------------------------------------------ layout

const TITLE_PX = 8.1 // 15 px Archivo 660, per character
const KEY_PX = 6.9 // 14 px key legend, per character
const PAD = 40 // module padding, both sides

function keysWidth(labels: readonly string[]): number {
  const cols = keyColumns(labels.map((label) => ({ label }))) ?? labels.length
  const w = labels.map((l) => Math.max(46, l.length * KEY_PX + 18))
  let widest = 0
  for (let i = 0; i < w.length; i += cols) {
    const row = w.slice(i, i + cols)
    widest = Math.max(widest, row.reduce((a, b) => a + b, 0) + 6 * (row.length - 1))
  }
  return widest
}

/**
 * Width a module needs to keep its title and head control on one line and its keys whole (an
 * estimate, px). `sendKeys`: switches are drawn as "Off | On" keys (write-only link), wider than
 * the slide switch.
 */
export function moduleNeed(def: ModuleDef, o: { sendKeys?: boolean } = {}): number {
  const lone = !def.head && def.body.length === 1 ? def.body[0] : null
  const headCtl = def.head ? (o.sendKeys ? 112 : 72) : lone && (lone.kind === 'steps' || lone.kind === 'range') ? 76 : 0
  let need = def.title.length * TITLE_PX + headCtl
  for (const s of def.body) {
    if (s.kind === 'choice') need = Math.max(need, keysWidth((s.options ?? []).map((o) => o.label)))
    else if (s.kind === 'steps' || s.kind === 'range') need = Math.max(need, isDetent(s) ? 200 : 190)
    else if (s.kind === 'action') need = Math.max(need, 140)
    else if (s.kind === 'switch') need = Math.max(need, o.sendKeys ? 112 : 120)
  }
  return Math.max(150, Math.ceil(need + PAD))
}

/**
 * Column widths (fr weights) for modules needing `needs` px in a strip `width` px wide: the
 * fewest rows that fit, balanced (9 → 5 + 4), each column as wide as its widest module needs and
 * the spare width shared in proportion, like the tested products' receiver strip. A strip of one
 * or two modules keeps three columns, so a lone module doesn't stretch across the page.
 */
export function stripColumns(needs: readonly number[], width: number): number[] {
  const n = needs.length
  if (n === 0) return [1]
  const weights = (cols: number) => {
    const w = Array.from({ length: cols }, () => 0)
    needs.forEach((x, i) => (w[i % cols] = Math.max(w[i % cols], x)))
    return w
  }
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    const w = weights(cols)
    // The needs are generous estimates: a strip 3 % short still keeps every title on its line.
    if (cols === 1 || w.reduce((a, b) => a + b, 0) <= width * 1.03) {
      if (n >= 3 || (cols === 1 && n > 1)) return w
      const padded = [...w, ...Array.from({ length: 3 - cols }, () => Math.max(...w))]
      return padded.reduce((a, b) => a + b, 0) <= width ? padded : w
    }
  }
  return [1]
}
