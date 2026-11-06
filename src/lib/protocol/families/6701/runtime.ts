/**
 * The LARK MAX 2 FamilyRuntime: the driver of driver.ts without its simulator and dev presets (FAMILIES.md §3.2).
 * The app loads this module with import() when a MAX 2 is opened (core/loader.ts); createMax2Driver() adds the
 * simulator.
 */
import type { FamilyRuntime } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_6701_USB } from '../../moma/profiles'
import { parseMomaRequest } from '../../moma/spec'
import { MAX2_COMMANDS, max2CommandOf } from './commands'
import { MAX2_CONTROLS } from './controls'
import { MAX2_HARDWARE_CHECK } from './hardware-check'
import { MAX2_APP_PRODUCTS, MAX2_PRODUCTS, max2ExperimentalProducts, MAX2_RESEARCH } from './products'
import { createMax2Device, type Max2SpecOptions } from './session'

/**
 * Catalogue key of an encoded request frame (FamilyDriver.commandOfFrame): every MAX 2 frame (USB targets 0/1/2,
 * BLE targets 2..11) has the same control byte 0x07 and no report id, so one profile parses them all.
 */
export function max2CommandOfFrame(frame: Uint8Array): number | null {
  const req = parseMomaRequest(MOMA_6701_USB, frame)
  return req ? max2CommandOf(req) : null
}

export interface Max2DriverOptions extends Max2SpecOptions {
  products?: readonly ProductInfo[]
}

export function createMax2Runtime(o: Max2DriverOptions = {}): FamilyRuntime {
  const { products: rows, ...spec } = o
  const products = rows ?? max2ExperimentalProducts()
  return {
    code: '6701',
    name: 'LARK MAX 2',
    status: 'experimental',
    products,
    commands: MAX2_COMMANDS,
    controls: MAX2_CONTROLS,
    research: MAX2_RESEARCH,
    createDevice: (transport, product, opts) => createMax2Device(transport, product, opts, spec),
    commandOfFrame: max2CommandOfFrame,
    hardwareCheck: MAX2_HARDWARE_CHECK,
  }
}

/** What the app loads for the MAX 2: the registered driver (index.ts `driver`, on the registry rows) without the simulator. */
export const MAX2_RUNTIME: FamilyRuntime = /* @__PURE__ */ createMax2Runtime({ products: [...MAX2_PRODUCTS, ...MAX2_APP_PRODUCTS] })
