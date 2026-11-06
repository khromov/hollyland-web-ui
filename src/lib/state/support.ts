/**
 * Untested products (docs/FAMILIES.md §0 #6, §4.3): "untested" is data (ProductInfo.support), and
 * the one-time first-connect notice is dismissed per product in this browser. Storage can be
 * unavailable (private windows, blocked site data): every access is wrapped, and the notice then
 * simply shows again on the next connection.
 */
import { familyCodeOf, type ProductInfo } from '../protocol/app'

const NOTICE_KEY_PREFIX = 'mc.untestedNotice.'

/** Storage key per product: family code + product id (USB PID, or the app id of a Bluetooth product). */
function noticeKey(p: ProductInfo): string {
  return `${NOTICE_KEY_PREFIX}${familyCodeOf(p) ?? p.code}.${p.productId}`
}

export function isNoticeDismissed(p: ProductInfo): boolean {
  try {
    return localStorage.getItem(noticeKey(p)) !== null
  } catch {
    return false
  }
}

export function rememberNoticeDismissed(p: ProductInfo): void {
  try {
    localStorage.setItem(noticeKey(p), String(Date.now()))
  } catch {
    /* storage unavailable: the notice shows again next time */
  }
}
