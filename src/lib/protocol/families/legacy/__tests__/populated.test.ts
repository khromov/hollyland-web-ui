/**
 * Conformance check 10 ("populated after connect", core/conformance.ts) on every legacy product, through the
 * LegacyMicDevice adapter: after connect() and the start-up reads, every readable control (ControlSpec.readBack
 * 'status' | 'get' | 'push') has a value. The shared suite runs the same check per driver (core/__tests__/
 * conformance.test.ts, 6501.test.ts); this file pins the readable set of each named product and the hardware
 * regression the check exists for:
 *
 *   Lark M2 PID 7 (hardware, PROTOCOL.md §11.8): the volume stayed unknown after every (re)connect. The mobile M2
 *   ignores heartbeat volume (A larkc1/HLDeviceActivity.onEvent cmd 16: volume only `if (productId >= 8)`), and the
 *   library read 0x04 at start-up only for the 6501 group. Both apps read 0x11 and 0x04 at start-up on the M2 and
 *   M2S too (A larkc1/HLDeviceActivity.getDeviceVersion, HLDevice6302Activity; device.ts fetchExtraSettings).
 *
 * The pre-fix library never sent 0x04 to a 6301 receiver; a simulator that never answers 0x04 leaves the device in
 * the same state, so the regression cases below run the check against such a simulator.
 */
import { describe, expect, it } from 'vitest'
import { Cmd } from '../../../commands'
import { displayName, lookupProduct, type ProductInfo } from '../../../models'
import { CONTROL } from '../../../core/controls'
import { checkPopulatedAfterConnect, populationRuns } from '../../../core/conformance'
import { simulatedTransport } from '../../../core/simulate'
import type { LegacyFamilyCode } from '../../../core/ids'
import type { FamilyDriver } from '../../../core/types'
import { LEGACY_DRIVERS, LegacyMicDevice, type LegacySimulator } from '..'

const row = (pid: number, vid = 0x3547): ProductInfo => lookupProduct(vid, pid)!

/** Readable controls per heartbeat family (legacyControls, families/legacy/controls.ts). */
const A2 = [
  CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.CHANNEL_MODE, CONTROL.PRESET_ENABLED, CONTROL.PRESET_STYLE, CONTROL.LED,
  CONTROL.AUTO_OFF, CONTROL.MIC_RECOGNITION,
]
const M2 = [CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.SPEAKER]
const M2S = [CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.CHANNEL_MODE, CONTROL.LED, CONTROL.AUTO_OFF, CONTROL.SPEAKER]
const G6501 = [CONTROL.NOISE_LEVEL, CONTROL.VOLUME, CONTROL.SPEAKER]

/** [family, product, readable value keys in control order]. */
const CASES: readonly [LegacyFamilyCode, ProductInfo, readonly string[]][] = [
  // A2 More settings: smart battery 0x3E (1041 only), speaker 0x13, mic recognition 0x3C (GET-only).
  ['6118', row(1041), [...A2, CONTROL.SMART_BATTERY, CONTROL.SPEAKER]],
  ['6118', row(1042), [...A2, CONTROL.SPEAKER]],
  // PID 7: volume only from 0x04 (the regression); PID 8: heartbeat volume, lock gated (> 2.0.0.31, simulator 2.0.0.32).
  ['6301', row(7), M2],
  ['6301', row(8), [...M2, CONTROL.VOLUME_LOCK]],
  // EAGLESHERO OEM rows (4417:32/33): same screens as PIDs 7/8.
  ['6301', row(32, 0x4417), M2],
  ['6301', row(33, 0x4417), [...M2, CONTROL.VOLUME_LOCK]],
  ['6302', row(1029), M2S],
  ['6302', row(1030), [...M2S, CONTROL.VOLUME_LOCK]],
  // 6501: PID 1 reads NC level and volume only with 0x11 / 0x04 (heartbeat link/battery only); 11/12/13 from the heartbeat too.
  ['6501', row(1), G6501],
  ['6501', row(11), G6501],
  ['6501', row(12), G6501],
  ['6501', row(13), G6501],
]

/** The legacy driver, with a simulator that never answers `cmds` (as if the library never sent them). */
function unanswered(code: LegacyFamilyCode, ...cmds: number[]): FamilyDriver {
  const d = LEGACY_DRIVERS[code]
  return {
    ...d,
    name: `${d.name} (no reply to ${cmds.map((c) => `0x${c.toString(16).padStart(2, '0')}`).join(', ')})`,
    createSimulator: (p, o) => {
      const sim = d.createSimulator(p, o) as LegacySimulator
      const respond = sim.respond.bind(sim)
      sim.respond = (packet) => (cmds.includes(packet[2]) ? [] : respond(packet))
      return sim
    },
  }
}

describe('legacy products: every readable control is populated after connect (LegacyMicDevice)', () => {
  it('the legacy drivers create LegacyMicDevice (the adapter the check runs through)', () => {
    const d = LEGACY_DRIVERS['6301']
    const p = row(7)
    expect(d.createDevice(simulatedTransport(d.createSimulator(p)), p)).toBeInstanceOf(LegacyMicDevice)
  })

  for (const [code, product, keys] of CASES) {
    it(`${displayName(product)} (PID ${product.productId}): ${keys.join(', ')}`, async () => {
      const r = await checkPopulatedAfterConnect(LEGACY_DRIVERS[code], product)
      expect(r.rx).toBe('available')
      expect(r.checked).toEqual(keys)
      expect(r.missing).toEqual([])
      expect(r.invalid).toEqual([])
      expect(r.unavailable).toEqual([])
      expect(r.populated).toEqual(keys)
    })
  }

  it('reconnect (Lark M2 PID 7): a new connection reads the volume the receiver has now', async () => {
    const d = LEGACY_DRIVERS['6301']
    const p = row(7)
    const sim = d.createSimulator(p) as LegacySimulator
    const fast = { requestTimeoutMs: 40, probeTimeoutMs: 60, interFrameDelayMs: 0, heartbeatIntervalMs: null }
    for (const volume of [3, 0, 5]) {
      sim.receiver.volume = volume // changed on the receiver while unplugged
      const mic = d.createDevice(simulatedTransport(sim), p, fast) as LegacyMicDevice
      await mic.connect()
      await mic.idle()
      expect(mic.state.values[CONTROL.VOLUME], `receiver volume ${volume}`).toBe(volume)
      await mic.disconnect()
    }
  })

  it('mock presets: the default run stands for presets without simulator options; "blind" gets the dropped-replies check', () => {
    expect(populationRuns(LEGACY_DRIVERS['6118'], row(1041)).map((r) => [r.id, r.presets])).toEqual([['default', ['a2']], ['blind', []]])
    expect(populationRuns(LEGACY_DRIVERS['6301'], row(7)).map((r) => [r.id, r.presets])).toEqual([['default', ['m2']]])
    expect(populationRuns(LEGACY_DRIVERS['6501'], row(1)).map((r) => [r.id, r.presets])).toEqual([['default', ['c1']]])
  })
})

describe('regression: Lark M2 PID 7 volume unknown after (re)connect (PROTOCOL.md §11.8)', () => {
  it('PID 7 without the 0x04 start-up read: the check reports the volume missing', async () => {
    const r = await checkPopulatedAfterConnect(unanswered('6301', Cmd.VOLUME_GET), row(7))
    expect(r.rx).toBe('available')
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([[CONTROL.VOLUME, 'status']])
    expect(r.missing[0].hint).toMatch(/does not carry it.*0x04/)
    // Everything else still comes from the heartbeat / GETs.
    expect(r.populated).toEqual([CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.SPEAKER])
  })

  it('declaring it as an exception needs a reason and passes it explicitly (it is reported, not hidden)', async () => {
    const r = await checkPopulatedAfterConnect(unanswered('6301', Cmd.VOLUME_GET), row(7), {
      notReadOnConnect: { [CONTROL.VOLUME]: { reason: 'test: the simulator never answers 0x04', productIds: [7] } },
    })
    expect(r.missing).toEqual([])
    expect(r.excepted).toEqual([{ key: CONTROL.VOLUME, reason: 'test: the simulator never answers 0x04' }])
  })

  it('PID 8 (camera) and the M2S take the volume from the heartbeat, so the same gap does not show there', async () => {
    for (const [code, pid] of [['6301', 8], ['6301', 33], ['6302', 1029], ['6302', 1030]] as const) {
      const r = await checkPopulatedAfterConnect(unanswered(code, Cmd.VOLUME_GET), row(pid, pid === 33 ? 0x4417 : 0x3547))
      expect(r.missing, `PID ${pid}`).toEqual([])
      expect(r.populated, `PID ${pid}`).toContain(CONTROL.VOLUME)
    }
  })

  it('Lark C1 (PID 1): NC level and volume come only from 0x11 / 0x04 (heartbeat link/battery only)', async () => {
    const noNc = await checkPopulatedAfterConnect(unanswered('6501', Cmd.NOISE_LEVEL_GET), row(1))
    expect(noNc.missing.map((m) => m.key)).toEqual([CONTROL.NOISE_LEVEL])
    const noVol = await checkPopulatedAfterConnect(unanswered('6501', Cmd.VOLUME_GET), row(1))
    expect(noVol.missing.map((m) => m.key)).toEqual([CONTROL.VOLUME])
    // PIDs 11/12/13 carry both in the heartbeat.
    for (const pid of [11, 12, 13]) {
      const r = await checkPopulatedAfterConnect(unanswered('6501', Cmd.NOISE_LEVEL_GET, Cmd.VOLUME_GET), row(pid))
      expect(r.missing, `PID ${pid}`).toEqual([])
    }
  })

  it('a GET-only setting (0x13 Phone Speaker) is missing when its start-up read is not answered', async () => {
    const r = await checkPopulatedAfterConnect(unanswered('6501', Cmd.SPEAKER_GET), row(12))
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([[CONTROL.SPEAKER, 'get']])
    expect(r.missing[0].hint).toMatch(/no GET/)
  })
})
