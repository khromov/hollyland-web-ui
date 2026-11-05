import type { Confidence } from './types'

/** "17:42" for a send time (ms epoch or Date), or null. */
export function sentTime(at: number | Date | null | undefined): string | null {
  if (at === null || at === undefined) return null
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Tooltip / aria-description for a value that isn't read back: "Last sent 17:42 · not confirmed"
 * or "Unknown". Undefined for a value read from the receiver. The hatch or dash on the control
 * is the visible mark; this text is never printed under it.
 */
export function confidenceNote(confidence: Confidence, at?: number | Date | null): string | undefined {
  if (confidence === 'sent') {
    const t = sentTime(at)
    return `Last sent${t ? ` ${t}` : ''} · not confirmed`
  }
  if (confidence === 'unknown') return 'Unknown'
  return undefined
}
