/**
 * What the shell says about the link to the receiver: the header lamp and words, the status
 * line, and the platform truth on the Connect page. Everything is derived from `session`, so the
 * header, status line and bands never disagree.
 */
import type { LampColor, LampState } from '../../lib/ui/types'
import type { StatusItem } from '../../lib/ui/StatusLine.svelte'
import { session } from '../../lib/state/session.svelte'
import { isWebHidSupported } from '../../lib/protocol'

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

export const DISCLAIMER = 'Independent project · not affiliated with Hollyland'

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
  get webHid(): boolean {
    return isWebHidSupported()
  }
  /** Replies are not known yet (just connected, still probing). */
  get probing(): boolean {
    return session.phase === 'ready' && !session.live && !session.writeOnly
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

  /** The words after the device name in the header ("Live · read & write"). */
  get mode(): string {
    switch (session.phase) {
      case 'unsupported':
        return 'No WebHID'
      case 'idle':
        return 'No receiver'
      case 'connecting':
        return 'Connecting…'
      case 'restarting':
        return 'Restarting'
      case 'lost':
        return 'Connection lost'
      case 'ready':
        if (session.writeOnly) return 'Send only'
        if (session.live) return 'Live · read & write'
        return 'Checking the link…'
    }
  }

  /** One sentence for the polite live region in the header (announced when the link changes). */
  get announcement(): string {
    const name = session.displayName
    switch (session.phase) {
      case 'ready':
        if (session.writeOnly) return `${name} connected. Send only: settings can be sent, nothing can be read back.`
        if (session.live) return `${name} connected. Live, read and write.`
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

  get firmware(): string | null {
    const u = session.units
    if (!u) return null
    const parts: string[] = []
    if (u.rx.version) parts.push(`RX ${u.rx.version}`)
    if (u.tx1.version) parts.push(`TX1 ${u.tx1.version}`)
    if (u.tx2.version) parts.push(`TX2 ${u.tx2.version}`)
    return parts.length ? parts.join(' · ') : null
  }

  /** Items of the desktop status line; `wide` adds the firmware versions (≥ 960 px). */
  statusItems(nowMs: number, wide = true): StatusItem[] {
    const kind = this.viaBridge ? 'Local bridge' : 'WebHID'
    const age = session.lastUpdate ? formatAge(nowMs - session.lastUpdate) : null
    switch (session.phase) {
      case 'unsupported':
      case 'idle': {
        const items: StatusItem[] = [
          { lamp: { state: 'hollow' }, label: 'Not connected' },
          { label: this.webHid ? 'WebHID available' : 'WebHID not available in this browser' },
        ]
        if (typeof window !== 'undefined' && !window.isSecureContext) items.push({ label: 'Not a secure context' })
        return items
      }
      case 'connecting':
        return [
          { lamp: { state: 'on', blink: true }, label: `${kind} · connecting` },
          ...(session.step ? [{ label: session.step }] : []),
        ]
      case 'restarting':
        return [{ lamp: { state: 'on', blink: true }, label: 'Restarting · reconnecting' }]
      case 'lost':
        return [
          { lamp: { color: 'rec', state: 'on' }, label: 'Connection lost' },
          ...(age ? [{ label: 'Last reply', value: `${age} ago` }] : []),
          { label: 'Reconnects when the receiver is back' },
        ]
      case 'ready': {
        if (session.writeOnly)
          return [
            { lamp: { state: 'hollow' }, label: `${kind} · send only` },
            { label: `${PLATFORM_NAME[platform]} drops the receiver’s replies` },
          ]
        if (!session.live) return [{ lamp: { state: 'hollow' }, label: `${kind} · checking replies` }]
        const fw = this.firmware
        return [
          { lamp: { state: 'on' }, label: `${kind} · two-way` },
          ...(age ? [{ label: 'Last reply', value: `${age} ago` }] : []),
          ...(this.audioHeldByBridge ? [{ label: 'USB audio paused while the bridge runs' }] : []),
          ...(fw && wide ? [{ label: 'Firmware', value: fw }] : []),
        ]
      }
    }
  }

  /** Right-hand end of the status line. */
  get statusEnd(): string {
    if (!this.connected) return `${DISCLAIMER} · LARK is a trademark of its owner`
    return DISCLAIMER
  }
}

export const link = new Link()
