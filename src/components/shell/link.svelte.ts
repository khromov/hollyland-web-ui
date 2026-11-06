/**
 * What the shell says about the link to the receiver: the header lamp and state word, the status
 * line and the footer disclaimer. Everything is derived from `session`, so the header, status line
 * and bands never disagree.
 */
import type { LampColor, LampState } from '../../lib/ui/types'
import type { StatusItem } from '../../lib/ui/StatusLine.svelte'
import { session } from '../../lib/state/session.svelte'

export type Platform = 'mac' | 'windows' | 'linux' | 'chromeos' | 'android' | 'ios' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const p = (nav.userAgentData?.platform || nav.platform || '').toLowerCase()
  const ua = (nav.userAgent || '').toLowerCase()
  if (/android/.test(ua)) return 'android'
  if (/iphone|ipad|ipod/.test(ua) || (p.includes('mac') && nav.maxTouchPoints > 1)) return 'ios'
  if (/cros/.test(ua) || p.includes('chrome os') || p.includes('chromeos')) return 'chromeos'
  if (p.includes('mac')) return 'mac'
  if (p.includes('win')) return 'windows'
  if (p.includes('linux')) return 'linux'
  return 'other'
}

export const platform: Platform = detectPlatform()

export const PLATFORM_NAME: Record<Platform, string> = {
  mac: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
  chromeos: 'ChromeOS',
  android: 'Android',
  ios: 'iOS',
  other: 'This system',
}

/** Shared clock for "last reply 0.4 s ago": ticks only while something on screen reads it. */
let now = $state(Date.now())
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

export const clock = {
  get now() {
    return now
  },
  /** Call from a component's script: ticks while that component is mounted. */
  use() {
    $effect(() => {
      if (subscribers++ === 0) timer = setInterval(() => (now = Date.now()), 250)
      return () => {
        if (--subscribers === 0 && timer) {
          clearInterval(timer)
          timer = null
        }
      }
    })
  },
}

/** "0.4 s", "12 s", "3 min". */
export function formatAge(ms: number): string {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 60) return `${Math.round(s)} s`
  return `${Math.round(s / 60)} min`
}

export const DISCLAIMER = 'Unofficial · not affiliated with Hollyland'

export interface LampSpec {
  color: LampColor
  state: LampState
  blink?: boolean
}

class Link {
  /** A device session exists (its pages are shown, live, frozen or restarting). */
  get connected(): boolean {
    return session.phase === 'ready' || session.phase === 'restarting' || session.phase === 'lost'
  }
  get viaBridge(): boolean {
    return session.transportKind === 'bridge'
  }
  /**
   * The bridge holds the whole receiver on macOS and Windows, so its USB audio is paused until the
   * bridge stops. On Linux (and ChromeOS) it only detaches the HID driver (docs/BRIDGE.md).
   */
  get audioHeldByBridge(): boolean {
    return this.viaBridge && this.connected && platform !== 'linux' && platform !== 'chromeos'
  }

  /** The header lamp next to the device name. */
  get lamp(): LampSpec {
    switch (session.phase) {
      case 'ready':
        return session.live ? { color: 'live', state: 'on' } : { color: 'live', state: 'hollow' }
      case 'connecting':
      case 'restarting':
        return { color: 'live', state: 'on', blink: true }
      case 'lost':
        return { color: 'rec', state: 'on' }
      default:
        return { color: 'live', state: 'hollow' }
    }
  }

  /** The link in a word: the header lamp's tooltip and accessible name. */
  get lampLabel(): string {
    switch (session.phase) {
      case 'unsupported':
      case 'idle':
        return 'Not connected'
      case 'connecting':
        return 'Connecting…'
      case 'restarting':
        return 'Restarting'
      case 'lost':
        return 'Connection lost'
      case 'ready':
        return 'Connected'
    }
  }

  /**
   * The state word printed after the header lamp ("Not connected", "Connecting…"). Empty while
   * connected (the lamp and the device name say it) and while the link is lost (the band under
   * the header says it).
   */
  get mode(): string {
    return session.phase === 'ready' || session.phase === 'lost' ? '' : this.lampLabel
  }

  /** One sentence for the polite live region in the header (announced when the link changes). */
  get announcement(): string {
    const name = session.displayName
    switch (session.phase) {
      case 'ready':
        if (session.writeOnly) return `${name} connected. Status unavailable.`
        if (session.live) return `${name} connected.`
        return ''
      case 'lost':
        return 'Connection to the receiver was lost.'
      case 'restarting':
        return 'The receiver is restarting.'
      case 'idle':
        return 'Not connected.'
      default:
        return ''
    }
  }

  /** "RX … · TX1 … · TX2 …" (every unit with a known version, any family), or null. */
  get firmware(): string | null {
    return session.firmware
  }

  /** The receiver's firmware version, for the phone link band, or null. */
  get rxVersion(): string | null {
    return session.unitList.find((u) => u.id === 'rx')?.version ?? null
  }

  /**
   * Items of the desktop status line: "● Connected  Last reply 0.4 s ago  Firmware RX … · TX1 …".
   * `wide` adds the firmware versions (≥ 960 px). Without a session it is empty (the header
   * already says "Not connected" / "Connecting…"), and a lost link keeps only the time of the
   * last reply (the band says "Connection lost").
   */
  statusItems(nowMs: number, wide = true): StatusItem[] {
    const age = session.lastUpdate ? formatAge(nowMs - session.lastUpdate) : null
    switch (session.phase) {
      case 'unsupported':
      case 'idle':
      case 'connecting':
      case 'restarting':
        return []
      case 'lost':
        return [
          age
            ? { lamp: { color: 'rec', state: 'on' }, label: 'Last reply', value: `${age} ago` }
            : { lamp: { color: 'rec', state: 'on' }, label: 'Connection lost' },
        ]
      case 'ready': {
        // Status unavailable (or not known yet): a hollow lamp; the strip under the header says why.
        if (!session.live) return [{ lamp: { state: 'hollow' }, label: 'Connected' }]
        const fw = this.firmware
        return [
          { lamp: { state: 'on' }, label: this.viaBridge ? 'Connected · bridge' : 'Connected' },
          ...(age ? [{ label: 'Last reply', value: `${age} ago` }] : []),
          ...(this.audioHeldByBridge ? [{ label: 'USB audio paused' }] : []),
          ...(fw && wide ? [{ label: 'Firmware', value: fw }] : []),
        ]
      }
    }
  }

  /** Right-hand end of the status line. */
  get statusEnd(): string {
    return DISCLAIMER
  }
}

export const link = new Link()
