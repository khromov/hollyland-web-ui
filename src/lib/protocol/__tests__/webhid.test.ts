/**
 * Generalized WebHidTransport against the WebHID test double (transports/fake-hid.ts).
 * The first test pins today's A2 bytes: sendReport(0xAA, 63 B) (PROTOCOL.md §11.3, §11.7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeRequest, fromHex, Target } from '../codec'
import { Requests } from '../commands'
import { HollylandDevice } from '../device'
import { lookupProduct, PRODUCTS, webHidLinkOf } from '../models'
import {
  A1_COLLECTIONS, A2_COLLECTIONS, FakeHid, FakeHidDevice, M3_COLLECTIONS_511, M3_COLLECTIONS_63, NO_ID_COLLECTIONS_64, declaredReport, vendorCollection,
} from '../transports/fake-hid'
import {
  defaultFilters, featureReportSize, filtersForProducts, inputReportSize, isKnownHidDevice, outputReportSize, productsNeedingVidFallback,
  WebHidTransport,
} from '../webhid'

function install(devices: FakeHidDevice[], platform = 'Linux x86_64'): FakeHid {
  const hid = new FakeHid(devices)
  vi.stubGlobal('navigator', { hid: hid.hidApi, platform, userAgent: platform })
  return hid
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const a2 = () => new FakeHidDevice({ vendorId: 0x3547, productId: 0x0411, collections: A2_COLLECTIONS })

describe('WebHidTransport: legacy A2 regression', () => {
  it('sends sendReport(0xAA, 63 B) exactly as before', async () => {
    const dev = a2()
    install([dev])
    const t = new WebHidTransport(dev.hid)
    await t.open()
    expect(t.framing).toBe('raw')
    expect(t.link).toMatchObject({ kind: 'webhid', reportId: 'byte0' })
    await t.send(encodeRequest(Requests.heartbeat()))
    expect(dev.sent).toHaveLength(1)
    expect(dev.sent[0].reportId).toBe(0xaa)
    expect(dev.sent[0].data.length).toBe(63)
    expect([...dev.sent[0].data.subarray(0, 5)]).toEqual([0xdd, 0x10, 0x40, 0x00, 0x00])
    // a short (unpadded) frame is padded to the same 63 bytes
    await t.send(Uint8Array.of(0xaa, 0xdd, 0x10, 0x40, 0, 0))
    expect(dev.sent[1].data).toEqual(dev.sent[0].data)
    await expect(t.send(new Uint8Array(65))).rejects.toThrow(/packet length 65 not in 1..64/)
    await t.close()
  })

  it('restores the leading 0xBB on input and drives HollylandDevice end to end', async () => {
    const dev = a2()
    install([dev])
    // live A2 heartbeat (bridge.test.ts LIVE '10 40')
    const hb = fromHex('bb dd 10 80 00 10 01 01 5b 5c 00 00 00 05 00 00 00 00 00 00 04')
    dev.onOutput = (r) => {
      if (r.reportId === 0xaa && r.data[1] === 0x10) queueMicrotask(() => dev.emitInput(0xbb, hb.subarray(1)))
    }
    const t = new WebHidTransport(dev.hid)
    const d = new HollylandDevice(t, { heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false, probeTimeoutMs: 50 })
    const s = await d.connect()
    expect(s.rx).toBe('available')
    expect(s.units.tx1).toMatchObject({ online: true, battery: 91 })
    await d.disconnect()
  })

  it('guesses write-only on macOS for byte-0 report ids, unknown elsewhere', () => {
    const dev = a2()
    install([dev], 'MacIntel')
    expect(new WebHidTransport(dev.hid).capabilities).toMatchObject({ receive: 'no', link: 'interrupt', maxWrite: 64 })
    install([dev], 'Linux x86_64')
    expect(new WebHidTransport(dev.hid).capabilities.receive).toBe('unknown')
  })

  it('keeps the default chooser filters and granted-device rules', async () => {
    expect(defaultFilters()).toEqual([
      { vendorId: 0x3547, usagePage: 0xff82 },
      { vendorId: 0x3547, productId: 7 }, { vendorId: 0x3547, productId: 8 },
      { vendorId: 0x4417, productId: 32 }, { vendorId: 0x4417, productId: 33 },
      { vendorId: 0x3547, productId: 1029 }, { vendorId: 0x3547, productId: 1030 },
      // 6501 group (Phase 1, W1): Lark C1, C1 2nd gen, M1 2nd gen, Mini
      { vendorId: 0x3547, productId: 1 }, { vendorId: 0x3547, productId: 11 }, { vendorId: 0x3547, productId: 12 }, { vendorId: 0x3547, productId: 13 },
    ])
    const other = new FakeHidDevice({ vendorId: 0x1234, productId: 0x040f })
    const m3 = new FakeHidDevice({ vendorId: 0x3547, productId: 0x040f, collections: M3_COLLECTIONS_63 })
    const hid = install([a2(), other, m3])
    for (const d of hid.devices) hid.granted.add(d)
    const granted = await WebHidTransport.getGrantedDevices()
    expect(granted.map((d) => d.productId)).toEqual([0x0411, 0x040f])
    expect(granted.every((d) => d.vendorId === 0x3547)).toBe(true)
    // Stub families are not connectable: no unconfirmed-VID fallback yet.
    expect(productsNeedingVidFallback()).toEqual([])
    expect(isKnownHidDevice({ vendorId: 0x1234, productId: 0x040f })).toBe(false)
  })

  it('request() shows the chooser with the default filters and prefers the control collection', async () => {
    const hid = install([a2()])
    const t = await WebHidTransport.request()
    expect(t?.info.productId).toBe(0x0411)
    expect(hid.requests[0]).toEqual(defaultFilters())
  })

  it('reports unplugs as a transport disconnect', async () => {
    const dev = a2()
    const hid = install([dev])
    const t = new WebHidTransport(dev.hid)
    await t.open()
    const gone = new Promise<Error | undefined>((r) => t.onDisconnect(r))
    hid.unplug(dev)
    expect(String(await gone)).toMatch(/unplugged/)
  })
})

describe('WebHidTransport: descriptor-derived sizes (other families)', () => {
  it('reads report sizes from the collections', () => {
    const m3 = new FakeHidDevice({ vendorId: 0x3547, productId: 0x040c, collections: M3_COLLECTIONS_511 })
    expect(outputReportSize(m3.hid, 8)).toBe(511)
    expect(inputReportSize(m3.hid, 8)).toBe(511)
    expect(outputReportSize(m3.hid, 0xaa)).toBeUndefined()
    const a1 = new FakeHidDevice({ vendorId: 0x3547, productId: 1031, collections: A1_COLLECTIONS })
    expect(featureReportSize(a1.hid, 5)).toBe(63)
    expect(featureReportSize(a1.hid, 6)).toBe(159)
    // nested collections count too
    const nested = new FakeHidDevice({
      vendorId: 1, productId: 1, collections: [{ ...vendorCollection(0xff00), children: [vendorCollection(0xff01, { output: [declaredReport(3, 20)] })] }],
    })
    expect(outputReportSize(nested.hid, 3)).toBe(20)
  })

  it('M3: report 8 padded to the declared 63 bytes; a 512-byte frame needs a 511-byte report', async () => {
    const dev = new FakeHidDevice({ vendorId: 0x3547, productId: 0x040e, collections: M3_COLLECTIONS_63, strictSizes: true })
    install([dev], 'MacIntel')
    const t = new WebHidTransport(dev.hid)
    expect(t.link).toMatchObject({ reportId: 8 })
    // reply id 8 is declared for input: macOS delivers it (unlike the A2's undeclared 0xBB)
    expect(t.capabilities.receive).toBe('unknown')
    await t.open()
    const frame = new Uint8Array(64)
    frame.set([0x08, 0xaa, 0xdd, 0x06, 0x00, 0x00, 0x00, 0x01, 0x60, 0x00, 0x00, 0x00, 0x00])
    await t.send(frame.subarray(0, 14))
    expect(dev.sent[0]).toMatchObject({ reportId: 8 })
    expect(dev.sent[0].data.length).toBe(63)
    await expect(t.send(new Uint8Array(512).fill(8, 0, 1))).rejects.toThrow(/packet length 512 not in 1..64/)
    await expect(t.send(Uint8Array.of(0xaa, 0xdd))).rejects.toThrow(/uses report id 0x8/)
    dev.emitInput(8, Uint8Array.of(0xbb, 0xdd, 0x06))
    await t.close()
  })

  it('M3 with 511-byte reports: 64-byte frames pad to 511, 512-byte frames fit', async () => {
    const dev = new FakeHidDevice({ vendorId: 0x3547, productId: 0x040f, collections: M3_COLLECTIONS_511, strictSizes: true })
    install([dev])
    const t = new WebHidTransport(dev.hid)
    expect(t.capabilities.maxWrite).toBe(512)
    await t.open()
    const got: Uint8Array[] = []
    t.onPacket((p) => got.push(p))
    await t.send(Uint8Array.of(0x08, 0xaa, 0xdd))
    const big = new Uint8Array(512)
    big[0] = 8
    big[511] = 0x5a
    await t.send(big)
    expect(dev.sent.map((r) => r.data.length)).toEqual([511, 511])
    expect(dev.sent[1].data[510]).toBe(0x5a)
    dev.emitInput(8, Uint8Array.of(0xbb, 0xdd))
    expect([...got[0]]).toEqual([0x08, 0xbb, 0xdd])
  })

  it('undeclared report id with a registry link: smallest frame size that fits', async () => {
    const link = webHidLinkOf(lookupProduct(0x3547, 1036)!)
    const dev = new FakeHidDevice({ vendorId: 0x3547, productId: 1036, collections: [vendorCollection(0xff00, { input: [declaredReport(1, 8)] })] })
    install([dev])
    const t = new WebHidTransport(dev.hid, { link })
    await t.open()
    await t.send(Uint8Array.of(0x08, 1, 2))
    const big = new Uint8Array(300)
    big[0] = 8
    await t.send(big)
    expect(dev.sent.map((r) => r.data.length)).toEqual([63, 511])
  })

  it('no report ids: sendReport(0, frame) padded to the declared size; longer frames are refused', async () => {
    const dev = new FakeHidDevice({ vendorId: 0x3547, productId: 1032, collections: NO_ID_COLLECTIONS_64 })
    install([dev])
    const t = new WebHidTransport(dev.hid)
    expect(t.framing).toBe('no-report-id')
    await t.open()
    await t.send(Uint8Array.of(0xaa, 0xdd, 0x06))
    expect(dev.sent[0]).toMatchObject({ reportId: 0 })
    expect(dev.sent[0].data.length).toBe(64)
    await expect(t.send(new Uint8Array(65))).rejects.toThrow(/not in 1..64/)
    const got: Uint8Array[] = []
    t.onPacket((p) => got.push(p))
    dev.emitInput(0, Uint8Array.of(0xbb, 0xdd, 0x06))
    expect([...got[0]]).toEqual([0xbb, 0xdd, 0x06])
  })

  it('filtersForProducts skips app identities and recognised rows unless asked', () => {
    expect(filtersForProducts(PRODUCTS)).toHaveLength(12) // 8 A2/M2/M2S rows + the 6501 group (W1)
    const all = filtersForProducts(PRODUCTS, { includeRecognised: true })
    expect(all.some((f) => f.productId === 1039)).toBe(true)
    expect(all.some((f) => f.productId === 1031)).toBe(false) // A1: feature reports, not an interrupt link
    expect(all.some((f) => f.productId === 2)).toBe(false) // Lark MAX: no link
  })
})

describe('legacy framing variants stay available', () => {
  it("framing 'report41' sends report 0x41 with the frame in the data", async () => {
    const dev = a2()
    install([dev])
    const t = new WebHidTransport(dev.hid, { framing: 'report41' })
    await t.open()
    await t.send(encodeRequest({ cmd: 0x10, target: Target.RX }))
    expect(dev.sent[0].reportId).toBe(0x41)
    expect([...dev.sent[0].data.subarray(0, 3)]).toEqual([0xaa, 0xdd, 0x10])
    expect(dev.sent[0].data.length).toBe(63)
  })
})
