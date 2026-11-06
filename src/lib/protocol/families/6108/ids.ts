/**
 * LARK A1 control ids and the mic-slot rule the app needs before (or without) loading the driver: no imports
 * beyond types, so the app's main chunk carries these few lines and not the A1 driver, which the registry loads
 * with import() (core/loader.ts). status.ts and controls.ts re-export everything here.
 */
import type { MicState } from '../../core/types'

/**
 * Family-scoped control ids for A1 settings without a canonical id (core/controls.ts CONTROL). The value domains
 * below are what the session writes into MicState.values; the A1 controls (Phase 2, W5) use the same ids.
 */
export const A1_CONTROL = {
  /** "EQ Adjustment": 1 Low, 2 Bright, 3 Equalization (wire values). */
  EQ: 'a1.eq',
  /** "Reverb Adjustment" switch. */
  REVERB_ENABLED: 'a1.reverb.enabled',
  /** Reverb size: 0 Small, 1 Medium, 2 Large (wire values). */
  REVERB_LEVEL: 'a1.reverb.level',
  /** "Mode setting": 0 Normal, 1 Performance (wire values). */
  SIGNAL_MODE: 'a1.signalMode',
  /**
   * Hidden cloud-driven performance flag (0x45 / 0x46). A value only, read at start-up (0x46) for the console: no
   * control, because neither app lets the user set it (A HLDevice6302ViewModel.handlePerformanceMode syncs it from
   * the cloud config EnhancedModeSwitch; I -[HL6108DeviceInfoSync checkEnhanceStatus:] @0x100204e1c).
   */
  PERFORMANCE: 'a1.performance',
  /**
   * "Wireless settings": 2 = "2 Mic & 1 RX", 4 = "4 Mic & 1 RX", from the RX version's second part (A
   * HLDevice6302Activity.onResGetVersion is6108FourMicOneRx). The switch re-flashes RX and mics: catalogued as a
   * destructive control, never implemented (controls.ts).
   */
  WIRELESS_MODE: 'a1.wirelessMode',
} as const

/**
 * 4 Mic & 1 RX firmware: the RX version's second part is 1 (A larkc1/HLDevice6302Activity.onResGetVersion:
 * split('.') size >= 4 and Integer.parseInt(split[1]) == 1 → is6108FourMicOneRx). Undefined when unknown.
 */
export function isA1FourMicFirmware(rxVersion: string | undefined): boolean | undefined {
  if (!rxVersion) return undefined
  const parts = rxVersion.trim().split('.')
  if (parts.length < 4) return undefined
  return parseInt(parts[1], 10) === 1
}

/** Mic slots of a firmware mode: 4 for 4 Mic & 1 RX (RX version x.1.x.x), 2 otherwise; undefined while unknown. */
export function a1MicSlotsOfVersion(rxVersion: string | undefined): 2 | 4 | undefined {
  const four = isA1FourMicFirmware(rxVersion)
  return four === undefined ? undefined : four ? 4 : 2
}

/**
 * Mic slots of the kit, for the 2- or 4-mic layout: from the RX version (A HLDevice6302Activity.onResGetVersion), else
 * 4 when a heartbeat reports TX3 or TX4 online, else undefined (the app assumes 2 until the version arrives).
 */
export function a1MicSlots(state: MicState): 2 | 4 | undefined {
  const v = state.values[A1_CONTROL.WIRELESS_MODE]
  if (v === 2 || v === 4) return v
  const fromVersion = a1MicSlotsOfVersion(state.units.rx.version)
  if (fromVersion) return fromVersion
  return state.units.tx3?.online || state.units.tx4?.online ? 4 : undefined
}
