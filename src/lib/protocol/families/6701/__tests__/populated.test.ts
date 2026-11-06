/**
 * Conformance check 10 ("populated after connect", core/conformance.ts) for the LARK MAX 2, beyond the shared run in
 * driver.test.ts: the readable set of every product is pinned, and the read path behind each value is shown to be
 * the one that fills it (silence one command in the simulator and exactly its controls go missing, with the hint for
 * their read path). The suite needs no notReadOnConnect exception for this family.
 */
import { describe, expect, it } from 'vitest'
import { checkNothingInvented, checkPopulatedAfterConnect, isReadableControl, populationRuns } from '../../../core/conformance'
import { controlKey } from '../../../core/controls'
import { createMax2Driver, max2Controls, MAX2_CMD, MAX2_CONTROL } from '..'

const d = createMax2Driver()
const row = (pid: number) => d.products.find((p) => p.productId === pid)!
const readable = (pid: number) => max2Controls(row(pid)).filter(isReadableControl).map((c) => c.id)

const COMMON = [
  MAX2_CONTROL.SPEAKER, MAX2_CONTROL.BIT_DEPTH, MAX2_CONTROL.USB_OUTPUT, MAX2_CONTROL.MIC_LOCK, MAX2_CONTROL.NOISE_ENABLED, MAX2_CONTROL.NOISE_DEPTH,
  MAX2_CONTROL.GAIN_TYPE, MAX2_CONTROL.GAIN_DYNAMIC, MAX2_CONTROL.MIC_GAIN, MAX2_CONTROL.CHANNEL_MODE,
]
const TC = [MAX2_CONTROL.TC_ENABLED, MAX2_CONTROL.TC_MODE, MAX2_CONTROL.TC_FPS, MAX2_CONTROL.TC_TIMING]

describe('check 10: readable controls per product', () => {
  it('mobile RX 1026: common + Mic Recognition, 4 Mic & 1 RX, Wireless Monitoring and the OWS page; no timecode', () => {
    expect(readable(1026)).toEqual([...COMMON, MAX2_CONTROL.MIC_RECOGNITION, MAX2_CONTROL.FOUR_MIC, MAX2_CONTROL.WIRELESS, MAX2_CONTROL.OWS_MONITOR, MAX2_CONTROL.OWS_VOLUME])
  })

  it('camera RX 1027: common + timecode + Mic Recognition + 4 Mic & 1 RX', () => {
    expect(readable(1027)).toEqual([...COMMON, ...TC, MAX2_CONTROL.MIC_RECOGNITION, MAX2_CONTROL.FOUR_MIC])
  })

  it('charging case 101 (BLE): common + timecode', () => {
    expect(readable(101)).toEqual([...COMMON, ...TC])
  })

  it('every product and preset gets a run; the replies-dropped preset gets the inverse check', () => {
    expect(populationRuns(d, row(1026)).map((r) => r.id)).toEqual(['default', 'max2-4mic', 'max2-ows', 'max2-oldfw', 'max2-blind'])
    expect(populationRuns(d, row(1027)).map((r) => r.id)).toEqual(['default', 'max2cam-tc'])
    expect(populationRuns(d, row(101)).map((r) => r.id)).toEqual(['default', 'max2box-mtu185'])
  })
})

describe('check 10: each value comes from its read path', () => {
  it('USB: the probe heartbeat fills the status controls; only USB Output needs its own GET (0x8044)', async () => {
    const r = await checkPopulatedAfterConnect(d, row(1027), { sim: { params: { silent: [MAX2_CMD.UAC_OUT_MODE_GET] } } })
    expect(r.missing.map((m) => [m.key, m.readBack])).toEqual([[MAX2_CONTROL.USB_OUTPUT, 'get']])
    expect(r.missing[0].hint).toMatch(/GET/)
  })

  it('USB: without the heartbeat (no reply to 0x600B) the probe fails and nothing is read', async () => {
    const r = await checkPopulatedAfterConnect(d, row(1026), { sim: { params: { silent: [MAX2_CMD.HEART_INFO] } } })
    expect(r.rx).toBe('unavailable')
  })

  it('BLE: "get all" fills the settings, the TC page GETs fill frame rate and timing (Android reads; no heartbeat needed)', async () => {
    const quiet = await checkPopulatedAfterConnect(d, row(101), { sim: { params: { forwardHeartbeat: false } } })
    expect(quiet.missing).toEqual([])
    const noTcGets = await checkPopulatedAfterConnect(d, row(101), { sim: { params: { silent: [MAX2_CMD.INPUT_FPS, MAX2_CMD.TIMING_MODE] } } })
    expect(noTcGets.missing.map((m) => m.key)).toEqual([MAX2_CONTROL.TC_FPS, MAX2_CONTROL.TC_TIMING])
    const noGetAll = await checkPopulatedAfterConnect(d, row(101), { sim: { params: { silent: [MAX2_CMD.VOICE_GAIN] } } })
    expect(noGetAll.missing.map((m) => m.key)).toEqual([MAX2_CONTROL.GAIN_TYPE, MAX2_CONTROL.GAIN_DYNAMIC, controlKey(MAX2_CONTROL.MIC_GAIN, 'tx1'), controlKey(MAX2_CONTROL.MIC_GAIN, 'tx2')])
  })

  it('the RX version gates resolve at start-up: without 0x600A the gated controls are unexplained (version-unknown is not a reason)', async () => {
    const r = await checkPopulatedAfterConnect(d, row(1026), { sim: { rxVersion: '3.0.0.40', params: { heartbeatLength: 33, silent: [MAX2_CMD.DEVICE_VERSION] } } })
    expect(r.missing.map((m) => m.key)).toEqual([MAX2_CONTROL.FOUR_MIC, MAX2_CONTROL.WIRELESS, MAX2_CONTROL.OWS_MONITOR, MAX2_CONTROL.OWS_VOLUME])
    expect(r.missing[0].hint).toMatch(/version is unknown/)
  })

  it('mic 3 / 4 gains are checked when those mics are online (4 Mic & 1 RX), offline otherwise', async () => {
    const two = await checkPopulatedAfterConnect(d, row(1026))
    expect(two.offline).toEqual([controlKey(MAX2_CONTROL.MIC_GAIN, 'tx3'), controlKey(MAX2_CONTROL.MIC_GAIN, 'tx4')])
    const four = await checkPopulatedAfterConnect(d, row(1026), { run: 'max2-4mic', sim: { profile: '4mic' } })
    expect(four.populated).toEqual(expect.arrayContaining([controlKey(MAX2_CONTROL.MIC_GAIN, 'tx3'), controlKey(MAX2_CONTROL.MIC_GAIN, 'tx4')]))
    expect(four.offline).toEqual([])
  })

  it('with every reply (and push) dropped nothing is invented, on both links', async () => {
    for (const pid of [1026, 101]) {
      const r = await checkNothingInvented(d, row(pid))
      expect(r).toMatchObject({ rx: 'unavailable', packets: 0, invented: [] })
    }
  })
})
