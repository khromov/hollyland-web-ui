/**
 * Registry: every product of FAMILIES.md §1.1 with support data, the §1.4 corrections, driver
 * lookup, createMicDevice and the mock presets.
 */
import { describe, expect, it } from 'vitest'
import { UnsupportedError } from '../../device'
import {
  ALL_PRODUCTS, APP_PRODUCTS, PRODUCTS, displayName, familyCodeOf, isConnectableProduct, isSupportedProduct, linksOf, lookupAppProduct,
  lookupProduct, supportOf, unitsOf, webHidLinkOf,
} from '../../models'
import { MockTransport } from '../../mock'
import { LegacyMicDevice } from '../../families/legacy'
import { CONTROL } from '../controls'
import { EAGLESHERO_VENDOR_ID, FAMILY_CODES, HOLLYLAND_VENDOR_ID } from '../ids'
import { DRIVERS, canConnect, createMicDevice, createMockDevice, driverFor, findMockPreset, mockPresets, productsOf, unsupportedReason } from '../registry'

const H = HOLLYLAND_VENDOR_ID

describe('registry rows (FAMILIES.md §1.1)', () => {
  it('lists every USB product with its family code', () => {
    const want: [number, number, string][] = [
      [H, 1041, '6118'], [H, 1042, '6118'], [H, 7, '6301'], [H, 8, '6301'], [EAGLESHERO_VENDOR_ID, 32, '6301'], [EAGLESHERO_VENDOR_ID, 33, '6301'],
      [H, 1029, '6302'], [H, 1030, '6302'], [H, 1, '6501'], [H, 11, '6501'], [H, 12, '6501'], [H, 13, '6501'], [H, 2, '6501'],
      [H, 1031, '6108'], [H, 1036, '6303'], [H, 1037, '6303'], [H, 1038, '6303'], [H, 1039, '6303'], [H, 1026, '6701'], [H, 1027, '6701'],
      [H, 1032, '6201'], [H, 1033, '6201'], [H, 1034, '6201'], [H, 1040, '6201'], [H, 1035, '6201'],
    ]
    for (const [vid, pid, code] of want) {
      const p = lookupProduct(vid, pid)
      expect(p, `${vid.toString(16)}:${pid}`).toBeDefined()
      expect(familyCodeOf(p!)).toBe(code)
      expect(p!.familyCode).toBe(code)
    }
    expect(PRODUCTS).toHaveLength(want.length)
    // (vid, pid) pairs are unique
    expect(new Set(PRODUCTS.map((p) => `${p.vendorId}:${p.productId}`)).size).toBe(PRODUCTS.length)
  })

  it('app/BLE identities are separate from USB PIDs (§1.4)', () => {
    expect(lookupProduct(H, 772)).toBeUndefined()
    expect(lookupProduct(H, 101)).toBeUndefined()
    expect(APP_PRODUCTS.map((p) => p.productId).sort((a, b) => a - b)).toEqual([101, 102, 772])
    expect(lookupAppProduct(101)).toMatchObject({ name: 'LARK MAX 2 charging case', familyCode: '6701', idKind: 'app', vendorId: 0, deviceKind: 'case' })
    expect(lookupAppProduct(772)).toMatchObject({ name: 'MELO P1 TWS Monitor Earphones', familyCode: '6201', deviceKind: 'earphones' })
    expect(lookupAppProduct(102)?.code).toBe('6701OWS')
    expect(ALL_PRODUCTS).toHaveLength(PRODUCTS.length + APP_PRODUCTS.length)
  })

  it('applies the §1.4 corrections', () => {
    expect(lookupProduct(H, 13)).toMatchObject({ name: 'Lark Mini', code: '6502JF' })
    expect(lookupProduct(H, 13)?.eaModel).toBeUndefined()
    expect(displayName(lookupProduct(H, 1)!)).toBe('Lark C1')
    expect(displayName(lookupProduct(H, 11)!)).toBe('Lark C1 (2nd gen)')
    expect(displayName(lookupProduct(H, 12)!)).toBe('Lark M1 (2nd gen)')
    expect(lookupProduct(H, 2)).toMatchObject({ name: 'Lark MAX', code: '6902', support: { level: 'recognised', confidence: 'low' } })
    expect(lookupProduct(H, 1034)?.name).toBe('MELO P1 Mic')
    expect(lookupProduct(H, 1040)?.name).toBe('MELO P1 Mic')
    expect(lookupProduct(H, 1035)?.name).toBe('MELO P1 Charging Case')
    expect(lookupProduct(H, 1032)?.name).toBe('MELO P1')
    for (const pid of [1026, 1027]) expect(lookupProduct(H, pid)?.notes).not.toMatch(/BLE product/)
    for (const pid of [1036, 1037, 1038, 1039]) expect(lookupProduct(H, pid)?.vendorIdConfirmed).toBe(false)
  })

  it('keeps the legacy behaviour of the existing rows', () => {
    for (const pid of [1036, 1031, 1026, 1032, 2]) {
      const p = lookupProduct(H, pid)!
      expect(p.family, String(pid)).toBeNull()
      expect(p.capabilities).toBeNull()
      expect(isSupportedProduct(p)).toBe(false)
    }
    for (const [vid, pid] of [[H, 1041], [H, 1042], [H, 7], [H, 8], [EAGLESHERO_VENDOR_ID, 32], [EAGLESHERO_VENDOR_ID, 33], [H, 1029], [H, 1030]]) {
      expect(isSupportedProduct(lookupProduct(vid, pid))).toBe(true)
    }
    // 6501 group, Phase 1 (W1): driven by HollylandDevice, experimental and untested.
    for (const pid of [1, 11, 12, 13]) {
      expect(lookupProduct(H, pid)?.family, String(pid)).toBe('6501')
      expect(isSupportedProduct(lookupProduct(H, pid))).toBe(true)
      expect(supportOf(lookupProduct(H, pid)!)).toMatchObject({ level: 'experimental', hardware: 'untested' })
    }
  })

  it('records support level, hardware testing and research confidence', () => {
    expect(supportOf(lookupProduct(H, 1041)!)).toMatchObject({ level: 'supported', hardware: 'tested', confidence: 'high' })
    expect(supportOf(lookupProduct(H, 1041)!).testedOn?.join(' ')).toMatch(/3\.0\.2\.008/)
    expect(supportOf(lookupProduct(H, 1042)!).hardware).toBe('sibling-tested')
    expect(supportOf(lookupProduct(H, 1029)!)).toMatchObject({ level: 'supported', hardware: 'untested' })
    // The A1 driver is registered since Phase 2 (W5, families/6108/products.ts A1_SUPPORT); never on hardware.
    expect(supportOf(lookupProduct(H, 1031)!)).toMatchObject({ level: 'experimental', hardware: 'untested' })
    // Phase 3 (W9): the M3, MAX 2 and MELO P1 drivers are registered; their control rows are experimental, untested.
    const registered = [1031, 1036, 1037, 1038, 1039, 1026, 1027, 1032, 1033]
    for (const pid of registered) expect(supportOf(lookupProduct(H, pid)!)).toMatchObject({ level: 'experimental', hardware: 'untested' })
    expect(supportOf(lookupAppProduct(101)!)).toMatchObject({ level: 'experimental', hardware: 'untested' })
    for (const p of PRODUCTS.filter((x) => !x.family && !registered.includes(x.productId))) {
      expect(supportOf(p).level, displayName(p)).toBe('recognised')
      expect(supportOf(p).hardware).toBe('untested')
      expect(supportOf(p).research).toMatch(/^docs\//)
    }
  })

  it('describes links (§3.4) and unit topology', () => {
    expect(webHidLinkOf(lookupProduct(H, 1041)!)).toMatchObject({ reportId: 'byte0', outSizes: [64], usagePage: 0xff82 })
    expect(webHidLinkOf(lookupProduct(H, 1037)!)).toMatchObject({ reportId: 8, outSizes: [64, 512] })
    expect(linksOf(lookupProduct(H, 1031)!)).toEqual([expect.objectContaining({ kind: 'webhid-feature', reportId: 5, size: 64 })])
    expect(linksOf(lookupAppProduct(101)!)).toEqual([expect.objectContaining({ kind: 'web-bluetooth', service: 0xfee7, write: 0xfec1, writeMode: 'without-response' })])
    expect(linksOf(lookupProduct(H, 1032)!).map((l) => l.kind)).toEqual(['webhid', 'web-bluetooth'])
    expect(unitsOf(lookupProduct(H, 1041)!)).toEqual(['rx', 'tx1', 'tx2'])
    expect(unitsOf(lookupProduct(H, 1031)!)).toEqual(['rx', 'tx1', 'tx2', 'tx3', 'tx4'])
    expect(unitsOf(lookupProduct(H, 1036)!)).toContain('rx4')
  })
})

describe('drivers', () => {
  it('has one driver per family code, products matching', () => {
    expect(Object.keys(DRIVERS).sort()).toEqual([...FAMILY_CODES].sort())
    for (const code of FAMILY_CODES) {
      const d = DRIVERS[code]
      expect(d.code).toBe(code)
      for (const p of d.products) expect(driverFor(p)).toBe(d)
      expect(productsOf(code).length).toBe(d.products.length)
    }
    expect(DRIVERS['6118'].status).toBe('supported')
    expect(DRIVERS['6501'].status).toBe('experimental') // Phase 1 (W1)
    expect(DRIVERS['6108'].status).toBe('experimental') // Phase 2 (W5)
    for (const code of ['6201', '6303', '6701'] as const) expect(DRIVERS[code].status).toBe('experimental') // Phase 3 (W9)
  })

  it('connectable: legacy rows (6501 since Phase 1), the A1 (Phase 2), M3, MAX 2 RX + BOX and MELO P1 RX (Phase 3)', () => {
    const connectable = ALL_PRODUCTS.filter(canConnect).map((p) => p.productId).sort((a, b) => a - b)
    expect(connectable).toEqual([1, 7, 8, 11, 12, 13, 32, 33, 101, 1026, 1027, 1029, 1030, 1031, 1032, 1033, 1036, 1037, 1038, 1039, 1041, 1042])
    expect(ALL_PRODUCTS.filter(isConnectableProduct)).toHaveLength(22)
    expect(unsupportedReason(lookupProduct(H, 2)!)).toMatch(/Lark MAX is recognised but not supported yet .*legacy-6501\.md/)
    expect(unsupportedReason(lookupProduct(H, 1034)!)).toMatch(/recognised but not supported yet .*melo-6201\.md/)
    expect(unsupportedReason(lookupProduct(H, 1036)!)).toBeNull()
  })

  it('createMicDevice: LegacyMicDevice for the A2, UnsupportedError for stubs and unknown PIDs', () => {
    const a2 = createMicDevice(new MockTransport({ info: { vendorId: H, productId: 1041 } }))
    expect(a2).toBeInstanceOf(LegacyMicDevice)
    expect(a2.family).toBe('6118')
    expect(a2.support.hardware).toBe('tested')
    expect(createMicDevice(new MockTransport({ info: { vendorId: H, productId: 1039 } })).family).toBe('6303')
    expect(() => createMicDevice(new MockTransport({ info: { vendorId: H, productId: 1035 } }))).toThrow(UnsupportedError)
    expect(() => createMicDevice(new MockTransport({ info: { vendorId: H, productId: 0x9999 } }))).toThrow(/not a product this app knows/)
    expect(() => createMicDevice(new MockTransport({ info: { vendorId: H, productId: 2 } }))).toThrow(/not supported yet/)
    const m1 = createMicDevice(new MockTransport({ info: { vendorId: H, productId: 12 } }))
    expect(m1).toBeInstanceOf(LegacyMicDevice)
    expect(m1.family).toBe('6501')
    expect(m1.support).toMatchObject({ level: 'experimental', hardware: 'untested' })
  })

  it('mock presets come from the drivers and build working devices', async () => {
    expect(mockPresets().map((p) => p.id)).toEqual([
      'a1', 'a1-4mic', 'a1-4mic-old', 'a1-oldfw', 'a1-blind', 'a2', 'a2s', 'blind',
      'melo', 'melo-fw3079', 'melo-fw3070', 'melo-1mic', 'melo-sub',
      'm2', 'm2cam', 'm2s', 'm2scam',
      'm3', 'm3-4ch', 'm3cam', 'm3cam4', 'm3-secondary', 'm3-multi', 'm3-2t2r',
      'c1', 'c1g2', 'm1g2', 'mini',
      'max2', 'max2-4mic', 'max2-ows', 'max2-oldfw', 'max2-blind', 'max2cam', 'max2cam-tc', 'max2box', 'max2box-mtu185',
    ])
    expect(findMockPreset('nope')).toBeUndefined()
    expect(() => createMockDevice('nope')).toThrow(/available: a1, a1-4mic, .*a2, a2s/)
    const { device, transport } = createMockDevice('m2s', { heartbeatIntervalMs: null, fetchIdentity: false, fetchSettings: false })
    const s = await device.connect()
    expect(s.rx).toBe('available')
    expect(s.product.productId).toBe(1029)
    expect(s.values[CONTROL.VOLUME]).toBe(3)
    expect(transport.kind).toBe('mock')
    await device.disconnect()
    const blind = createMockDevice('blind', { heartbeatIntervalMs: null, probeTimeoutMs: 30, fetchIdentity: false })
    expect((await blind.device.connect()).rx).toBe('unavailable')
    await blind.device.disconnect()
  })
})
