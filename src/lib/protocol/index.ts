/**
 * Hollyland LARK A2 / A2S / M2 / M2S USB control protocol, plus the contracts and registry for the
 * other product families (docs/FAMILIES.md). Zero runtime dependencies; works in browsers (WebHID)
 * and Node (any Transport, e.g. scripts/node-hid-transport.ts).
 *
 * Specification: docs/PROTOCOL.md (legacy families), docs/research/families/*.md (the others)
 *
 *   import { WebHidTransport, HollylandDevice } from '$lib/protocol'
 *   const t = await WebHidTransport.request()            // user gesture
 *   const dev = new HollylandDevice(t!)
 *   dev.on('state', (s) => render(s))
 *   await dev.connect()
 *   if (dev.rx === 'available') await dev.setNoiseLevel(2)
 *
 * Family-independent API (MicDevice):
 *
 *   const mic = createMicDevice(t!)                      // LegacyMicDevice or a family's FamilyDevice
 *   await mic.connect()
 *   await mic.set(CONTROL.NOISE_LEVEL, 2)
 */
export * from './codec'
export * from './commands'
export * from './models'
export * from './transport'
export * from './device'
export * from './webhid'
export * from './mock'
export { Emitter } from './emitter'
export type { EventMap, Listener } from './emitter'
export * from './bridge'

// ---- multi-family core (docs/FAMILIES.md §3); additive
export * from './core/ids'
export type * from './core/types'
export * from './core/controls'
export * from './core/engine'
export * from './core/registry'
export * from './core/simulate'
export { stubDriver, type StubDriverInit } from './core/stub'
export { appProduct, recognised, usbProduct } from './core/product-rows'
export { CommandSafetyError, ControlUnavailableError, ControlValueError, RequestTimeoutError } from './core/errors'
/** Byte readers / writers for family codecs (namespaced: generic names like `u8`, `or`). */
export * as bytes from './core/bytes'

// ---- transports
export * from './transports/fake-hid'
export * from './transports/webhid-feature'
export * from './transports/web-bluetooth'
export * from './transports/fake-bluetooth'

// ---- families
export * from './families/legacy'
/** Shared Moma codec (W2). */
export * as moma from './moma'
export * as a1 from './families/6108'
export * as melo from './families/6201'
export * as m3 from './families/6303'
export * as max2 from './families/6701'
