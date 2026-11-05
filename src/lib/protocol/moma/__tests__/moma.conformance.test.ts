/**
 * The shared conformance suite (core/conformance.ts, FAMILIES.md §5.3) run against a toy driver built on
 * the Moma codec, once per framing: 6303 (report id 8, padded, no checksum), 6701 BLE (start/end markers,
 * XOR) and 6201 BLE (XOR), plus 6201 USB with batch replies split into one frame per item.
 */
import { describe, expect, it } from 'vitest'
import { CONTROL } from '../../core/controls'
import { describeDriverConformance } from '../../core/conformance'
import { simulatedTransport } from '../../core/simulate'
import { MOMA_6201_BLE, MOMA_6201_USB, MOMA_6303, MOMA_6701_BLE } from '../profiles'
import { momaToyDriver, type MomaToySimulator } from './moma-toy-driver'

const drivers = [
  momaToyDriver('6303', MOMA_6303, 0xf303),
  momaToyDriver('6701', MOMA_6701_BLE, 0xf701),
  momaToyDriver('6201', MOMA_6201_BLE, 0xf201),
]

for (const d of drivers) {
  describeDriverConformance(d, {
    // 1 = byte by byte; 12/13 split right before / after the XOR byte of short replies; 20 = BLE default MTU − 3.
    chunkSizes: [1, 2, 7, 12, 13, 20],
    preconditions: [
      { name: 'NC level needs NC on', arrange: (s) => ((s as MomaToySimulator).ncOn = false), control: CONTROL.NOISE_LEVEL, value: 2, reason: 'noise-off' },
    ],
  })
}

describe('Moma toy driver: batch replies split into one frame per item (6201 USB)', () => {
  const d = momaToyDriver('6201', MOMA_6201_USB, 0xf202)
  const product = d.products[0]
  const fast = { requestTimeoutMs: 60, probeTimeoutMs: 60, retries: 0, heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false }

  it('a "get all" batch completes when every requested item arrived, whatever the framing', async () => {
    for (const splitBatch of [false, true]) {
      const sim = d.createSimulator(product, { params: { splitBatch } }) as MomaToySimulator
      sim.led = false
      const dev = d.createDevice(simulatedTransport(sim), product, fast)
      await dev.connect()
      await dev.refresh('settings')
      expect(dev.state.values[CONTROL.LED], `splitBatch ${splitBatch}`).toBe(false)
      expect(dev.state.values[CONTROL.NOISE_LEVEL]).toBe(1)
      // Both batch items went out in one frame.
      const last = sim.requests.at(-1)!
      expect(last.items.map((i) => i.cmd)).toEqual([0x1301, 0x2001])
      await dev.disconnect()
    }
  })

  it('device pushes (type 0 items) reach onMessage as unsolicited messages', async () => {
    const sim = d.createSimulator(product) as MomaToySimulator
    const dev = d.createDevice(simulatedTransport(sim), product, fast)
    const pushes: unknown[] = []
    dev.on('push', (m) => pushes.push(m))
    await dev.connect()
    sim.pushVu(42)
    await new Promise((r) => setTimeout(r, 5))
    expect(dev.state.values['moma.vu']).toBe(42)
    expect(pushes).toHaveLength(1)
    await dev.disconnect()
  })

  it('a console frame in another framing is refused (it would not re-encode to the same bytes)', async () => {
    const sim = d.createSimulator(product) as MomaToySimulator
    const dev = d.createDevice(simulatedTransport(sim), product, fast)
    await dev.connect()
    // iOS framing (control 0x00) of a catalogued read: not this profile's bytes → needs force, then refused (untested product).
    const ios = Uint8Array.of(0xaa, 0xdd, 0x06, 0x00, 0x00, 0x00, 0x01, 0x60, 0x0b, 0x01, 0x00, 0x00)
    await expect(dev.sendRaw(ios)).rejects.toThrow(/without force/)
    await expect(dev.sendRaw(ios, { force: true })).rejects.toThrow(/cannot be classified/)
    // The profile's own framing of the same read is accepted without force.
    await dev.sendRaw(Uint8Array.of(0xaa, 0xdd, 0x06, 0x00, 0x04, 0x00, 0x01, 0x60, 0x0b, 0x01, 0x00, 0x00, 0x1e))
    await dev.disconnect()
  })

  it('a batch hiding a destructive item behind a read is classified destructive and refused', async () => {
    const sim = d.createSimulator(product) as MomaToySimulator
    const dev = d.createDevice(simulatedTransport(sim), product, { ...fast, allowDestructive: true })
    await dev.connect()
    const before = sim.requests.length
    // batch [STATUS 0x600B, FACTORY_RESET 0x2007 [0, 0]] in the 6201 USB framing
    const body = [0xaa, 0xdd, 0x06, 0x00, 0x04, 0x00, 0x02, 0x60, 0x0b, 0x01, 0x00, 0x00, 0x20, 0x07, 0x01, 0x00, 0x02, 0x00, 0x00]
    const frame = Uint8Array.from([...body, body.reduce((a, b) => a ^ b, 0)])
    expect(d.commandOfFrame(frame)).toBe(0x2007)
    await expect(dev.sendRaw(frame)).rejects.toThrow(/without force/)
    await expect(dev.sendRaw(frame, { force: true })).rejects.toThrow()
    expect(sim.requests.length).toBe(before)
    await dev.disconnect()
  })

  it('a batch hiding a destructive item behind an uncatalogued one is refused (untested product)', async () => {
    const sim = d.createSimulator(product) as MomaToySimulator
    const dev = d.createDevice(simulatedTransport(sim), product, { ...fast, allowDestructive: true })
    await dev.connect()
    const before = sim.requests.length
    // batch [FACTORY_RESET 0x2007 [0, 0], 0x7777 (not catalogued)] in the 6201 USB framing: commandOfFrame
    // ranks the uncatalogued item first, so the engine must not take it for "just uncatalogued".
    const body = [0xaa, 0xdd, 0x06, 0x00, 0x04, 0x00, 0x02, 0x20, 0x07, 0x01, 0x00, 0x02, 0x00, 0x00, 0x77, 0x77, 0x01, 0x00, 0x00]
    const frame = Uint8Array.from([...body, body.reduce((a, b) => a ^ b, 0)])
    expect(d.commandOfFrame(frame)).toBe(0x7777)
    await expect(dev.sendRaw(frame, { force: true })).rejects.toThrow(/not tested on hardware/)
    // An uncatalogued id alone is refused too: the catalogue may miss iOS-only commands (MELO P1 0x131B).
    const lone = [0xaa, 0xdd, 0x06, 0x00, 0x04, 0x00, 0x01, 0x13, 0x1b, 0x01, 0x00, 0x00]
    await expect(dev.sendRaw(Uint8Array.from([...lone, lone.reduce((a, b) => a ^ b, 0)]), { force: true })).rejects.toThrow(/not tested on hardware/)
    expect(sim.requests.length).toBe(before)
    await dev.disconnect()
  })
})
