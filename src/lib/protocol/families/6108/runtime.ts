/**
 * The LARK A1 FamilyRuntime: the driver of driver.ts without its simulator and dev presets (FAMILIES.md §3.2). The
 * app loads this module with import() when an A1 is opened (core/loader.ts); createA1Driver() adds the simulator.
 */
import type { FamilyRuntime } from '../../core/types'
import type { ProductInfo } from '../../models'
import { a1CommandOfFrame } from './codec'
import { A1_COMMANDS } from './commands'
import { A1_CONTROLS } from './controls'
import { A1_HARDWARE_CHECK } from './hardware-check'
import { A1_PRODUCTS, A1_RESEARCH } from './products'
import { createA1Device, createA1Spec, type A1SpecOptions } from './session'

export interface A1DriverOptions extends A1SpecOptions {
  products?: readonly ProductInfo[]
}

export function createA1Runtime(o: A1DriverOptions = {}): FamilyRuntime {
  const products = o.products ?? A1_PRODUCTS
  const spec = createA1Spec(o)
  const controls = o.controls
    ? products.flatMap((p) => o.controls!(p)).filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
    : o.readOnly
      ? []
      : A1_CONTROLS
  return {
    code: '6108',
    name: 'LARK A1',
    status: 'experimental',
    products,
    commands: A1_COMMANDS,
    controls,
    research: A1_RESEARCH,
    createDevice: (transport, product, opts) => createA1Device(transport, product, opts, spec),
    commandOfFrame: a1CommandOfFrame,
    hardwareCheck: A1_HARDWARE_CHECK,
  }
}

/** What the app loads for the A1: the registered driver (index.ts `driver`) without the simulator. */
export const A1_RUNTIME: FamilyRuntime = /* @__PURE__ */ createA1Runtime()
