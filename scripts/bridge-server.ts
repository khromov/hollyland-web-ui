/**
 * WebSocket relay used by scripts/bridge.ts (the USB side lives there). Kept free of `usb` so the
 * security rules (Origin / Host checks, one client per channel) are unit-tested with a fake
 * receiver in src/lib/protocol/__tests__/bridge.test.ts. Protocol: src/lib/protocol/bridge.ts.
 *
 *  - listens on 127.0.0.1 only; paths /hid (interrupt packets: exactly 64 bytes for the legacy
 *    receivers, 1..maxOut bytes for receivers whose packet contract says so; see BridgePacketInfo
 *    in src/lib/protocol/bridge.ts) and, optionally, /iap2 (raw bytes)
 *  - refuses upgrades whose Host header is not a loopback name with our port (DNS rebinding)
 *  - accepts pages from http(s)://localhost:*, http(s)://127.0.0.1:*, http(s)://[::1]:* and
 *    origins passed with --allow-origin; a refused page is closed with code 4003 so it can
 *    tell the user what to do (no message from it is ever read)
 *  - one client per channel: a second one is closed with code 4001
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import {
  BRIDGE_CLOSE, LEGACY_BRIDGE_PACKET, type BridgeDeviceInfo, type BridgePacketInfo, type BridgeServerMessage,
} from '../src/lib/protocol/bridge'

export type BridgeChannel = 'hid' | 'iap2'

export interface BridgeServerOptions {
  /** 0 = pick a free port (tests). */
  port: number
  /** Interface to bind; loopback only (default 127.0.0.1). */
  host?: string
  version: string
  /** Extra exact origins, e.g. https://hollyland-web-ui.example (normalized by normalizeOrigin). */
  allowOrigins?: readonly string[]
  /** Accept clients that send no Origin header (Node scripts). Browsers always send one. */
  allowNoOrigin?: boolean
  /** Serve /iap2 (raw bulk passthrough). */
  iap2?: boolean
  /** Binary data from a client: on 'hid' as the device's packet contract allows (legacy: exactly 64 bytes), any length on 'iap2'. */
  onClientData: (channel: BridgeChannel, data: Buffer) => void
  /** A client attached or left a channel. */
  onClientChange?: (channel: BridgeChannel, connected: boolean, origin: string | undefined) => void
  log?: (line: string) => void
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** "https://Example.com:443/" -> "https://example.com"; null when not an http(s) origin. */
export function normalizeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch {
    return null
  }
}

/** http(s)://localhost[:port], http(s)://127.0.0.1[:port] or http(s)://[::1][:port]. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function isOriginAllowed(origin: string | undefined, allow: readonly string[] = [], allowNoOrigin = false): boolean {
  if (origin === undefined || origin === '') return allowNoOrigin
  if (isLoopbackOrigin(origin)) return true
  const n = normalizeOrigin(origin)
  return n !== null && allow.includes(n)
}

/** Host header must name a loopback host and our port (defeats DNS rebinding). */
export function isHostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false
  try {
    const u = new URL(`http://${host}`)
    return LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase()) && u.port === String(port)
  } catch {
    return false
  }
}

/** WebSocket close reasons are limited to 123 UTF-8 bytes. */
function closeReason(text: string): string {
  if (Buffer.byteLength(text) <= 123) return text
  let s = text
  while (Buffer.byteLength(s + '…') > 123) s = s.slice(0, -1)
  return s + '…'
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
}

export class BridgeServer {
  private readonly opts: BridgeServerOptions
  private readonly allow: string[]
  private readonly http: Server
  private readonly wss: WebSocketServer
  private readonly clients: Record<BridgeChannel, WebSocket | null> = { hid: null, iap2: null }
  private device: BridgeDeviceInfo | null = null
  private packet: BridgePacketInfo = LEGACY_BRIDGE_PACKET
  private boundPort = 0

  constructor(opts: BridgeServerOptions) {
    this.opts = opts
    this.allow = (opts.allowOrigins ?? []).map((o) => normalizeOrigin(o)).filter((o): o is string => o !== null)
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: false })
    this.http = createServer((req, res) => this.onHttp(req, res))
    this.http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.onUpgrade(req, socket, head))
  }

  get port(): number {
    return this.boundPort
  }

  get host(): string {
    return this.opts.host ?? '127.0.0.1'
  }

  url(channel: BridgeChannel = 'hid'): string {
    return `ws://${this.host}:${this.boundPort}/${channel}`
  }

  get allowedOrigins(): readonly string[] {
    return this.allow
  }

  hasClient(channel: BridgeChannel = 'hid'): boolean {
    return this.clients[channel]?.readyState === WebSocket.OPEN
  }

  listen(): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (e: Error) => reject(e)
      this.http.once('error', onError)
      this.http.listen(this.opts.port, this.host, () => {
        this.http.off('error', onError)
        const addr = this.http.address()
        this.boundPort = typeof addr === 'object' && addr ? addr.port : this.opts.port
        resolve(this.boundPort)
      })
    })
  }

  /**
   * The receiver was captured (info) or lost (null). Tells connected clients. `packet` is the
   * receiver's interrupt-OUT contract (default: exactly 64 bytes, the legacy receivers).
   */
  setDevice(info: BridgeDeviceInfo | null, packet: BridgePacketInfo = LEGACY_BRIDGE_PACKET): void {
    const had = this.device !== null
    this.device = info
    this.packet = packet
    let msg: BridgeServerMessage
    if (info) msg = { type: 'replugged', device: info, packet }
    else if (had) msg = { type: 'unplugged' }
    else return
    for (const ch of ['hid', 'iap2'] as const) this.sendJson(ch, msg)
  }

  /** Current interrupt-OUT packet contract. */
  get packetInfo(): BridgePacketInfo {
    return this.packet
  }

  /** Relay one packet from the receiver to the channel's client. Returns false when nobody listens. */
  deliver(channel: BridgeChannel, data: Uint8Array): boolean {
    const ws = this.clients[channel]
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(data, { binary: true })
    return true
  }

  /** Close every client (1001) and stop listening. */
  async close(): Promise<void> {
    for (const ch of ['hid', 'iap2'] as const) {
      const ws = this.clients[ch]
      this.clients[ch] = null
      try {
        ws?.close(BRIDGE_CLOSE.stopped, 'bridge stopped')
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 500)
      this.wss.close(() => {
        clearTimeout(t)
        resolve()
      })
    })
    for (const ws of this.wss.clients) ws.terminate()
    await new Promise<void>((resolve) => {
      this.http.close(() => resolve())
      this.http.closeAllConnections()
    })
  }

  // ------------------------------------------------------------------------------ internals

  private log(line: string): void {
    this.opts.log?.(line)
  }

  private sendJson(channel: BridgeChannel, msg: BridgeServerMessage): void {
    const ws = this.clients[channel]
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  private onHttp(req: IncomingMessage, res: ServerResponse): void {
    if (!isHostAllowed(req.headers.host, this.boundPort)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Forbidden host\n')
      return
    }
    const path = new URL(req.url ?? '/', 'http://bridge').pathname
    if (req.method === 'GET' && path === '/') {
      const d = this.device
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(
        `Hollyland Web UI bridge ${this.opts.version}\n` +
          `WebSocket: ${this.url('hid')}${this.opts.iap2 ? `, ${this.url('iap2')}` : ''}\n` +
          `Receiver: ${d ? `${d.productName ?? 'receiver'} (${hex4(d.vendorId)}:${hex4(d.productId)}) captured` : 'none'}\n` +
          `Client: ${this.hasClient('hid') ? 'connected' : 'none'}\n`,
      )
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found\n')
  }

  private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!isHostAllowed(req.headers.host, this.boundPort)) {
      this.log(`refused a connection with Host "${req.headers.host ?? ''}"`)
      rejectUpgrade(socket, 403, 'Forbidden host')
      return
    }
    const path = new URL(req.url ?? '/', 'http://bridge').pathname
    const channel: BridgeChannel | null = path === '/hid' ? 'hid' : path === '/iap2' ? 'iap2' : null
    if (!channel) {
      rejectUpgrade(socket, 404, 'Not found')
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, channel, req.headers.origin))
  }

  private accept(ws: WebSocket, channel: BridgeChannel, origin: string | undefined): void {
    // Refusals complete the handshake and close with a code so the page can explain the fix.
    // No message handler is attached, so nothing a refused page sends is ever read.
    if (!isOriginAllowed(origin, this.allow, this.opts.allowNoOrigin)) {
      this.log(`refused origin ${origin ?? '(none)'} on /${channel}${origin ? ` (allow it with --allow-origin ${origin})` : ''}`)
      ws.close(BRIDGE_CLOSE.origin, closeReason(`origin ${origin ?? '(none)'} is not allowed`))
      return
    }
    if (channel === 'iap2' && !this.opts.iap2) {
      ws.close(BRIDGE_CLOSE.unavailable, 'iAP2 relay is off; start the bridge with --iap2')
      return
    }
    const existing = this.clients[channel]
    if (existing && existing.readyState === WebSocket.OPEN) {
      this.log(`refused a second client on /${channel} from ${origin ?? '(no origin)'}`)
      ws.close(BRIDGE_CLOSE.inUse, 'another client is already connected to the bridge')
      return
    }
    existing?.terminate() // closing, but not gone yet
    this.clients[channel] = ws
    this.log(`client connected on /${channel} from ${origin ?? '(no origin)'}`)
    this.opts.onClientChange?.(channel, true, origin)

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (this.clients[channel] !== ws) return
      if (!isBinary) {
        this.sendJson(channel, { type: 'error', message: 'text messages are not accepted; send binary packets' })
        return
      }
      const buf = toBuffer(data)
      if (channel === 'hid') {
        const { maxOut, fixed } = this.packet
        if (fixed && buf.length !== maxOut) {
          this.sendJson(channel, { type: 'error', message: `expected exactly ${maxOut} bytes, got ${buf.length}` })
          return
        }
        if (!fixed && (buf.length < 1 || buf.length > maxOut)) {
          this.sendJson(channel, { type: 'error', message: `expected 1..${maxOut} bytes, got ${buf.length}` })
          return
        }
      }
      if (!this.device) {
        this.sendJson(channel, { type: 'error', message: 'no receiver captured; packet dropped' })
        return
      }
      try {
        this.opts.onClientData(channel, buf)
      } catch (e) {
        this.sendJson(channel, { type: 'error', message: (e as Error).message })
      }
    })
    ws.on('close', () => {
      if (this.clients[channel] !== ws) return
      this.clients[channel] = null
      this.log(`client left /${channel}`)
      this.opts.onClientChange?.(channel, false, origin)
    })
    ws.on('error', (e: Error) => this.log(`client socket error on /${channel}: ${e.message}`))

    const hello: BridgeServerMessage = {
      type: 'hello',
      device: this.device,
      bridge: { version: this.opts.version, iap2: !!this.opts.iap2 },
      channel,
      ...(channel === 'hid' ? { packet: this.packet } : {}),
    }
    ws.send(JSON.stringify(hello))
  }
}

export function hex4(n: number): string {
  return n.toString(16).padStart(4, '0')
}
