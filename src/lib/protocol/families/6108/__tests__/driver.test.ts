/**
 * Family 6108: the shared conformance suite (docs/FAMILIES.md §5.3) against the registered LARK A1 driver (Phase 2,
 * W5), with the A1's firmware gates (check 4) and the official app's preconditions (check 5), and once more for every
 * simulator firmware profile. Check 10 (populated after connect) runs on the default simulator and on every mock
 * preset with simulator options (4-mic, 22-byte heartbeat, old firmware, write-only).
 */
import { describe, expect, it } from 'vitest'
import { CONTROL } from '../../../core/controls'
import { describeDriverConformance, type GateCase, type PreconditionCase } from '../../../core/conformance'
import { FamilyDevice } from '../../../core/engine'
import { DRIVERS, canConnect, createMicDevice, createMockDevice, driverFor, findMockPreset } from '../../../core/registry'
import type { DeviceSimulator, FamilyDriver } from '../../../core/types'
import { lookupProduct, supportOf } from '../../../models'
import { MockTransport } from '../../../mock'
import {
  A1_COMMANDS, A1_CONTROL, A1_MOCK_PRESETS, A1_PRODUCTS, A1Simulator, createA1Driver, createA1WireDriver, driver, encodeA1Frame,
} from '..'

const sim = (s: DeviceSimulator) => s as A1Simulator

const GATES: readonly GateCase[] = [
  // A blemic/manager/DeviceDataManager.is6108NewDevice: HexUtil.compareVersions(rx, "1.0.1.3") >= 0 (inclusive).
  { name: 'Mic mute below RX 1.0.1.3 (1.0.1.2): unavailable', sim: { rxVersion: '1.0.1.2' }, control: CONTROL.MIC_MUTE, unit: 'tx1', expect: 'unavailable' },
  { name: 'Mic mute far below (1.0.0.9): unavailable', sim: { rxVersion: '1.0.0.9' }, control: CONTROL.MIC_MUTE, unit: 'tx1', expect: 'unavailable' },
  { name: 'Mic mute at RX 1.0.1.3 (inclusive): ok', sim: { rxVersion: '1.0.1.3' }, control: CONTROL.MIC_MUTE, unit: 'tx1', expect: 'ok' },
  { name: 'Mic mute above (1.0.2.0): ok', sim: { rxVersion: '1.0.2.0' }, control: CONTROL.MIC_MUTE, unit: 'tx2', expect: 'ok' },
  // A HLDevice6302Activity.onResGetVersion: mic3Mic4MuteView only when is6108FourMicOneRx (RX x.1.x.x).
  { name: 'Mic3 mute in 2 Mic & 1 RX mode (RX 1.0.1.3): unavailable', sim: {}, control: CONTROL.MIC_MUTE, unit: 'tx3', expect: 'unavailable' },
  { name: 'Mic3 mute in 4 Mic & 1 RX mode (RX 1.1.1.3): ok', sim: { profile: '4mic' }, control: CONTROL.MIC_MUTE, unit: 'tx3', expect: 'ok' },
  { name: 'Mic4 mute in 4 Mic & 1 RX mode: ok', sim: { profile: '4mic' }, control: CONTROL.MIC_MUTE, unit: 'tx4', expect: 'ok' },
  // I -[HLHeartEntity initA1HeartInfo:]: no signal-mode byte unless LEN is 17 or 23.
  { name: 'Mode setting with a 22-byte heartbeat (no signal-mode byte): unavailable', sim: { profile: '4mic-old' }, control: A1_CONTROL.SIGNAL_MODE, expect: 'unavailable' },
  { name: 'Mode setting with the 17-byte heartbeat: ok', sim: {}, control: A1_CONTROL.SIGNAL_MODE, expect: 'ok' },
  { name: 'Mode setting with the 23-byte heartbeat: ok', sim: { profile: '4mic' }, control: A1_CONTROL.SIGNAL_MODE, expect: 'ok' },
]

const muteBoth = (s: DeviceSimulator) => {
  sim(s).mics[0].muted = true
  sim(s).mics[1].muted = true
}

const NO_MIC = { online: ['rx'] as const }

/** A larkc1/HLDevice6302Activity (is6108Device): what the home screen refuses before sending. */
const PRECONDITIONS: readonly PreconditionCase[] = [
  { name: 'NC switch refused when every online mic is muted (R toast_tx_mute)', arrange: muteBoth, control: CONTROL.NOISE_ENABLED, value: false, reason: 'all-mics-muted' },
  { name: 'NC level refused when every online mic is muted', arrange: muteBoth, control: CONTROL.NOISE_LEVEL, value: 1, reason: 'all-mics-muted' },
  { name: 'NC switch refused with no mic online (R mic_offline_tip)', sim: NO_MIC, control: CONTROL.NOISE_ENABLED, value: false, reason: 'mic-disconnected' },
  { name: 'volume refused with no mic online', sim: NO_MIC, control: CONTROL.VOLUME, value: 0, reason: 'mic-disconnected' },
  { name: 'channel mode refused with no mic online', sim: NO_MIC, control: CONTROL.CHANNEL_MODE, value: 0, reason: 'mic-disconnected' },
  { name: 'EQ refused with no mic online', sim: NO_MIC, control: A1_CONTROL.EQ, value: 1, reason: 'mic-disconnected' },
  { name: 'reverb refused with no mic online', sim: NO_MIC, control: A1_CONTROL.REVERB_ENABLED, value: false, reason: 'mic-disconnected' },
  {
    name: 'Mic Recognition needs Mic1 and Mic2 in 2 Mic & 1 RX mode (R toast_connect_mic)', sim: { online: ['rx', 'tx1'] },
    control: CONTROL.MIC_RECOGNITION, value: false, reason: 'both-mics-required',
  },
  {
    name: 'NC level refused while NC is off (level row hidden)', arrange: (s) => (sim(s).noiseOn = false), control: CONTROL.NOISE_LEVEL, value: 1,
    reason: 'noise-off',
  },
  {
    name: 'reverb size refused while reverb is off (size row hidden)', arrange: (s) => (sim(s).reverbOn = false), control: A1_CONTROL.REVERB_LEVEL,
    value: 2, reason: 'reverb-off',
  },
]

/** Keep NC and reverb on in the round trip, so their level / size round-trip too (both are refused while off). */
const WRITE_VALUES = { [CONTROL.NOISE_ENABLED]: true, [A1_CONTROL.REVERB_ENABLED]: true }

describeDriverConformance(driver, { gates: GATES, preconditions: PRECONDITIONS, writeValues: WRITE_VALUES })

/** The same driver with the simulator pinned to one firmware profile (default run only). */
function withProfile(profile: string): FamilyDriver {
  const d = createA1Driver({ unitIdentityDelayMs: 0 })
  return { ...d, name: `LARK A1 (${profile})`, mockPresets: [], createSimulator: (_p, o) => new A1Simulator({ ...o, profile }) }
}
for (const profile of ['4mic', '4mic-old', '2mic-android']) describeDriverConformance(withProfile(profile), { writeValues: WRITE_VALUES })

// The Phase 1 read-only driver still meets the contract (diagnostics, first hardware session).
describeDriverConformance({ ...createA1WireDriver({ unitIdentityDelayMs: 0 }), name: 'LARK A1 (read-only)' })

describe('registered A1 driver (Phase 2)', () => {
  it('is the registry entry: experimental, connectable, hardware untested, with the real catalogue', () => {
    expect(DRIVERS['6108']).toBe(driver)
    expect(driver.status).toBe('experimental')
    expect(driver.commands).toBe(A1_COMMANDS)
    expect(driver.commandOfFrame(encodeA1Frame(0x1f))).toBe(0x1f)
    expect(driver.commandOfFrame(Uint8Array.of(0xde, 0xad))).toBeNull()
    expect(driver.hardwareCheck.map((s) => s.id)).toEqual(['feature-reports', 'heartbeat', 'version', 'reply-bytes', 'report-id-byte', 'led'])
    for (const p of A1_PRODUCTS) {
      expect(driverFor(p)).toBe(driver)
      expect(canConnect(p)).toBe(true)
      expect(supportOf(p)).toMatchObject({ level: 'experimental', hardware: 'untested' })
    }
    expect(lookupProduct(0x3547, 1031)?.support?.level).toBe('experimental')
  })

  it('createMicDevice picks the A1 driver by VID/PID; destructive controls are hidden for the untested row', () => {
    const d = createMicDevice(new MockTransport({ info: { vendorId: 0x3547, productId: 1031 } }))
    expect(d).toBeInstanceOf(FamilyDevice)
    expect(d.family).toBe('6108')
    expect(d.controls.map((c) => c.id)).not.toContain(A1_CONTROL.WIRELESS_MODE)
    expect(driver.controls.map((c) => c.id)).toContain(A1_CONTROL.WIRELESS_MODE)
    expect(d.controls.every((c) => c.safety === 'write')).toBe(true)
  })

  it('mock presets build working devices for every firmware case', async () => {
    expect(A1_MOCK_PRESETS.map((p) => p.id)).toEqual(['a1', 'a1-4mic', 'a1-4mic-old', 'a1-oldfw', 'a1-blind'])
    for (const p of A1_MOCK_PRESETS) expect(findMockPreset(p.id)?.driver).toBe(driver)
    const { device } = createMockDevice('a1-4mic', { heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false })
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect(s.units.tx4?.online).toBe(true)
    await device.disconnect()
    const blind = createMockDevice('a1-blind', { heartbeatIntervalMs: null, probeTimeoutMs: 30 })
    expect((await blind.device.connect()).rx).toBe('unavailable')
    await blind.device.disconnect()
  })
})
