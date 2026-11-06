/**
 * The MELO P1 FamilyRuntime: the driver of driver.ts without its simulator and dev presets (FAMILIES.md §3.2). The
 * app loads this module with import() when a MELO P1 is opened (core/loader.ts); createMeloDriver() adds the simulator.
 */
import { UnsupportedError } from '../../device-errors'
import { momaCommandOfFrame } from '../../moma/spec'
import { MOMA_6201_BLE, MOMA_6201_IOS, MOMA_6201_USB } from '../../moma/profiles'
import { displayName, type ProductInfo } from '../../models'
import type { FamilyRuntime } from '../../core/types'
import { MELO_COMMANDS } from './commands'
import { MELO_CONTROLS } from './controls'
import { createMeloDevice } from './device'
import { MELO_HARDWARE_CHECK } from './hardware-check'
import { MELO_RESEARCH, MELO_RX_PRODUCT_IDS, meloExperimentalProducts } from './products'

/** Command id of a MELO P1 request frame in any of the three framings (USB, BLE, iOS), or null. */
export function meloCommandOfFrame(frame: Uint8Array): number | null {
  for (const p of [MOMA_6201_USB, MOMA_6201_BLE, MOMA_6201_IOS]) {
    const c = momaCommandOfFrame(p, frame, MELO_COMMANDS)
    if (c !== null) return c
  }
  return null
}

function isReceiver(p: ProductInfo): boolean {
  return MELO_RX_PRODUCT_IDS.includes(p.productId) && p.vendorId !== 0
}

export function createMeloRuntime(o: { products?: readonly ProductInfo[] } = {}): FamilyRuntime {
  const products = o.products ?? meloExperimentalProducts()
  return {
    code: '6201',
    name: 'MELO P1',
    status: 'experimental',
    products,
    commands: MELO_COMMANDS,
    controls: MELO_CONTROLS,
    research: MELO_RESEARCH,
    createDevice: (transport, product, opts) => {
      if (!isReceiver(product)) throw new UnsupportedError(`${displayName(product)} is recognised but not supported yet: the official app only updates its firmware`)
      return createMeloDevice(transport, product, opts)
    },
    commandOfFrame: meloCommandOfFrame,
    hardwareCheck: MELO_HARDWARE_CHECK,
  }
}

/** What the app loads for the MELO P1: MELO_DRIVER (index.ts `driver`) without the simulator. */
export const MELO_RUNTIME: FamilyRuntime = /* @__PURE__ */ createMeloRuntime()
