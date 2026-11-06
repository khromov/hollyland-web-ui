/**
 * LARK M3 texts and checks the app needs before (or without) loading the driver: no runtime imports, so the app's
 * main chunk carries these lines and not the M3 driver, which the registry loads with import() (core/loader.ts).
 * controls.ts and session.ts re-export them.
 */
import type { M3Device } from './session'

/** "Restart Device" / "This change requires a restart. Continue?" (R restart_device, restart_device_desc). */
export const M3_RESTART_TEXT = 'This change requires a restart. Continue?'

/**
 * Whether a MicDevice is an M3Device (channel-mode restart confirm, `channelModeNeedsConfirm`). Checked by family
 * and method rather than `instanceof`, so the check does not load the driver.
 */
export function isM3Device(d: unknown): d is M3Device {
  const m = d as Partial<M3Device> | null | undefined
  return !!m && typeof m === 'object' && m.family === '6303' && typeof m.channelModeNeedsConfirm === 'function'
}
