/**
 * WebHidFeatureTransport (transports/webhid-feature.ts) against the feature-report fake
 * (transports/fake-hid-feature.ts): SET_REPORT + GET_REPORT pairing, id-byte normalisation, stale-reply retry,
 * failures, timeouts (3000 / 1000 ms as Android), serialisation, OTA refusal, chooser filters.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromHex } from '../../../codec'
import { PRODUCTS } from '../../../models'
import { TransportError } from '../../../transport'
import { A2_COLLECTIONS, FakeHid, FakeHidDevice, declaredReport, vendorCollection } from '../../../transports/fake-hid'
import { FakeFeatureHidDevice, fakeFeatureDeviceFor } from '../../../transports/fake-hid-feature'
import {
  A1_FEATURE_LINK, FEATURE_READ_TIMEOUT_MS, FEATURE_WRITE_TIMEOUT_MS, WebHidFeatureTransport, featureLinkFilters, featureLinkFor,
  normalizeFeatureReport,
} from '../../../transports/webhid-feature'
import { encodeA1Frame } from '../codec'
import { A1Requests } from '../commands'
import { A1Simulator, encodeA1SimReply } from '../sim'
import { A1_OTA_VECTORS } from './vectors'

function install(devices: FakeHidDevice[] = []): FakeHid {
  const hid = new FakeHid(devices)
  vi.stubGlobal('navigator', { hid: hid.hidApi, platform: 'MacIntel', userAgent: 'Macintosh' })
  return hid
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const HB = encodeA1Frame(0x1f)
const VERSION = encodeA1Frame(0x0d, [0])

/** A fake that answers every request with `cmd` echoed and body [0x2a]. */
function echoDevice(o: ConstructorParameters<typeof FakeFeatureHidDevice>[0] = {}): FakeFeatureHidDevice {
  return new FakeFeatureHidDevice({ respond: (f) => [encodeA1SimReply(f[4], [0x2a])], ...o })
}

async function opened(dev: FakeFeatureHidDevice, o?: ConstructorParameters<typeof WebHidFeatureTransport>[1]) {
  install([dev])
  const t = new WebHidFeatureTransport(dev.hid, o)
  const packets: Uint8Array[] = []
  const debug: string[] = []
  t.onPacket((p) => packets.push(p))
  t.onDebug((m) => debug.push(m))
  await t.open()
  return { t, packets, debug }
}

describe('WebHidFeatureTransport: SET_REPORT + GET_REPORT', () => {
  it('sends sendFeatureReport(5, frame[1..64]) and emits the GET reply before send() resolves', async () => {
    const dev = echoDevice()
    const { t, packets } = await opened(dev)
    expect(t.capabilities).toEqual({ receive: 'unknown', link: 'feature', maxWrite: 64 })
    expect(t.link).toMatchObject({ kind: 'webhid-feature', reportId: 5, size: 64 }) // from the registry row
    let atResolve = -1
    await t.send(HB).then(() => (atResolve = packets.length))
    expect(atResolve).toBe(1)
    expect(dev.sent).toHaveLength(1)
    expect(dev.sent[0]).toMatchObject({ kind: 'feature', reportId: 5 })
    expect([...dev.sent[0].data]).toEqual([...HB.subarray(1)]) // 63 data bytes
    expect(dev.gets).toBe(1)
    expect(packets[0]).toHaveLength(64)
    expect([...packets[0]]).toEqual([...encodeA1SimReply(0x1f, [0x2a])])
    expect(t.lastReplyLayout).toEqual({ byteLength: 64, includedReportId: true })
    expect(t.stats).toMatchObject({ sets: 1, gets: 1, staleGets: 0, droppedReplies: 0, failedGets: 0 })
  })

  it('restores the id byte when receiveFeatureReport() leaves it out', async () => {
    const dev = echoDevice({ featureIncludesReportId: false })
    const { t, packets } = await opened(dev)
    await t.send(VERSION)
    expect(t.lastReplyLayout).toEqual({ byteLength: 63, includedReportId: false })
    expect([...packets[0]]).toEqual([...encodeA1SimReply(0x0d, [0x2a])])
  })

  it('repeats a stale GET once and emits the fresh reply', async () => {
    const dev = echoDevice()
    const { t, packets, debug } = await opened(dev)
    await t.send(VERSION) // register = version reply
    dev.staleGets = 1 // the next GET still returns it
    await t.send(HB)
    expect(packets.map((p) => p[4])).toEqual([0x0d, 0x1f])
    expect(dev.gets).toBe(3)
    expect(t.stats.staleGets).toBe(1)
    expect(debug.some((m) => /stale/.test(m))).toBe(true)
  })

  it('drops a reply that never matches (no packet, the engine times out)', async () => {
    const dev = new FakeFeatureHidDevice({ respond: (f) => (f[4] === 0x1f ? [encodeA1SimReply(0x1f, [1])] : []) })
    const { t, packets, debug } = await opened(dev, { staleRetryDelayMs: 0 })
    await t.send(HB)
    await t.send(VERSION) // no answer: the register still holds the heartbeat reply
    expect(packets.map((p) => p[4])).toEqual([0x1f])
    expect(t.stats).toMatchObject({ staleGets: 2, droppedReplies: 1 })
    expect(debug.some((m) => /dropping the reply to 0xd/.test(m))).toBe(true)
    // all-zero register before any reply ("nothing ready"): also dropped
    const fresh = await opened(new FakeFeatureHidDevice({ respond: () => [] }), { staleRetries: 0 })
    await fresh.t.send(HB)
    expect(fresh.packets).toEqual([])
    expect(fresh.t.stats.droppedReplies).toBe(1)
  })

  it('a refused GET emits nothing and resolves (write-only link); a refused SET throws', async () => {
    const dev = echoDevice()
    const { t, packets, debug } = await opened(dev)
    dev.getFailure = new DOMException('Failed to receive the feature report.', 'NotAllowedError')
    await expect(t.send(HB)).resolves.toBeUndefined()
    expect(packets).toEqual([])
    expect(t.stats.failedGets).toBe(1)
    expect(dev.sent).toHaveLength(1) // the SET went out
    expect(debug.some((m) => /receiveFeatureReport\(5\) failed/.test(m))).toBe(true)
    dev.getFailure = null
    dev.failNext = { op: 'sendFeatureReport', error: new DOMException('Failed to write the feature report.', 'NotAllowedError') }
    await expect(t.send(HB)).rejects.toThrow(TransportError)
    await expect(t.send(HB)).resolves.toBeUndefined() // the queue keeps working after a failure
  })

  it('times out like Android: SET 3000 ms, GET 1000 ms', async () => {
    expect([FEATURE_WRITE_TIMEOUT_MS, FEATURE_READ_TIMEOUT_MS]).toEqual([3000, 1000])
    vi.useFakeTimers()
    const dev = echoDevice()
    const { t, packets } = await opened(dev)
    dev.hang = 'get'
    let settled = false
    const p = t.send(HB).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(packets).toEqual([])
    expect(t.stats.failedGets).toBe(1)

    dev.hang = 'set'
    let error: unknown = null
    const q = t.send(HB).catch((e: unknown) => (error = e))
    await vi.advanceTimersByTimeAsync(2999)
    expect(error).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    await q
    expect(error).toBeInstanceOf(TransportError)
    expect(String(error)).toMatch(/SET_REPORT\(feature 5\) timed out after 3000 ms/)
  })

  it('serialises exchanges: SET, GET, SET, GET', async () => {
    const log: string[] = []
    const dev = new FakeFeatureHidDevice({
      respond: (f) => {
        log.push(`SET ${f[4].toString(16)}`)
        return [encodeA1SimReply(f[4], [0])]
      },
    })
    dev.setDelayMs = 3
    dev.getDelayMs = 3
    const get = dev.receiveFeatureReport.bind(dev)
    dev.receiveFeatureReport = async (id: number) => {
      const v = await get(id)
      log.push(`GET ${new Uint8Array(v.buffer)[4].toString(16)}`)
      return v
    }
    const { t, packets } = await opened(dev)
    await Promise.all([t.send(HB), t.send(VERSION), t.send(encodeA1Frame(0x46))])
    expect(log).toEqual(['SET 1f', 'GET 1f', 'SET d', 'GET d', 'SET 46', 'GET 46'])
    expect(packets.map((p) => p[4])).toEqual([0x1f, 0x0d, 0x46])
  })

  it('refuses the OTA report, other report ids and frames that do not fit; nothing is sent', async () => {
    const dev = echoDevice()
    const { t } = await opened(dev)
    for (const v of A1_OTA_VECTORS) {
      const f = new Uint8Array(160).fill(0xcd)
      f.set(fromHex(v.hex))
      await expect(t.send(f), v.name).rejects.toThrow(/firmware-update reports are never sent/)
    }
    await expect(t.send(fromHex('aa dd 10 40 00 00'))).rejects.toThrow(/feature report 5/)
    await expect(t.send(new Uint8Array(0))).rejects.toThrow(TransportError)
    const long = new Uint8Array(65)
    long[0] = 5
    await expect(t.send(long)).rejects.toThrow(/does not fit/)
    expect(dev.sent).toEqual([])
    await t.close()
    await expect(t.send(HB)).rejects.toThrow(/not open/)
  })

  it('uses the declared report size, else size - 1; reports the declared feature reports', async () => {
    const declared = echoDevice()
    const a = await opened(declared)
    expect(a.t.declaredFeatureReports()).toEqual([{ reportId: 5, bytes: 63 }, { reportId: 6, bytes: 159 }])
    expect(a.debug[0]).toMatch(/feature reports 5=63 B, 6=159 B/)
    const undeclared = echoDevice({ collections: [vendorCollection(0xff00, {})] })
    const b = await opened(undeclared)
    expect(b.debug[0]).toMatch(/none declared .*report 5 is not declared/)
    await b.t.send(HB)
    expect(undeclared.sent[0].data).toHaveLength(63)
    expect(b.packets).toHaveLength(1) // the fake answers with the reply's own length
    const wide = echoDevice({ collections: [vendorCollection(0xff00, { feature: [declaredReport(5, 64)] })], strictSizes: true })
    const c = await opened(wide)
    await c.t.send(HB)
    expect(wide.sent[0].data).toHaveLength(64)
    expect(c.packets[0]).toHaveLength(64)
  })
})

describe('normalizeFeatureReport', () => {
  const reply = encodeA1SimReply(0x1f, [1, 2, 3])
  const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

  it('decides from the declared size, then the magic position, then byte 0', () => {
    expect(normalizeFeatureReport(view(reply), 5, 64, 63).layout.includedReportId).toBe(true)
    expect(normalizeFeatureReport(view(reply.slice(1)), 5, 64, 63).layout.includedReportId).toBe(false)
    expect([...normalizeFeatureReport(view(reply.slice(1)), 5, 64, 63).report]).toEqual([...reply])
    // undeclared: magic BB DD at offset 2 (with id) or 1 (without)
    expect(normalizeFeatureReport(view(reply.slice(0, 40)), 5, 64).layout.includedReportId).toBe(true)
    expect(normalizeFeatureReport(view(reply.slice(1, 40)), 5, 64).layout.includedReportId).toBe(false)
    // no magic: byte 0 equal to the id
    expect(normalizeFeatureReport(view(Uint8Array.of(5, 0, 0, 0)), 5, 64).layout.includedReportId).toBe(true)
    expect(normalizeFeatureReport(view(Uint8Array.of(9, 0, 0, 0)), 5, 64).report.subarray(0, 2)).toEqual(Uint8Array.of(5, 9))
    // always exactly `size` bytes
    expect(normalizeFeatureReport(view(new Uint8Array(100)), 5, 64).report).toHaveLength(64)
  })
})

describe('WebHidFeatureTransport: chooser and registry', () => {
  it('derives filters from the registry: none while the A1 is recognised-only, unless asked', () => {
    expect(featureLinkFilters()).toEqual([])
    expect(featureLinkFilters(PRODUCTS, { includeRecognised: true })).toEqual([{ vendorId: 0x3547, productId: 1031 }])
    expect(featureLinkFor(0x3547, 1031)).toMatchObject({ reportId: 5, size: 64, otaReportId: 6 })
    expect(featureLinkFor(0x3547, 1041)).toBeUndefined() // the A2 uses interrupt reports
    expect(A1_FEATURE_LINK).toMatchObject({ reportId: 5, size: 64 })
  })

  it('request(): refuses an empty filter list (it would list every HID device); picks the declaring interface', async () => {
    const a1Audio = new FakeFeatureHidDevice({ collections: [vendorCollection(0x000c, {})] }) // consumer-control interface
    const a1Vendor = new FakeFeatureHidDevice()
    const hid = install([a1Audio, a1Vendor])
    await expect(WebHidFeatureTransport.request()).rejects.toThrow(/no connectable product/)
    hid.choose = (_f, devs) => [...devs]
    const t = await WebHidFeatureTransport.request(featureLinkFilters(PRODUCTS, { includeRecognised: true }))
    expect(t?.device).toBe(a1Vendor.hid)
    expect(hid.requests[0]).toEqual([{ vendorId: 0x3547, productId: 1031 }])
  })

  it('granted devices, reconnect, connect events and unplug', async () => {
    const a1 = new FakeFeatureHidDevice()
    const a2 = new FakeHidDevice({ vendorId: 0x3547, productId: 0x0411, collections: A2_COLLECTIONS })
    const hid = install([a1, a2])
    hid.granted.add(a1)
    hid.granted.add(a2)
    expect(await WebHidFeatureTransport.getGrantedDevices()).toEqual([a1.hid])
    const t = (await WebHidFeatureTransport.reconnect())!
    expect(t.info).toMatchObject({ vendorId: 0x3547, productId: 1031, id: 'webhid-feature:3547:407' })
    const seen: HIDDevice[] = []
    const off = WebHidFeatureTransport.onDeviceConnect((d) => seen.push(d))
    hid.plug(a2)
    hid.plug(a1)
    off()
    expect(seen).toEqual([a1.hid])
    await t.open()
    const reasons: (Error | undefined)[] = []
    t.onDisconnect((r) => reasons.push(r))
    hid.unplug(a1)
    expect(reasons).toHaveLength(1)
    expect(String(reasons[0])).toMatch(/unplugged/)
  })

  it('answers through a DeviceSimulator with fakeFeatureDeviceFor()', async () => {
    const sim = new A1Simulator({ profile: '4mic' })
    const dev = fakeFeatureDeviceFor(sim)
    expect([dev.vendorId, dev.productId]).toEqual([0x3547, 1031])
    const { t, packets } = await opened(dev)
    await t.send(encodeA1Frame(A1Requests.version('rx').cmd, A1Requests.version('rx').payload))
    expect([...packets[0].subarray(4, 12)]).toEqual([0x0d, 0x00, 0x05, 0x00, 1, 1, 1, 3])
    expect(sim.received).toHaveLength(1)
  })
})
