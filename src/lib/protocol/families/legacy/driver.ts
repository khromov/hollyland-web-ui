/**
 * FamilyDriver records for the legacy `AA DD` families, so the registry treats every family the
 * same way: runtime.ts (devices are LegacyMicDevice, HollylandDevice underneath; what the app loads) plus
 * the simulators, which wrap mock.ts's SimulatedReceiver. The 6501 group (Lark C1 / C1 2nd gen / M1 2nd gen / Mini) is 'experimental':
 * built from the official apps' code (docs/research/families/legacy-6501.md), not run on hardware.
 */
import type { Family } from '../../commands'
import { UnsupportedError } from '../../device-errors'
import { displayName, type ProductInfo } from '../../models'
import { MockTransport, SimulatedReceiver } from '../../mock'
import { chunkBytes } from '../../core/bytes'
import type { LegacyFamilyCode } from '../../core/ids'
import type { DeviceSimulator, FamilyDriver, MockPreset, SimFaults, SimOptions } from '../../core/types'
import type { TransportCapabilities, TransportDeviceInfo } from '../../transport'
import { legacyRuntime, refuseLegacyStub } from './runtime'

export { legacyCatalogue } from './runtime'

/** "1.0.0.15" → [1, 0, 0, 15, 0, 0] for SimulatedReceiver.rxVersion. */
function versionBytes(v: string): number[] {
  const parts = v.split('.').map((x) => parseInt(x, 10) || 0)
  while (parts.length < 6) parts.push(0)
  return parts.slice(0, 6)
}

/** DeviceSimulator over mock.ts's SimulatedReceiver (6118 / 6301 / 6302 / 6501; the 6501 profile follows the PID). */
export class LegacySimulator implements DeviceSimulator {
  readonly receiver: SimulatedReceiver
  readonly info: TransportDeviceInfo
  readonly capabilities: TransportCapabilities
  faults: SimFaults

  constructor(product: ProductInfo, o: SimOptions = {}) {
    if (!product.family) throw new UnsupportedError(`${displayName(product)} is not supported yet by the legacy simulator`)
    this.receiver = new SimulatedReceiver({ family: product.family as Family, camera: product.variant === 'camera', productId: product.productId })
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    if (o.rxVersion) this.receiver.rxVersion = versionBytes(o.rxVersion)
    if (o.online) {
      this.receiver.tx[0].online = o.online.includes('tx1')
      this.receiver.tx[1].online = o.online.includes('tx2')
    }
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: 'Wireless Microphone (simulated)', serialNumber: 'SIM' }
    this.capabilities = { receive: o.dropReplies ? 'no' : 'yes', link: 'mock', maxWrite: 64 }
  }

  respond(packet: Uint8Array): Uint8Array[] {
    this.receiver.dropReplies = this.faults.dropReplies === true
    this.receiver.duplicateReplies = this.faults.duplicateReplies === true
    const out = this.receiver.respond(packet)
    const n = this.faults.chunkSize
    return n ? out.flatMap((p) => chunkBytes(p, n)) : out
  }
}

/** Dev presets (`?mock=`), same ids as the session store's simulator presets. */
const PRESETS: Readonly<Record<LegacyFamilyCode, readonly MockPreset[]>> = {
  '6118': [
    { id: 'a2', label: 'LARK A2 (simulated)', family: '6118', productId: 1041 },
    { id: 'a2s', label: 'LARK A2S camera RX (simulated)', family: '6118', productId: 1042 },
    { id: 'blind', label: 'LARK A2, replies dropped (macOS-like)', family: '6118', productId: 1041, sim: { dropReplies: true } },
  ],
  '6301': [
    { id: 'm2', label: 'Lark M2 (simulated)', family: '6301', productId: 7 },
    { id: 'm2cam', label: 'Lark M2 camera RX (simulated)', family: '6301', productId: 8 },
  ],
  '6302': [
    { id: 'm2s', label: 'LARK M2S (simulated)', family: '6302', productId: 1029 },
    { id: 'm2scam', label: 'LARK M2S camera RX (simulated)', family: '6302', productId: 1030 },
  ],
  '6501': [
    { id: 'c1', label: 'Lark C1 (simulated, untested profile)', family: '6501', productId: 1 },
    { id: 'c1g2', label: 'Lark C1 (2nd gen) (simulated, untested profile)', family: '6501', productId: 11 },
    { id: 'm1g2', label: 'Lark M1 (2nd gen) (simulated, untested profile)', family: '6501', productId: 12 },
    { id: 'mini', label: 'Lark Mini (simulated, untested profile)', family: '6501', productId: 13 },
  ],
}

export function legacyDriver(code: LegacyFamilyCode): FamilyDriver {
  const runtime = legacyRuntime(code)
  return {
    ...runtime,
    createSimulator(product: ProductInfo, o?: SimOptions) {
      if (runtime.status === 'stub') refuseLegacyStub(code, product)
      return new LegacySimulator(product, o)
    },
    mockPresets: PRESETS[code],
  }
}

/** The four legacy drivers. */
export const LEGACY_DRIVERS: Readonly<Record<LegacyFamilyCode, FamilyDriver>> = {
  '6118': /* @__PURE__ */ legacyDriver('6118'),
  '6301': /* @__PURE__ */ legacyDriver('6301'),
  '6302': /* @__PURE__ */ legacyDriver('6302'),
  '6501': /* @__PURE__ */ legacyDriver('6501'),
}

/** MockTransport wired to a legacy simulator (convenience for tests and dev presets). */
export function legacyMockTransport(sim: LegacySimulator, latencyMs = 0): MockTransport {
  return new MockTransport({ info: sim.info, respond: (p) => sim.respond(p), latencyMs, capabilities: sim.capabilities })
}
