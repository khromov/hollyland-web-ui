/**
 * Hollyland Web UI local USB bridge: full read/write on macOS and Linux, where the OS drops the
 * receiver's replies before any browser sees them (docs/PROTOCOL.md §2.4). See docs/BRIDGE.md.
 *
 *   npm run bridge [-- --port 47321 --allow-origin https://example.com --iap2 --verbose]
 *
 * What it does (needs root; on Linux, write access to the receiver's USB device node is enough,
 * see the udev rule in docs/BRIDGE.md "Linux"):
 *  1. listens on ws://127.0.0.1:<port>/hid (loopback only, Origin + Host checks, one client)
 *  2. finds a supported receiver (VID 0x3547 / 0x4417, connectable PIDs with an interrupt HID link
 *     from the registry in src/lib/protocol/models.ts), detaches the OS drivers (on macOS this
 *     takes the WHOLE receiver: its USB audio pauses; on Linux only interface 0), claims the HID control interface
 *     (interface 0: interrupt IN 0x82 / OUT 0x03)
 *  3. relays every interrupt-IN packet to the client and every client packet to the interrupt-OUT
 *     endpoint, byte for byte (legacy receivers: exactly 64 bytes; other families: the packet
 *     contract sent in the hello, see bridgePacketForLink); re-captures the receiver after an
 *     unplug/restart
 *  4. always hands the receiver back to the OS on exit (Ctrl+C, SIGTERM, crashes)
 *
 * --iap2 additionally claims interface 7 (vendor class, bulk IN 0x83 / OUT 0x02) and relays raw
 * bulk bytes on /iap2 for experiments. iAP2 itself is not implemented here.
 *
 * Do not run this file with plain `node` + sudo: use `npm run bridge` (scripts/bridge-launch.mjs),
 * which re-launches it under sudo with the current node binary and tsx (on Linux without sudo when
 * the udev rule already gives you the receiver).
 *
 * `npx hollyland-web-ui` (cli/hollyland-web-ui.mjs) runs a bundled copy (cli/dist/bridge.mjs, built by
 * `npm run build:cli`) under sudo with --embedded: a short banner and log lines marked "bridge",
 * because its output shares the terminal with the CLI's.
 */
import { createRequire } from 'node:module'
import type * as UsbTypes from 'usb'
import { BridgeServer, hex4, isLoopbackOrigin, normalizeOrigin } from './bridge-server'
import { BRIDGE_DEFAULT_PORT, bridgePacketForLink, type BridgeDeviceInfo, type BridgePacketInfo } from '../src/lib/protocol/bridge'
import {
  EAGLESHERO_VENDOR_ID, HOLLYLAND_VENDOR_ID, PRODUCTS, isConnectableProduct, webHidLinkOf,
} from '../src/lib/protocol/models'

const BRIDGE_VERSION = '1.0.0'

/**
 * Origin of the hosted Hollyland Web UI build on GitHub Pages (https://khromov.github.io/hollyland-web-ui/).
 * Not accepted by default: an origin covers every page on that host and the bridge relays any
 * command (factory reset included), so only `npx hollyland-web-ui --bridge-only` (or an explicit
 * --allow-origin) lets the hosted page in. Used here only to label it in the banner.
 */
const GITHUB_PAGES_ORIGIN = 'https://khromov.github.io'

type Usb = typeof UsbTypes
type Device = UsbTypes.Device
type InEndpoint = UsbTypes.InEndpoint
type OutEndpoint = UsbTypes.OutEndpoint
type LibUSBException = UsbTypes.LibUSBException

/**
 * Only macOS hands the bridge the whole USB device (its audio interfaces too). On Linux libusb
 * detaches the kernel driver from interface 0 alone; snd-usb-audio keeps the audio interfaces.
 */
const PAUSES_AUDIO = process.platform !== 'linux'

/** Linux: the udev rule that lets the bridge run without root (docs/BRIDGE.md "Linux"). */
const LINUX_USB_RULE = 'SUBSYSTEM=="usb", ATTR{idVendor}=="3547", MODE="0660", TAG+="uaccess"'
const LINUX_RULE_HINT =
  `add the udev rule ${LINUX_USB_RULE} to /etc/udev/rules.d/70-hollyland.rules, ` +
  'run "sudo udevadm control --reload" and re-plug the receiver (or run the bridge as root)'

// ------------------------------------------------------------------------------------- CLI

interface Options {
  port: number
  allowOrigins: string[]
  allowNoOrigin: boolean
  iap2: boolean
  iap2Interface: number
  pid: number | null
  verbose: boolean
  /** Started by `npx hollyland-web-ui`: short banner, log lines marked "bridge". */
  embedded: boolean
}

const HELP = `Hollyland Web UI USB bridge ${BRIDGE_VERSION}

Usage: npm run bridge [-- options]

Options:
  --port <n>              WebSocket port on 127.0.0.1 (default ${BRIDGE_DEFAULT_PORT})
  --allow-origin <url>    also accept pages from this origin, e.g. ${GITHUB_PAGES_ORIGIN}
                          for the hosted Hollyland Web UI (repeatable; localhost and
                          127.0.0.1 pages are always accepted)
  --allow-no-origin       accept clients without an Origin header (local Node scripts)
  --iap2                  also relay the vendor bulk interface on /iap2 (experimental)
  --iap2-interface <n>    interface number for --iap2 (default 7)
  --pid <n>               only capture this USB product id (decimal or 0x hex)
  --verbose               print every packet
  --embedded              short banner and "bridge" log prefix (used by npx hollyland-web-ui)
  -h, --help              show this help

USB audio from the receiver pauses while the bridge runs. Press Ctrl+C to give it back.
Details: docs/BRIDGE.md`

class UsageError extends Error {}

function parseNumber(flag: string, v: string | undefined, min: number, max: number): number {
  if (v === undefined) throw new UsageError(`${flag} needs a value`)
  const n = /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : /^\d+$/.test(v) ? Number(v) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`${flag}: "${v}" is not a number in ${min}..${max}`)
  return n
}

function parseArgs(argv: readonly string[]): Options | 'help' {
  const o: Options = {
    port: BRIDGE_DEFAULT_PORT, allowOrigins: [], allowNoOrigin: false, iap2: false, iap2Interface: 7, pid: null, verbose: false,
    embedded: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].includes('=') ? (argv[i].split(/=(.*)/s, 2) as [string, string]) : [argv[i], undefined]
    const value = () => inline ?? argv[++i]
    switch (flag) {
      case '-h':
      case '--help':
        return 'help'
      case '--port':
        o.port = parseNumber(flag, value(), 1, 65535)
        break
      case '--allow-origin': {
        const raw = value()
        if (!raw) throw new UsageError('--allow-origin needs a value, e.g. https://mic.example.com')
        if (raw === '*') throw new UsageError('--allow-origin "*" is not supported: name the exact origin of the page')
        const n = normalizeOrigin(raw)
        if (!n) throw new UsageError(`--allow-origin: "${raw}" is not an origin like https://mic.example.com (no path)`)
        o.allowOrigins.push(n)
        break
      }
      case '--allow-no-origin':
        o.allowNoOrigin = true
        break
      case '--iap2':
        o.iap2 = true
        break
      case '--iap2-interface':
        o.iap2Interface = parseNumber(flag, value(), 0, 255)
        break
      case '--pid':
        o.pid = parseNumber(flag, value(), 0, 0xffff)
        break
      case '--verbose':
      case '-v':
        o.verbose = true
        break
      case '--embedded':
        o.embedded = true
        break
      default:
        throw new UsageError(`unknown option ${argv[i]}`)
    }
  }
  return o
}

// --------------------------------------------------------------------------------- logging

const t0 = Date.now()
/** "bridge" under npx hollyland-web-ui, whose own messages share the terminal. */
let logLabel = ''
function log(line: string): void {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(7)
  console.log(`${logLabel}${s}s  ${line}`)
}

function hexdump(b: Uint8Array): string {
  let end = b.length
  while (end > 8 && b[end - 1] === 0) end--
  const s = [...b.subarray(0, end)].map((x) => x.toString(16).padStart(2, '0')).join(' ')
  return end < b.length ? `${s} …(${b.length - end}×00)` : s
}

// ------------------------------------------------------------------------------------- USB

interface Pipe {
  label: 'hid' | 'iap2'
  number: number
  inEp: InEndpoint
  outEp: OutEndpoint
  /** We detached an OS driver from this interface and must re-attach it. */
  detached: boolean
  claimed: boolean
  errors: number[]
}

interface Captured {
  device: Device
  info: BridgeDeviceInfo
  hid: Pipe
  iap2: Pipe | null
  /** Interrupt-OUT packet contract sent to clients (legacy: exactly 64 bytes). */
  packet: BridgePacketInfo
}

/**
 * USB products the bridge captures: connectable registry rows with an interrupt HID link. While
 * the other families are stubs this is exactly the LARK A2 / A2S / M2 / M2S set.
 */
const SUPPORTED = PRODUCTS.filter((p) => p.idKind !== 'app' && isConnectableProduct(p) && !!webHidLinkOf(p))

function productName(vid: number, pid: number): string {
  return PRODUCTS.find((p) => p.vendorId === vid && p.productId === pid)?.name ?? `${hex4(vid)}:${hex4(pid)}`
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class Bridge {
  private readonly usb: Usb
  private readonly opts: Options
  readonly server: BridgeServer
  private cap: Captured | null = null
  /** Devices whose hand-back is in progress (for the synchronous exit fallback). */
  private readonly releasing = new Map<Device, Pipe[]>()
  private state: 'searching' | 'capturing' | 'captured' | 'stopping' = 'searching'
  private scanTimer: ReturnType<typeof setInterval> | null = null
  private lastFailure = ''
  private waitingNoted = false
  private readonly onAttach = (d: Device) => {
    if (this.matches(d) && this.state === 'searching') setTimeout(() => void this.tryCapture(), 1200)
  }
  private readonly onDetach = (d: Device) => {
    if (this.cap && d === this.cap.device && this.state === 'captured') this.lost('unplugged')
  }

  constructor(usb: Usb, opts: Options) {
    this.usb = usb
    this.opts = opts
    this.server = new BridgeServer({
      port: opts.port,
      version: BRIDGE_VERSION,
      allowOrigins: opts.allowOrigins,
      allowNoOrigin: opts.allowNoOrigin,
      iap2: opts.iap2,
      log,
      onClientData: (ch, data) => this.write(ch, data),
    })
  }

  matches(d: Device): boolean {
    const { idVendor, idProduct } = d.deviceDescriptor
    if (this.opts.pid !== null) {
      return (idVendor === HOLLYLAND_VENDOR_ID || idVendor === EAGLESHERO_VENDOR_ID) && idProduct === this.opts.pid
    }
    return SUPPORTED.some((p) => p.vendorId === idVendor && p.productId === idProduct)
  }

  /** Find + capture whenever no receiver is held (hotplug events plus a 2 s scan as backup). */
  start(): void {
    this.usb.usb.on('attach', this.onAttach)
    this.usb.usb.on('detach', this.onDetach)
    this.scanTimer = setInterval(() => {
      if (this.state === 'searching') void this.tryCapture()
    }, 2000)
    void this.tryCapture()
  }

  /** The capture attempt in progress, so stop() can wait for it and hand the receiver back. */
  private attempt: Promise<void> | null = null

  tryCapture(): Promise<void> {
    if (this.state !== 'searching') return this.attempt ?? Promise.resolve()
    this.attempt = this.captureOnce().finally(() => {
      this.attempt = null
    })
    return this.attempt
  }

  private async captureOnce(): Promise<void> {
    const d = this.usb.getDeviceList().find((x) => this.matches(x))
    if (!d) {
      if (!this.waitingNoted) {
        log('waiting for a receiver: plug in a LARK A2 / A2S / M2 / M2S receiver')
        this.waitingNoted = true
      }
      return
    }
    this.state = 'capturing'
    try {
      const c = await this.capture(d)
      if (this.state !== 'capturing') {
        // Shutdown started while capturing.
        await this.release(c.device, [c.iap2, c.hid], false)
        return
      }
      this.cap = c
      this.state = 'captured'
      this.lastFailure = ''
      this.waitingNoted = false
      const { info } = c
      log(
        `captured ${productName(info.vendorId, info.productId)} (${hex4(info.vendorId)}:${hex4(info.productId)}` +
          `${info.serialNumber ? `, serial ${info.serialNumber}` : ''}): interface ${c.hid.number}, ` +
          `IN 0x${c.hid.inEp.address.toString(16)} / OUT 0x${c.hid.outEp.address.toString(16)}` +
          (c.iap2 ? `; iAP2 interface ${c.iap2.number}, IN 0x${c.iap2.inEp.address.toString(16)} / OUT 0x${c.iap2.outEp.address.toString(16)}` : ''),
      )
      if (PAUSES_AUDIO) log('USB audio from this receiver is PAUSED until the bridge stops (Ctrl+C)')
      else log('USB audio keeps working: the bridge holds only the HID control interface')
      this.server.setDevice(info, c.packet)
    } catch (e) {
      if (this.state === 'capturing') this.state = 'searching'
      const msg = errText(e)
      if (msg !== this.lastFailure) {
        log(`could not capture the receiver: ${msg} (retrying)`)
        this.lastFailure = msg
      }
    }
  }

  private async capture(device: Device): Promise<Captured> {
    const u = this.usb.usb
    try {
      device.open()
    } catch (e) {
      const ex = e as LibUSBException
      if (process.platform === 'linux' && ex.errno === u.LIBUSB_ERROR_ACCESS) {
        throw new Error(`no permission to open the receiver (LIBUSB_ERROR_ACCESS): ${LINUX_RULE_HINT}`)
      }
      throw e
    }
    const pipes: Pipe[] = []
    try {
      const hid = this.findPipe(device, 'hid', (n, cls) => cls === u.LIBUSB_CLASS_HID && n >= 0, u.LIBUSB_TRANSFER_TYPE_INTERRUPT, 0)
      if (!hid) throw new Error('no HID interface with interrupt IN and OUT endpoints')
      pipes.push(hid) // before claim(): a failed claim may already have detached the OS driver
      this.claim(device, hid)
      hid.outEp.timeout = 1000

      let iap2: Pipe | null = null
      if (this.opts.iap2) {
        const want = this.opts.iap2Interface
        iap2 = this.findPipe(device, 'iap2', (n, cls) => n === want && cls === u.LIBUSB_CLASS_VENDOR_SPEC, u.LIBUSB_TRANSFER_TYPE_BULK, want)
        if (!iap2) {
          log(`--iap2: interface ${want} with bulk IN/OUT not found; /iap2 stays empty`)
        } else {
          try {
            this.claim(device, iap2)
            pipes.push(iap2)
            iap2.outEp.timeout = 2000
          } catch (e) {
            log(`--iap2: could not claim interface ${want}: ${errText(e)}`)
            if (iap2.detached) {
              try {
                device.__attachKernelDriver(iap2.number)
              } catch {
                /* best effort */
              }
            }
            iap2 = null
          }
        }
      }

      const dd = device.deviceDescriptor
      const [manufacturer, productNameStr, serialNumber] = await Promise.all([
        readString(device, dd.iManufacturer),
        readString(device, dd.iProduct),
        readString(device, dd.iSerialNumber),
      ])
      const info: BridgeDeviceInfo = {
        vendorId: dd.idVendor,
        productId: dd.idProduct,
        productName: productNameStr,
        manufacturer,
        serialNumber,
      }
      const row = PRODUCTS.find((p) => p.vendorId === dd.idVendor && p.productId === dd.idProduct)
      const packet = bridgePacketForLink(row ? webHidLinkOf(row) : undefined, hid.outEp.descriptor.wMaxPacketSize)
      const c: Captured = { device, info, hid, iap2, packet }
      this.startPoll(c, hid, Math.max(64, hid.inEp.descriptor.wMaxPacketSize))
      if (iap2) this.startPoll(c, iap2, Math.max(64, iap2.inEp.descriptor.wMaxPacketSize))
      return c
    } catch (e) {
      // Undo a partial capture so the OS gets the receiver back.
      await this.release(device, pipes, false)
      throw e
    }
  }

  /**
   * node-usb's Interface.claim()/detachKernelDriver() pass the interface's INDEX in the
   * configuration instead of its number; the A2's interfaces are numbered 0, 1, 3, 7, so the
   * raw device methods are called with the real interface number.
   */
  private claim(device: Device, p: Pipe): void {
    let active = false
    try {
      active = device.__isKernelDriverActive(p.number)
    } catch {
      active = false
    }
    if (active) {
      try {
        device.__detachKernelDriver(p.number)
        p.detached = true
      } catch (e) {
        const ex = e as LibUSBException
        if (ex.errno === this.usb.usb.LIBUSB_ERROR_ACCESS) {
          throw new Error(
            `the OS refused to release interface ${p.number} (LIBUSB_ERROR_ACCESS): ` +
              (process.platform === 'linux' ? LINUX_RULE_HINT : 'run the bridge as root (npm run bridge)'),
          )
        }
        throw new Error(`could not detach the OS driver from interface ${p.number}: ${ex.message}`)
      }
    }
    try {
      device.__claimInterface(p.number)
      p.claimed = true
    } catch (e) {
      const ex = e as LibUSBException
      if (ex.errno === this.usb.usb.LIBUSB_ERROR_BUSY || ex.errno === this.usb.usb.LIBUSB_ERROR_ACCESS) {
        throw new Error(`interface ${p.number} is in use by another program (another bridge? HollyAudio?): ${ex.message}`)
      }
      throw new Error(`could not claim interface ${p.number}: ${ex.message}`)
    }
  }

  private findPipe(
    device: Device,
    label: Pipe['label'],
    match: (num: number, cls: number) => boolean,
    type: number,
    prefer: number,
  ): Pipe | null {
    const candidates = (device.interfaces ?? []).filter((itf) => match(itf.interfaceNumber, itf.descriptor.bInterfaceClass))
    candidates.sort((a, b) => (a.interfaceNumber === prefer ? -1 : 0) - (b.interfaceNumber === prefer ? -1 : 0))
    for (const itf of candidates) {
      const inEp = itf.endpoints.find((e) => e.direction === 'in' && e.transferType === type) as InEndpoint | undefined
      const outEp = itf.endpoints.find((e) => e.direction === 'out' && e.transferType === type) as OutEndpoint | undefined
      if (inEp && outEp) return { label, number: itf.interfaceNumber, inEp, outEp, detached: false, claimed: false, errors: [] }
    }
    return null
  }

  private startPoll(c: Captured, p: Pipe, size: number): void {
    p.inEp.removeAllListeners('data')
    p.inEp.removeAllListeners('error')
    p.inEp.on('data', (d: Buffer) => {
      if (this.opts.verbose) log(`${p.label} IN  ${d.length}: ${hexdump(d)}`)
      this.server.deliver(p.label, d)
    })
    p.inEp.on('error', (e: LibUSBException) => this.onPipeError(c, p, e, size))
    p.inEp.startPoll(p.label === 'hid' ? 2 : 4, size)
  }

  private isGoneError(e: LibUSBException, device: Device): boolean {
    const u = this.usb.usb
    if (e.errno === u.LIBUSB_TRANSFER_NO_DEVICE || e.errno === u.LIBUSB_ERROR_NO_DEVICE) return true
    try {
      return !this.usb.getDeviceList().includes(device)
    } catch {
      return false
    }
  }

  private onPipeError(c: Captured, p: Pipe, e: LibUSBException, size: number): void {
    if (this.cap !== c || this.state !== 'captured') return
    if (this.isGoneError(e, c.device)) {
      this.lost('unplugged')
      return
    }
    const now = Date.now()
    p.errors = [...p.errors.filter((t) => now - t < 10_000), now]
    log(`${p.label} IN error: ${e.message}`)
    if (p.errors.length > 5) {
      log(`${p.label}: too many errors, giving the receiver back and capturing it again`)
      this.lost('errors')
      return
    }
    // node-usb stops polling after an error; restart once its transfers have wound down.
    p.inEp.once('end', () =>
      setTimeout(() => {
        if (this.cap !== c || this.state !== 'captured' || p.inEp.pollActive) return
        try {
          p.inEp.startPoll(p.label === 'hid' ? 2 : 4, size)
        } catch (err) {
          log(`${p.label}: could not restart polling: ${errText(err)}`)
          this.lost('errors')
        }
      }, 300),
    )
  }

  private write(channel: 'hid' | 'iap2', data: Buffer): void {
    const c = this.cap
    const p = channel === 'hid' ? c?.hid : c?.iap2
    if (!c || !p || this.state !== 'captured') throw new Error(`no receiver captured; ${channel} packet dropped`)
    if (this.opts.verbose) log(`${channel} OUT ${data.length}: ${hexdump(data)}`)
    p.outEp.transfer(data, (err) => {
      if (!err) return
      log(`${channel} OUT error: ${err.message}`)
      if (this.cap === c && this.isGoneError(err, c.device)) this.lost('unplugged')
    })
  }

  /** The receiver went away (unplug, RX restart) or misbehaves: drop it and search again. */
  private lost(why: 'unplugged' | 'errors'): void {
    const c = this.cap
    if (!c) return
    this.cap = null
    this.state = 'searching'
    this.server.setDevice(null)
    log(why === 'unplugged' ? 'receiver unplugged or restarting: waiting for it to come back' : 'released the receiver after errors')
    void this.release(c.device, [c.iap2, c.hid], why === 'unplugged').then(() => {
      if (why === 'errors') setTimeout(() => void this.tryCapture(), 1500)
    })
  }

  /** Stop polling, release interfaces, re-attach the OS drivers, close. Never throws. */
  async release(device: Device, pipes: readonly (Pipe | null | undefined)[], deviceGone: boolean): Promise<void> {
    if (this.releasing.has(device)) return
    const list = pipes.filter((p): p is Pipe => !!p)
    this.releasing.set(device, list)
    try {
      for (const p of list) {
        await stopPoll(p.inEp, 1000)
        p.inEp.removeAllListeners('data')
        p.inEp.removeAllListeners('error')
        p.inEp.on('error', () => undefined) // late transfer errors must not crash the process
      }
      if (!deviceGone) {
        for (const p of list) {
          if (!p.claimed) continue
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 1000)
            try {
              device.__releaseInterface(p.number, () => {
                clearTimeout(t)
                resolve()
              })
            } catch {
              clearTimeout(t)
              resolve()
            }
          })
          p.claimed = false
        }
        for (const p of list) {
          if (!p.detached) continue
          try {
            device.__attachKernelDriver(p.number)
          } catch (e) {
            log(`note: re-attaching the OS driver to interface ${p.number}: ${errText(e)}`)
          }
          p.detached = false
        }
      }
      try {
        device.close()
      } catch {
        /* already closed or gone */
      }
    } finally {
      this.releasing.delete(device)
    }
  }

  /** Last-resort synchronous hand-back from the process 'exit' handler (async work is impossible there). */
  releaseSync(): void {
    const all = new Map(this.releasing)
    if (this.cap) all.set(this.cap.device, [this.cap.hid, ...(this.cap.iap2 ? [this.cap.iap2] : [])])
    for (const [device, pipes] of all) {
      for (const p of pipes) {
        if (!p.detached) continue
        try {
          device.__attachKernelDriver(p.number)
        } catch {
          /* best effort */
        }
        p.detached = false
      }
      try {
        device.close()
      } catch {
        /* best effort */
      }
    }
  }

  async stop(): Promise<void> {
    this.state = 'stopping'
    if (this.scanTimer) clearInterval(this.scanTimer)
    this.usb.usb.off('attach', this.onAttach)
    this.usb.usb.off('detach', this.onDetach)
    await this.server.close().catch(() => undefined)
    await this.attempt?.catch(() => undefined) // a capture in flight releases itself when it sees 'stopping'

    const c = this.cap
    if (c) await this.release(c.device, [c.iap2, c.hid], false)
    this.cap = null
  }
}

function readString(device: Device, index: number): Promise<string | undefined> {
  if (!index) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), 1000)
    try {
      device.getStringDescriptor(index, (err, value) => {
        clearTimeout(t)
        resolve(err ? undefined : value?.trim() || undefined)
      })
    } catch {
      clearTimeout(t)
      resolve(undefined)
    }
  })
}

function stopPoll(ep: InEndpoint, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (!ep.pollActive) return resolve()
    const t = setTimeout(resolve, ms)
    try {
      ep.stopPoll(() => {
        clearTimeout(t)
        resolve()
      })
    } catch {
      clearTimeout(t)
      resolve()
    }
  })
}

// ------------------------------------------------------------------------------------ main

function printRootHelp(embedded: boolean): void {
  const node = process.execPath
  if (embedded) {
    console.error(
      'The bridge needs root to take the receiver away from the operating system.\n' +
        'Start it with "npx hollyland-web-ui", which asks for your password through sudo.',
    )
    return
  }
  console.error(`The bridge needs root.

To read the receiver's replies it has to take the receiver away from the operating system
(on macOS this pauses the receiver's USB audio while the bridge runs), and only root may do that.

Start it from the project folder with:

  npm run bridge

That asks for your password through sudo and keeps using this Node (${node}),
so nvm installs work. To run it by hand instead:

  sudo "${node}" --import tsx scripts/bridge.ts
`)
}

async function main(): Promise<void> {
  let opts: Options | 'help'
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`bridge: ${e.message}\n\n${HELP}`)
      process.exit(2)
    }
    throw e
  }
  if (opts === 'help') {
    console.log(HELP)
    return
  }
  if (process.platform === 'win32') {
    console.error(
      'The bridge does not run on Windows: Windows cannot detach its HID driver from the receiver.\n' +
        'Run it on Linux or macOS for full read/write. See docs/BRIDGE.md.',
    )
    process.exit(1)
  }
  if (opts.embedded) logLabel = '  bridge'
  // Linux needs no root: write access to the receiver's device node (udev rule) is enough, and
  // capture() says what to do when it is missing.
  if (process.platform !== 'linux' && typeof process.getuid === 'function' && process.getuid() !== 0) {
    printRootHelp(opts.embedded)
    process.exit(1)
  }

  const require = createRequire(import.meta.url)
  let usb: Usb
  try {
    usb = require('usb') as Usb
  } catch (e) {
    console.error(
      `Could not load the "usb" package (${errText(e)}). ` +
        (opts.embedded
          ? 'Try a fresh copy: npx --yes hollyland-web-ui@latest'
          : 'Run "npm install" in the project folder first.'),
    )
    process.exit(1)
  }

  const bridge = new Bridge(usb, opts)
  try {
    await bridge.server.listen()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') {
      console.error(`Port ${opts.port} on 127.0.0.1 is already in use. Is another bridge running? Pick another port with --port <n>.`)
    } else {
      console.error(`Could not listen on 127.0.0.1:${opts.port}: ${errText(e)}`)
    }
    process.exit(1)
  }

  // ------------------------------------------------------------- always give the receiver back
  let stopping = false
  let stoppingSince = 0
  const shutdown = (code: number, why: string) => {
    if (stopping) {
      // One Ctrl+C can arrive twice: from the terminal and relayed by a launcher (npx hollyland-web-ui, sudo).
      if (Date.now() - stoppingSince > 1500) log('still giving the receiver back to the OS…')
      return
    }
    stopping = true
    stoppingSince = Date.now()
    log(`${why}: giving the receiver back to the OS…`)
    const hard = setTimeout(() => {
      console.error('Cleanup took too long. If the receiver\'s audio does not come back, unplug and re-plug it.')
      process.exit(code || 1)
    }, 6000)
    void bridge
      .stop()
      .catch((e: unknown) => log(`cleanup error: ${errText(e)}`))
      .finally(() => {
        clearTimeout(hard)
        log(PAUSES_AUDIO ? 'receiver handed back. USB audio resumes in a moment (re-plug it if it does not).' : 'receiver handed back.')
        process.exit(code)
      })
  }
  process.on('SIGINT', () => shutdown(130, 'Ctrl+C'))
  process.on('SIGTERM', () => shutdown(143, 'SIGTERM'))
  process.on('SIGHUP', () => shutdown(129, 'terminal closed'))
  process.on('uncaughtException', (e) => {
    console.error(e)
    shutdown(1, 'unexpected error')
  })
  process.on('unhandledRejection', (e) => {
    console.error(e)
    shutdown(1, 'unexpected error')
  })
  process.on('exit', () => bridge.releaseSync())

  if (opts.embedded) {
    // npx hollyland-web-ui prints the page address and the instructions itself.
    log(`listening on ${bridge.server.url('hid')} (this computer only; one page at a time)`)
    if (opts.iap2) log(`iAP2 relay on ${bridge.server.url('iap2')} (experimental, raw bulk bytes)`)
    bridge.start()
    return
  }

  const origins = [
    'http://localhost:*, https://localhost:*',
    'http://127.0.0.1:*, https://127.0.0.1:*',
    ...bridge.server.allowedOrigins.map((o) =>
      o === GITHUB_PAGES_ORIGIN ? `${o} (hosted Hollyland Web UI, --allow-origin)` : `${o} (--allow-origin)`,
    ),
    ...(opts.allowNoOrigin ? ['clients without an Origin header (--allow-no-origin)'] : []),
  ]
  console.log(`
Hollyland Web UI USB bridge ${BRIDGE_VERSION}

  WebSocket   ${bridge.server.url('hid')}${opts.iap2 ? `\n  iAP2 relay  ${bridge.server.url('iap2')} (experimental, raw bulk bytes)` : ''}
  Listening   127.0.0.1 only (not reachable from other computers)
  Accepts     ${origins.join('\n              ')}
  Clients     one page at a time; a second one is refused

  ${
    PAUSES_AUDIO
      ? 'While the bridge holds the receiver its USB AUDIO IS PAUSED (no mic input on this computer).'
      : 'USB audio keeps working: the bridge takes only the receiver\'s HID control interface.'
  }
  Press Ctrl+C to stop; the receiver is handed back to the OS automatically.
${opts.port !== BRIDGE_DEFAULT_PORT ? `\n  Custom port: open the page with ?bridge=${opts.port}\n` : ''}
In Hollyland Web UI, choose "Connect through local bridge".
`)
  if (opts.allowOrigins.some((o) => !isLoopbackOrigin(o) && o.startsWith('http:'))) {
    log('note: plain-http origins other than localhost cannot be trusted on a shared network')
  }
  bridge.start()
}

void main()
