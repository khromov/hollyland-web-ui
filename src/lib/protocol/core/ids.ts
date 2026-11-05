/**
 * Identifiers shared by every layer. No imports: models.ts, families/*\/products.ts and the
 * transports may all import from here without creating cycles (docs/FAMILIES.md §3.6).
 */

/** USB vendor id of Hollyland (A `usbmic/core/USBHIDService.VENDOR_ID` = 13639). */
export const HOLLYLAND_VENDOR_ID = 0x3547
/** EAGLESHERO OEM builds (A `USBHIDService.VENDOR_ID_EAGLES` = 17431; legacy-6501.md §1.4). */
export const EAGLESHERO_VENDOR_ID = 0x4417
/** Vendor ids the official Android app accepts for USB devices (A `USBHIDService.isSupportedUsbDevice`). */
export const KNOWN_VENDOR_IDS: readonly number[] = [HOLLYLAND_VENDOR_ID, EAGLESHERO_VENDOR_ID]
/**
 * Placeholder vendor id for products that are not USB devices (BLE charging case, Bluetooth
 * earphones): their `productId` is the app's internal id (FAMILIES.md §1.4), never a USB PID.
 */
export const APP_ID_VENDOR = 0

/**
 * Product family codes (A `application/common/protocol/Product.java` product names).
 *  - legacy `AA DD` framing on HollylandDevice: 6118 (A2/A2S), 6301 (M2), 6302 (M2S), 6501 (C1 group)
 *  - FamilyDriver on the generic engine: 6108 (A1), 6201 (MELO P1), 6303 (M3), 6701 (MAX 2)
 */
export type FamilyCode = '6118' | '6301' | '6302' | '6501' | '6108' | '6201' | '6303' | '6701'
export type LegacyFamilyCode = '6118' | '6301' | '6302' | '6501'
export type DriverFamilyCode = '6108' | '6201' | '6303' | '6701'

export const LEGACY_FAMILY_CODES: readonly LegacyFamilyCode[] = ['6118', '6301', '6302', '6501']
export const DRIVER_FAMILY_CODES: readonly DriverFamilyCode[] = ['6108', '6201', '6303', '6701']
export const FAMILY_CODES: readonly FamilyCode[] = [...LEGACY_FAMILY_CODES, ...DRIVER_FAMILY_CODES]

export function isLegacyFamilyCode(code: string | null | undefined): code is LegacyFamilyCode {
  return code === '6118' || code === '6301' || code === '6302' || code === '6501'
}

/** Where each family's protocol is specified. */
export const FAMILY_RESEARCH: Readonly<Record<FamilyCode, string>> = {
  '6118': 'docs/PROTOCOL.md',
  '6301': 'docs/PROTOCOL.md',
  '6302': 'docs/PROTOCOL.md',
  '6501': 'docs/research/families/legacy-6501.md',
  '6108': 'docs/research/families/a1-6108.md',
  '6201': 'docs/research/families/melo-6201.md',
  '6303': 'docs/research/families/m3-6303.md',
  '6701': 'docs/research/families/max2-6701.md',
}

/** How a page reaches a product. 'bridge' = the local root-libusb relay (docs/BRIDGE.md). */
export type LinkKind = 'webhid' | 'webhid-feature' | 'web-bluetooth' | 'bridge'

/**
 * A unit of a kit, as the UI shows it. Only `rx` is connected directly; everything else is reached
 * through it (FAMILIES.md §1.1, "Units that are never connected directly").
 *  tx1..tx4  microphones (A1/M3/MAX 2 up to 4)
 *  rx2..rx4  M3 secondary receivers (payload ids 7..9; the connected RX is `rx`)
 *  box       charging case (MAX 2 BOX, MELO P1 case)
 *  earL/earR earphones paired to the RX (MAX 2 OWS, MELO P1 TWS)
 *  remote    MELO P1 remote control
 */
export type UnitId = 'rx' | 'tx1' | 'tx2' | 'tx3' | 'tx4' | 'rx2' | 'rx3' | 'rx4' | 'box' | 'earL' | 'earR' | 'remote'

export const UNIT_IDS: readonly UnitId[] = ['rx', 'tx1', 'tx2', 'tx3', 'tx4', 'rx2', 'rx3', 'rx4', 'box', 'earL', 'earR', 'remote']
export const TX_UNIT_IDS: readonly UnitId[] = ['tx1', 'tx2', 'tx3', 'tx4']

export function isUnitId(v: unknown): v is UnitId {
  return typeof v === 'string' && (UNIT_IDS as readonly string[]).includes(v)
}
