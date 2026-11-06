/**
 * The LARK M3 FamilyRuntime: the driver of driver.ts without its simulator and dev presets (FAMILIES.md §3.2). The
 * app loads this module with import() when an M3 is opened (core/loader.ts); createM3Driver() adds the simulator.
 */
import type { FamilyRuntime } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_6303 } from '../../moma/profiles'
import { momaCommandOfFrame } from '../../moma/spec'
import { M3_COMMANDS } from './commands'
import { M3_ALL_CONTROLS } from './controls'
import { M3_HARDWARE_CHECK } from './hardware-check'
import { M3_PRODUCTS, M3_RESEARCH, m3ExperimentalProducts } from './products'
import { createM3Device } from './session'

export interface M3DriverOptions {
  /** Default: the four M3 rows with support.level 'experimental' (hardware 'untested'). */
  products?: readonly ProductInfo[]
}

export function createM3Runtime(o: M3DriverOptions = {}): FamilyRuntime {
  const products = o.products ?? m3ExperimentalProducts()
  return {
    code: '6303',
    name: 'LARK M3',
    status: 'experimental',
    products,
    commands: M3_COMMANDS,
    controls: M3_ALL_CONTROLS,
    research: M3_RESEARCH,
    createDevice: (transport, product, opts) => createM3Device(transport, product, opts),
    commandOfFrame: (f) => momaCommandOfFrame(MOMA_6303, f, M3_COMMANDS),
    hardwareCheck: M3_HARDWARE_CHECK,
  }
}

/** What the app loads for the M3: the registered driver (index.ts `driver`, on the registry rows) without the simulator. */
export const M3_RUNTIME: FamilyRuntime = /* @__PURE__ */ createM3Runtime({ products: M3_PRODUCTS })
