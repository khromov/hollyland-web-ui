/**
 * Hollyland LARK A2 / A2S / M2 / M2S USB control protocol. Zero runtime dependencies;
 * works in browsers (WebHID) and Node (any Transport, e.g. scripts/node-hid-transport.ts).
 *
 * Specification: docs/PROTOCOL.md
 *
 *   import { WebHidTransport, HollylandDevice } from '$lib/protocol'
 *   const t = await WebHidTransport.request()            // user gesture
 *   const dev = new HollylandDevice(t!)
 *   dev.on('state', (s) => render(s))
 *   await dev.connect()
 *   if (dev.rx === 'available') await dev.setNoiseLevel(2)
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
