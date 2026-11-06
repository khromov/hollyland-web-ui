/**
 * Pure helpers for drawing a ControlSpec (docs/FAMILIES.md §3.3, §4.1): printed values, stop
 * counts, scale marks. No state; the Settings modules and the family sections share them.
 */
import type { ControlSpec, ControlValue, UnitId } from '../../lib/protocol/app'

/** "−4", "+4", "0" with a real minus sign (signed ranges), or the plain number. */
export function signedNumber(n: number, signed: boolean): string {
  const r = Math.round(n * 100) / 100
  if (r < 0) return `−${Math.abs(r)}`
  return signed && r > 0 ? `+${r}` : String(r)
}

/** The number printed for a raw range / steps value (raw + displayOffset). */
export function shownNumber(spec: ControlSpec, raw: number): number {
  return raw + (spec.range?.displayOffset ?? 0)
}

/** True when the printed scale crosses zero (dB gains): print a sign on positive values. */
export function isSigned(spec: ControlSpec): boolean {
  const r = spec.range
  if (!r) return false
  const off = r.displayOffset ?? 0
  return r.min + off < 0 && r.max + off > 0
}

/** "−4 dB", "12": a raw value as printed, with the unit. */
export function formatRaw(spec: ControlSpec, raw: number, withUnit = true): string {
  const n = signedNumber(shownNumber(spec, raw), isSigned(spec))
  const unit = spec.range?.unit
  return withUnit && unit ? `${n} ${unit}` : n
}

/** Number of stops of a steps / range control. */
export function stopCount(spec: ControlSpec): number {
  const r = spec.range
  if (!r) return 0
  return Math.round((r.max - r.min) / (r.step || 1)) + 1
}

/** Scale marks (raw values): the ends, and the printed zero when it falls inside the range. */
export function scaleMarks(spec: ControlSpec): number[] {
  const r = spec.range
  if (!r) return []
  const off = r.displayOffset ?? 0
  const marks = [r.min, r.max]
  const zero = -off
  if (zero > r.min && zero < r.max) marks.splice(1, 0, zero)
  else {
    const mid = r.min + Math.round((r.max - r.min) / 2 / (r.step || 1)) * (r.step || 1)
    if (mid > r.min && mid < r.max) marks.splice(1, 0, mid)
  }
  return marks
}

/** A value as words for the confirm dialog ("On", "24bit", "−4 dB"). */
export function valueWords(spec: ControlSpec, value: ControlValue, legends?: { on: string; off: string }): string {
  if (typeof value === 'boolean') return value ? (legends?.on ?? 'On') : (legends?.off ?? 'Off')
  if (typeof value === 'number') {
    const o = spec.options?.find((x) => x.value === value)
    if (o) return o.label
    if (spec.range) return formatRaw(spec, value)
    return String(value)
  }
  return value.join(', ')
}

const UNIT_NAME: Record<UnitId, string> = {
  rx: 'Receiver',
  tx1: 'Mic 1',
  tx2: 'Mic 2',
  tx3: 'Mic 3',
  tx4: 'Mic 4',
  rx2: 'Receiver 2',
  rx3: 'Receiver 3',
  rx4: 'Receiver 4',
  box: 'Charging case',
  earL: 'Earphone L',
  earR: 'Earphone R',
  remote: 'Remote',
}

const UNIT_PLATE: Record<UnitId, string> = {
  rx: 'RX',
  tx1: 'TX1',
  tx2: 'TX2',
  tx3: 'TX3',
  tx4: 'TX4',
  rx2: 'RX',
  rx3: 'RX',
  rx4: 'RX',
  box: 'CASE',
  earL: 'L',
  earR: 'R',
  remote: 'RC',
}

export function unitName(u: UnitId): string {
  return UNIT_NAME[u] ?? u
}

export function unitPlate(u: UnitId): string {
  return UNIT_PLATE[u] ?? u.toUpperCase()
}

/**
 * Columns for `n` modules in a strip `width` px wide: as many as fit at `min` px, balanced over the
 * rows (6 → 3 + 3, 9 → 5 + 4); one or two modules keep a third of the row each, like the legacy
 * Feature Settings strip.
 */
export function balancedColumns(n: number, width: number, min = 250): number {
  if (n <= 0 || width <= 0) return 1
  const fit = Math.max(1, Math.floor(width / min))
  if (n <= fit) return Math.max(n, Math.min(3, fit))
  return Math.ceil(n / Math.ceil(n / fit))
}

/** grid-template-columns for a section strip (auto-fit until the width is measured). */
export function sectionColumns(n: number, width: number): string {
  return width > 0 ? `repeat(${balancedColumns(n, width)}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))'
}
