/**
 * LARK A1 (family 6108 / A6108) registry rows. docs/research/families/a1-6108.md §1–2.
 * Import rule (FAMILIES.md §3.6): runtime imports from core/ only, types only from models.ts.
 */
import { recognised, usbProduct } from '../../core/product-rows'
import type { ProductInfo } from '../../models'

export const A1_RESEARCH = 'docs/research/families/a1-6108.md'

/** Phase 0 stub: recognised only. Commands and heartbeat agree between Android and iOS; the transport is inferred (§1.2). */
export const A1_SUPPORT = recognised(A1_RESEARCH, 'medium', 'commands high, feature-report transport medium (descriptor not captured)')

export const A1_PRODUCTS: readonly ProductInfo[] = [
  // A Product.PRODUCT_6108 = 1031 (VID 0x3547 via USBHIDService.VENDOR_ID); R product_6108 "LARK A1";
  // I EA `lark a1` → deviceType 10 (-[EADSessionManager setupControllerForAccessory:withProtocolString:] @0x10012477c),
  // +[HLDeviceUtils getDeviceNameWithType:] case 10 @0x100321374.
  usbProduct('6108', A1_SUPPORT, {
    productId: 1031, name: 'LARK A1', code: '6108', txCount: 2, channels: 2, eaModel: 'lark a1',
    // A USBHIDService heartbeat 1 s for 1031 (a1-6108.md §4.1); iOS polls every 3 s.
    heartbeatIntervalMs: 1000,
    deviceKind: 'receiver',
    // 2 Mic & 1 RX or 4 Mic & 1 RX firmware (A HLDevice6302Activity.onResGetVersion is6108FourMicOneRx).
    maxUnits: ['rx', 'tx1', 'tx2', 'tx3', 'tx4'],
    links: [
      // A USBHIDService.onEventMainThread(USBDataSendEvent) → HlUsbManagerImpl.executeControlTransfer:
      // SET_REPORT/GET_REPORT wValue 0x0305 (Feature 5), wLength 64; 0x0306 / 160 B during OTA (never used here).
      { kind: 'webhid-feature', reportId: 5, size: 64, otaReportId: 6, note: 'Feature 5 declaration not verified (a1-6108.md §2.3)' },
    ],
    notes: 'Feature-report framing "ProtocolV2": 05 03 AA DD cmd len16 payload EF (a1-6108.md §3)',
  }),
]
