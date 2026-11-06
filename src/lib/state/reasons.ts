/**
 * Short UI words for why a control is blocked (MicState.availability reasons, docs/FAMILIES.md
 * §3.3) and one-sentence confirmations for restart / reset / destructive controls. Copy rule:
 * a few words, shown only while blocked; no protocol jargon, no model-specific claims.
 */
import type { ControlAvailability, ControlSpec } from '../protocol/app'

/** Reason code → a few words. Unknown codes fall back to "Unavailable". */
export const REASON_TEXT: Readonly<Record<string, string>> = {
  'mic-disconnected': 'No mic connected',
  'no-mic-online': 'No mic connected',
  'mic-offline': 'Mic offline',
  'unit-offline': 'Offline',
  'all-mics-muted': 'Mics are muted',
  'both-mics-required': 'Needs both mics',
  'noise-off': 'Noise cancellation is off',
  'noise-gate-off': 'Noise gate is off',
  'reverb-off': 'Reverb is off',
  'led-off': 'Light is off',
  'volume-locked': 'Volume is locked',
  'firmware-too-old': 'Needs newer receiver firmware',
  'firmware-too-new': 'Not on this firmware',
  'version-unknown': 'Checking firmware…',
  'secondary-rx': 'Secondary receiver',
  'not-4t4r': 'Needs 4TX & 4RX mode',
  'two-mic-mode': 'In 2-mic mode',
  'four-mic-mode': 'In 4-mic mode',
  'apple-only': 'iOS app only',
  'box-only': 'Charging case only',
  'timecode-on': 'Timecode is on',
  'real-time-timing': 'Real-time timing',
  'recording-on': 'Recording',
  'wireless-off': 'Wireless monitoring is off',
  'earphone-disconnected': 'No earphones connected',
  'jack-empty': '3.5 mm jack is empty',
  'jack-output': '3.5 mm jack is an output',
  'state-unknown': 'Not read yet',
  'read-only': 'Read-only',
}

/**
 * A few words for a blocked control. `writeOnly` (replies never arrive): "Checking firmware…" becomes
 * "Can't check receiver firmware" and "Not read yet" becomes "Can't read current value".
 */
export function reasonText(a: ControlAvailability | null | undefined, writeOnly = false): string | null {
  if (!a || a.ok) return null
  if (a.reason === 'version-unknown' && writeOnly) return "Can't check receiver firmware"
  if (a.reason === 'state-unknown' && writeOnly) return "Can't read current value"
  return (a.reason && REASON_TEXT[a.reason]) || 'Unavailable'
}

/** What a confirmed control does, for the confirm dialog. */
export interface ConfirmInfo {
  /** Dialog title: the control's label. */
  title: string
  /** One sentence. */
  text: string
  /** restart: the receiver drops off and comes back (the restart overlay follows); reset: timecode reset. */
  kind: 'restart' | 'reset' | 'destructive' | 'disruptive'
  /** Label of the confirm key. */
  action: string
}

/**
 * One sentence of an official-app confirm text: a "Label: " prefix is dropped, and of several
 * sentences the one that says what happens (restart, reset, pairing, erase) is kept.
 */
export function oneSentence(text: string): string {
  const t = text.trim().replace(/^[^:.?!]{1,40}:\s+/, '')
  const parts = t.match(/[^.?!]+[.?!]+/g)?.map((s) => s.trim()) ?? [t]
  return parts.find((s) => /restart|reset|pair|erase|delete|re-?flash/i.test(s)) ?? parts[0] ?? t
}

const FALLBACK_TEXT: Record<ConfirmInfo['kind'], string> = {
  restart: 'The receiver restarts.',
  reset: 'This cannot be undone.',
  destructive: 'This cannot be undone.',
  disruptive: 'The receiver changes mode.',
}

const ACTION: Record<ConfirmInfo['kind'], string> = {
  restart: 'Restart',
  reset: 'Reset',
  destructive: 'Continue',
  disruptive: 'Continue',
}

/**
 * House sentences for the confirmations that aren't a restart, by control id (the official texts
 * name screens and modes this page doesn't show).
 */
const CONFIRM_TEXT: Readonly<Record<string, string>> = {
  'max2.fourMic': 'The mics reconnect.',
  'max2.rxPair': 'The receiver enters pairing mode.',
  'max2.ows.startPairing': 'The earphones disconnect while it searches.',
  'max2.tc.timing': 'Timecode goes back to 00:00:00:00 and a new recording starts.',
}

/**
 * The confirmation of a control. A restart always reads "The receiver restarts." (the title asks
 * "Restart the receiver?"), whatever the official text; other kinds use the house sentence of the
 * control, else one sentence of `text` / the spec's confirmText.
 */
export function confirmInfo(spec: ControlSpec, kind: ConfirmInfo['kind'], text?: string): ConfirmInfo {
  const raw = text ?? spec.confirmText
  const words = kind === 'restart' ? FALLBACK_TEXT.restart : (CONFIRM_TEXT[spec.id] ?? (raw ? oneSentence(raw) : FALLBACK_TEXT[kind]))
  return { title: spec.label, text: words, kind, action: ACTION[kind] }
}

/** restart when the control's confirm text says the device restarts, else disruptive. */
export function disruptiveKind(spec: ControlSpec): 'restart' | 'disruptive' {
  return /restart/i.test(spec.confirmText ?? '') ? 'restart' : 'disruptive'
}
