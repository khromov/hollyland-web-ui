/**
 * LARK M3 (family 6303) registry rows. docs/research/families/m3-6303.md §1–2.
 * Import rule (FAMILIES.md §3.6): runtime imports from core/ only, types only from models.ts.
 */
import { recognised, usbProduct } from '../../core/product-rows'
import type { WebHidLinkSpec } from '../../core/types'
import type { ProductInfo } from '../../models'

export const M3_RESEARCH = 'docs/research/families/m3-6303.md'

/** Phase 0 stub: recognised only. Framing high, transport and VID medium (FAMILIES.md §1.2). */
export const M3_SUPPORT = recognised(M3_RESEARCH, 'medium', 'framing high; transport and vendor id medium (VID never checked by the app)')

/**
 * A Protocol6303Provider.createCommandPostBuilder().setReportId(8), new CommandStanderParser(8);
 * getUsbConfig → BULK (interrupt pipe), frames 64 or 512 bytes incl. the id (m3-6303.md §2.1, §2.3).
 */
export const M3_LINK: WebHidLinkSpec = {
  kind: 'webhid', reportId: 8, outSizes: [64, 512], inSize: 512,
  note: 'report 8 sizes (63/511 data bytes) inferred, descriptor not captured (m3-6303.md §2.3)',
}

/** A Product.PRODUCT_6303_RX_* (1036–1039); A Device6303DataManager.isPhoneRx() = PID 1038 || 1039. */
const ROWS: readonly { pid: number; variant: 'camera' | 'mobile'; ch: 2 | 4; constant: string }[] = [
  { pid: 1036, variant: 'camera', ch: 2, constant: 'PRODUCT_6303_RX_CAMERA_2CH' },
  { pid: 1037, variant: 'camera', ch: 4, constant: 'PRODUCT_6303_RX_CAMERA_4CH' },
  { pid: 1038, variant: 'mobile', ch: 2, constant: 'PRODUCT_6303_RX_PHONE_2CH' },
  { pid: 1039, variant: 'mobile', ch: 4, constant: 'PRODUCT_6303_RX_PHONE_4CH' },
]

export const M3_PRODUCTS: readonly ProductInfo[] = ROWS.map((r) =>
  // R product_6303 "LARK M3" (A DeviceCompat.getDeviceName 1036–1039); I EA `lark m3` → deviceType 14 (@0x10012477c).
  usbProduct('6303', M3_SUPPORT, {
    productId: r.pid, name: 'LARK M3', label: `LARK M3 (${r.variant === 'camera' ? 'camera' : 'phone'} RX, ${r.ch}CH)`, code: '6303',
    variant: r.variant,
    // Kept from the Phase 0 registry (txCount = channels = 2 / 4 by PID). Up to 4 TX in 4T4R on every PID (m3-6303.md §1.1).
    txCount: r.ch, channels: r.ch, eaModel: 'lark m3',
    // A HLDeviceVolTrack6303Activity heartbeat 0x6000 every 1.5 s (FAMILIES.md §1.3).
    heartbeatIntervalMs: 1500,
    deviceKind: 'receiver',
    // TX1–4 = payload ids 1–4, RX1–4 = 6–9 (A Device6303DataManager.txIndexToDeviceId / rxIndexToDeviceId).
    maxUnits: ['rx', 'tx1', 'tx2', 'tx3', 'tx4', 'rx2', 'rx3', 'rx4'],
    // A USBHIDService.isSupportedUsbDevice accepts 1036–1039 before the VID check: 0x3547 is a guess.
    vendorIdConfirmed: false,
    links: [M3_LINK],
    notes: `Moma framing, report id 8, no checksum (${r.constant}; m3-6303.md §3)`,
  }),
)
