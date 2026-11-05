/**
 * Placeholder driver for a family whose implementation has not landed yet (FAMILIES.md §3.2:
 * "W0 creates the four folders with a stub driver (status: 'stub', products only)"). It names
 * the products and refuses to create devices or simulators.
 */
import { UnsupportedError } from '../device'
import { displayName, type ProductInfo } from '../models'
import type { FamilyCode } from './ids'
import type { FamilyDriver, HardwareCheckStep } from './types'

export interface StubDriverInit {
  code: FamilyCode
  name: string
  products: readonly ProductInfo[]
  research: string
  /** Planned first-contact steps (FAMILIES.md §5.7), descriptive only. */
  hardwareCheck?: readonly HardwareCheckStep[]
}

export function stubDriver(init: StubDriverInit): FamilyDriver {
  const refuse = (p: ProductInfo): never => {
    throw new UnsupportedError(`${displayName(p)} is recognised but not supported yet (driver for family ${init.code} is a stub; see ${init.research})`)
  }
  return {
    code: init.code,
    name: init.name,
    status: 'stub',
    products: init.products,
    commands: {},
    controls: [],
    research: init.research,
    createDevice: (_t, product) => refuse(product),
    createSimulator: (product) => refuse(product),
    commandOfFrame: () => null,
    mockPresets: [],
    hardwareCheck: init.hardwareCheck ?? [],
  }
}
