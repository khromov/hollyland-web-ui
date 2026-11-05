/**
 * Pure helpers for the Overview page: labels and rules from docs/research/features.md §4, §12, §16.
 */
import type { Family } from '../../lib/protocol'
import type { BlockReason } from '../../lib/state/session.svelte'
import type { KeyOption, SegmentOption } from '../../lib/ui/types'
import { toasts } from '../../lib/ui/toast.svelte'

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

export const CHANNEL_MODE_LABEL: Record<number, string> = { 0: 'Mono', 1: 'Stereo', 2: 'SafeTr' }

export const CHANNEL_MODE_HINT: Record<number, string> = {
  0: 'Both mics mixed onto one channel.',
  1: 'Mic 1 on the left channel, Mic 2 on the right.',
  2: 'Safety track: second channel recorded 6 dB lower',
}

const MODE_GLYPH = { 0: 'mono', 1: 'stereo', 2: 'safetr' } as const

/** Channel-mode keys with their routing glyphs, for the modes this receiver offers. */
export function channelModeOptions(modes: readonly number[]): KeyOption<number>[] {
  return modes.map((m) => ({
    value: m,
    label: CHANNEL_MODE_LABEL[m] ?? `Mode ${m}`,
    hint: CHANNEL_MODE_HINT[m],
    glyph: MODE_GLYPH[m as 0 | 1 | 2],
  }))
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

/** Block reasons, short: said in place while blocked and in the toast when the control is touched. */
export const BLOCK_SHORT: Record<Exclude<BlockReason, null>, string> = {
  'mic-disconnected': 'No mic connected',
  'all-muted': 'Mics are muted',
}
export const VOLUME_LOCKED_TEXT = 'Volume is locked'
export const LIGHT_OFF_TEXT = 'Turn on the light first'
/** A firmware-gated feature this receiver doesn't offer (the full reason goes in the tooltip). */
export const GATE_SHORT = 'Needs newer firmware'


/** Label of the noise control in the official app, per family (M2S "NC", M2 "NC Level"). */
export function noiseLabel(family: Family | null): string {
  if (family === '6302') return 'NC'
  if (family === '6301') return 'NC Level'
  return 'Noise cancellation'
}

/** Label of the volume control in the official app, per family. */
export function volumeLabel(family: Family | null): string {
  if (family === '6302') return 'Volume adjustment'
  if (family === '6301') return 'Volume'
  return 'RX volume'
}

/**
 * Where a mic lands on the receiver's USB output, from the channel mode (normalised).
 * `side` is the mono legend ("L", "R", "L + R"), `text` says it in words.
 */
export function micOutput(mic: 0 | 1, mode: number | null | undefined): { side: string; text: string } | null {
  switch (mode) {
    case 1:
      return mic === 0 ? { side: 'L', text: 'Left channel' } : { side: 'R', text: 'Right channel' }
    case 0:
      return { side: 'L + R', text: 'Mono mix' }
    case 2:
      return { side: 'L + R', text: 'Main + safety' }
    default:
      return null
  }
}

/**
 * Caption above a meter window whose USB channel isn't simply one mic ("Mix · L", "Main",
 * "Safety −6 dB", "USB L" while the channel mode is unknown); null in Stereo (the mic's colour says it).
 */
export function meterCaption(usb: { label: string; tone: string }): string | null {
  if (usb.tone !== 'neutral') return null
  return usb.label.length <= 2 ? `USB ${usb.label}` : usb.label
}

/**
 * When each setting was last sent from this browser on a write-only link, per receiver model.
 * The session remembers the values sent; this adds the time for "Last sent 17:42".
 */
const SENT_AT_PREFIX = 'mc.overview.sentAt.'
export type SentAt = Partial<Record<string, number>>

export function loadSentAt(productId: number | undefined): SentAt {
  if (productId === undefined) return {}
  try {
    const raw = localStorage.getItem(SENT_AT_PREFIX + productId.toString(16))
    return raw ? (JSON.parse(raw) as SentAt) : {}
  } catch {
    return {}
  }
}

export function saveSentAt(productId: number | undefined, value: SentAt) {
  if (productId === undefined) return
  try {
    localStorage.setItem(SENT_AT_PREFIX + productId.toString(16), JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

/** "17:42" */
export function formatHm(t: number | undefined | null): string | null {
  if (!t) return null
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** When a value was sent: "17:42" today, "yesterday 17:42", otherwise "3 Nov 17:42". */
export function formatSentAt(t: number | undefined | null, now = Date.now()): string | null {
  const hm = formatHm(t)
  if (!hm || !t) return hm
  const day = (x: number) => {
    const d = new Date(x)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  }
  const days = Math.round((day(now) - day(t)) / 86_400_000)
  if (days === 0) return hm
  if (days === 1) return `yesterday ${hm}`
  const date = new Date(t).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  })
  return `${date} ${hm}`
}

let lastBlocked = { msg: '', at: 0 }
/** Toast for a swallowed interaction (the app's touch interceptor), at most once per 2 s per message. */
export function blockedToast(msg: string) {
  const now = Date.now()
  if (msg === lastBlocked.msg && now - lastBlocked.at < 2000) return
  lastBlocked = { msg, at: now }
  toasts.warning(msg)
}
