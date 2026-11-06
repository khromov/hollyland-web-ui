/**
 * Session helpers without Svelte state: connect paths and HID routing (links.ts), block / confirm
 * copy (reasons.ts), the first-connect notice storage (support.ts) and the hardware report (report.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  A1_COLLECTIONS, A2_COLLECTIONS, CONTROL, FakeHid, FakeHidDevice, M3_COLLECTIONS_63, WebHidFeatureTransport, WebHidTransport,
  createMockDevice, lookupAppProduct, lookupProduct, vendorCollection,
} from '../../protocol'
import {
  connectPaths, hidTransportFor, pickHidDevice, productsFor, reconnectUsb, requestBluetooth, requestUsb, resolveUsbProduct, sameReceiver,
  usbChooserFilters,
} from '../links'
import { confirmInfo, oneSentence, reasonText } from '../reasons'
import { buildHardwareReport } from '../report'
import { isNoticeDismissed, rememberNoticeDismissed } from '../support'

const H = 0x3547

function install(devices: FakeHidDevice[], extra: Record<string, unknown> = {}): FakeHid {
  const hid = new FakeHid(devices)
  vi.stubGlobal('navigator', { hid: hid.hidApi, platform: 'Linux x86_64', userAgent: 'Linux', ...extra })
  return hid
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('links', () => {
  it('offers USB where WebHID exists and Bluetooth only with navigator.bluetooth', () => {
    install([])
    expect(connectPaths()).toEqual({ usb: true, bluetooth: false, bridge: true })
    install([], { bluetooth: new EventTarget() })
    expect(connectPaths().bluetooth).toBe(true)
    vi.stubGlobal('navigator', { userAgent: 'Firefox' })
    expect(connectPaths()).toEqual({ usb: false, bluetooth: false, bridge: true })
  })

  it('one USB chooser for interrupt and feature-report products; Bluetooth for the MAX 2 case and MELO P1', () => {
    const filters = usbChooserFilters()
    expect(filters[0]).toEqual({ vendorId: H, usagePage: 0xff82 })
    for (const pid of [7, 1029, 1, 1031, 1036, 1039, 1026, 1032]) expect(filters.some((f) => f.productId === pid), String(pid)).toBe(true)
    expect(filters.some((f) => f.productId === 1034)).toBe(false) // MELO P1 Mic: recognised only
    expect(productsFor('bluetooth').map((p) => p.productId).sort((a, b) => a - b)).toEqual([101, 1032])
    expect(productsFor('usb').some((p) => p.productId === 1031)).toBe(true)
  })

  it('resolves rows with an unconfirmed vendor id by PID', () => {
    expect(resolveUsbProduct(H, 1041)?.name).toBe('LARK A2')
    expect(resolveUsbProduct(0x1234, 1038)?.familyCode).toBe('6303')
    expect(resolveUsbProduct(0x1234, 1041)).toBeUndefined()
  })

  it('picks the transport by link: feature reports for the A1, interrupt reports otherwise', async () => {
    const a1 = new FakeHidDevice({ vendorId: H, productId: 1031, collections: A1_COLLECTIONS })
    install([a1])
    const r = await requestUsb()
    expect(r?.kind).toBe('webhid-feature')
    expect(r?.transport).toBeInstanceOf(WebHidFeatureTransport)
    const m3 = new FakeHidDevice({ vendorId: H, productId: 1038, collections: M3_COLLECTIONS_63 })
    const t = await hidTransportFor(m3.hid)
    expect(t.kind).toBe('webhid')
    expect((t.transport as WebHidTransport).link?.reportId).toBe(8)
  })

  it('keeps the legacy interface choice and prefers the declared interface for the other families', async () => {
    const control = new FakeHidDevice({ vendorId: H, productId: 0x0411, collections: A2_COLLECTIONS })
    const other = new FakeHidDevice({ vendorId: H, productId: 0x0411, collections: [vendorCollection(0xff90, {})] })
    expect(pickHidDevice([other.hid, control.hid])).toBe(control.hid)
    const m3Plain = new FakeHidDevice({ vendorId: H, productId: 1038, collections: [vendorCollection(0x000c, {})] })
    const m3Ctl = new FakeHidDevice({ vendorId: H, productId: 1038, collections: M3_COLLECTIONS_63 })
    expect(pickHidDevice([m3Plain.hid, m3Ctl.hid])).toBe(m3Ctl.hid)
    expect((await hidTransportFor(control.hid)).transport).toBeInstanceOf(WebHidTransport)
  })
})

describe('choosers', () => {
  // requestDevice() needs the click's user activation: both choosers must call it before anything is awaited
  // (the transports they may need are fetched with import(), after or alongside the chooser).
  it('call requestDevice() synchronously', async () => {
    const hid = install([])
    const hidRequest = vi.spyOn(hid.hidApi, 'requestDevice')
    const usb = requestUsb()
    expect(hidRequest).toHaveBeenCalledTimes(1)
    expect(await usb).toBeNull()

    const cancel = Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' })
    const bleRequest = vi.fn(() => Promise.reject(cancel))
    install([], { bluetooth: Object.assign(new EventTarget(), { requestDevice: bleRequest }) })
    const ble = requestBluetooth()
    expect(bleRequest).toHaveBeenCalledTimes(1)
    expect(await ble).toBeNull()
  })
})

describe('reconnect', () => {
  it('reopens only the receiver the page was showing, not another granted one', async () => {
    const a2 = new FakeHidDevice({ vendorId: H, productId: 1041, collections: A2_COLLECTIONS })
    const m3 = new FakeHidDevice({ vendorId: H, productId: 1039, collections: M3_COLLECTIONS_63 })
    const m3Row = lookupProduct(H, 1038)!
    // An M3 comes back from 4-track with its 4CH product id: still the same receiver.
    expect(sameReceiver(m3.hid, m3Row)).toBe(true)
    expect(sameReceiver(a2.hid, m3Row)).toBe(false)
    const hid = install([a2])
    hid.granted.add(a2)
    expect(await reconnectUsb(m3Row)).toBeNull()
    const both = install([a2, m3])
    both.granted.add(a2)
    both.granted.add(m3)
    const r = await reconnectUsb(m3Row)
    expect(r?.product?.familyCode).toBe('6303')
    // Without a previous receiver the legacy choice is unchanged (the A2's control collection).
    expect((await reconnectUsb())?.product?.productId).toBe(1041)
  })
})

describe('reasons', () => {
  it('turns availability into a few words', () => {
    expect(reasonText(null)).toBeNull()
    expect(reasonText({ ok: true })).toBeNull()
    expect(reasonText({ ok: false, reason: 'mic-disconnected', message: 'long' })).toBe('No mic connected')
    expect(reasonText({ ok: false, reason: 'version-unknown' })).toBe('Checking firmware…')
    expect(reasonText({ ok: false, reason: 'version-unknown' }, true)).toBe("Can't check receiver firmware")
    expect(reasonText({ ok: false, reason: 'state-unknown' })).toBe('Not read yet')
    expect(reasonText({ ok: false, reason: 'state-unknown' }, true)).toBe("Can't read current value")
    expect(reasonText({ ok: false, reason: 'something-new' })).toBe('Unavailable')
  })

  it('keeps one sentence of an official confirm text', () => {
    expect(oneSentence('Settings successful. The device will restart in a few seconds. Please reconnect.')).toBe('The device will restart in a few seconds.')
    expect(oneSentence('Switching to or from 4-track: This change requires a restart. Continue?')).toBe('This change requires a restart.')
    expect(oneSentence('Reset: After reset, timecode will be 00:00:00:00 and new recording will start.')).toBe(
      'After reset, timecode will be 00:00:00:00 and new recording will start.',
    )
    const spec = { id: 'x', label: 'Bit Depth', group: 'settings', kind: 'choice', safety: 'disruptive', readBack: 'get', confidence: 'high', source: '' } as const
    expect(confirmInfo(spec, 'restart')).toEqual({ title: 'Bit Depth', text: 'The receiver restarts.', kind: 'restart', action: 'Restart' })
    // A restart reads the house sentence whatever the official text says.
    expect(confirmInfo({ ...spec, confirmText: 'Switching to Smart Audio Mixer output will restart the device.' }, 'restart').text).toBe(
      'The receiver restarts.',
    )
    expect(confirmInfo({ ...spec, id: 'max2.fourMic', confirmText: 'Switches between 2 Mic & 1 RX and 4 Mic & 1 RX; the mics reconnect.' }, 'disruptive').text).toBe(
      'The mics reconnect.',
    )
  })
})

describe('support', () => {
  it('remembers the first-connect notice per product and survives missing storage', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) })
    const m3 = lookupProduct(H, 1038)!
    expect(isNoticeDismissed(m3)).toBe(false)
    rememberNoticeDismissed(m3)
    expect(isNoticeDismissed(m3)).toBe(true)
    expect(isNoticeDismissed(lookupProduct(H, 1039)!)).toBe(false)
    expect(isNoticeDismissed(lookupAppProduct(101)!)).toBe(false)
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(isNoticeDismissed(m3)).toBe(false)
    expect(() => rememberNoticeDismissed(m3)).not.toThrow()
  })
})

describe('hardware report', () => {
  it('lists product, support, firmware, values, blocked controls, writes, checks and traffic', async () => {
    const { device, transport } = createMockDevice('a1', { heartbeatIntervalMs: null })
    await device.connect()
    await (device as unknown as { idle(): Promise<void> }).idle()
    const text = buildHardwareReport({
      now: Date.UTC(2026, 10, 6),
      userAgent: 'test',
      page: 'http://localhost/',
      product: device.product,
      support: device.support,
      linkKind: 'mock',
      transport,
      state: device.state,
      controls: device.controls,
      writes: [{ at: 0, id: CONTROL.LED, value: false, ok: true, confirmed: true, code: 0 }],
      checks: [{ id: 'heartbeat', title: 'Heartbeat 0x1F', kind: 'read', detail: 'length', run: async () => ({ ok: true, summary: '' }) }],
      checkResults: { heartbeat: { ok: true, summary: '17-byte body' } },
      traffic: [{ id: 1, t: 0, dir: 'out', bytes: new Uint8Array([5, 3]), hex: '05 03', hexShort: '05 03', status: 'ok', heartbeat: true, manual: false }],
    })
    await device.disconnect()
    expect(text).toMatch(/^Hollyland Web UI hardware report/)
    expect(text).toMatch(/Product: LARK A1 .* USB 3547:0407 · family 6108/)
    expect(text).toMatch(/Support: experimental · hardware untested/)
    expect(text).toMatch(/Firmware: RX 1\.0\.1\.3/)
    expect(text).toMatch(/Replies: received/)
    expect(text).toMatch(/mic\.mute:tx3: two-mic-mode/)
    expect(text).toMatch(/led = false → ok · ack code 0/)
    expect(text).toMatch(/\[read\] Heartbeat 0x1F: ok: 17-byte body/)
    expect(text).toMatch(/Traffic \(last 50 of 1\):\n {2}00:00:00\.000 → 05 03/)
  })
})
