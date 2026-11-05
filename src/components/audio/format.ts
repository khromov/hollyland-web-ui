import { findPreset } from '../../lib/audio/voicefx'
import { usbChannelMeters } from '../../lib/ui/meters'

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** "01:42" (or "1:02:03" past an hour). */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`
}

/** "02:16.4": minutes, seconds and tenths. */
export function fmtLength(sec: number): string {
  const tenths = Math.max(0, Math.floor(sec * 10))
  return `${fmtClock(tenths / 10)}.${tenths % 10}`
}

/** Timecode split for display: "01:42" and ".18". */
export function fmtTimecode(sec: number): [string, string] {
  const hundredths = Math.max(0, Math.floor(sec * 100))
  return [fmtClock(hundredths / 100), `.${pad(hundredths % 100)}`]
}

/** "17:38:04" */
export function fmtTimeOfDay(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

/** "39.3 MB" / "812 kB" */
export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`
}

/** "Warm & Solid", "Mic 1: Clean Voice · Mic 2: off", or "Raw". */
export function effectLabel(processed: boolean, fx: readonly (string | null)[], channelMode: number | null, names: readonly [string, string]): string {
  if (!processed || !fx.some((id) => id !== null)) return 'Raw'
  const name = (id: string | null) => findPreset(id)?.name ?? 'off'
  if (fx[0] === fx[1]) return name(fx[0])
  const ch = usbChannelMeters(channelMode, names)
  return `${ch[0].label}: ${name(fx[0])} · ${ch[1].label}: ${name(fx[1])}`
}
