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
 * Registered since Phase 3 (W9): `driver` is MELO_DRIVER (receivers 1032 / 1033 'experimental', hardware
 * 'untested'; mic, case and earphones stay recognised only).
 */
import type { FamilyDriver } from '../../core/types'
import { MELO_DRIVER } from './driver'

export * from './products'
export * from './commands'
export * from './status'
export * from './controls'
export * from './protocol'
export * from './device'
export * from './sim'
export * from './hardware-check'
export * from './driver'

export const driver: FamilyDriver = MELO_DRIVER
