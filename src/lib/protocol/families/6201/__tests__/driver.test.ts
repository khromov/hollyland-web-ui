/**
 * Family 6201: the shared conformance suite (docs/FAMILIES.md §5.3).
 *  - the registered `driver`, which is MELO_DRIVER since Phase 3 (W9);
 *  - MELO_DRIVER against MeloSimulator over the mock transport (USB framing), with the
 *    firmware gates (3.0.7.9, 4.0.0.1) below / at / above and the app's preconditions;
 *  - the same suite over the whole Web Bluetooth stack (WebBluetoothTransport → fake GATT FFE0 / FFE1 / FFE2 →
 *    simulator), MTU 23: BLE framing (target 1), writes with response, 20-byte notifications.
 * Check 10 (populated after connect) runs for the default simulator and every preset with simulator options; no
 * notReadOnConnect exception is needed: every readable control is read at start-up or explained by availability.
 */
import { describe, expect, it } from 'vitest'
import { describeDriverConformance, type ConformanceOptions } from '../../../core/conformance'
import { DRIVERS, canConnect } from '../../../core/registry'
import { lookupProduct } from '../../../models'
import { bleBridgedDriver } from '../../../transports/fake-bluetooth'
import { driver, MELO_BLE_LINK, MELO_CONTROL as C, MELO_DRIVER, meloFrameLength, type MeloSimulator } from '..'

describe('registered MELO P1 driver (Phase 3)', () => {
  it('is MELO_DRIVER: receivers experimental and connectable, accessories recognised only', () => {
    expect(DRIVERS['6201']).toBe(driver)
    expect(driver).toBe(MELO_DRIVER)
    expect(driver.status).toBe('experimental')
    for (const pid of [1032, 1033]) {
      const p = lookupProduct(0x3547, pid)!
      expect(p.support).toMatchObject({ level: 'experimental', hardware: 'untested' })
      expect(canConnect(p)).toBe(true)
    }
    for (const pid of [1034, 1035, 1040]) expect(canConnect(lookupProduct(0x3547, pid)!)).toBe(false)
  })
})

const options: ConformanceOptions = {
  // The GET-backed controls are read at start-up (user queue, ahead of the suite's own requests), so the
  // read-modify-write setters (0x130A, 0x1308, 0x2000, 0x1142) have their struct when check 3 writes them.
  deviceOptions: { fetchSettings: true },
  // 1 = byte by byte; 13 splits right before the XOR byte of a 1-byte ack; 20 = BLE MTU 23.
  chunkSizes: [1, 2, 7, 13, 20],
  gates: [
    { name: 'per-mic gain below 3.0.7.9', sim: { rxVersion: '3.0.7.8' }, control: C.MIC_GAIN, unit: 'tx1', expect: 'unavailable' },
    { name: 'per-mic gain at 3.0.7.9 (inclusive)', sim: { rxVersion: '3.0.7.9' }, control: C.MIC_GAIN, unit: 'tx1', expect: 'ok' },
    { name: 'per-mic gain above 3.0.7.9', sim: { rxVersion: '4.0.1.2' }, control: C.MIC_GAIN, unit: 'tx2', expect: 'ok' },
    { name: 'Near / Mid / Far gain below 3.0.7.9', sim: { rxVersion: '3.0.7.8' }, control: C.MIC_GAIN_PRESET, expect: 'ok' },
    { name: 'Near / Mid / Far gain replaced at 3.0.7.9', sim: { rxVersion: '3.0.7.9' }, control: C.MIC_GAIN_PRESET, expect: 'unavailable' },
    { name: 'noise gate below 4.0.0.1 (V1 structures)', sim: { rxVersion: '4.0.0.0' }, control: C.NOISE_GATE_ENABLED, expect: 'ok' },
    { name: 'noise gate hidden at 4.0.0.1 (V2 structures)', sim: { rxVersion: '4.0.0.1' }, control: C.NOISE_GATE_ENABLED, expect: 'unavailable' },
    { name: 'noise gate hidden above 4.0.0.1', sim: { rxVersion: '4.0.1.2' }, control: C.NOISE_GATE_THRESHOLD, expect: 'unavailable' },
  ],
  preconditions: [
    { name: 'NC needs a mic online', sim: { online: ['rx'] }, control: C.NC_ENABLED, value: false, reason: 'no-mic-online' },
    { name: 'NC level needs NC on', arrange: (s) => ((s as MeloSimulator).ncOn = false), control: C.NC_DEPTH, value: 10, reason: 'noise-off' },
    { name: 'mic LED needs that mic online', sim: { online: ['rx', 'tx1'] }, control: C.LED, unit: 'tx2', value: false, reason: 'unit-offline' },
    { name: 'mic fader needs that mic online', sim: { online: ['rx', 'tx1'] }, control: C.MIC_VOLUME, unit: 'tx2', value: 3, reason: 'unit-offline' },
    { name: '3.5 mm mode needs something plugged in', sim: { params: { jack: 'empty' } }, control: C.JACK_MODE, value: 1, reason: 'jack-empty' },
    { name: 'noise gate needs the jack plugged in', sim: { params: { jack: 'empty' } }, control: C.NOISE_GATE_ENABLED, value: true, reason: 'jack-empty' },
    { name: 'noise gate needs the jack set to input', sim: { params: { jack: 'output' } }, control: C.NOISE_GATE_THRESHOLD, value: -60, reason: 'jack-output' },
    { name: 'noise gate threshold needs the gate on', control: C.NOISE_GATE_THRESHOLD, value: -60, reason: 'noise-gate-off' },
    { name: 'LED brightness needs that LED on', control: C.LED_BRIGHTNESS, unit: 'tx2', value: 0, reason: 'led-off' },
  ],
}

describeDriverConformance(MELO_DRIVER, options)

// Over Web Bluetooth: the registry link (FFE0 / FFE1 with response / FFE2) for both receivers, host writes joined
// into frames before the simulator; simulator chunking is left out (the fake GATT already splits at MTU − 3).
describeDriverConformance(bleBridgedDriver(MELO_DRIVER, { mtu: 23, link: MELO_BLE_LINK, frameLength: meloFrameLength }), { ...options, chunkSizes: [] })

describe('write-only link (blindAvailability)', () => {
  it('blocks every write built from a structure it could not read; firmware gates wait for the version', async () => {
    const { simulatedTransport } = await import('../../../core/simulate')
    const p = lookupProduct(0x3547, 1032)!
    const device = MELO_DRIVER.createDevice(simulatedTransport(MELO_DRIVER.createSimulator(p, { dropReplies: true })), p, {
      blindWrites: true, probeTimeoutMs: 20, requestTimeoutMs: 20,
    })
    await device.connect()
    expect(device.state.rx).toBe('unavailable')
    const a = device.state.availability
    for (const k of [C.NC_ENABLED, C.MIC_BIT_DEPTH, C.OUTPUT_BIT_DEPTH, C.BGM_VOLUME, `${C.MIC_MUTE}:tx1`, C.LED, `${C.LED}:tx2`, C.USB_OUT_MUTE]) {
      expect(a[k], k).toMatchObject({ ok: false, reason: 'state-unknown' })
    }
    expect(a[C.MIC_GAIN_PRESET]).toMatchObject({ ok: false, reason: 'version-unknown' })
    // The NC depth carries its own switch byte: it goes out blind.
    expect(a[C.NC_DEPTH]?.ok ?? true).toBe(true)
    await expect(device.set(C.NC_DEPTH, 10)).resolves.toMatchObject({ ok: true, confirmed: false })
    await device.disconnect()
  })
})
