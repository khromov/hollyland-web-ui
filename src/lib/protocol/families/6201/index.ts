/**
 * MELO P1 (family 6201): Moma framing with XOR (Android) / none (iOS), over USB HID and BLE GATT.
 * Spec: docs/research/families/melo-6201.md. Owner: W8 (docs/FAMILIES.md §3.7).
 *
 * Phase 0 stub: products only. Replace `driver` with the real FamilyDriver (status
 * 'experimental') and set the receiver rows' `support.level` to 'experimental' in products.ts.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { MELO_APP_PRODUCTS, MELO_PRODUCTS, MELO_RESEARCH } from './products'

export * from './products'

export const driver: FamilyDriver = /* @__PURE__ */ stubDriver({
  code: '6201',
  name: 'MELO P1',
  products: [...MELO_PRODUCTS, ...MELO_APP_PRODUCTS],
  research: MELO_RESEARCH,
  // FAMILIES.md §5.7, row 6201.
  hardwareCheck: [
    { id: 'ble-advertising', title: 'BLE advertising', kind: 'descriptor', detail: 'Advertised name; FFE0 visible; service data 0xBBBB layout.' },
    { id: 'ble-fragmentation', title: 'Notification fragmentation', kind: 'observe', detail: 'Notification sizes; are long writes accepted?' },
    { id: 'device-info', title: 'Device info 0x600A [0]', kind: 'read', detail: 'Sound-card master firmware version (gates the V2 structures).' },
    { id: 'heartbeat', title: 'Status 0x600B', kind: 'read', detail: 'Payload length (31 B); does the reply carry XOR when the request had control 0x00?' },
    { id: 'led', title: 'LED 0x2000 and back', kind: 'write-reversible', detail: 'Change the mixer LED brightness and restore it.' },
  ],
})
