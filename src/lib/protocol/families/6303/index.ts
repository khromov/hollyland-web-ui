/**
 * LARK M3 (family 6303): Moma framing with report id 8.
 * Spec: docs/research/families/m3-6303.md. Owner: W6 (docs/FAMILIES.md §3.7).
 *
 * Phase 0 stub: products only. Replace `driver` with the real FamilyDriver (status
 * 'experimental') and set the rows' `support.level` to 'experimental' in products.ts.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { M3_PRODUCTS, M3_RESEARCH } from './products'

export * from './products'

export const driver: FamilyDriver = /* @__PURE__ */ stubDriver({
  code: '6303',
  name: 'LARK M3',
  products: M3_PRODUCTS,
  research: M3_RESEARCH,
  // FAMILIES.md §5.7, row 6303.
  hardwareCheck: [
    { id: 'descriptor', title: 'HID descriptor', kind: 'descriptor', detail: 'Report 8 sizes (63 / 511?) and the vendor id.' },
    { id: 'heartbeat', title: 'Status 0x6000', kind: 'read', detail: 'Capture the source / target / type bytes of the reply.' },
    { id: 'device-info', title: 'Device info 0x600A [6]', kind: 'read', detail: 'RX version and serial.' },
    { id: 'versions', title: 'Firmware versions 0x6012 [0]', kind: 'read', detail: 'Version list of the 4T4R system (45-byte reply).' },
    { id: 'short-writes', title: '63-byte writes', kind: 'observe', detail: 'Are 64-byte frames accepted, or only the declared size?' },
    { id: 'led', title: 'LED 0x6009 and back', kind: 'write-reversible', detail: 'Toggle the indicator LED (inverted: 0 = on) and restore it.' },
  ],
})
