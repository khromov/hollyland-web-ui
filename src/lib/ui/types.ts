export interface SegmentOption<V> {
  value: V
  label: string
  disabled?: boolean
  hint?: string
}

/** One key in a KeyGroup. `glyph` picks a routing glyph for channel-mode keys. */
export interface KeyOption<V> extends SegmentOption<V> {
  glyph?: RoutingMode
  /** Shown under the label on tall keys, e.g. "15 min". */
  sub?: string
}

/**
 * How much the page knows about a value (one look per meaning, see styles/instrument.css):
 * - solid: read back from the receiver
 * - sent: sent from this browser, not confirmed (write-only link)
 * - unknown: never read and never sent
 */
export type Confidence = 'solid' | 'sent' | 'unknown'

/** Identity of a channel. Purple / yellow only when the channel truly carries that mic. */
export type ChannelTone = 'mic1' | 'mic2' | 'neutral'

export type LampColor = 'mic1' | 'mic2' | 'live' | 'rec' | 'neutral'
export type LampState = 'on' | 'off' | 'hollow'

/** Channel mode routing, as drawn on the channel-mode keys. */
export type RoutingMode = 'mono' | 'stereo' | 'safetr'

/** What a meter window shows instead of (or over) live levels. */
export type MeterState =
  | 'live' // levels are flowing
  | 'idle' // first run: "Show live levels" (asks for microphone permission)
  | 'starting' // waiting for the permission prompt / the device
  | 'denied' // permission blocked
  | 'paused' // USB audio paused while the local bridge runs (macOS)
  | 'nodevice' // no USB audio input from the receiver
  | 'error' // anything else, with `message`
