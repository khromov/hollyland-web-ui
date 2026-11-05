/**
 * Variable-length bridge packets (docs/FAMILIES.md §3.4): the hello / replugged messages carry the
 * captured receiver's packet contract; legacy receivers and old bridges keep "exactly 64 bytes".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket as WsClient, WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import { BridgeServer } from '../../../../scripts/bridge-server'
import {
  BRIDGE_MAX_VARIABLE_PACKET, BridgeTransport, LEGACY_BRIDGE_PACKET, bridgePacketForLink, type BridgeDeviceInfo, type BridgePacketInfo,
  type BridgeSocketConstructor,
} from '../bridge'
import { lookupProduct, webHidLinkOf } from '../models'

const M3: BridgeDeviceInfo = { vendorId: 0x3547, productId: 0x040e, productName: 'LARK M3' }
const A2: BridgeDeviceInfo = { vendorId: 0x3547, productId: 0x0411, productName: 'Wireless Microphone' }

const PAGE = class extends WsClient {
  constructor(url: string) {
    super(url, { origin: 'http://localhost:5173' })
  }
} as unknown as BridgeSocketConstructor

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))

async function start(device: BridgeDeviceInfo | null, packet?: BridgePacketInfo) {
  const received: Buffer[] = []
  const server = new BridgeServer({ port: 0, version: 'test', onClientData: (_ch, d) => received.push(d) })
  await server.listen()
  if (device) server.setDevice(device, packet)
  cleanups.push(() => server.close())
  return { server, received, url: server.url('hid') }
}

async function connect(url: string): Promise<BridgeTransport> {
  const t = await BridgeTransport.connect(url, 1000, { WebSocket: PAGE })
  cleanups.push(() => t.close())
  return t
}

describe('bridgePacketForLink', () => {
  it('legacy rows keep exactly 64 bytes; M3 gets 1..512; unpadded families a large variable limit', () => {
    expect(bridgePacketForLink(undefined)).toEqual(LEGACY_BRIDGE_PACKET)
    expect(bridgePacketForLink(webHidLinkOf(lookupProduct(0x3547, 1041)!))).toEqual({ maxOut: 64, fixed: true })
    expect(bridgePacketForLink(webHidLinkOf(lookupProduct(0x3547, 1029)!))).toEqual({ maxOut: 64, fixed: true })
    expect(bridgePacketForLink(webHidLinkOf(lookupProduct(0x3547, 1038)!), 64)).toEqual({ maxOut: 512, fixed: false })
    expect(bridgePacketForLink(webHidLinkOf(lookupProduct(0x3547, 1026)!))).toEqual({ maxOut: BRIDGE_MAX_VARIABLE_PACKET, fixed: false })
  })
})

describe('bridge packet contract', () => {
  it('legacy: hello says 64/fixed, the client pads, the server rejects other lengths', async () => {
    const { url, received } = await start(A2)
    const t = await connect(url)
    expect(t.packet).toEqual({ maxOut: 64, fixed: true })
    expect(t.capabilities).toMatchObject({ receive: 'yes', link: 'bridge', maxWrite: 64 })
    await t.send(Uint8Array.of(0xaa, 0xdd, 0x10, 0x40, 0, 0))
    await settle()
    expect(received.map((b) => b.length)).toEqual([64])
    await expect(t.send(new Uint8Array(65))).rejects.toThrow(/packet length 65 not in 1..64/)
  })

  it('M3: frames of 1..512 bytes are relayed at their own length', async () => {
    const { url, received } = await start(M3, { maxOut: 512, fixed: false })
    const t = await connect(url)
    expect(t.packet).toEqual({ maxOut: 512, fixed: false })
    expect(t.capabilities.maxWrite).toBe(512)
    const small = new Uint8Array(64)
    small.set([0x08, 0xaa, 0xdd])
    const big = new Uint8Array(512)
    big[0] = 0x08
    await t.send(small)
    await t.send(big)
    await t.send(Uint8Array.of(0x08, 0xaa, 0xdd))
    await settle()
    expect(received.map((b) => b.length)).toEqual([64, 512, 3])
    await expect(t.send(new Uint8Array(513))).rejects.toThrow(/not in 1..512/)
  })

  it('the server enforces the contract for raw clients too', async () => {
    const { url, received } = await start(M3, { maxOut: 512, fixed: false })
    const raw = new WsClient(url, { origin: 'http://localhost:5173' })
    const texts: string[] = []
    raw.on('message', (d, isBinary) => {
      if (!isBinary) texts.push(String(d))
    })
    await new Promise<void>((r) => raw.on('open', () => r()))
    raw.send(Buffer.alloc(513))
    raw.send(Buffer.alloc(10))
    await settle(60)
    raw.terminate()
    expect(received.map((b) => b.length)).toEqual([10])
    const msgs = texts.map((x) => JSON.parse(x) as { type: string; message?: string; packet?: BridgePacketInfo })
    expect(msgs[0]).toMatchObject({ type: 'hello', packet: { maxOut: 512, fixed: false } })
    expect(msgs.find((m) => m.type === 'error')?.message).toBe('expected 1..512 bytes, got 513')
  })

  it('replugged updates the contract (a different receiver came back)', async () => {
    const { server, url } = await start(A2)
    const t = await connect(url)
    const back = new Promise<void>((r) => t.onReplug(() => r()))
    server.setDevice(null)
    await settle()
    server.setDevice(M3, { maxOut: 512, fixed: false })
    await back
    expect(t.packet).toEqual({ maxOut: 512, fixed: false })
  })

  it('an older bridge without the packet field means exactly 64 bytes', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((r) => wss.once('listening', () => r()))
    const got: Buffer[] = []
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'hello', device: A2, bridge: { version: '1.0.0' }, channel: 'hid' }))
      ws.on('message', (d) => got.push(d as Buffer))
    })
    cleanups.push(() => new Promise<void>((r) => wss.close(() => r())))
    cleanups.push(() => wss.clients.forEach((c) => c.terminate()))
    const t = await connect(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}/hid`)
    expect(t.packet).toEqual(LEGACY_BRIDGE_PACKET)
    await t.send(Uint8Array.of(0xaa, 0xdd))
    await settle()
    expect(got.map((b) => b.length)).toEqual([64])
  })
})
