/**
 * LARK MAX 2 (family 6701): Moma framing with start/end items and XOR, over USB HID (RX) and BLE
 * GATT (charging case). Spec: docs/research/families/max2-6701.md. Owner: W7 (docs/FAMILIES.md §3.7).
 *
 * Phase 0 stub: products only. Replace `driver` with the real FamilyDriver (status
 * 'experimental') and set the rows' `support.level` to 'experimental' in products.ts.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { MAX2_APP_PRODUCTS, MAX2_PRODUCTS, MAX2_RESEARCH } from './products'

export * from './products'

export const driver: FamilyDriver = /* @__PURE__ */ stubDriver({
  code: '6701',
  name: 'LARK MAX 2',
  products: [...MAX2_PRODUCTS, ...MAX2_APP_PRODUCTS],
  research: MAX2_RESEARCH,
  // FAMILIES.md §5.7, row 6701.
  hardwareCheck: [
    { id: 'ble-services', title: 'BLE advertising', kind: 'descriptor', detail: 'Is FEE7 in the UUID list or only in service data? Notification sizes.' },
    { id: 'ble-pushes', title: 'Pushed items', kind: 'observe', detail: 'Pushed item types and cadence after connect.' },
    // I -[HLBleDeviceController sendHeartInfo] @0x1002454ec: iOS polls 0x600B to target 2 through the BOX every 3 s.
    { id: 'ble-heartbeat', title: 'BLE status 0x600B to target 2', kind: 'read', detail: 'Does the BOX forward the RX heartbeat (49 B payload) as on iOS?' },
    { id: 'device-info', title: 'Device info 0x600A [1]', kind: 'read', detail: 'Per-unit version reply.' },
    { id: 'usb-descriptor', title: 'USB descriptor', kind: 'descriptor', detail: 'Report ids and sizes of 1026 / 1027.' },
    { id: 'usb-heartbeat', title: 'USB status 0x600B', kind: 'read', detail: 'Reply length (49 B payload) and whether broadcast target 0 works.' },
  ],
})
