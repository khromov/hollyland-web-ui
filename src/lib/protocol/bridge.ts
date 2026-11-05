/**
 * BridgeTransport: reaches the receiver through the optional local USB bridge
 * (scripts/bridge.ts, docs/BRIDGE.md) over a loopback WebSocket. Works in browsers and in Node
 * (uses globalThis.WebSocket unless a constructor is passed in).
 *
 * Why: macOS (and probably Windows) drops the receiver's replies (undeclared HID report id 0xBB,
 * PROTOCOL.md §2.4), so WebHID there is write-only. The bridge runs as root, takes the whole
 * receiver from the OS with libusb and relays interrupt endpoint packets byte for byte, so this
 * transport receives replies everywhere (`capabilities.receive === 'yes'`).
 *
 * Wire protocol on ws://127.0.0.1:47321/hid:
 *   client -> bridge  binary   exactly one 64-byte interrupt-OUT packet (AA DD cmd dst …)
 *   bridge -> client  binary   one interrupt-IN packet exactly as read (BB DD cmd src …)
 *   bridge -> client  text     JSON: hello | unplugged | replugged | error (BridgeServerMessage)
 *   close codes       4001 another client is connected, 4003 origin refused,
 *                     4004 channel not available, 1001 bridge stopped
 *
 *   const t = await BridgeTransport.connect()          // resolves after "hello" with a receiver
 *   const dev = new HollylandDevice(t)
 *   await dev.connect()                                 // dev.rx === 'available'
 */
import { PACKET_SIZE } from './codec'
import { Emitter } from './emitter'
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from './transport'

export const BRIDGE_DEFAULT_PORT = 47321
export const BRIDGE_DEFAULT_URL = `ws://127.0.0.1:${BRIDGE_DEFAULT_PORT}/hid`
/** The command users run to start the bridge (shown in UI copy and errors). */
export const BRIDGE_COMMAND = 'npm run bridge'

export const BRIDGE_CLOSE = {
  /** The bridge is shutting down (Ctrl+C). */
  stopped: 1001,
  /** Another client already holds this channel. */
  inUse: 4001,
  /** The page's Origin is not on the allow list. */
  origin: 4003,
  /** The channel is switched off (e.g. /iap2 without --iap2). */
  unavailable: 4004,
} as const

/** USB identity of the captured receiver, as sent by the bridge. */
export interface BridgeDeviceInfo {
  vendorId: number
  productId: number
  productName?: string
  manufacturer?: string
  serialNumber?: string
}

export interface BridgeHello {
  type: 'hello'
  /** null while the bridge has no receiver (unplugged or still capturing). */
  device: BridgeDeviceInfo | null
  bridge: { version: string; iap2?: boolean }
  channel?: 'hid' | 'iap2'
}

export type BridgeServerMessage =
  | BridgeHello
  | { type: 'unplugged' }
  | { type: 'replugged'; device: BridgeDeviceInfo }
  | { type: 'error'; message: string }

export type BridgeErrorKind =
  /** Nothing answered at the URL (bridge not started, wrong port). */
  | 'not-running'
  /** Another page or tab already uses the bridge. */
  | 'in-use'
  /** The bridge refused this page's Origin. */
  | 'origin'
  /** Connected, but the bridge never said hello. */
  | 'timeout'
  /** The bridge runs but has no receiver. */
  | 'no-device'
  /** The requested channel is off. */
  | 'unavailable'
  /** The browser refused to create the socket (mixed content, bad URL, no WebSocket API). */
  | 'blocked'
  /** The bridge closed an established connection. */
  | 'closed'
  /** The receiver left the bridge (unplugged, restarting). */
  | 'unplugged'

const TITLES: Record<BridgeErrorKind, string> = {
  'not-running': 'Bridge not reachable',
  'in-use': 'Bridge already in use',
  origin: 'Bridge refused this page',
  timeout: "Bridge didn't answer",
  'no-device': 'No receiver on the bridge',
  unavailable: 'Bridge channel is off',
  blocked: "Browser didn't allow the bridge",
  closed: 'Bridge connection closed',
  unplugged: 'Receiver unplugged',
}

/** Transport error with a UI-ready short title. Messages avoid jargon and say what to do. */
export class BridgeError extends TransportError {
  readonly kind: BridgeErrorKind
  readonly title: string
  readonly closeCode?: number

  constructor(kind: BridgeErrorKind, message: string, options?: { cause?: unknown; closeCode?: number }) {
    super(message, options)
    this.name = 'BridgeError'
    this.kind = kind
    this.title = TITLES[kind]
    this.closeCode = options?.closeCode
  }
}

/** Minimal WebSocket constructor shape (browser WebSocket, Node's global, or the `ws` package). */
export type BridgeSocketConstructor = new (url: string) => WebSocket

export interface BridgeConnectOptions {
  /** WebSocket implementation (default globalThis.WebSocket). */
  WebSocket?: BridgeSocketConstructor
}

export interface BridgeEvents {
  /** The bridge captured the receiver again (after an unplug or an RX restart). */
  replug: [TransportDeviceInfo]
  /** The receiver left the bridge; the socket stays up and waits for `replug`. */
  unplug: []
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Resolve a user-supplied bridge address (e.g. the `?bridge=` query parameter): a port number
 * or a ws:// URL on a loopback host. Anything else falls back to the default URL, so a crafted
 * link cannot point the page at a remote server.
 */
export function resolveBridgeUrl(param?: string | null): string {
  const p = (param ?? '').trim()
  if (!p) return BRIDGE_DEFAULT_URL
  if (/^\d{1,5}$/.test(p)) {
    const port = Number(p)
    return port > 0 && port < 65536 ? `ws://127.0.0.1:${port}/hid` : BRIDGE_DEFAULT_URL
  }
  try {
    const u = new URL(p)
    if ((u.protocol === 'ws:' || u.protocol === 'wss:') && LOOPBACK_HOSTS.has(u.hostname)) {
      if (u.pathname === '/' || u.pathname === '') u.pathname = '/hid'
      return u.href
    }
  } catch {
    /* fall through */
  }
  return BRIDGE_DEFAULT_URL
}

function pageOrigin(): string | null {
  const loc = (globalThis as { location?: { origin?: string } }).location
  return loc?.origin && loc.origin !== 'null' ? loc.origin : null
}

/** Map a WebSocket close to a friendly error. `reachedServer` = the socket was ever open. */
export function bridgeCloseError(code: number, reason: string, reachedServer: boolean, url: string): BridgeError {
  const why = reason ? ` (${reason})` : ''
  switch (code) {
    case BRIDGE_CLOSE.inUse:
      return new BridgeError(
        'in-use',
        'Another page or tab is already connected to the bridge. Disconnect it there (or close that tab) and try again.',
        { closeCode: code },
      )
    case BRIDGE_CLOSE.origin: {
      const origin = pageOrigin()
      const fix = origin ? `${BRIDGE_COMMAND} -- --allow-origin ${origin}` : `${BRIDGE_COMMAND} -- --allow-origin <this page's origin>`
      return new BridgeError(
        'origin',
        `The bridge only accepts pages served from localhost or 127.0.0.1. To allow this page, restart it with: ${fix}`,
        { closeCode: code },
      )
    }
    case BRIDGE_CLOSE.unavailable:
      return new BridgeError('unavailable', `The bridge has this channel switched off${why}.`, { closeCode: code })
    case BRIDGE_CLOSE.stopped:
      return new BridgeError('closed', `The bridge stopped. Start it again with "${BRIDGE_COMMAND}".`, { closeCode: code })
  }
  if (!reachedServer) {
    return new BridgeError(
      'not-running',
      `No bridge answered at ${url}. Start it in a terminal with "${BRIDGE_COMMAND}", then try again.`,
      { closeCode: code },
    )
  }
  return new BridgeError('closed', `The bridge closed the connection${why}.`, { closeCode: code })
}

function parseDevice(raw: unknown): BridgeDeviceInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.vendorId !== 'number' || typeof d.productId !== 'number') return null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  return {
    vendorId: d.vendorId,
    productId: d.productId,
    productName: str(d.productName),
    manufacturer: str(d.manufacturer),
    serialNumber: str(d.serialNumber),
  }
}

interface Waiter {
  resolve: () => void
  reject: (e: BridgeError) => void
}

const WS_OPEN = 1

export class BridgeTransport extends BaseTransport {
  readonly kind = 'bridge'
  readonly capabilities: TransportCapabilities = { receive: 'yes' }
  readonly url: string
  /** Bridge build from the last hello, e.g. { version: '1.0.0' }. */
  bridge: BridgeHello['bridge'] | null = null

  /** One live transport per URL, so a new connect() frees the bridge's single client slot. */
  private static readonly registry = new Map<string, BridgeTransport>()

  private readonly ctor: BridgeSocketConstructor | undefined
  private readonly extra = new Emitter<BridgeEvents>()
  private ws: WebSocket | null = null
  private reachedServer = false
  private device: BridgeDeviceInfo | null = null
  private lastDevice: BridgeDeviceInfo | null = null
  private closedByHost = false
  private helloWaiter: Waiter | null = null
  private readonly deviceWaiters = new Set<Waiter>()

  constructor(url: string = BRIDGE_DEFAULT_URL, options: BridgeConnectOptions = {}) {
    super()
    this.url = url
    this.ctor = options.WebSocket
  }

  /**
   * Connect to a running bridge. Resolves once the bridge said hello and has a receiver;
   * rejects with a BridgeError (kind: not-running, in-use, origin, timeout, no-device, …).
   * A previous transport for the same URL is closed first.
   */
  static async connect(
    url: string = BRIDGE_DEFAULT_URL,
    timeoutMs = 3000,
    options: BridgeConnectOptions = {},
  ): Promise<BridgeTransport> {
    const prev = BridgeTransport.registry.get(url)
    if (prev) await prev.close()
    const t = new BridgeTransport(url, options)
    BridgeTransport.registry.set(url, t)
    try {
      await t.open(timeoutMs)
    } catch (e) {
      await t.close()
      throw e
    }
    return t
  }

  /** True while the socket is up and the bridge holds a receiver. */
  get isOpen(): boolean {
    return this.ws?.readyState === WS_OPEN && this.device !== null
  }

  /** True while the socket to the bridge is up (even without a receiver). */
  get socketOpen(): boolean {
    return this.ws?.readyState === WS_OPEN
  }

  get info(): TransportDeviceInfo | null {
    const d = this.device ?? this.lastDevice
    if (!d) return null
    return { ...d, id: `bridge:${this.url}` }
  }

  /** The bridge captured the receiver again; reattach a HollylandDevice to this transport. */
  onReplug(listener: (info: TransportDeviceInfo) => void): () => void {
    return this.extra.on('replug', listener)
  }

  onUnplug(listener: () => void): () => void {
    return this.extra.on('unplug', listener)
  }

  /**
   * Dial the bridge if needed and wait until it holds a receiver. Called by connect() and by
   * HollylandDevice.connect() when a transport is reused after an unplug.
   */
  async open(timeoutMs = 3000): Promise<void> {
    if (this.isOpen) return
    this.closedByHost = false
    BridgeTransport.registry.set(this.url, this)
    if (!this.ws || this.ws.readyState > WS_OPEN) await this.dial(timeoutMs)
    if (!this.device) await this.waitForDevice(timeoutMs)
  }

  async close(): Promise<void> {
    this.closedByHost = true
    this.device = null
    if (BridgeTransport.registry.get(this.url) === this) BridgeTransport.registry.delete(this.url)
    const closing = new BridgeError('closed', 'Closed by the page.')
    this.helloWaiter?.reject(closing)
    this.rejectDeviceWaiters(closing)
    const ws = this.ws
    if (!ws || ws.readyState > WS_OPEN) {
      this.ws = null
      return
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 1000)
      function done() {
        clearTimeout(timer)
        resolve()
      }
      ws.addEventListener('close', done)
      try {
        ws.close(1000, 'closed by page')
      } catch {
        done()
      }
    })
    if (this.ws === ws) this.ws = null
  }

  async send(packet: Uint8Array): Promise<void> {
    const ws = this.ws
    if (!ws || ws.readyState !== WS_OPEN) throw new TransportError('the bridge connection is closed')
    if (!this.device) throw new BridgeError('unplugged', 'The receiver is not connected to the bridge right now.')
    if (packet.length === 0 || packet.length > PACKET_SIZE) throw new TransportError(`packet length ${packet.length} not in 1..64`)
    const out = new Uint8Array(PACKET_SIZE) // the bridge accepts exactly 64 bytes
    out.set(packet)
    ws.send(out)
  }

  // ------------------------------------------------------------------------------ internals

  private dial(timeoutMs: number): Promise<void> {
    const Ctor = this.ctor ?? (globalThis as { WebSocket?: BridgeSocketConstructor }).WebSocket
    if (!Ctor) return Promise.reject(new BridgeError('blocked', 'This environment has no WebSocket API.'))
    let ws: WebSocket
    try {
      ws = new Ctor(this.url)
    } catch (e) {
      return Promise.reject(
        new BridgeError('blocked', `The browser refused to connect to ${this.url} (${(e as Error).message}).`, { cause: e }),
      )
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.reachedServer = false
    ws.addEventListener('open', () => {
      if (ws === this.ws) this.reachedServer = true
    })
    ws.addEventListener('message', (ev: MessageEvent) => this.onMessage(ws, ev))
    ws.addEventListener('close', (ev: CloseEvent) => this.onClose(ws, ev))
    ws.addEventListener('error', () => this.debug('bridge socket error (a close event follows)'))

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (err?: BridgeError) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.helloWaiter === waiter) this.helloWaiter = null
        if (err) reject(err)
        else resolve()
      }
      const waiter: Waiter = { resolve: () => finish(), reject: (e) => finish(e) }
      this.helloWaiter = waiter
      const timer = setTimeout(() => {
        finish(
          this.reachedServer
            ? new BridgeError('timeout', `The bridge at ${this.url} accepted the connection but never said hello. Restart it and try again.`)
            : new BridgeError('not-running', `No bridge answered at ${this.url} within ${Math.round(timeoutMs / 100) / 10} s. Start it with "${BRIDGE_COMMAND}".`),
        )
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }, timeoutMs)
    })
  }

  private waitForDevice(timeoutMs: number): Promise<void> {
    if (this.device) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.deviceWaiters.delete(w)
        reject(
          new BridgeError(
            'no-device',
            'The bridge is running but has no receiver. Plug the receiver in (or re-plug it), wait for the bridge to say "captured", then try again.',
          ),
        )
      }, timeoutMs)
      const w: Waiter = {
        resolve: () => {
          clearTimeout(timer)
          this.deviceWaiters.delete(w)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          this.deviceWaiters.delete(w)
          reject(e)
        },
      }
      this.deviceWaiters.add(w)
    })
  }

  private rejectDeviceWaiters(e: BridgeError): void {
    for (const w of [...this.deviceWaiters]) w.reject(e)
  }

  private onMessage(ws: WebSocket, ev: MessageEvent): void {
    if (ws !== this.ws) return
    const data: unknown = ev.data
    if (typeof data === 'string') {
      this.onControl(data)
    } else if (data instanceof ArrayBuffer) {
      this.emitPacket(new Uint8Array(data))
    } else if (ArrayBuffer.isView(data)) {
      this.emitPacket(new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice())
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      void data.arrayBuffer().then((b) => this.emitPacket(new Uint8Array(b)))
    }
  }

  private onControl(text: string): void {
    let msg: { type?: unknown; [k: string]: unknown }
    try {
      msg = JSON.parse(text) as typeof msg
    } catch {
      this.debug(`bridge sent non-JSON text: ${text.slice(0, 80)}`)
      return
    }
    switch (msg.type) {
      case 'hello': {
        const b = msg.bridge as { version?: unknown; iap2?: unknown } | undefined
        this.bridge = { version: typeof b?.version === 'string' ? b.version : 'unknown', iap2: b?.iap2 === true }
        const d = parseDevice(msg.device)
        this.setDevice(d)
        this.debug(
          `bridge ${this.bridge.version} at ${this.url}: ` +
            (d ? `receiver ${d.productName ?? ''} ${d.vendorId.toString(16)}:${d.productId.toString(16)}` : 'no receiver yet'),
        )
        this.helloWaiter?.resolve()
        break
      }
      case 'unplugged': {
        const was = this.device
        this.device = null
        this.debug('bridge: receiver unplugged')
        this.extra.emit('unplug')
        if (was) this.emitDisconnect(new BridgeError('unplugged', 'The receiver was unplugged or restarted.'))
        break
      }
      case 'replugged': {
        const d = parseDevice(msg.device)
        if (!d) return
        this.setDevice(d)
        this.debug('bridge: receiver captured again')
        const info = this.info
        if (info) this.extra.emit('replug', info)
        break
      }
      case 'error':
        this.debug(`bridge error: ${String(msg.message ?? '')}`)
        break
      default:
        this.debug(`bridge sent unknown message type ${String(msg.type)}`)
    }
  }

  private setDevice(d: BridgeDeviceInfo | null): void {
    this.device = d
    if (d) {
      this.lastDevice = d
      for (const w of [...this.deviceWaiters]) w.resolve()
    }
  }

  private onClose(ws: WebSocket, ev: CloseEvent): void {
    if (ws !== this.ws) return
    this.ws = null
    const wasLive = this.device !== null
    this.device = null
    const err = bridgeCloseError(ev.code, ev.reason, this.reachedServer, this.url)
    this.debug(`bridge connection closed (code ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`)
    this.helloWaiter?.reject(err)
    this.rejectDeviceWaiters(err)
    if (BridgeTransport.registry.get(this.url) === this) BridgeTransport.registry.delete(this.url)
    if (!this.closedByHost && wasLive) this.emitDisconnect(err)
  }
}
