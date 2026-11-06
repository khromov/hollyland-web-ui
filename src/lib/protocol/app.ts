/**
 * The app's entry into the protocol library: every module the UI needs before a product is opened, and none
 * that imports driver code. index.ts (the library API for tests, Node scripts and the bridge) imports every
 * family statically, so importing from it would put every driver into the app's main chunk. Here:
 *
 *  - registry rows, links, support and firmware rules (models.ts, versions.ts, core/ids.ts)
 *  - the USB and Bluetooth chooser filters and the Bluetooth chooser (webhid.ts, transports/ble-links.ts,
 *    transports/feature-links.ts), the WebHID interrupt transport and the local bridge
 *  - control ids and helpers (core/controls.ts) and the family ids the UI uses (families/<code>/ids.ts, under
 *    the same `a1` / `melo` / `m3` / `max2` namespaces as index.ts, holding only those ids)
 *  - error classes (device-errors.ts, core/control-errors.ts)
 *  - the lazy loader (core/loader.ts): openMicDevice(), loadDriver(), loadWebBluetoothTransport() …
 *  - types only of what the loader fetches (HollylandDevice, LegacyMicDevice, the two lazy transports)
 *
 * src/lib/protocol/__tests__/app-entry.test.ts fails when this module (or app code) reaches driver code
 * statically.
 */
export * from './codec'
export * from './models'
export * from './transport'
export * from './webhid'
export * from './bridge'
export * from './versions'
export * from './device-errors'
export { Emitter } from './emitter'
export type { EventMap, Listener } from './emitter'

export * from './core/ids'
export type * from './core/types'
export * from './core/controls'
export * from './core/control-errors'
export * from './core/loader'
export { appProduct, recognised, usbProduct } from './core/product-rows'

export {
  bleCandidates, bleLinkOf, bleProducts, bleRequestOptions, bleUuidEquals, bluetoothApi, canonicalBleUuid, isWebBluetoothSupported,
  requestBleDevice, shortBleUuid, toBleRequestFilter,
  type BleChoice, type BleChooserOptions, type BleCharacteristicLike, type BleCharacteristicProperties, type BleDeviceLike,
  type BleGattServerLike, type BleLinkCandidate, type BleRequestDeviceOptions, type BleRequestFilter, type BleRequestOptionsInit,
  type BleServiceLike, type BluetoothApiLike,
} from './transports/ble-links'
export * from './transports/feature-links'

/** Family ids and checks the UI uses without loading the driver (the full family modules are in index.ts). */
export * as a1 from './families/6108/ids'
export * as melo from './families/6201/ids'
export * as m3 from './families/6303/ids'
export * as max2 from './families/6701/ids'

// Types of what the loader fetches (erased at build time).
export type * from './device'
export type { Family, Safety } from './commands'
export type { LegacyMicDevice } from './families/legacy/adapter'
export type { WebBluetoothTransport, WebBluetoothTransportOptions } from './transports/web-bluetooth'
export type { WebHidFeatureTransport, WebHidFeatureTransportOptions } from './transports/webhid-feature'
