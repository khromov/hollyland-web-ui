/**
 * Meters on the family Overview. A meter measures what it says: a USB audio channel of the
 * receiver (app-side, needs microphone permission) or the levels the device pushes itself (MELO
 * P1, no permission). Per-mic windows only when each mic has its own source:
 *  - device levels: always (one level per mic)
 *  - USB: two mics on two channels, or four mics on four channels (LARK M3 4-track, once the
 *    browser delivers four); four mics on a two-channel output get one pair of USB L / R windows
 * USB windows are neutral (no mic colour) and say what the channel carries when it isn't one mic.
 */
import type { FamilyCode } from '../../../lib/protocol'
import type { MeterState } from '../../../lib/ui/types'

export interface MicMeter {
  read: () => { rmsDb: number; peakDb: number } | null
  /** What the meter measures ("Mic 1", "Mix · L", "USB L"). */
  label: string
  /** Shown above the bar when the channel isn't simply this mic. */
  caption?: string
  state: MeterState
  message?: string
  onstart?: () => void
  /** Only the first window carries the first-run key. */
  primary: boolean
}

/** USB audio channels the receiver sends in this channel mode (LARK M3 4-track: 4). */
export function usbChannelCount(family: FamilyCode | null, mode: number | undefined): number {
  return family === '6303' && mode === 2 ? 4 : 2
}

/**
 * What USB channel `c` (0 = L, 1 = R, 2, 3) carries, for its window: the mic's own name when
 * each channel is one mic (Stereo, 4-track), the mix in Mono, the bare channel otherwise
 * (safety track, mode unknown, write-only). `caption` is null when the label is the mic.
 */
export function usbChannelLabel(
  family: FamilyCode | null,
  mode: number | undefined,
  c: number,
  micName: string,
): { label: string; caption: string | null } {
  const side = c === 0 ? 'L' : c === 1 ? 'R' : `${c + 1}`
  if (mode === 1 || (family === '6303' && mode === 2)) return { label: micName, caption: null }
  if (mode === 0) return { label: `Mix · ${side}`, caption: `Mix · ${side}` }
  return { label: `USB ${side}`, caption: `USB ${side}` }
}

/** dB → a { rmsDb, peakDb } pair for a meter (device levels carry one value per input). */
export function deviceReading(db: number | undefined, at: number | undefined, now = Date.now()): { rmsDb: number; peakDb: number } | null {
  if (db === undefined || !Number.isFinite(db)) return null
  // A stream that stopped must not freeze the bar at its last level.
  if (at !== undefined && now - at > 1500) return null
  return { rmsDb: db, peakDb: db }
}
