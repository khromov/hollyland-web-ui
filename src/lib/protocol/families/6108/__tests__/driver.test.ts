/**
 * Family 6108: shared conformance suite (docs/FAMILIES.md §5.3).
 *  - the registered `driver` is still a stub (recognised only) but carries the real catalogue and frame classifier
 *  - the unregistered read-only wire driver runs the full suite against the simulator, for every firmware profile
 * Phase 2 (W5) adds gates (RX >= 1.0.1.3 inclusive for mute) and preconditions here.
 */
import { describe, expect, it } from 'vitest'
import { MockTransport } from '../../../mock'
import { canConnect, driverFor } from '../../../core/registry'
import { describeDriverConformance } from '../../../core/conformance'
import { DRIVERS } from '../../../core/registry'
import { driver, A1_COMMANDS, A1_PRODUCTS, A1Simulator, createA1WireDriver, encodeA1Frame } from '..'
import type { FamilyDriver } from '../../../core/types'

describeDriverConformance(driver)

describe('registered A1 driver (Phase 1: partial stub)', () => {
  it('is the registry entry, still a stub, with the real catalogue', () => {
    expect(DRIVERS['6108']).toBe(driver)
    expect(driver.status).toBe('stub')
    expect(driver.commands).toBe(A1_COMMANDS)
    expect(driver.commandOfFrame(encodeA1Frame(0x1f))).toBe(0x1f)
    expect(driver.commandOfFrame(Uint8Array.of(0xde, 0xad))).toBeNull()
    expect(driver.hardwareCheck.map((s) => s.id)).toEqual(['feature-reports', 'heartbeat', 'version', 'reply-bytes', 'report-id-byte', 'led'])
    for (const p of A1_PRODUCTS) {
      expect(driverFor(p)).toBe(driver)
      expect(canConnect(p)).toBe(false)
      expect(() => driver.createDevice(new MockTransport(), p)).toThrow(/not supported yet/)
    }
  })
})

const wire = createA1WireDriver({ unitIdentityDelayMs: 0 })
describeDriverConformance(wire)

/** The same read-only driver with the simulator pinned to one firmware profile. */
function withProfile(profile: string): FamilyDriver {
  const d = createA1WireDriver({ unitIdentityDelayMs: 0 })
  return { ...d, name: `LARK A1 (${profile})`, createSimulator: (_p, o) => new A1Simulator({ ...o, profile }) }
}
for (const profile of ['4mic', '4mic-old', '2mic-android']) describeDriverConformance(withProfile(profile))
