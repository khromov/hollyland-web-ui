/**
 * Firmware version rules of the official apps, and the Lark C1 volume wire map. Used by the registry rows
 * (models.ts Capabilities, firmware gates) and by HollylandDevice; no imports, so the rows do not pull the
 * legacy command catalogue (commands.ts re-exports everything here).
 */

/**
 * Lark C1 (PID 1) volume buttons 1..6 -> wire value of 0x05 / 0x04: the button tags of
 * A application/common/compatibility/DeviceCompat.getVoiceLevels(1) = [5, 4, 3, 0, 1, 2] (the layout
 * default tags of res/layout/activity_hldevice.xml voice_1..voice_6 are the same). Every other PID uses
 * [0..5]. iOS sends 0..2 for every 6501-engine type (HLLarkM2View voiceView @0x1000cf8c4), i.e. the
 * top three Android buttons. The meaning (dB) is not documented; [?] 0 = 0 dB, 1/2 = +1/+2, 3/4/5 = -1/-2/-3.
 */
export const LARK_C1_VOLUME_WIRE: readonly number[] = [5, 4, 3, 0, 1, 2]

/**
 * A version that is "not known yet" and must be asked for again.
 * Android 6118: C6118DeviceRuntimeManager.isVersionMissing = blank, or
 * C6118FirmwareUpgradeCoordinator.toVersionInt (strip [^0-9.], join the digits, parse) == 0, so
 * "0.0.0.0" and "0.0.0.000" (six zero bytes through formatSixByteDeviceVersion) both count.
 * Android M2: HLDeviceActivity.onEvent re-sends 0x03 on "0.0.0.0". iOS: handleDeviceVersionEntity
 * @0x1000bc6ec re-queries after 1 s on "0.0.0.0" or "0.0.0.000". Here: blank or every digit 0.
 * (Android's int parse also treats a joined value > 2^31-1 as missing; that overflow is not copied.)
 */
export function isVersionMissing(v: string | null | undefined): boolean {
  if (v == null) return true
  const digits = v.replace(/[^0-9]/g, '')
  return digits.length === 0 || /^0+$/.test(digits)
}

const versionParts = (v: string): number[] | null => {
  const parts = v.trim().split('.')
  if (parts.some((x) => !/^\d+$/.test(x))) return null
  return parts.map((x) => parseInt(x, 10))
}

/**
 * Android application/httpcommon/utils/Util.isNewVersion(v, ref): both need >= 4 dot parts; the
 * first ref.length parts are compared numerically; strictly greater -> true, equal -> false.
 */
export function isNewerVersionAndroid(v: string | undefined, ref: string): boolean {
  if (!v) return false
  const a = versionParts(v)
  const b = versionParts(ref)
  if (!a || !b || a.length < 4 || b.length < 4) return false
  for (let i = 0; i < b.length; i++) {
    const x = a[i] ?? 0
    if (x > b[i]) return true
    if (x < b[i]) return false
  }
  return false
}

/**
 * iOS `[v compare:ref options:NSNumericSearch] == NSOrderedDescending` for dotted numeric versions
 * (used by -[HL6501Engine applyRXVersionCapabilities:toState:] @0x1000bd88c against "2.0.0.9").
 * Components compare numerically; with an equal prefix the longer string is greater.
 */
export function isNewerVersionIos(v: string | undefined, ref: string): boolean {
  if (!v) return false
  const a = versionParts(v)
  const b = versionParts(ref)
  if (!a || !b) return false
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return a.length > b.length
}

/** Last '.' component as an integer (iOS M2 noise-switch rule: `[[v componentsSeparatedByString:@"."] lastObject] intValue`). */
export function lastVersionComponent(v: string | undefined): number | null {
  if (!v) return null
  const last = v.split('.').pop() ?? ''
  const m = /^\s*[+-]?\d+/.exec(last)
  return m ? parseInt(m[0], 10) : 0
}
