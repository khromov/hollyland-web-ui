/**
 * Browser connect paths (docs/FAMILIES.md §3.4, §4.1): which links this browser offers, one USB
 * chooser for every connectable HID product (interrupt reports and the A1's feature reports), the
 * matching transport for the chosen device, silent reconnects, and the Web Bluetooth chooser (MAX 2
 * charging case, MELO P1). Every filter comes from the registry rows of connectable products.
 *
 * The choosers run from main-chunk code, so `requestDevice()` is called inside the click's user
 * gesture; the feature-report and Web Bluetooth transports are fetched with import() only once a
 * device of theirs is chosen (core/loader.ts).
 */
import {
  CONTROL_USAGE_PAGE,
  PRODUCTS,
  WebHidTransport,
  bleCandidates,
  defaultFilters,
  familyCodeOf,
  featureLinkFilters,
  featureLinkOf,
  featureReportSize,
  isConnectableProduct,
  isWebBluetoothSupported,
  isWebHidSupported,
  loadWebBluetoothTransport,
  loadWebHidFeatureTransport,
  lookupProduct,
  outputReportSize,
  requestBleDevice,
  webHidLinkOf,
  type ProductInfo,
  type Transport,
  type WebBluetoothTransport,
} from '../protocol/app'

/** How the session reaches the product ('mock' = the development simulator). */
export type LinkKind = 'webhid' | 'webhid-feature' | 'web-bluetooth' | 'bridge' | 'mock'

/** Connect keys this browser can offer. */
export interface ConnectPaths {
  /** WebHID: "Connect over USB" (one chooser for every USB product, A1 included). */
  usb: boolean
  /** Web Bluetooth (navigator.bluetooth) and a connectable product with a GATT link (MAX 2 case, MELO P1). */
  bluetooth: boolean
  /** The local USB bridge (a WebSocket on this computer, docs/BRIDGE.md); any browser can reach it. */
  bridge: boolean
}

export function connectPaths(): ConnectPaths {
  return {
    usb: isWebHidSupported(),
    bluetooth: isWebBluetoothSupported() && bleCandidates().length > 0,
    bridge: true,
  }
}

/** Connectable products a link can reach (for the connect screen's lists). */
export function productsFor(kind: 'usb' | 'bluetooth'): ProductInfo[] {
  if (kind === 'bluetooth') return bleCandidates().flatMap((c) => (c.product ? [c.product] : []))
  return PRODUCTS.filter((p) => p.idKind !== 'app' && isConnectableProduct(p) && (!!webHidLinkOf(p) || !!featureLinkOf(p)))
}

/**
 * Registry row of a USB VID/PID: the exact row, else a connectable row whose vendor id the
 * official app never checks (M3, MELO P1), matched by PID alone.
 */
export function resolveUsbProduct(vendorId: number, productId: number): ProductInfo | undefined {
  return (
    lookupProduct(vendorId, productId) ??
    PRODUCTS.find((p) => p.vendorIdConfirmed === false && p.productId === productId && isConnectableProduct(p))
  )
}

/** USB chooser filters: the legacy filters (A2 control collection + interrupt rows) and the feature-report rows. */
export function usbChooserFilters(): HIDDeviceFilter[] {
  return [...defaultFilters(), ...featureLinkFilters()]
}

/** Whether a HID interface declares the report the product's link uses (A1 feature 5, M3 output 8). */
function declaresLinkReport(d: HIDDevice, p: ProductInfo): boolean {
  const feature = featureLinkOf(p)
  if (feature) return featureReportSize(d, feature.reportId) !== undefined
  const hid = webHidLinkOf(p)
  return typeof hid?.reportId === 'number' && outputReportSize(d, hid.reportId) !== undefined
}

/**
 * The HID interface to open among the chosen / granted ones. The legacy rule is unchanged (the A2's
 * control collection, else the first); for the other families the interface that declares the
 * product's report wins.
 */
export function pickHidDevice(devices: readonly HIDDevice[]): HIDDevice | undefined {
  const control = devices.find((d) => (d.collections ?? []).some((c) => c.usagePage === CONTROL_USAGE_PAGE))
  if (control) return control
  const known = devices.filter((d) => {
    const p = resolveUsbProduct(d.vendorId, d.productId)
    return !!p && isConnectableProduct(p)
  })
  const declared = known.find((d) => declaresLinkReport(d, resolveUsbProduct(d.vendorId, d.productId)!))
  return declared ?? known[0] ?? devices[0]
}

/** A HID interface opened as a transport, with the link kind and the registry row. */
export interface HidOpened {
  transport: Transport
  kind: 'webhid' | 'webhid-feature'
  product: ProductInfo | undefined
}

/**
 * The transport for a HID interface: feature reports for the A1 (WebHidFeatureTransport, fetched on
 * first use), interrupt reports otherwise.
 */
export async function hidTransportFor(device: HIDDevice): Promise<HidOpened> {
  const product = resolveUsbProduct(device.vendorId, device.productId)
  const feature = product ? featureLinkOf(product) : undefined
  if (feature) {
    const WebHidFeatureTransport = await loadWebHidFeatureTransport()
    return { transport: new WebHidFeatureTransport(device, { link: feature }), kind: 'webhid-feature', product }
  }
  // Legacy rows: exactly as before (the transport looks its link up itself).
  if (!product || product.family) return { transport: new WebHidTransport(device), kind: 'webhid', product }
  return { transport: new WebHidTransport(device, { link: webHidLinkOf(product) }), kind: 'webhid', product }
}

/** Show the USB chooser (user gesture). `anyDevice`: list every HID device (M3 / MELO P1 vendor id unconfirmed). */
export async function requestUsb(o: { anyDevice?: boolean } = {}): Promise<HidOpened | null> {
  if (!isWebHidSupported()) throw new Error('WebHID is not available in this browser')
  const devices = await navigator.hid.requestDevice({ filters: o.anyDevice ? [] : usbChooserFilters() })
  const d = pickHidDevice(devices)
  return d ? hidTransportFor(d) : null
}

/** Granted HID devices of ours that are plugged in (same rule as WebHidTransport.getGrantedDevices). */
export async function grantedUsbDevices(): Promise<HIDDevice[]> {
  return WebHidTransport.getGrantedDevices()
}

/**
 * Whether a HID device is the same kind of receiver as `previous` (same protocol family: an M3 that
 * comes back in 4-track mode enumerates with its 4CH product id).
 */
export function sameReceiver(device: Pick<HIDDevice, 'vendorId' | 'productId'>, previous: ProductInfo): boolean {
  const p = resolveUsbProduct(device.vendorId, device.productId)
  if (!p) return false
  if (p.vendorId === previous.vendorId && p.productId === previous.productId) return true
  const code = familyCodeOf(previous)
  return !!code && familyCodeOf(p) === code
}

/**
 * Reopen a granted USB device without the chooser, or null. `previous`: the receiver the page was
 * showing (lost link, restart): only that kind of receiver is reopened, so another granted receiver
 * that happens to be plugged in (an A2 next to an M3) never takes over the session.
 */
export async function reconnectUsb(previous?: ProductInfo | null): Promise<HidOpened | null> {
  const granted = await grantedUsbDevices()
  const d = pickHidDevice(previous ? granted.filter((g) => sameReceiver(g, previous)) : granted)
  return d ? hidTransportFor(d) : null
}

/** A granted HID device was plugged in (replug, receiver restart). Returns an unsubscribe function. */
export function onUsbDeviceConnect(listener: (device: HIDDevice) => void): () => void {
  return WebHidTransport.onDeviceConnect(listener)
}

/**
 * Show the Bluetooth chooser (user gesture), connect GATT and identify the product. The chooser opens
 * before anything is awaited; WebBluetoothTransport is fetched while it is up.
 */
export async function requestBluetooth(): Promise<WebBluetoothTransport | null> {
  const choice = requestBleDevice()
  const transportClass = loadWebBluetoothTransport()
  // A cancelled chooser never awaits the class: keep a failed fetch from surfacing as an unhandled rejection.
  transportClass.catch(() => undefined)
  const chosen = await choice
  if (!chosen) return null
  const WebBluetoothTransportClass = await transportClass
  const t = new WebBluetoothTransportClass(chosen.device, chosen.candidates)
  await t.open()
  return t
}

/**
 * Reconnect a Bluetooth device without the chooser (waits up to `advertisementTimeoutMs` for it to
 * advertise): `device`, the previous session's device object, first (works without
 * navigator.bluetooth.getDevices(), which Chrome keeps behind a flag), then the granted devices.
 */
export async function reconnectBluetooth(
  deviceId?: string,
  advertisementTimeoutMs = 5000,
  device?: WebBluetoothTransport['device'] | null,
): Promise<WebBluetoothTransport | null> {
  try {
    const WebBluetoothTransportClass = await loadWebBluetoothTransport()
    return await WebBluetoothTransportClass.reconnect({ deviceId, advertisementTimeoutMs, devices: device ? [device] : [] })
  } catch {
    return null
  }
}

/** Short name of a link kind for the Device page and the report. */
export const LINK_LABEL: Record<string, string> = {
  webhid: 'USB',
  'webhid-feature': 'USB',
  'web-bluetooth': 'Bluetooth',
  bridge: 'Local bridge',
  mock: 'Simulator',
}
