/**
 * MELO P1 (family 6201): Moma framing with XOR (Android) / none (iOS), over USB HID and BLE GATT.
 * Spec: docs/research/families/melo-6201.md. Owner: W8 (docs/FAMILIES.md §3.7).
 *
 *   products.ts        registry rows (receivers, mic, case, earphones) + the experimental copies the driver serves
 *   commands.ts        command catalogue (every A Command6201 id + iOS-only 0x131B / 0x131C, safety classes, sources),
 *                      device types, firmware gates, request builders
 *   status.ts          heartbeat (31 B), device info (20 B, byte-reversed versions), VU levels, mixer / settings structs
 *   controls.ts        ControlSpecs: More Settings, track faders, outputs, LED, work mode
 *   protocol.ts        ProtocolSpec (start-up reads, gates, preconditions, read-modify-write setters), MeloSession
 *   device.ts          MeloDevice (FamilyDevice + VU level stream: startLevels / onLevels / stopLevels)
 *   sim.ts             MeloSimulator (VU push timer, batch replies, XOR on / off by control byte)
 *   hardware-check.ts  first-contact steps (FAMILIES.md §5.7)
 *   driver.ts          createMeloDriver() / MELO_DRIVER: the Phase 2 driver ('experimental')
 *
 * The registered `driver` below stays a stub (receivers recognised only; see driver.ts for why) but carries the
 * real catalogue and frame classifier, so sendRaw classification and the console can name every MELO P1 frame.
 */
import { stubDriver } from '../../core/stub'
import type { FamilyDriver } from '../../core/types'
import { MELO_COMMANDS } from './commands'
import { meloCommandOfFrame } from './driver'
import { MELO_HARDWARE_CHECK } from './hardware-check'
import { MELO_APP_PRODUCTS, MELO_PRODUCTS, MELO_RESEARCH } from './products'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './protocol'
export * from './device'
export * from './sim'
export * from './hardware-check'
export * from './driver'

function partialStub(): FamilyDriver {
  return {
    ...stubDriver({ code: '6201', name: 'MELO P1', products: [...MELO_PRODUCTS, ...MELO_APP_PRODUCTS], research: MELO_RESEARCH, hardwareCheck: MELO_HARDWARE_CHECK }),
    commands: MELO_COMMANDS,
    commandOfFrame: meloCommandOfFrame,
  }
}

export const driver: FamilyDriver = /* @__PURE__ */ partialStub()
