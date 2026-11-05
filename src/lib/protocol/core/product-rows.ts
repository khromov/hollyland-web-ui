/**
 * Builders for registry rows. Used by models.ts (legacy rows) and families/<code>/products.ts.
 * Runtime imports only from ./ids, types only from ../models (models.ts aggregates the family
 * rows at module evaluation, FAMILIES.md §3.6 import-cycle rule).
 */
import type { ProductInfo } from '../models'
import { APP_ID_VENDOR, HOLLYLAND_VENDOR_ID, type FamilyCode } from './ids'
import type { SupportInfo } from './types'

type Row = Omit<ProductInfo, 'vendorId' | 'family' | 'capabilities' | 'heartbeatIntervalMs' | 'variant' | 'familyCode' | 'support'> & {
  vendorId?: number
  family?: ProductInfo['family']
  capabilities?: ProductInfo['capabilities']
  heartbeatIntervalMs?: number
  variant?: ProductInfo['variant']
}

/**
 * A USB row of a FamilyDriver family (not driven by HollylandDevice: `family` and `capabilities`
 * stay null). VID defaults to Hollyland; set `vendorIdConfirmed: false` where the apps never
 * check it (M3, MELO P1).
 */
export function usbProduct(familyCode: FamilyCode, support: SupportInfo, row: Row): ProductInfo {
  return {
    vendorId: HOLLYLAND_VENDOR_ID,
    family: null,
    capabilities: null,
    heartbeatIntervalMs: 0,
    variant: null,
    idKind: 'usb',
    ...row,
    familyCode,
    support,
  }
}

/**
 * A product that is not a USB device (BLE charging case, Bluetooth earphones). `productId` is the
 * app's internal id (MAX 2 BOX 101, OWS 102, MELO P1 earphones 772), vendorId APP_ID_VENDOR (0),
 * so `lookupProduct(vid, pid)` and the USB filters never match it (FAMILIES.md §1.4).
 */
export function appProduct(familyCode: FamilyCode, support: SupportInfo, row: Omit<Row, 'vendorId'>): ProductInfo {
  return {
    family: null,
    capabilities: null,
    heartbeatIntervalMs: 0,
    variant: null,
    ...row,
    vendorId: APP_ID_VENDOR,
    idKind: 'app',
    familyCode,
    support,
  }
}

/** Support record for a family whose driver is still a stub (FAMILIES.md §2.2 Phase 0). */
export function recognised(research: string, confidence: SupportInfo['confidence'], note?: string): SupportInfo {
  return { level: 'recognised', hardware: 'untested', confidence, research, ...(note ? { note } : {}) }
}
