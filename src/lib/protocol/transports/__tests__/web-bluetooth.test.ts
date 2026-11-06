/**
 * WebBluetoothTransport against the navigator.bluetooth test double (transports/fake-bluetooth.ts):
 * chooser filters from the registry links (MAX 2 BOX, MELO P1), product identification by GATT
 * service, write modes and MTU chunking with the 20-byte fallback, notification pieces and the
 * reassembly hook, disconnects, connect retries, silent reconnect, availability and platforms,
 * and the toy FamilyDriver end to end, including the shared conformance suite, over the BLE stack.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONTROL } from '../../core/controls'
import { describeDriverConformance } from '../../core/conformance'
import { encodeToy, T, TOY_PRODUCT, toyDriver, ToySimulator } from '../../core/__tests__/toy-driver'
import { ALL_PRODUCTS, HOLLYLAND_VENDOR_ID, isConnectableProduct, lookupAppProduct, lookupProduct } from '../../models'
import type { MicDeviceOptions, WebBluetoothLinkSpec } from '../../core/types'
import { TransportError } from '../../transport'
import {
  BLE_APP_WRITE_CHUNK, BLE_DESKTOP_WITHOUT_RESPONSE_CHUNK, BLE_MIN_WRITE_CHUNK, BleFrameJoiner, bleCandidates, bleLinkOf, bleRequestOptions,
  bleUuidEquals, canonicalBleUuid, defaultBleWriteChunk, isWebBluetoothSupported, onWebBluetoothAvailabilityChange, shortBleUuid,
  webBluetoothAvailability, webBluetoothPlatform, webBluetoothPlatformSupport, WebBluetoothTransport, type BleLinkCandidate,
} from '../web-bluetooth'
import {
  bleBridgedDriver, bleFilterMatches, bleSimulatedTransport, FakeBleDevice, FakeBluetooth, fakeBleDeviceForLink, fakeMax2Box, fakeMeloP1,
} from '../fake-bluetooth'

afterEach(() => {
  vi.unstubAllGlobals()
})

const BOX = lookupAppProduct(101)!
const MELO = lookupProduct(HOLLYLAND_VENDOR_ID, 1032)!
const BOX_LINK = bleLinkOf(BOX)!
const MELO_LINK = bleLinkOf(MELO)!
const BOTH: BleLinkCandidate[] = [{ product: BOX, link: BOX_LINK }, { product: MELO, link: MELO_LINK }]
const FEE7 = '0000fee7-0000-1000-8000-00805f9b34fb'
const FFE0 = '0000ffe0-0000-1000-8000-00805f9b34fb'
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const seq = (n: number, from = 0) => Uint8Array.from({ length: n }, (_, i) => (from + i) & 0xff)
const concat = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]))
/** Toy frame length: 5 header bytes + len + xor (core/__tests__/toy-driver.ts). */
const toyLength = (b: Uint8Array): number | null => (b[0] !== 0xa5 && b[0] !== 0x5a ? 0 : b.length < 5 ? null : 6 + b[4])

async function openOn(device: FakeBleDevice, candidates: BleLinkCandidate | BleLinkCandidate[], o: ConstructorParameters<typeof WebBluetoothTransport>[2] = {}) {
  const bt = new FakeBluetooth([device])
  bt.grant(device)
  const t = new WebBluetoothTransport(device, candidates, { bluetooth: bt.api, platform: 'macos', connectRetryDelayMs: 1, ...o })
  await t.open()
  return { t, bt }
}

describe('UUID and registry helpers', () => {
  it('canonicalizes 16-bit aliases and full UUIDs', () => {
    expect(canonicalBleUuid(0xfee7)).toBe(FEE7)
    expect(canonicalBleUuid('FEE7')).toBe(FEE7)
    expect(canonicalBleUuid('0x0000fee7')).toBe(FEE7)
    expect(canonicalBleUuid('0000FEE7-0000-1000-8000-00805F9B34FB')).toBe(FEE7)
    expect(canonicalBleUuid('e49a25f8-f69a-11e8-8eb2-f2801f1b9fd1')).toBe('e49a25f8-f69a-11e8-8eb2-f2801f1b9fd1')
    expect(() => canonicalBleUuid('battery_service')).toThrow(RangeError)
    expect(() => canonicalBleUuid(-1)).toThrow(RangeError)
    expect(bleUuidEquals(0xfec1, '0000FEC1-0000-1000-8000-00805f9b34fb')).toBe(true)
    expect(shortBleUuid(FFE0)).toBe('0xffe0')
  })

  it('reads the BLE links of the MAX 2 BOX and the MELO P1 RX from the registry', () => {
    expect(BOX_LINK).toMatchObject({ service: 0xfee7, write: 0xfec1, notify: 0xfec1, writeMode: 'without-response' })
    expect(MELO_LINK).toMatchObject({ service: 0xffe0, write: 0xffe1, notify: 0xffe2, writeMode: 'with-response' })
    expect(bleLinkOf(lookupProduct(HOLLYLAND_VENDOR_ID, 0x0411)!)).toBeUndefined()
  })

  it('offers only connectable rows unless recognised rows are asked for', () => {
    const all = bleCandidates(ALL_PRODUCTS, { includeRecognised: true }).map((c) => c.product!.productId)
    expect(all).toEqual(expect.arrayContaining([101, 1032]))
    expect(all).not.toContain(1033) // second-phone RX: USB only
    const live = bleCandidates()
    for (const c of live) expect(isConnectableProduct(c.product!)).toBe(true)
    expect(live.length).toBeLessThanOrEqual(all.length)
  })

  it('builds requestDevice options: canonical filters, byte prefixes, every service optional', () => {
    const o = bleRequestOptions([...BOTH, BOTH[0]])
    expect(o.acceptAllDevices).toBeUndefined()
    expect(o.filters).toEqual([
      { services: [FEE7] },
      { serviceData: [{ service: FEE7 }] },
      { serviceData: [{ service: canonicalBleUuid(0xbbbb), dataPrefix: Uint8Array.of(4, 1) }] },
      { serviceData: [{ service: canonicalBleUuid(0xbbbb), dataPrefix: Uint8Array.of(4, 2) }] },
    ])
    expect(o.optionalServices).toEqual([FEE7, FFE0])
    expect(bleRequestOptions(BOTH, { acceptAllDevices: true })).toEqual({ acceptAllDevices: true, optionalServices: [FEE7, FFE0] })
    // Without serviceData filters: MAX 2 keeps its services filter; MELO P1 alone falls back to acceptAllDevices.
    expect(bleRequestOptions(BOTH, { serviceDataFilters: false })).toEqual({ filters: [{ services: [FEE7] }], optionalServices: [FEE7, FFE0] })
    expect(bleRequestOptions([BOTH[1]], { serviceDataFilters: false })).toEqual({ acceptAllDevices: true, optionalServices: [FFE0] })
  })

  it('default write chunk: 509 with response, 182 without on desktop, 20 on Android', () => {
    expect(defaultBleWriteChunk('with-response', 'android')).toBe(BLE_APP_WRITE_CHUNK)
    expect(defaultBleWriteChunk('without-response', 'macos')).toBe(BLE_DESKTOP_WITHOUT_RESPONSE_CHUNK)
    expect(defaultBleWriteChunk('without-response', 'windows')).toBe(BLE_DESKTOP_WITHOUT_RESPONSE_CHUNK)
    expect(defaultBleWriteChunk('without-response', 'android')).toBe(BLE_MIN_WRITE_CHUNK)
  })
})

describe('fake chooser filters', () => {
  it('match the fake BOX by service data only, and the MELO P1 by its 0xBBBB prefix', () => {
    const box = fakeMax2Box()
    const melo = fakeMeloP1()
    const [uuidFilter, boxData, meloChina, meloData] = bleRequestOptions(BOTH).filters!
    expect(bleFilterMatches(uuidFilter, box)).toBe(false) // FEE7 not in the UUID list (the uncertain case)
    expect(bleFilterMatches(boxData, box)).toBe(true)
    expect(bleFilterMatches(meloData, melo)).toBe(true) // fake advertises 04 02 (C6201_OVERSEA)
    expect(bleFilterMatches(meloChina, fakeMeloP1({ serviceData: [[0xbbbb, [4, 1]]] }))).toBe(true) // 04 01: C6201_INLAND / iOS "0401"
    expect(bleFilterMatches(meloData, box)).toBe(false)
    // MELO P1 TWS earphones share productLine 4 (deviceId 3, iOS "0403" → type 12): not offered as a receiver.
    const ear = fakeMeloP1({ serviceData: [[0xbbbb, [4, 3]]] })
    expect(bleRequestOptions(BOTH).filters!.some((f) => bleFilterMatches(f, ear))).toBe(false)
    expect(bleFilterMatches({ serviceData: [{ service: canonicalBleUuid(0xbbbb), dataPrefix: Uint8Array.of(3) }] }, melo)).toBe(false)
    expect(bleFilterMatches(uuidFilter, fakeMax2Box({ advertiseServiceUuid: true }))).toBe(true)
  })
})

describe('availability and platform', () => {
  it('reports unsupported without navigator.bluetooth', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/140.0', platform: 'MacIntel' })
    expect(isWebBluetoothSupported()).toBe(false)
    expect(await webBluetoothAvailability()).toBe('unsupported')
    const s = webBluetoothPlatformSupport()
    expect(s).toMatchObject({ platform: 'macos', api: false, expected: 'available', persistentPermissions: false })
    expect(s.note).toMatch(/Chrome or Edge/)
  })

  it('reads getAvailability() and availabilitychanged', async () => {
    const bt = new FakeBluetooth()
    vi.stubGlobal('navigator', { bluetooth: bt.api, userAgent: 'x', platform: 'Win32' })
    expect(isWebBluetoothSupported()).toBe(true)
    expect(await webBluetoothAvailability()).toBe('available')
    const seen: boolean[] = []
    const off = onWebBluetoothAvailabilityChange((v) => seen.push(v))
    bt.setAvailable(false)
    expect(await webBluetoothAvailability()).toBe('no-adapter')
    off()
    bt.setAvailable(true)
    expect(seen).toEqual([false])
    expect(webBluetoothPlatformSupport()).toMatchObject({ platform: 'windows', api: true, persistentPermissions: true })
  })

  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile', 'Linux armv8l', 'android', 'available'],
    ['Mozilla/5.0 (X11; Linux x86_64) Chrome/130', 'Linux x86_64', 'linux', 'behind-flag'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/130', 'Linux x86_64', 'chromeos', 'available'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130', 'iPhone', 'ios', 'unavailable'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Win32', 'windows', 'available'],
  ])('platform of %s', (userAgent, platform, want, expected) => {
    vi.stubGlobal('navigator', { userAgent, platform })
    expect(webBluetoothPlatform()).toBe(want)
    expect(webBluetoothPlatformSupport().expected).toBe(expected)
  })

  it('treats a Macintosh user agent with touch points as iPadOS', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', platform: 'MacIntel', maxTouchPoints: 5 })
    expect(webBluetoothPlatform()).toBe('ios')
  })
})

describe('WebBluetoothTransport.request()', () => {
  it('finds the MAX 2 BOX by service data, grants its service through optionalServices, and identifies it', async () => {
    const box = fakeMax2Box()
    const bt = new FakeBluetooth([box])
    vi.stubGlobal('navigator', { bluetooth: bt.api, userAgent: 'Macintosh', platform: 'MacIntel' })
    const t = await WebBluetoothTransport.request({ includeRecognised: true })
    expect(t).not.toBeNull()
    expect(bt.requests[0].optionalServices).toEqual(expect.arrayContaining([FEE7, FFE0]))
    expect(t!.isOpen).toBe(true)
    expect(t!.kind).toBe('web-bluetooth')
    expect(t!.product).toBe(BOX)
    expect(t!.info).toEqual({ vendorId: 0, productId: 101, productName: 'LARK MAX 2 BOX (fake)', id: `ble:${box.id}` })
    expect(t!.capabilities).toMatchObject({ receive: 'unknown', link: 'gatt' })
    expect(t!.writeMode).toBe('without-response')
    expect(box.characteristic(0xfee7, 0xfec1).notifying).toBe(true)
    await t!.close()
    expect(box.gatt.connected).toBe(false)
  })

  it('identifies the MELO P1 when both products are offered', async () => {
    const box = fakeMax2Box()
    const melo = fakeMeloP1()
    const bt = new FakeBluetooth([box, melo])
    bt.choose = (_o, matching) => matching.find((d) => d === melo) ?? null
    const t = await WebBluetoothTransport.request({ bluetooth: bt.api, candidates: BOTH, platform: 'macos' })
    expect(t!.product).toBe(MELO)
    expect(t!.info).toMatchObject({ vendorId: HOLLYLAND_VENDOR_ID, productId: 1032 })
    expect(t!.writeMode).toBe('with-response')
    expect(t!.diagnostics()).toMatchObject({ service: FFE0, write: canonicalBleUuid(0xffe1), notify: canonicalBleUuid(0xffe2), writeChunkSize: 509 })
  })

  it('returns null when the user cancels; throws without an adapter or API', async () => {
    const bt = new FakeBluetooth([])
    expect(await WebBluetoothTransport.request({ bluetooth: bt.api, candidates: BOTH })).toBeNull()
    bt.available = false
    await expect(WebBluetoothTransport.request({ bluetooth: bt.api, candidates: BOTH })).rejects.toThrow(/adapter not available/)
    vi.stubGlobal('navigator', {})
    await expect(WebBluetoothTransport.request({ candidates: BOTH })).rejects.toBeInstanceOf(TransportError)
    await expect(WebBluetoothTransport.request({ bluetooth: bt.api, candidates: [] })).rejects.toThrow(/no product/)
  })

  it('retries without serviceData filters when the browser rejects them', async () => {
    const box = fakeMax2Box({ advertiseServiceUuid: true })
    const bt = new FakeBluetooth([box])
    bt.supportsServiceDataFilters = false
    const t = await WebBluetoothTransport.request({ bluetooth: bt.api, candidates: BOTH })
    expect(t!.product).toBe(BOX)
    expect(bt.requests).toHaveLength(2)
    expect(bt.requests[1]).toEqual({ filters: [{ services: [FEE7] }], optionalServices: [FEE7, FFE0] })

    const melo = fakeMeloP1()
    const bt2 = new FakeBluetooth([melo])
    bt2.supportsServiceDataFilters = false
    const t2 = await WebBluetoothTransport.request({ bluetooth: bt2.api, candidates: [BOTH[1]] })
    expect(t2!.product).toBe(MELO)
    expect(bt2.requests[1]).toEqual({ acceptAllDevices: true, optionalServices: [FFE0] })
  })

  it('open: false returns the transport without connecting', async () => {
    const box = fakeMax2Box()
    const bt = new FakeBluetooth([box])
    const t = await WebBluetoothTransport.request({ bluetooth: bt.api, candidates: [BOTH[0]], open: false })
    expect(t!.isOpen).toBe(false)
    expect(box.connectCalls).toBe(0)
    expect(t!.info.productId).toBe(101)
  })
})

describe('writes', () => {
  it('MAX 2 BOX on desktop: one write without response per frame (up to 182 B)', async () => {
    const box = fakeMax2Box({ mtu: 185 })
    const { t } = await openOn(box, BOTH[0])
    await t.send(seq(30))
    await t.send(seq(182))
    await t.send(seq(200))
    const w = box.characteristic(0xfee7, 0xfec1).writes
    expect(w.map((x) => [x.mode, x.data.length])).toEqual([
      ['without-response', 30], ['without-response', 182], ['without-response', 182], ['without-response', 18],
    ])
    expect(concat(w.slice(2).map((x) => x.delivered))).toEqual(seq(200))
    expect(t.diagnostics()).toMatchObject({ framesWritten: 3, piecesWritten: 4 })
  })

  it('MAX 2 BOX on Android: 20-byte pieces, so an MTU-23 link loses nothing', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0], { platform: 'android' })
    await t.send(seq(45))
    const w = box.characteristic(0xfee7, 0xfec1).writes
    expect(w.map((x) => x.delivered.length)).toEqual([20, 20, 5])
    expect(concat(w.map((x) => x.delivered))).toEqual(seq(45))
  })

  it('documents the risk: a whole frame without response on an MTU-23 link is truncated silently', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0], { platform: 'macos' })
    await t.send(seq(30))
    expect(box.characteristic(0xfee7, 0xfec1).writes[0].delivered.length).toBe(20)
  })

  it('MELO P1: writes with response; a frame over 509 B is split', async () => {
    const melo = fakeMeloP1({ mtu: 512 })
    const { t } = await openOn(melo, BOTH[1])
    await t.send(seq(40))
    await t.send(seq(600))
    const w = melo.characteristic(0xffe0, 0xffe1).writes
    expect(w.map((x) => [x.mode, x.data.length])).toEqual([['with-response', 40], ['with-response', 509], ['with-response', 91]])
  })

  it('falls back to 20-byte pieces when the device refuses a long write, and keeps that size', async () => {
    const melo = fakeMeloP1()
    melo.longWrites = false
    const { t } = await openOn(melo, BOTH[1])
    const notes: string[] = []
    t.onDebug((m) => notes.push(m))
    await t.send(seq(40))
    await t.send(seq(30))
    const w = melo.characteristic(0xffe0, 0xffe1).writes
    expect(w.map((x) => x.data.length)).toEqual([20, 20, 20, 10])
    expect(concat(w.slice(0, 2).map((x) => x.delivered))).toEqual(seq(40))
    expect(t.writeChunkSize).toBe(20)
    expect(t.diagnostics().fellBackToMinChunk).toBe(true)
    expect(notes.some((n) => /20-byte pieces/.test(n))).toBe(true)
  })

  it('does not fall back when disabled or when the frame already fits 20 bytes', async () => {
    const melo = fakeMeloP1()
    melo.longWrites = false
    const { t } = await openOn(melo, BOTH[1], { fallbackToMinChunk: false })
    await expect(t.send(seq(40))).rejects.toBeInstanceOf(TransportError)
    const c = melo.characteristic(0xffe0, 0xffe1)
    c.failNext = { op: 'write', error: new DOMException('GATT operation failed for unknown reason.', 'NetworkError') }
    const { t: t2 } = await openOn(fakeMeloP1(), BOTH[1])
    const c2 = (t2.device as FakeBleDevice).characteristic(0xffe0, 0xffe1)
    c2.failNext = { op: 'write', error: new DOMException('GATT operation failed for unknown reason.', 'NetworkError') }
    await expect(t2.send(seq(10))).rejects.toThrow(/GATT write failed/)
    expect(t2.writeChunkSize).toBe(509)
  })

  it('serializes concurrent sends (Chrome allows one GATT operation at a time)', async () => {
    const melo = fakeMeloP1({ mtu: 512 })
    const { t } = await openOn(melo, BOTH[1])
    await Promise.all([t.send(Uint8Array.of(1)), t.send(Uint8Array.of(2, 2)), t.send(Uint8Array.of(3, 3, 3))])
    expect(melo.characteristic(0xffe0, 0xffe1).writes.map((w) => [...w.data])).toEqual([[1], [2, 2], [3, 3, 3]])
  })

  it('follows the characteristic when it cannot do the link write mode (as Android FastBle does)', async () => {
    const box = fakeMax2Box({ writeProperties: { write: true, writeWithoutResponse: false } })
    const { t } = await openOn(box, BOTH[0])
    expect(t.writeMode).toBe('with-response')
    await t.send(seq(8))
    expect(box.characteristic(0xfee7, 0xfec1).writes[0].mode).toBe('with-response')
    // An explicit override is obeyed (and the fake refuses it like Chrome).
    const box2 = fakeMax2Box({ writeProperties: { write: true, writeWithoutResponse: false } })
    const { t: t2 } = await openOn(box2, BOTH[0], { writeMode: 'without-response' })
    await expect(t2.send(seq(8))).rejects.toThrow(/not permitted/)
  })

  it('refuses sends before open, empty frames and oversize frames', async () => {
    const box = fakeMax2Box()
    const t = new WebBluetoothTransport(box, BOTH[0])
    await expect(t.send(seq(4))).rejects.toThrow(/not connected/)
    await t.open()
    await expect(t.send(new Uint8Array(0))).rejects.toThrow(/frame length/)
    await expect(t.send(new Uint8Array(5000))).rejects.toThrow(/frame length/)
    expect(() => new WebBluetoothTransport(box, BOTH[0], { writeChunkSize: 600 })).toThrow(RangeError)
  })
})

describe('notifications', () => {
  it('emits every MTU-sized piece as a packet and records sizes', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0])
    const got: Uint8Array[] = []
    t.onPacket((p) => got.push(p))
    await box.notify(0xfee7, 0xfec1, seq(75, 0x10))
    expect(got.map((p) => p.length)).toEqual([20, 20, 20, 15])
    expect(concat(got)).toEqual(seq(75, 0x10))
    expect(t.capabilities.receive).toBe('yes')
    expect(t.diagnostics()).toMatchObject({ notifications: 4, notificationBytes: { min: 15, max: 20, last: 15 } })
  })

  it.each([23, 185, 512])('the reassembly hook gives whole frames at MTU %i', async (mtu) => {
    const box = fakeMax2Box({ mtu })
    const { t } = await openOn(box, BOTH[0], { assembler: new BleFrameJoiner(toyLength) })
    const got: Uint8Array[] = []
    t.onPacket((p) => got.push(p))
    const a = encodeToy(0xa5, T.STATUS, 0, seq(40))
    const b = encodeToy(0xa5, T.VERSION, 1, seq(3))
    await box.notify(0xfee7, 0xfec1, concat([a, b]))
    expect(got).toEqual([a, b])
  })

  it('stops after close() and resumes after reopening', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0])
    const got: Uint8Array[] = []
    t.onPacket((p) => got.push(p))
    await t.close()
    await box.notify(0xfee7, 0xfec1, seq(4)).catch(() => undefined)
    expect(got).toHaveLength(0)
    await t.open()
    await box.notify(0xfee7, 0xfec1, seq(4))
    expect(got).toHaveLength(1)
  })
})

describe('BleFrameJoiner', () => {
  it('joins every split of two frames and resyncs over garbage', () => {
    const a = encodeToy(0xa5, T.STATUS, 0, seq(9))
    const b = encodeToy(0xa5, T.GET_ALL, 0, [0, 3, 0, 10])
    const stream = concat([Uint8Array.of(0x00, 0x13), a, b])
    for (let cut = 1; cut < stream.length; cut++) {
      const j = new BleFrameJoiner(toyLength)
      const out = [...j.push(stream.slice(0, cut)), ...j.push(stream.slice(cut))]
      expect(out, `cut ${cut}`).toEqual([a, b])
      expect(j.dropped).toBe(2)
      expect(j.pending).toBe(0)
    }
  })
})

describe('disconnects, connect retries and service lookup', () => {
  it('link loss fires onDisconnect once; close() fires nothing', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0])
    const reasons: (Error | undefined)[] = []
    t.onDisconnect((r) => reasons.push(r))
    box.dropConnection()
    expect(t.isOpen).toBe(false)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toBeInstanceOf(TransportError)
    expect(reasons[0]!.message).toMatch(/disconnected/)
    await expect(t.send(seq(4))).rejects.toThrow(/not connected/)
    await t.open()
    expect(t.isOpen).toBe(true)
    await t.close()
    expect(reasons).toHaveLength(1)
  })

  it('a write that loses the link reports a disconnect', async () => {
    const box = fakeMax2Box()
    const { t } = await openOn(box, BOTH[0])
    const reasons: unknown[] = []
    t.onDisconnect((r) => reasons.push(r))
    const c = box.characteristic(0xfee7, 0xfec1)
    c.onWrite(() => box.dropConnection())
    await t.send(seq(4)) // accepted, then the link drops
    await expect(t.send(seq(4))).rejects.toThrow(/not connected/)
    expect(reasons).toHaveLength(1)
  })

  it('retries GATT connect and gives up after the configured attempts', async () => {
    const box = fakeMax2Box()
    box.failConnects = 2
    const { t } = await openOn(box, BOTH[0])
    expect(t.isOpen).toBe(true)
    expect(t.diagnostics().connectAttempts).toBe(3)

    const box2 = fakeMax2Box()
    box2.failConnects = 5
    await expect(openOn(box2, BOTH[0], { connectAttempts: 2 })).rejects.toThrow(/could not connect/)
    expect(box2.connectCalls).toBe(2)
  })

  it('cancels a hung connect after the timeout and tries again', async () => {
    const box = fakeMax2Box()
    box.hangConnects = 1
    const { t } = await openOn(box, BOTH[0], { connectTimeoutMs: 20 })
    expect(t.isOpen).toBe(true)
    expect(box.connectCalls).toBe(2)
  })

  it('fails cleanly when the device offers none of the services, and disconnects', async () => {
    const other = new FakeBleDevice({ name: 'Heart rate strap', services: [{ uuid: 0x180d, characteristics: [{ uuid: 0x2a37, properties: { notify: true } }] }] })
    await expect(openOn(other, BOTH)).rejects.toThrow(/offers none of the expected GATT services/)
    expect(other.gatt.connected).toBe(false)
  })

  it('finds the characteristic in another service, like BleBoxOption', async () => {
    const link: WebBluetoothLinkSpec = { ...BOX_LINK, service: 0xfee8 }
    const box = fakeMax2Box()
    const { t } = await openOn(box, { product: BOX, link })
    expect(t.diagnostics()).toMatchObject({ service: FEE7, serviceFoundByCharacteristicSearch: true })
  })

  it('a failed subscription fails open() and disconnects ("Connected" only after notify setup)', async () => {
    const box = fakeMax2Box()
    box.characteristic(0xfee7, 0xfec1).failNext = { op: 'startNotifications', error: new DOMException('GATT Error Unknown.', 'NetworkError') }
    await expect(openOn(box, BOTH[0])).rejects.toThrow(/GATT setup failed/)
    expect(box.gatt.connected).toBe(false)
  })

  it('a SecurityError for a service the chooser did not allow is reported', async () => {
    const box = fakeMax2Box()
    const bt = new FakeBluetooth([box])
    bt.grant(box, [0x1234])
    const t = new WebBluetoothTransport(box, BOTH[0], { connectRetryDelayMs: 1 })
    await expect(t.open()).rejects.toThrow(/not allowed to access the service/)
  })

  it('lists the GATT inventory for the diagnostic report', async () => {
    const melo = fakeMeloP1()
    const { t } = await openOn(melo, BOTH[1])
    const inv = await t.inspectGatt()
    expect(inv.services).toEqual([
      {
        uuid: FFE0,
        characteristics: [
          { uuid: canonicalBleUuid(0xffe1), properties: { write: true, writeWithoutResponse: false } },
          { uuid: canonicalBleUuid(0xffe2), properties: { notify: true } },
        ],
      },
    ])
  })
})

describe('WebBluetoothTransport.reconnect()', () => {
  it('reconnects to a granted device once it advertises', async () => {
    const box = fakeMax2Box()
    const bt = new FakeBluetooth([box])
    bt.grant(box)
    const t = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, advertisementTimeoutMs: 200 })
    expect(t?.isOpen).toBe(true)
    expect(t!.product).toBe(BOX)
    expect(box.watchingAdvertisements).toBe(false) // watch aborted after the first advertisement
  })

  it('skips devices out of range, honours deviceId, and needs persistent permissions', async () => {
    const far = fakeMax2Box({ id: 'far' })
    far.inRange = false
    const near = fakeMeloP1({ id: 'near' })
    const bt = new FakeBluetooth([far, near])
    bt.grant(far)
    bt.grant(near)
    const t = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, advertisementTimeoutMs: 30 })
    expect(t!.product).toBe(MELO)
    await t!.close()

    expect(await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, deviceId: 'far', advertisementTimeoutMs: 30 })).toBeNull()
    const byId = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, deviceId: 'ble:near', advertisementTimeoutMs: 30 })
    expect(byId?.deviceId).toBe('near')
    await byId!.close()

    bt.persistentPermissions = false
    expect(await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH })).toBeNull()
  })

  it('reconnects a device object in hand without getDevices() (Chrome keeps it behind a flag)', async () => {
    const box = fakeMax2Box()
    const bt = new FakeBluetooth([box])
    bt.persistentPermissions = false
    const first = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH })
    expect(first).toBeNull()
    const t = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, devices: [box], advertisementTimeoutMs: 200 })
    expect(t?.isOpen).toBe(true)
    expect(t!.product).toBe(BOX)
    await t!.close()
    box.inRange = false
    expect(await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, devices: [box], advertisementTimeoutMs: 30 })).toBeNull()
  })

  it('connects at once when the browser cannot watch advertisements', async () => {
    const box = fakeMax2Box()
    box.supportsWatchAdvertisements = false
    const bt = new FakeBluetooth([box])
    bt.grant(box)
    const t = await WebBluetoothTransport.reconnect({ bluetooth: bt.api, candidates: BOTH, advertisementTimeoutMs: 5000 })
    expect(t?.isOpen).toBe(true)
  })

  it('forget() revokes the grant', async () => {
    const box = fakeMax2Box()
    const { t, bt } = await openOn(box, BOTH[0])
    await t.forget()
    expect(await bt.getDevices()).toEqual([])
    expect(box.gatt.connected).toBe(false)
  })
})

// --------------------------------------------------------------------- FamilyDevice end to end

const FAST: MicDeviceOptions = {
  requestTimeoutMs: 60, probeTimeoutMs: 80, retries: 0, interFrameDelayMs: 0, heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false,
}

describe('toy FamilyDriver over the BLE stack', () => {
  it('connects, reads status, writes, receives pushes and sees the link drop', async () => {
    const sim = new ToySimulator()
    const { transport, device, bridge } = bleSimulatedTransport(sim, TOY_PRODUCT, { mtu: 23, frameLength: toyLength, transport: { writeChunkSize: 4 } })
    const mic = toyDriver.createDevice(transport, TOY_PRODUCT, FAST)
    const s = await mic.connect()
    expect(s.rx).toBe('available')
    await mic.refresh('status')
    expect(mic.state.units.tx1).toMatchObject({ online: true, battery: 80 })
    expect(mic.state.values[CONTROL.VOLUME]).toBe(3)
    const r = await mic.set(CONTROL.VOLUME, 5)
    expect(r).toMatchObject({ ok: true, confirmed: true })
    expect(sim.volume).toBe(5)
    // Every frame crossed the link in 4-byte writes and was joined again by the peripheral.
    expect(bridge.frames.length).toBeGreaterThanOrEqual(3)
    expect(device.characteristic(0xfff0, 0xfff1).writes.every((w) => w.data.length <= 4)).toBe(true)
    sim.push(42)
    await sleep(20)
    expect(mic.state.values['toy.level']).toBe(42)
    const dropped = new Promise<void>((resolve) => mic.on('disconnect', () => resolve()))
    device.dropConnection()
    await dropped
    expect(mic.state.connected).toBe(false)
  })
})

// The shared conformance suite (FAMILIES.md §5.3) with the toy driver behind WebBluetoothTransport and
// the fake GATT link: default chunking at MTU 23, and 4-byte writes joined by the peripheral.
const toyConformance = {
  gates: [
    { name: 'LED below 1.2.0 is unavailable', sim: { rxVersion: '1.1.9' }, control: CONTROL.LED, expect: 'unavailable' as const },
    { name: 'LED at 1.2.0 (inclusive) is available', sim: { rxVersion: '1.2.0' }, control: CONTROL.LED, expect: 'ok' as const },
  ],
  preconditions: [
    { name: 'volume needs a mic online', sim: { online: ['rx' as const] }, control: CONTROL.VOLUME, value: 1, reason: 'mic-disconnected' },
    {
      name: 'NC level needs NC on', arrange: (s: unknown) => ((s as ToySimulator).ncOn = false), control: CONTROL.NOISE_LEVEL, value: 1,
      reason: 'noise-off',
    },
  ],
}
describeDriverConformance(bleBridgedDriver(toyDriver, { mtu: 23 }), toyConformance)
describeDriverConformance(bleBridgedDriver(toyDriver, { mtu: 23, frameLength: toyLength, transport: { writeChunkSize: 4 } }), toyConformance)

describe('fake peripheral built from a link', () => {
  it('separate write and notify characteristics carry the link properties', () => {
    const d = fakeBleDeviceForLink(MELO_LINK)
    expect(d.characteristic(0xffe0, 0xffe1).properties).toEqual({ write: true, writeWithoutResponse: false })
    expect(d.characteristic(0xffe0, 0xffe2).properties).toEqual({ notify: true })
    expect([...d.advertisement.serviceData.keys()]).toEqual([canonicalBleUuid(0xbbbb)])
    const box = fakeMax2Box()
    expect(box.characteristic(0xfee7, 0xfec1).properties).toEqual({ write: false, writeWithoutResponse: true, notify: true })
  })
})
