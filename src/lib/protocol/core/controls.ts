/**
 * ControlSpec helpers: canonical control ids, value validation, availability and the
 * untested-product filter (FAMILIES.md §2.3, §4.3).
 */
import { ControlUnavailableError, ControlValueError } from './control-errors'
import type { ControlAvailability, ControlId, ControlSpec, ControlValue, MicState, SupportInfo, UnitId } from './types'

/**
 * Canonical ids for settings that mean the same thing in several families. Families use these
 * when the meaning matches (the generic renderer and bespoke modules key on them) and a
 * family-scoped id ('a1.eq', 'max2.tc.fps') otherwise.
 */
export const CONTROL = {
  /** NC on/off (switch). */
  NOISE_ENABLED: 'noise.enabled',
  /** NC strength (choice; 1-based levels as the family's app numbers them). */
  NOISE_LEVEL: 'noise.level',
  /** RX output volume step (steps, 0-based). */
  VOLUME: 'volume',
  /** Channel mode (choice: 0 mono, 1 stereo, 2 safety track; families add values). */
  CHANNEL_MODE: 'channel.mode',
  /** Indicator LED (switch, true = on). */
  LED: 'led',
  /** TX auto power-off (switch, true = enabled). */
  AUTO_OFF: 'autoOff',
  /** "Mic Recognition" / TX identify (switch). */
  MIC_RECOGNITION: 'mic.recognition',
  /** Per-mic mute (switch, perUnit). */
  MIC_MUTE: 'mic.mute',
  /** Per-mic gain (range, perUnit). */
  MIC_GAIN: 'mic.gain',
  /** Speaker passthrough / "Phone Speaker" (switch; may be disruptive). */
  SPEAKER: 'speaker.passthrough',
  /** RX volume lock (switch). */
  VOLUME_LOCK: 'volume.lock',
  /** On-device voice preset on/off (switch). */
  PRESET_ENABLED: 'preset.enabled',
  /** On-device voice preset style (choice). */
  PRESET_STYLE: 'preset.style',
  /** "Smart battery life" (switch). */
  SMART_BATTERY: 'smartBattery',
  /** Restart the receiver (action, disruptive). */
  RESTART_RX: 'rx.restart',
  /** Remove a mic's pairing (action, destructive, perUnit). */
  REMOVE_PAIRING: 'tx.removePairing',
  /** Factory reset (action, destructive). */
  FACTORY_RESET: 'rx.factoryReset',
} as const

export type CanonicalControlId = (typeof CONTROL)[keyof typeof CONTROL]

/**
 * Key of a value in MicState.values: the control id, or `${id}:${unit}` for per-unit controls
 * (e.g. 'mic.mute:tx2'). Availability uses the same keys (a per-unit key overrides the plain one).
 */
export function controlKey(id: ControlId, unit?: UnitId): string {
  return unit && unit !== 'rx' ? `${id}:${unit}` : id
}

export function controlById(controls: readonly ControlSpec[], id: ControlId): ControlSpec | undefined {
  return controls.find((c) => c.id === id)
}

/**
 * Controls a product may show: destructive and OTA controls are removed for hardware-untested
 * products (FAMILIES.md §2.3, §4.3), OTA controls always (firmware upload is not implemented).
 */
export function visibleControls(controls: readonly ControlSpec[], support: SupportInfo): ControlSpec[] {
  return controls.filter((c) => c.safety !== 'ota' && !(c.safety === 'destructive' && support.hardware === 'untested'))
}

/**
 * Check a value against its spec; returns the normalised value (numbers stay numbers, `action`
 * becomes `true`). Throws ControlValueError.
 */
export function validateControlValue(spec: ControlSpec, value: ControlValue, unit?: UnitId): ControlValue {
  if (spec.perUnit) {
    if (!unit) throw new ControlValueError(spec.id, `needs a unit (${spec.perUnit.join(', ')})`)
    if (!spec.perUnit.includes(unit)) throw new ControlValueError(spec.id, `unit ${unit} not in ${spec.perUnit.join(', ')}`)
  } else if (unit !== undefined && unit !== 'rx') {
    throw new ControlValueError(spec.id, `is not a per-unit control (got unit ${unit})`)
  }
  switch (spec.kind) {
    case 'switch':
      if (typeof value !== 'boolean') throw new ControlValueError(spec.id, `expects true/false, got ${String(value)}`)
      return value
    case 'action':
      if (value !== true) throw new ControlValueError(spec.id, 'an action is triggered with the value true')
      return true
    case 'choice': {
      if (typeof value !== 'number') throw new ControlValueError(spec.id, `expects a number, got ${String(value)}`)
      const opts = spec.options ?? []
      if (!opts.some((o) => o.value === value)) {
        throw new ControlValueError(spec.id, `${value} is not one of ${opts.map((o) => o.value).join(', ')}`)
      }
      return value
    }
    case 'steps':
    case 'range': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new ControlValueError(spec.id, `expects a number, got ${String(value)}`)
      const r = spec.range
      if (!r) return value
      if (value < r.min || value > r.max) throw new ControlValueError(spec.id, `${value} is outside ${r.min}..${r.max}`)
      const k = (value - r.min) / r.step
      if (r.step > 0 && Math.abs(k - Math.round(k)) > 1e-9) throw new ControlValueError(spec.id, `${value} is not on a ${r.step} step from ${r.min}`)
      if (spec.kind === 'steps' && !Number.isInteger(value)) throw new ControlValueError(spec.id, `${value} is not an integer step`)
      return value
    }
  }
}

/** Availability reasons that are firmware gates (bypassed by `ignoreFirmwareGates`); every other reason is a precondition. */
export const FIRMWARE_GATE_REASONS: readonly string[] = ['version-unknown', 'firmware-too-old']

/**
 * Throw ControlUnavailableError when the state marks the control (or the control on this unit)
 * unavailable. Firmware gates are checked unless `ignoreFirmwareGates`; other reasons (the app's
 * preconditions) only with `enforcePreconditions` (both MicDeviceOptions, defaults false / true).
 */
export function requireAvailable(
  state: MicState,
  id: ControlId,
  unit?: UnitId,
  o: { ignoreFirmwareGates?: boolean; enforcePreconditions?: boolean } = {},
): void {
  const a: ControlAvailability | undefined = (unit ? state.availability[controlKey(id, unit)] : undefined) ?? state.availability[id]
  if (!a || a.ok) return
  const gate = FIRMWARE_GATE_REASONS.includes(a.reason ?? '')
  if (gate ? o.ignoreFirmwareGates === true : o.enforcePreconditions === false) return
  throw new ControlUnavailableError(id, a.reason ?? 'unavailable', a.message)
}

/** Numeric version compare on dot parts (missing parts = 0). "v" prefixes are stripped. */
export function compareVersions(a: string, b: string): number {
  const parse = (s: string) => s.trim().replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/**
 * Availability from a minimum RX firmware version (inclusive unless `exclusive`):
 * unknown version → { ok: false, reason: 'version-unknown' }.
 */
export function versionGate(version: string | undefined, min: string, o: { exclusive?: boolean; ignore?: boolean } = {}): ControlAvailability {
  if (o.ignore) return { ok: true }
  if (!version || /^0(\.0)*$/.test(version.trim())) return { ok: false, reason: 'version-unknown', message: 'the receiver firmware version is not known yet' }
  const c = compareVersions(version, min)
  const ok = o.exclusive ? c > 0 : c >= 0
  return ok ? { ok: true } : { ok: false, reason: 'firmware-too-old', message: `needs receiver firmware ${o.exclusive ? 'above' : 'at least'} ${min} (has ${version})` }
}

/** A test value different from `current` for a control (used by the conformance suite). */
export function alternativeValue(spec: ControlSpec, current: ControlValue | undefined): ControlValue | undefined {
  switch (spec.kind) {
    case 'switch':
      return current === true ? false : true
    case 'choice': {
      const o = (spec.options ?? []).find((x) => x.value !== current)
      return o?.value
    }
    case 'steps':
    case 'range': {
      const r = spec.range
      if (!r) return undefined
      return current === r.min ? r.min + r.step : r.min
    }
    case 'action':
      return undefined
  }
}
