/**
 * Display rules for "Device Information" (features.md §6; Android C6118DeviceInfoViewModel
 * #buildVersionDisplayText, #buildPlainDisplayText, #isInvalidDisplayText).
 * A value is shown as "--" (null here) when the unit is offline (the RX always counts as online),
 * when the string is empty, when a version is not a positive version, or when a serial number
 * consists only of ':', '-', '.', spaces and '0'.
 */

/** Digits of a version string concatenated, like HexUtil/toVersionInt ("3.0.2.008" -> 302008). */
function versionInt(v: string): number {
  const digits = v.replace(/[^0-9.]/g, '').replace(/\./g, '')
  return digits ? Number(digits) : 0
}

export function versionText(v: string | undefined | null, online: boolean): string | null {
  if (!online || !v) return null
  const s = v.trim().replace(/^[vV]/, '')
  if (!s || !(versionInt(s) > 0)) return null
  return s
}

export function serialText(sn: string | undefined | null, online: boolean): string | null {
  if (!online || !sn) return null
  const s = sn.trim()
  if (!s || /^[:\-. 0]+$/.test(s)) return null
  return s
}
