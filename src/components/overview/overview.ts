/**
 * Pure helpers for the Overview page: labels and rules from docs/research/features.md §4, §12, §16.
 */
import type { Family } from '../../lib/protocol'
import type { SegmentOption } from '../../lib/ui/types'
import { toasts } from '../../lib/ui/toast.svelte'

export type Level = { rmsDb: number; peakDb: number }
export type LevelReader = () => Level | null

/** Battery status word, exactly as the A2 app (C6118DeviceActivity#updateBatteryView). */
export function micBatteryWord(battery: number | undefined, charging: boolean): string {
  if (!battery || battery <= 0) return ''
  if (charging) return 'Charging'
  return battery <= 10 ? 'Low' : 'Normal'
}

/** Camera RX row (§4.2): "--" when 0, "Low" at 10 % or below, otherwise "Normal". No charging state. */
export function cameraRxBatteryWord(battery: number | undefined): string {
  if (!battery || battery <= 0) return '--'
  return battery <= 10 ? 'Low' : 'Normal'
}

/** Noise level options: Weak / Medium / Strong on 6118 (1/2/3), Weak / Strong on M2/M2S (1/2). */
export function noiseOptions(maxLevel: number): SegmentOption<number>[] {
  if (maxLevel >= 3) {
    return [
      { value: 1, label: 'Weak' },
      { value: 2, label: 'Medium' },
      { value: 3, label: 'Strong' },
    ]
  }
  return [
    { value: 1, label: 'Weak' },
    { value: maxLevel, label: 'Strong' },
  ]
}

export function noiseLevelName(level: number | undefined, maxLevel: number): string | null {
  if (level === undefined) return null
  if (level <= 0) return 'Off'
  return noiseOptions(maxLevel).find((o) => o.value === level)?.label ?? `Level ${level}`
}

export const CHANNEL_MODE_LABEL: Record<number, string> = { 0: 'Mono', 1: 'Stereo', 2: 'SafeTr' }

export const CHANNEL_MODE_HINT: Record<number, string> = {
  0: 'Both mics mixed onto one channel.',
  1: 'Mic 1 on the left channel, Mic 2 on the right.',
  2: 'Safety track: second channel recorded 6 dB lower',
}

/** The A2 renders any value other than 0/1 as SafeTr. */
export function normaliseChannelMode(mode: number | undefined, family: Family | null): number | undefined {
  if (mode === undefined) return undefined
  if (family === '6118' && mode !== 0 && mode !== 1) return 2
  return mode
}

export const PRESET_OPTIONS: SegmentOption<number>[] = [
  { value: 0, label: 'Bright' },
  { value: 1, label: 'Low' },
  { value: 2, label: 'Balance' },
]

export const VOLUME_LOCKED_TEXT = 'Volume adjustment locked, please unlock first'

/** Label of the noise control in the official app, per family (M2S "NC", M2 "NC Level"). */
export function noiseLabel(family: Family | null): string {
  if (family === '6302') return 'NC'
  if (family === '6301') return 'NC Level'
  return 'Noise Cancellation'
}

/** Label of the volume control in the official app, per family. */
export function volumeLabel(family: Family | null): string {
  if (family === '6302') return 'Volume adjustment'
  if (family === '6301') return 'Volume'
  return 'RX volume'
}

/**
 * Meter source for a mic, following the app (C6118AudioLevelMonitor): Stereo L = Mic 1, R = Mic 2;
 * Mono and SafeTr use the first channel for both, and in SafeTr Mic 2 reads 6 dB lower.
 * An unknown mode falls back to the plain left/right mapping.
 */
export function meterSource(
  mic: 0 | 1,
  mode: number | undefined,
  read: (channel: number) => Level | null,
  inputChannels: number,
): { read: LevelReader; caption: string } {
  if (mode === 0) return { read: () => read(0), caption: 'Mono mix' }
  if (mode === 2) {
    if (mic === 0) return { read: () => read(0), caption: 'Main track' }
    return {
      read: () => {
        const l = read(0)
        return l ? { rmsDb: l.rmsDb - 6, peakDb: l.peakDb - 6 } : null
      },
      caption: 'Safety track, -6 dB',
    }
  }
  if (inputChannels === 1) return { read: () => read(0), caption: 'Mono input' }
  return { read: () => read(mic), caption: mic === 0 ? 'Left channel' : 'Right channel' }
}

let lastBlocked = { msg: '', at: 0 }
/** Toast for a swallowed interaction (the app's touch interceptor), at most once per 2 s per message. */
export function blockedToast(msg: string) {
  const now = Date.now()
  if (msg === lastBlocked.msg && now - lastBlocked.at < 2000) return
  lastBlocked = { msg, at: now }
  toasts.warning(msg)
}

export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
