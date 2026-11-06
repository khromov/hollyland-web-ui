/**
 * LARK MAX 2 (family 6701): Moma framing with start/end items and XOR, over USB HID (RX) and BLE
 * GATT (charging case). Spec: docs/research/families/max2-6701.md. Owner: W7 (docs/FAMILIES.md §3.7).
 *
 *   commands.ts        command catalogue keyed by request form (GET / SET / unpair), builders, enums, unit numbering
 *   status.ts          heartbeat 0x600B (33 / 49 B), 0x600A (52 B), BLE pushes 0x6000–0x6002, per-setting items
 *   controls.ts        ControlSpecs (official labels), per-product filter, gates (RX ≥ 3.0.0.50), preconditions
 *   session.ts         ProtocolSpec for both links (probe, 3 s poll, start-up reads, correlation, writes) + createMax2Device
 *   sim.ts             simulator: USB poll mode and BLE push mode with MTU-sized notification chunks
 *   driver.ts          createMax2Driver(): the 'experimental' FamilyDriver, mock presets
 *   runtime.ts         createMax2Runtime() / MAX2_RUNTIME: the driver without the simulator (what the app loads)
 *   ids.ts             control / value ids, enums and per-product rules the app uses without loading the driver
 *   hardware-check.ts  first-contact steps (FAMILIES.md §5.7)
 *
 * Registered since Phase 3 (W9): `driver` is createMax2Driver() on the registry rows (rows 1026 / 1027 / 101
 * 'experimental', hardware 'untested'; the OWS earphone 102 stays recognised).
 */
import type { FamilyDriver } from '../../core/types'
import { createMax2Driver } from './driver'
import { MAX2_APP_PRODUCTS, MAX2_PRODUCTS } from './products'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './session'
export * from './sim'
export * from './driver'
export * from './runtime'
export * from './hardware-check'

export const driver: FamilyDriver = /* @__PURE__ */ createMax2Driver({ products: [...MAX2_PRODUCTS, ...MAX2_APP_PRODUCTS] })
