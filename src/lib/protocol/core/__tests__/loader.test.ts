/**
 * Lazy registry (core/loader.ts): every family's runtime is its static driver without the simulator, the
 * statuses known before loading match the drivers, openMicDevice behaves as createMicDevice, and the
 * duck-typed device checks agree with instanceof.
 */
import { describe, expect, it } from 'vitest'
import { UnsupportedError } from '../../device'
import { MockTransport } from '../../mock'
import { LegacyMicDevice } from '../../families/legacy'
import { MeloDevice, hasMeloLevels } from '../../families/6201'
import { M3Device, isM3Device } from '../../families/6303'
import { Max2Device, isMax2Device } from '../../families/6701'
import { WebBluetoothTransport } from '../../transports/web-bluetooth'
import { WebHidFeatureTransport } from '../../transports/webhid-feature'
import { FAMILY_CODES, HOLLYLAND_VENDOR_ID } from '../ids'
import {
  DRIVER_STATUS, isLegacyMicDevice, loadDriver, loadDriverFor, loadWebBluetoothTransport, loadWebHidFeatureTransport, loadedDriverFor,
  openMicDevice,
} from '../loader'
import { DRIVERS, createMicDevice, createMockDevice } from '../registry'

const H = HOLLYLAND_VENDOR_ID
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id)

describe('loader', () => {
  it('knows every driver status before loading it', () => {
    expect(Object.keys(DRIVER_STATUS).sort()).toEqual([...FAMILY_CODES].sort())
    for (const code of FAMILY_CODES) expect(DRIVER_STATUS[code], code).toBe(DRIVERS[code].status)
  })

  it('loads each family as its registered driver without the simulator', async () => {
    for (const code of FAMILY_CODES) {
      expect(loadedDriverFor(DRIVERS[code].products[0]), code).toBeUndefined()
      const r = await loadDriver(code)
      const d = DRIVERS[code]
      expect(r.code).toBe(code)
      expect(r.name).toBe(d.name)
      expect(r.status).toBe(d.status)
      expect(r.research).toBe(d.research)
      expect(r.products).toEqual(d.products)
      expect(ids(r.controls)).toEqual(ids(d.controls))
      expect(Object.keys(r.commands)).toEqual(Object.keys(d.commands))
      expect(ids(r.hardwareCheck)).toEqual(ids(d.hardwareCheck))
      expect(r).not.toHaveProperty('createSimulator')
      expect(r).not.toHaveProperty('mockPresets')
      expect(await loadDriver(code)).toBe(r)
      expect(loadedDriverFor(d.products[0])).toBe(r)
      expect(await loadDriverFor(d.products[0])).toBe(r)
    }
  })

  it('opens the same devices as createMicDevice, and refuses the same products', async () => {
    for (const pid of [1041, 7, 1029, 1, 1031, 1039, 1026, 1032]) {
      const t = () => new MockTransport({ info: { vendorId: H, productId: pid } })
      const lazy = await openMicDevice(t())
      const eager = createMicDevice(t())
      expect(lazy.constructor, String(pid)).toBe(eager.constructor)
      expect(lazy.family).toBe(eager.family)
      expect(lazy.product).toBe(eager.product)
      expect(ids(lazy.controls)).toEqual(ids(eager.controls))
    }
    expect(await openMicDevice(new MockTransport({ info: { vendorId: H, productId: 1041 } }))).toBeInstanceOf(LegacyMicDevice)
    await expect(openMicDevice(new MockTransport({ info: { vendorId: H, productId: 1035 } }))).rejects.toThrow(UnsupportedError)
    await expect(openMicDevice(new MockTransport({ info: { vendorId: H, productId: 0x9999 } }))).rejects.toThrow(/not a product this app knows/)
    await expect(openMicDevice(new MockTransport({ info: { vendorId: H, productId: 2 } }))).rejects.toThrow(/not supported yet/)
  })

  it('checks device kinds without instanceof, with the same answers', () => {
    for (const id of ['a2', 'm2', 'c1', 'a1', 'm3', 'max2', 'max2box', 'melo']) {
      const { device } = createMockDevice(id, { heartbeatIntervalMs: null })
      expect(isLegacyMicDevice(device), id).toBe(device instanceof LegacyMicDevice)
      expect(isM3Device(device), id).toBe(device instanceof M3Device)
      expect(isMax2Device(device), id).toBe(device instanceof Max2Device)
      expect(hasMeloLevels(device), id).toBe(device instanceof MeloDevice)
    }
    for (const x of [null, undefined, {}, { family: '6118' }, { family: '6201' }]) {
      expect(isLegacyMicDevice(x)).toBe(false)
      expect(hasMeloLevels(x)).toBe(false)
    }
  })

  it('loads the Bluetooth and feature-report transports on demand', async () => {
    expect(await loadWebBluetoothTransport()).toBe(WebBluetoothTransport)
    expect(await loadWebHidFeatureTransport()).toBe(WebHidFeatureTransport)
  })
})
