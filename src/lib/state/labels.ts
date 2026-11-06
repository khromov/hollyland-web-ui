/**
 * Display words for the drivers' ControlSpecs (the official apps' labels, as the drivers keep them):
 * one casing (sentence case, like the tested products' pages: "Channel mode", "Indicator light"),
 * no "Toggle" / "Switch" / "Settings" / "Adjustment" suffixes, one spelling per term ("24-bit"),
 * and the few official words that read oddly out of their screen ("Instr", "Mon (2.4G)",
 * "Set gain to") replaced. Bit-depth options are put in one order (24-bit first).
 *
 * The session hands these display specs to the pages (session.controls); the hardware report keeps
 * the drivers' own labels.
 */
import type { ControlSpec } from '../protocol'

/** Whole labels replaced (matched before the suffixes are dropped). */
const LABEL: Readonly<Record<string, string>> = {
  'Volume adjustment': 'Volume',
  'EQ Adjustment': 'EQ',
  'Reverb Adjustment': 'Reverb',
  'Schedule power off': 'Auto power off',
  'Set gain to': 'Gain',
  'Camera Power On/Off': 'Camera power',
  Instr: 'Instrument',
  'Instr mute': 'Instrument mute',
  BGM: 'Backing track',
  'BGM mute': 'Backing track mute',
  'Mon (2.4G)': 'Wireless monitoring',
  'Mon (2.4G) mute': 'Wireless monitoring mute',
  'Noise Cancellation Settings': 'Noise cancellation level',
  'Threshold Settings': 'Noise gate threshold',
  'Smart audio mixer Auto Speaker Output': 'Auto speaker output',
  'Internal Recording Depth': 'Internal recording',
  'Timecode switch': 'Timecode',
  'Timecode Frame Rate': 'Frame rate',
  '3.5mm Jack I/O Mode': '3.5 mm jack',
  // Official mode names, kept as they are written on the product.
  '4 Mic & 1 RX': '4 Mic & 1 RX',
}

/** Option legends replaced. */
const OPTION: Readonly<Record<string, string>> = {
  '24bit': '24-bit',
  '32bit': '32-bit',
  '32bit float': '32-bit float',
  'Set gain to': 'Fixed',
  'Dynamic Gain': 'Dynamic',
  'Count From Zero': 'Count from zero',
  'Real-time Timing': 'Real-time',
  'Normal mode': 'Normal',
  'Performance mode': 'Performance',
}

/** Words kept as written inside a label (units, product terms). */
const KEEP = /^(?:[A-Z0-9][A-Z0-9./&()-]*|[0-9].*|I\/O|dB|Hz|mm)$/

/** "Noise Cancellation Toggle" → "Noise cancellation", "Lock Mic" → "Lock mic", "TX Recognition" → "TX recognition". */
export function displayLabel(label: string): string {
  const mapped = LABEL[label.trim()]
  if (mapped) return mapped
  const t = label.replace(/\s+(toggle|switch|settings|adjustment)$/i, '').trim() || label.trim()
  if (LABEL[t]) return LABEL[t]
  return t
    .split(/(\s+)/)
    .map((w, i) => (i === 0 || /^\s+$/.test(w) || KEEP.test(w) ? w : w.toLowerCase()))
    .join('')
}

export function displayOption(label: string): string {
  return OPTION[label.trim()] ?? label
}

/** Bits of a bit-depth legend ("24bit", "32-bit float"), or null. */
function bitsOf(label: string): { bits: number; float: boolean } | null {
  const m = /^\s*(\d+)\s*-?\s*bit\b(.*)$/i.exec(label)
  return m ? { bits: Number(m[1]), float: /float/i.test(m[2]) } : null
}

/** The spec with display words; bit-depth options in one order (24-bit, 32-bit, 32-bit float). */
export function displaySpec(spec: ControlSpec): ControlSpec {
  let options = spec.options?.map((o) => ({ ...o, label: displayOption(o.label) }))
  if (options && options.length > 1 && options.every((o) => bitsOf(o.label))) {
    options = [...options].sort((a, b) => {
      const x = bitsOf(a.label)!
      const y = bitsOf(b.label)!
      return x.bits - y.bits || +x.float - +y.float
    })
  }
  return { ...spec, label: displayLabel(spec.label), ...(options ? { options } : {}) }
}

const cache = new WeakMap<readonly ControlSpec[], readonly ControlSpec[]>()

/** Display specs of a device's control list (cached per list). */
export function displayControls(specs: readonly ControlSpec[]): readonly ControlSpec[] {
  let out = cache.get(specs)
  if (!out) {
    out = specs.map(displaySpec)
    cache.set(specs, out)
  }
  return out
}
