/**
 * Conformance check 10 ("populated after connect", core/conformance.ts) for the LARK M3: the readable set of every PID
 * and preset, and the start-up reads it depends on. The heartbeat carries the home page and two More Settings values
 * (bytes 26 / 27); bit depth and playback without unplugging exist only in the 0x6011 reply, the camera RX levels only
 * in the 0x100E reply, so the driver reads both at start-up (the apps read them when the page opens). A receiver that
 * does not answer them leaves exactly those values unknown, which the check reports with the GET hint.
 */
import { describe, expect, it } from 'vitest'
import { CONTROL } from '../../../core/controls'
import { checkNothingInvented, checkPopulatedAfterConnect, populationRuns } from '../../../core/conformance'
import type { FamilyDriver } from '../../../core/types'
import { MomaRequestReader, MOMA_6303 } from '../../../moma'
import { createM3Driver, M3Cmd, M3_CONTROL, type M3Simulator } from '..'

const driver = createM3Driver()
const row = (pid: number) => driver.products.find((p) => p.productId === pid)!

const MUTE4 = ['mic.mute:tx1', 'mic.mute:tx2', 'mic.mute:tx3', 'mic.mute:tx4']
const HOME_TAIL = [CONTROL.CHANNEL_MODE, M3_CONTROL.SMART_MIX, CONTROL.MIC_RECOGNITION, CONTROL.LED]
const MORE = [CONTROL.SPEAKER, M3_CONTROL.BIT_DEPTH, M3_CONTROL.TX_BUTTON_LOCK, CONTROL.AUTO_OFF]
const PHONE_KEYS = [CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, CONTROL.VOLUME, ...HOME_TAIL, ...MORE]
const CAMERA_KEYS = [
  CONTROL.NOISE_ENABLED, CONTROL.NOISE_LEVEL, M3_CONTROL.CAMERA_LEVEL_1, M3_CONTROL.CAMERA_LEVEL_2, M3_CONTROL.CAMERA_LEVEL_3, ...HOME_TAIL,
  M3_CONTROL.HOT_SHOE_SYNC, ...MORE,
]

/** The M3 driver with a simulator that never answers `cmds` (as if the library never sent them). */
function unanswered(...cmds: number[]): FamilyDriver {
  return {
    ...driver,
    name: `LARK M3 (no reply to ${cmds.map((c) => `0x${c.toString(16)}`).join(', ')})`,
    createSimulator: (p, o) => {
      const sim = driver.createSimulator(p, o) as M3Simulator
      const respond = sim.respond.bind(sim)
      const reader = new MomaRequestReader(MOMA_6303)
      sim.respond = (packet) => (reader.push(packet).some((f) => f.items.some((it) => cmds.includes(it.cmd))) ? [] : respond(packet))
      return sim
    },
  }
}

describe('LARK M3: every readable control is populated after connect', () => {
  for (const [pid, keys, mutes] of [
    [1036, CAMERA_KEYS, MUTE4.slice(0, 2)],
    [1037, CAMERA_KEYS, MUTE4.slice(0, 2)],
    [1038, PHONE_KEYS, MUTE4.slice(0, 2)],
    [1039, PHONE_KEYS, MUTE4.slice(0, 2)],
  ] as const) {
    it(`PID ${pid}: mute of the online TXs, ${keys.join(', ')}`, async () => {
      const r = await checkPopulatedAfterConnect(driver, row(pid))
      expect(r.rx).toBe('available')
      expect(r.populated).toEqual([...mutes, ...keys])
      expect(r.offline).toEqual(MUTE4.slice(2))
      expect(r).toMatchObject({ missing: [], invalid: [], unavailable: [], excepted: [], stale: [] })
    })
  }

  it('every preset with simulator options gets its own run, and passes', async () => {
    const runs = driver.products.flatMap((p) => populationRuns(driver, p).map((r) => `${p.productId}:${r.id}${r.presets.length ? `=${r.presets.join('+')}` : ''}`))
    expect(runs).toEqual([
      '1036:default=m3cam', '1036:m3-multi', '1037:default', '1037:m3cam4', '1038:default=m3', '1038:m3-secondary', '1038:m3-2t2r', '1039:default', '1039:m3-4ch',
    ])
    for (const p of driver.products) {
      for (const run of populationRuns(driver, p)) {
        const r = await checkPopulatedAfterConnect(driver, p, { run: run.id, sim: run.sim })
        expect(r.missing, `${p.productId} ${run.id}`).toEqual([])
        expect(r.invalid, `${p.productId} ${run.id}`).toEqual([])
      }
    }
  })

  it('four mics online (m3-4ch): all four mute values come from the heartbeat', async () => {
    const r = await checkPopulatedAfterConnect(driver, row(1039), { run: 'm3-4ch', sim: driver.mockPresets.find((m) => m.id === 'm3-4ch')!.sim })
    expect(r.populated.slice(0, 4)).toEqual(MUTE4)
    expect(r.offline).toEqual([])
  })

  it('a secondary RX: global settings keep their values (the heartbeat mirrors the primary); nothing is excused', async () => {
    const r = await checkPopulatedAfterConnect(driver, row(1038), { run: 'm3-secondary', sim: { profile: 'secondary' } })
    expect(r.populated).toEqual([...MUTE4.slice(0, 2), ...PHONE_KEYS])
    expect(r.values[CONTROL.LED]).toBe(true)
  })
})

describe('the start-up reads check 10 depends on', () => {
  it('no reply to 0x6011: bit depth and playback without unplugging are missing (GET hint); the heartbeat still fills the rest', async () => {
    const r = await checkPopulatedAfterConnect(unanswered(M3Cmd.GET_SETTING_INFO), row(1038))
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([[CONTROL.SPEAKER, 'get'], [M3_CONTROL.BIT_DEPTH, 'get']])
    expect(r.missing[0].hint).toMatch(/no GET for it was answered at start-up/)
    // Lock and auto power off are in 0x6011 too, but the heartbeat carries them (bytes 26 / 27).
    expect(r.populated).toContain(M3_CONTROL.TX_BUTTON_LOCK)
    expect(r.populated).toContain(CONTROL.AUTO_OFF)
  })

  it('no reply to 0x100E: the three camera RX levels are missing; the phone RX does not need it', async () => {
    const d = unanswered(M3Cmd.GET_GAIN_LEVEL_DETAIL)
    expect((await checkPopulatedAfterConnect(d, row(1036))).missing.map((m) => m.key)).toEqual([
      M3_CONTROL.CAMERA_LEVEL_1, M3_CONTROL.CAMERA_LEVEL_2, M3_CONTROL.CAMERA_LEVEL_3,
    ])
    expect((await checkPopulatedAfterConnect(d, row(1038))).missing).toEqual([])
  })

  it('identity replies are not needed for any value (no firmware gates on the M3 home / More Settings pages)', async () => {
    const r = await checkPopulatedAfterConnect(unanswered(M3Cmd.GET_DEV_INFO, M3Cmd.GET_FIRMWARE_VER), row(1037))
    expect(r.missing).toEqual([])
  })

  it('with every reply dropped no readable control has a value (nothing defaults)', async () => {
    for (const p of driver.products) expect(await checkNothingInvented(driver, p)).toEqual({ rx: 'unavailable', packets: 0, invented: [] })
  })
})
