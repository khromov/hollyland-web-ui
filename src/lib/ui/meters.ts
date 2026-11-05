import type { ChannelTone } from './types'

export interface UsbChannelMeter {
  /** What the channel carries, for the meter label and its accessible name. */
  label: string
  /** USB channel side. */
  side: 'L' | 'R'
  /** Purple / yellow only when the channel truly carries that mic. */
  tone: ChannelTone
}

/**
 * Meters measure the receiver's USB channels, not mics. What each channel carries follows the
 * channel mode (normalised: 0 mono, 1 stereo, 2 SafeTr / safety track):
 * - Stereo: Mic 1 on L (purple), Mic 2 on R (yellow)
 * - Mono: the mix on both sides, neutral
 * - SafeTr: the mix on L ("Main") and a −6 dB copy on R ("Safety −6 dB"), neutral
 * - unknown (null; also write-only before the mode is confirmed): neutral L / R
 */
export function usbChannelMeters(
  mode: number | null | undefined,
  names: readonly [string, string] = ['Mic 1', 'Mic 2'],
): [UsbChannelMeter, UsbChannelMeter] {
  switch (mode) {
    case 1:
      return [
        { label: names[0], side: 'L', tone: 'mic1' },
        { label: names[1], side: 'R', tone: 'mic2' },
      ]
    case 0:
      return [
        { label: 'Mix · L', side: 'L', tone: 'neutral' },
        { label: 'Mix · R', side: 'R', tone: 'neutral' },
      ]
    case 2:
      return [
        { label: 'Main', side: 'L', tone: 'neutral' },
        { label: 'Safety −6 dB', side: 'R', tone: 'neutral' },
      ]
    default:
      return [
        { label: 'L', side: 'L', tone: 'neutral' },
        { label: 'R', side: 'R', tone: 'neutral' },
      ]
  }
}

/** dBFS for display: one decimal, a real minus sign, "−∞" at the floor. */
export function formatDb(db: number, floor = -60): string {
  if (!Number.isFinite(db) || db <= floor + 0.05) return '−∞'
  const v = Math.round(db * 10) / 10
  if (v >= 0) return v === 0 ? '0.0' : `+${v.toFixed(1)}`
  return `−${Math.abs(v).toFixed(1)}`
}
