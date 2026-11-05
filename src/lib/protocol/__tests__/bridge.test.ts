/**
 * BridgeTransport against the real relay server of scripts/bridge.ts (scripts/bridge-server.ts)
 * with a fake receiver behind it, so the Origin / Host / single-client rules are tested too.
 * The canned replies are the live LARK A2 capture from 2026-11-05 (root libusb, interface 0).
 */
import { createServer, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket as WsClient, WebSocketServer } from 'ws'
import {
  BridgeServer, isHostAllowed, isLoopbackOrigin, isOriginAllowed, normalizeOrigin, type BridgeServerOptions,
} from '../../../../scripts/bridge-server'
import {
  BRIDGE_CLOSE, BRIDGE_DEFAULT_URL, BridgeError, BridgeTransport, resolveBridgeUrl, type BridgeDeviceInfo,
  type BridgeSocketConstructor,
} from '../bridge'
import { fromHex, Target } from '../codec'
import { HollylandDevice, type HollylandDeviceOptions } from '../device'

const A2: BridgeDeviceInfo = {
  vendorId: 0x3547, productId: 0x0411, productName: 'Wireless Microphone', manufacturer: 'Hollyland', serialNumber: 'RXSERIAL001',
}

/** Live replies, keyed by request "cmd dst" (zero padded to 64 bytes like the real IN endpoint). */
const LIVE: Record<string, string> = {
  '10 40': 'bb dd 10 80 00 10 01 01 5b 5c 00 00 00 05 00 00 00 00 00 00 04',
  '41 40': 'bb dd 41 80 00 06 03 00 02 00 00 08',
  '41 41': 'bb dd 41 81 00 06 03 00 02 00 00 08',
  '41 42': 'bb dd 41 82 00 06 03 00 02 00 00 08',
  '15 40': 'bb dd 15 80 00 0b 52 58 53 45 52 49 41 4c 30 30 31',
  '15 41': 'bb dd 15 81 00 0b 54 58 31 53 45 52 49 41 4c 30 31',
  '15 42': 'bb dd 15 82 00 0b 54 58 32 53 45 52 49 41 4c 30 31',
}

function padded(hex: string): Buffer {
  const b = Buffer.alloc(64)
  Buffer.from(fromHex(hex)).copy(b)
  return b
}

const FAST: HollylandDeviceOptions = {
  requestTimeoutMs: 200, probeTimeoutMs: 300, interFrameDelayMs: 0, heartbeatIntervalMs: null, retries: 0,
  fetchIdentity: false, fetchSettings: false,
}

/** A WebSocket constructor that sends an Origin header like a browser page would. */
function browserSocket(origin: string): BridgeSocketConstructor {
  return class extends WsClient {
    constructor(url: string) {
      super(url, { origin })
    }
  } as unknown as BridgeSocketConstructor
}
const PAGE = browserSocket('http://localhost:5173')

interface Harness {
  server: BridgeServer
  url: string
  /** Every packet the fake receiver got on the OUT endpoint. */
  received: Buffer[]
}

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

async function startBridge(o: Partial<BridgeServerOptions> & { device?: BridgeDeviceInfo | null; silent?: boolean } = {}): Promise<Harness> {
  const received: Buffer[] = []
  const server: BridgeServer = new BridgeServer({
    port: 0,
    version: 'test',
    ...o,
    onClientData: (channel, data) => {
      received.push(data)
      if (channel !== 'hid' || o.silent) return
      const key = `${data[2].toString(16).padStart(2, '0')} ${data[3].toString(16).padStart(2, '0')}`
      const reply = data[0] === 0xaa && data[1] === 0xdd ? LIVE[key] : undefined
      if (reply) setTimeout(() => server.deliver('hid', padded(reply)), 2) // one reply per request
    },
  })
  await server.listen()
  if (o.device !== null) server.setDevice(o.device ?? A2)
  cleanups.push(() => server.close())
  return { server, url: server.url('hid'), received }
}

async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as AddressInfo).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

async function connect(url: string, timeoutMs = 1000, ctor: BridgeSocketConstructor = PAGE): Promise<BridgeTransport> {
  const t = await BridgeTransport.connect(url, timeoutMs, { WebSocket: ctor })
  cleanups.push(() => t.close())
  return t
}

async function rejection(p: Promise<unknown>): Promise<BridgeError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(BridgeError)
    return e as BridgeError
  }
  throw new Error('expected a rejection')
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('BridgeTransport: connect', () => {
  it('resolves after hello and reports the captured receiver', async () => {
    const { url } = await startBridge()
    const t = await connect(url)
    expect(t.kind).toBe('bridge')
    expect(t.capabilities.receive).toBe('yes')
    expect(t.isOpen).toBe(true)
    expect(t.bridge).toEqual({ version: 'test', iap2: false })
    expect(t.info).toMatchObject({ vendorId: 0x3547, productId: 0x0411, productName: 'Wireless Microphone', serialNumber: 'RXSERIAL001' })
  })

  it('works with the WebSocket built into Node when the bridge allows clients without Origin', async () => {
    const { url } = await startBridge({ allowNoOrigin: true })
    const t = await BridgeTransport.connect(url, 1000)
    cleanups.push(() => t.close())
    expect(t.isOpen).toBe(true)
  })

  it('waits for the receiver when the bridge has none yet', async () => {
    const { server, url } = await startBridge({ device: null })
    setTimeout(() => server.setDevice(A2), 50)
    const t = await connect(url)
    expect(t.info?.productId).toBe(0x0411)
  })

  it('rejects with no-device when no receiver shows up', async () => {
    const { url } = await startBridge({ device: null })
    const e = await rejection(BridgeTransport.connect(url, 150, { WebSocket: PAGE }))
    expect(e.kind).toBe('no-device')
    expect(e.title).toBe('No receiver on the bridge')
  })

  it('rejects with not-running when nothing listens', async () => {
    const url = `ws://127.0.0.1:${await freePort()}/hid`
    const e = await rejection(BridgeTransport.connect(url, 1000, { WebSocket: PAGE }))
    expect(e.kind).toBe('not-running')
    expect(e.message).toContain('npm run bridge')
    // describeError() in the session store maps messages containing "open" / "busy" to other titles.
    expect(e.message).not.toMatch(/open|busy|not supported/i)
  })

  it('rejects with timeout when the server never says hello', async () => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
    await new Promise<void>((r) => wss.once('listening', () => r()))
    cleanups.push(() => new Promise<void>((r) => wss.close(() => r())))
    cleanups.push(() => wss.clients.forEach((c) => c.terminate()))
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/hid`
    const e = await rejection(BridgeTransport.connect(url, 150, { WebSocket: PAGE }))
    expect(e.kind).toBe('timeout')
  })

  it('refuses pages from other origins (4003) and accepts --allow-origin ones', async () => {
    const { url } = await startBridge({ allowOrigins: ['https://Mic.Example.com/'] })
    const evil = await rejection(BridgeTransport.connect(url, 1000, { WebSocket: browserSocket('https://evil.example') }))
    expect(evil.kind).toBe('origin')
    expect(evil.closeCode).toBe(BRIDGE_CLOSE.origin)
    expect(evil.message).toContain('--allow-origin')
    const ok = await connect(url, 1000, browserSocket('https://mic.example.com'))
    expect(ok.isOpen).toBe(true)
  })

  it('refuses a second client (4001) and frees the slot when the first one leaves', async () => {
    const { url } = await startBridge()
    const first = await connect(url)
    const second = new BridgeTransport(url, { WebSocket: PAGE })
    const e = await rejection(second.open(1000))
    expect(e.kind).toBe('in-use')
    expect(e.closeCode).toBe(BRIDGE_CLOSE.inUse)
    await first.close()
    const third = await connect(url)
    expect(third.isOpen).toBe(true)
  })

  it('connect() closes a previous transport for the same URL instead of being refused', async () => {
    const { url } = await startBridge()
    const a = await connect(url)
    const b = await connect(url)
    expect(a.socketOpen).toBe(false)
    expect(b.isOpen).toBe(true)
  })

  it('refuses upgrades with a non-loopback Host header (DNS rebinding)', async () => {
    const { server } = await startBridge()
    const ws = new WsClient(`ws://127.0.0.1:${server.port}/hid`, { origin: 'http://localhost:5173', headers: { Host: `evil.example:${server.port}` } })
    const status = await new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
      ws.on('open', () => resolve(101))
      ws.on('error', () => undefined)
    })
    ws.terminate()
    expect(status).toBe(403)
  })
})

describe('BridgeTransport: HollylandDevice over the bridge', () => {
  it('gets live replies: heartbeat, versions and serials from the real A2 capture', async () => {
    const { url, received } = await startBridge()
    const t = await connect(url)
    const dev = new HollylandDevice(t, FAST)
    const s = await dev.connect()
    expect(s.rx).toBe('available')
    expect(s.product.name).toBe('LARK A2')
    expect(received[0].length).toBe(64)
    expect([...received[0].subarray(0, 6)]).toEqual([0xaa, 0xdd, 0x10, 0x40, 0x00, 0x00])
    expect(s.units.tx1).toMatchObject({ online: true, battery: 91 })
    expect(s.units.tx2).toMatchObject({ online: true, battery: 92 })
    expect(s.settings).toMatchObject({ noiseLevel: 0, noiseEnabled: false, volume: 5, channelMode: 0, ledOn: true, autoPowerOff: true })
    expect(await dev.getFirmwareVersion(Target.TX2)).toBe('3.0.2.008')
    expect(await dev.getSerialNumber(Target.RX)).toBe('RXSERIAL001')
    expect(await dev.getSerialNumber(Target.TX1)).toBe('TX1SERIAL01')
    await dev.disconnect()
    expect(t.socketOpen).toBe(false)
  })

  it('pads short packets to 64 bytes; the bridge rejects anything else', async () => {
    const { url, received } = await startBridge({ silent: true })
    const t = await connect(url)
    await t.send(new Uint8Array([0xaa, 0xdd, 0x10, 0x40, 0, 0]))
    await settle()
    expect(received.map((b) => b.length)).toEqual([64])
    await expect(t.send(new Uint8Array(65))).rejects.toThrow(/packet length/)

    // Free the single client slot, then talk to the server directly.
    await t.close()
    const raw = new WsClient(url, { origin: 'http://localhost:5173' })
    const replies: string[] = []
    raw.on('message', (d, isBinary) => {
      if (!isBinary) replies.push(String(d))
    })
    await new Promise<void>((r) => raw.on('open', () => r()))
    raw.send(Buffer.alloc(10))
    raw.send('hello?')
    await settle(60)
    raw.terminate()
    expect(received.length).toBe(1)
    const errors = replies.map((r) => JSON.parse(r) as { type: string; message?: string }).filter((m) => m.type === 'error')
    expect(errors.map((m) => m.message)).toEqual([expect.stringContaining('exactly 64 bytes'), expect.stringContaining('text messages')])
  })

  it('unplug disconnects the device; replug lets a new HollylandDevice reuse the transport', async () => {
    const { server, url } = await startBridge()
    const t = await connect(url)
    const dev = new HollylandDevice(t, FAST)
    await dev.connect()

    const gone = new Promise<Error | undefined>((r) => dev.on('disconnect', (reason) => r(reason)))
    server.setDevice(null)
    const reason = await gone
    expect(reason).toBeInstanceOf(BridgeError)
    expect((reason as BridgeError).kind).toBe('unplugged')
    expect(t.isOpen).toBe(false)
    expect(t.socketOpen).toBe(true)
    await expect(t.send(new Uint8Array(64))).rejects.toThrow(/not connected to the bridge/)

    const back = new Promise<number>((r) => t.onReplug((info) => r(info.productId)))
    server.setDevice(A2)
    expect(await back).toBe(0x0411)
    const dev2 = new HollylandDevice(t, FAST)
    const s = await dev2.connect()
    expect(s.rx).toBe('available')
    expect(s.units.tx1.battery).toBe(91)
    await dev2.disconnect()
  })

  it('a stopped bridge (1001) disconnects with a friendly reason', async () => {
    const { server, url } = await startBridge()
    const t = await connect(url)
    const dev = new HollylandDevice(t, FAST)
    await dev.connect()
    const gone = new Promise<Error | undefined>((r) => dev.on('disconnect', (reason) => r(reason)))
    await server.close()
    const reason = (await gone) as BridgeError
    expect(reason.kind).toBe('closed')
    expect(reason.closeCode).toBe(BRIDGE_CLOSE.stopped)
    expect(reason.message).toContain('npm run bridge')
  })
})

describe('bridge security helpers', () => {
  it('accepts loopback page origins only, plus exact allow-listed ones', () => {
    for (const o of ['http://localhost:5173', 'https://localhost', 'http://127.0.0.1:4173', 'http://[::1]:5173']) {
      expect(isOriginAllowed(o)).toBe(true)
    }
    for (const o of ['https://evil.example', 'http://localhost.evil.example', 'http://127.0.0.1.evil.example', 'null', 'file://', 'chrome-extension://abc']) {
      expect(isOriginAllowed(o)).toBe(false)
    }
    expect(isOriginAllowed(undefined)).toBe(false)
    expect(isOriginAllowed(undefined, [], true)).toBe(true)
    expect(isOriginAllowed('https://mic.example.com', ['https://mic.example.com'])).toBe(true)
    expect(isOriginAllowed('https://mic.example.com:8443', ['https://mic.example.com'])).toBe(false)
    expect(isLoopbackOrigin('ws://localhost:1')).toBe(false)
    expect(normalizeOrigin('HTTPS://Mic.Example.com:443/')).toBe('https://mic.example.com')
    expect(normalizeOrigin('https://mic.example.com/app')).toBeNull()
  })

  it('checks the Host header against loopback names and the bridge port', () => {
    expect(isHostAllowed('127.0.0.1:47321', 47321)).toBe(true)
    expect(isHostAllowed('localhost:47321', 47321)).toBe(true)
    expect(isHostAllowed('[::1]:47321', 47321)).toBe(true)
    expect(isHostAllowed('127.0.0.1:80', 47321)).toBe(false)
    expect(isHostAllowed('evil.example:47321', 47321)).toBe(false)
    expect(isHostAllowed(undefined, 47321)).toBe(false)
  })

  it('resolveBridgeUrl only accepts loopback bridges', () => {
    expect(resolveBridgeUrl(null)).toBe(BRIDGE_DEFAULT_URL)
    expect(resolveBridgeUrl('47400')).toBe('ws://127.0.0.1:47400/hid')
    expect(resolveBridgeUrl('ws://localhost:47400')).toBe('ws://localhost:47400/hid')
    expect(resolveBridgeUrl('ws://evil.example:47321/hid')).toBe(BRIDGE_DEFAULT_URL)
    expect(resolveBridgeUrl('99999')).toBe(BRIDGE_DEFAULT_URL)
  })
})
