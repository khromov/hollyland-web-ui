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
 *   hardware-check.ts  first-contact steps (FAMILIES.md §5.7)
 *
 * The registered `driver` below stays a stub (products recognised only, createDevice refuses) but carries the real
 * catalogue, frame classifier and hardware check, so sendRaw classification and the console name every MAX 2 frame.
 * Switching the registry to the real driver is a shared change (core/__tests__/registry.test.ts pins the stub status,
 * the connectable PIDs and the preset list): `export const driver = createMax2Driver()` plus `support.level:
 * 'experimental'` on rows 1026 / 1027 / 101 in products.ts.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { MAX2_COMMANDS } from './commands'
import { max2CommandOfFrame } from './driver'
import { MAX2_HARDWARE_CHECK } from './hardware-check'
import { MAX2_APP_PRODUCTS, MAX2_PRODUCTS, MAX2_RESEARCH } from './products'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './session'
export * from './sim'
export * from './driver'
export * from './hardware-check'

function partialStub(): FamilyDriver {
  return {
    ...stubDriver({ code: '6701', name: 'LARK MAX 2', products: [...MAX2_PRODUCTS, ...MAX2_APP_PRODUCTS], research: MAX2_RESEARCH, hardwareCheck: MAX2_HARDWARE_CHECK }),
    commands: MAX2_COMMANDS,
    commandOfFrame: max2CommandOfFrame,
  }
}

export const driver: FamilyDriver = /* @__PURE__ */ partialStub()
