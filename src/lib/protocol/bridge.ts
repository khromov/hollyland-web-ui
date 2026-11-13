/**
 * BridgeTransport: reaches the receiver through the optional local USB bridge
 * (scripts/bridge.ts, docs/BRIDGE.md) over a loopback WebSocket. Works in browsers and in Node
 * (uses globalThis.WebSocket unless a constructor is passed in).
 *
 * Why: macOS and Linux (and probably Windows) drop the receiver's replies (undeclared HID report
 * id 0xBB, PROTOCOL.md §2.4), so WebHID there is write-only. The bridge takes the receiver's HID
 * interface from the OS with libusb (root on macOS, where it takes the whole receiver; on Linux
 * a udev rule is enough) and relays interrupt endpoint packets byte for byte, so this
 * transport receives replies everywhere (`capabilities.receive === 'yes'`).
 *
 * Wire protocol on ws://127.0.0.1:47321/hid:
 *   client -> bridge  binary   one interrupt-OUT transfer. Legacy receivers: exactly 64 bytes
 *                              (AA DD cmd dst …). Other families: 1..packet.maxOut bytes as the
 *                              hello's `packet` says (M3: 64 or 512 bytes starting with report id 08)
 *   bridge -> client  binary   one interrupt-IN transfer exactly as read (BB DD cmd src …)
 *   bridge -> client  text     JSON: hello | unplugged | replugged | error (BridgeServerMessage)
 *   hello / replugged carry `packet: { maxOut, fixed }` (absent from bridges before this field:
 *   the client then assumes { maxOut: 64, fixed: true }, i.e. exactly 64 bytes)
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
import type { WebHidLinkSpec } from './core/types'

export const BRIDGE_DEFAULT_PORT = 47321
export const BRIDGE_DEFAULT_URL = `ws://127.0.0.1:${BRIDGE_DEFAULT_PORT}/hid`

/** The npm package of the launcher (cli/hollyland-web-ui.mjs): web UI and bridge in one command. */
export const NPM_PACKAGE = 'hollyland-web-ui'
/**
 * Whether NPM_PACKAGE is on npm yet. While false, the page tells people to start the bridge from a
 * clone of the repository, never with npx: the bridge runs as root, so the page must not point at a
 * package name that isn't published (and could be claimed by someone else). Set it to true once
 * `npm view hollyland-web-ui` shows the published package.
 */
export const NPM_PACKAGE_PUBLISHED: boolean = false
export const REPO_URL = 'https://github.com/khromov/hollyland-web-ui'
/** Origin of the hosted Hollyland Web UI (GitHub Pages, https://khromov.github.io/hollyland-web-ui/). */
export const HOSTED_ORIGIN = 'https://khromov.github.io'

/** Where the page is served from, which decides how the bridge has to be started for it. */
export type PageContext = 'loopback' | 'hosted' | 'other'

/** `origin` defaults to this page's; no origin (Node, tests) counts as loopback. */
export function pageContext(origin: string | null = pageOrigin()): PageContext {
  if (!origin) return 'loopback'
  if (origin === HOSTED_ORIGIN) return 'hosted'
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname) ? 'loopback' : 'other'
  } catch {
    return 'other'
  }
}

export interface BridgeStartHelp {
  /** What to type in a terminal. */
  command: string
  /** Where to type it, e.g. "in a clone of …"; null: in any terminal. */
  where: string | null
  /** The command for people who have a clone of the repository; null when `command` is that already. */
  fromClone: string | null
}

/**
 * How to start a bridge that accepts this page (shown in the connect screen and in errors).
 * - With the npm package: `npx hollyland-web-ui --bridge-only` (only the bridge: this page is already
 *   open; that mode also accepts the hosted page).
 * - From a clone: `npm run bridge`, which accepts pages on this computer only; other pages need
 *   `--allow-origin`.
 */
export function bridgeStartHelp(origin: string | null = pageOrigin(), published = NPM_PACKAGE_PUBLISHED): BridgeStartHelp {
  const ctx = pageContext(origin)
  const clone =
    ctx === 'loopback' ? 'npm run bridge' : `npm run bridge -- --allow-origin ${ctx === 'hosted' ? HOSTED_ORIGIN : origin}`
  const repo = REPO_URL.replace(/^https:\/\//, '')
  if (published && ctx !== 'other') {
    return { command: `npx ${NPM_PACKAGE} --bridge-only`, where: null, fromClone: clone }
  }
  return {
    command: clone,
    where: ctx === 'loopback' ? 'in the Hollyland Web UI project folder' : `in a clone of ${repo}, after npm install`,
    fromClone: null,
  }
}

/** `Start it with "…" in …`: the sentence used in error messages. */
export function bridgeStartSentence(help: BridgeStartHelp = bridgeStartHelp()): string {
  if (help.where) return `Start it with "${help.command}" ${help.where}`
  return `Start it in a terminal with "${help.command}"${help.fromClone ? ` (from a clone: "${help.fromClone}")` : ''}`
}

/**
 * Chrome's Local Network Access permission for this page to reach 127.0.0.1 ("loopback-network",
 * formerly "local-network-access"). Only public pages (the hosted site) need it; null when the
 * browser doesn't know the permission or has no Permissions API.
 */
export async function loopbackPermission(): Promise<PermissionState | null> {
  const permissions = (globalThis as { navigator?: { permissions?: Permissions } }).navigator?.permissions
  if (!permissions?.query) return null
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      return (await permissions.query({ name } as unknown as PermissionDescriptor)).state
    } catch {
      /* this browser doesn't know that permission name */
    }
  }
  return null
}

/**
 * A page that isn't on this computer can fail to reach a running bridge because Chrome's local
 * network permission is denied (or still being asked): say so instead of "not running".
 */
async function explainLocalNetworkBlock(e: unknown): Promise<unknown> {
  if (!(e instanceof BridgeError) || e.kind !== 'not-running' || pageContext() === 'loopback') return e
  const state = await loopbackPermission()
  if (state === 'denied') {
    return new BridgeError(
      'blocked',
      'Allow Local network access in the site settings (left of the address), then reload.',
      { cause: e, closeCode: e.closeCode },
    )
  }
  if (state === 'prompt') {
    return new BridgeError(
      'not-running',
      `${e.message} When Chrome asks about devices on this network, choose Allow.`,
      { cause: e, closeCode: e.closeCode },
    )
  }
  return e
}

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

/**
 * Interrupt-OUT packet contract for the captured receiver (docs/FAMILIES.md §3.4).
 *  fixed: true   every client packet must be exactly `maxOut` bytes (legacy: 64; the client pads)
 *  fixed: false  1..maxOut bytes, relayed as one transfer at its own length (M3: up to 512)
 */
export interface BridgePacketInfo {
  maxOut: number
  fixed: boolean
}

/** What a bridge without the `packet` field accepts: exactly 64 bytes. */
export const LEGACY_BRIDGE_PACKET: BridgePacketInfo = { maxOut: 64, fixed: true }

/** Upper bound for variable-length frames (MAX 2 / MELO P1 USB frames are unpadded; libusb splits a transfer into max-size packets). */
export const BRIDGE_MAX_VARIABLE_PACKET = 4096

/**
 * Packet contract for a captured receiver from its registry link (scripts/bridge.ts):
 *  - legacy `byte0` link with 64-byte frames (or no link): exactly 64 bytes, as before
 *  - numbered report id (M3: 08, frames 64 / 512): 1..largest frame size
 *  - variable-length frames (MAX 2 / MELO P1): 1..BRIDGE_MAX_VARIABLE_PACKET
 */
export function bridgePacketForLink(link: WebHidLinkSpec | undefined, wMaxPacketSize = 64): BridgePacketInfo {
  if (!link) return LEGACY_BRIDGE_PACKET
  const largest = Math.max(0, ...(link.outSizes ?? []))
  if (link.variableLength) return { maxOut: Math.max(BRIDGE_MAX_VARIABLE_PACKET, largest), fixed: false }
  if (link.reportId === 'byte0' && largest <= PACKET_SIZE) return LEGACY_BRIDGE_PACKET
  return { maxOut: Math.max(largest, wMaxPacketSize, PACKET_SIZE), fixed: false }
}

export interface BridgeHello {
  type: 'hello'
  /** null while the bridge has no receiver (unplugged or still capturing). */
  device: BridgeDeviceInfo | null
  bridge: { version: string; iap2?: boolean }
  channel?: 'hid' | 'iap2'
  /** Packet contract for `device` (absent: LEGACY_BRIDGE_PACKET). */
  packet?: BridgePacketInfo
}

export type BridgeServerMessage =
  | BridgeHello
  | { type: 'unplugged' }
  | { type: 'replugged'; device: BridgeDeviceInfo; packet?: BridgePacketInfo }
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
  /**
   * The browser refused to create the socket (mixed content, bad URL, no WebSocket API), or Chrome's
   * local network permission is denied for this (hosted) page.
   */
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
        'Another tab is using the bridge. Close it, then retry.',
        { closeCode: code },
      )
    case BRIDGE_CLOSE.origin: {
      const origin = pageOrigin()
      const help = bridgeStartHelp(origin)
      const fix = origin
        ? `"${help.command}"${help.where ? ` ${help.where}` : ''}`
        : `"npm run bridge -- --allow-origin <this page's origin>"`
      return new BridgeError('origin', `Restart the bridge with ${fix}.`, { closeCode: code })
    }
    case BRIDGE_CLOSE.unavailable:
      return new BridgeError('unavailable', `The bridge has this channel switched off${why}.`, { closeCode: code })
    case BRIDGE_CLOSE.stopped:
      return new BridgeError('closed', `The bridge stopped. ${bridgeStartSentence()}.`, { closeCode: code })
  }
  if (!reachedServer) {
    return new BridgeError('not-running', `No bridge at ${url}. ${bridgeStartSentence()}.`, {
      closeCode: code,
    })
  }
  return new BridgeError('closed', `The bridge closed the connection${why}.`, { closeCode: code })
}

function parsePacket(raw: unknown): BridgePacketInfo {
  if (!raw || typeof raw !== 'object') return LEGACY_BRIDGE_PACKET
  const p = raw as Record<string, unknown>
  const max = p.maxOut
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 1 << 16) return LEGACY_BRIDGE_PACKET
  return { maxOut: max, fixed: p.fixed !== false }
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
  readonly capabilities: TransportCapabilities = { receive: 'yes', link: 'bridge', maxWrite: PACKET_SIZE }
  readonly url: string
  /** Bridge build from the last hello, e.g. { version: '1.0.0' }. */
  bridge: BridgeHello['bridge'] | null = null
  /** Packet contract for the captured receiver (from hello / replugged). */
  packet: BridgePacketInfo = LEGACY_BRIDGE_PACKET

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
      throw await explainLocalNetworkBlock(e)
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
    if (!this.device) throw new BridgeError('unplugged', 'Receiver not connected to the bridge.')
    const { maxOut, fixed } = this.packet
    if (packet.length === 0 || packet.length > maxOut) throw new TransportError(`packet length ${packet.length} not in 1..${maxOut}`)
    if (fixed) {
      const out = new Uint8Array(maxOut) // legacy: the bridge accepts exactly 64 bytes
      out.set(packet)
      ws.send(out)
    } else {
      ws.send(packet.slice())
    }
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
            ? new BridgeError('timeout', `The bridge at ${this.url} didn't respond. Restart it.`)
            : new BridgeError('not-running', `No bridge at ${this.url}. ${bridgeStartSentence()}.`),
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
            'Plug in (or re-plug) the receiver, wait for "captured", then retry.',
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
        this.setPacket(msg.packet)
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
        this.setPacket(msg.packet)
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

  private setPacket(raw: unknown): void {
    this.packet = parsePacket(raw)
    this.capabilities.maxWrite = this.packet.maxOut
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
