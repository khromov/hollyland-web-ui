/**
 * Transport abstraction. Higher layers (codec, device) never touch WebHID / node-hid directly.
 *
 * Contract (see docs/PROTOCOL.md §2, docs/FAMILIES.md §3.4):
 *  - `send(frame)` receives one complete protocol frame exactly as the family's Android builder
 *    produces it. For the legacy families that is the 64-byte buffer that starts with `AA DD`
 *    (or `55` for OTA data); M3 frames start with report id 08 and are 64 or 512 bytes; MAX 2 /
 *    MELO P1 frames are unpadded. The transport maps the frame onto its own API: report id and
 *    padding to the declared report size (WebHID: `sendReport(frame[0], frame.subarray(1))`,
 *    hidapi: `write(frame)`), feature reports, or GATT chunking.
 *  - `onPacket` delivers every raw packet the device sent, with the leading byte restored, so a
 *    legacy reply arrives as `BB DD cmd src lenHi lenLo payload…` exactly like Android's
 *    `bulkTransfer` sees it. A packet may hold part of a frame (BLE notifications, multi-report
 *    frames): the family's assembler reassembles.
 *  - A synchronous transport (feature reports) emits the reply through `onPacket` before `send()`
 *    resolves, so the engines need no special case.
 */
import { Emitter } from './emitter'

export interface TransportDeviceInfo {
  vendorId: number
  productId: number
  productName?: string
  manufacturer?: string
  serialNumber?: string
  /** Free-form id useful for logs (HID path, WebHID index…). */
  id?: string
}

export interface TransportCapabilities {
  /**
   * Whether this transport can receive device replies on the current platform.
   * `'yes'` = verified, `'no'` = known to be filtered by the OS (macOS / Linux / Windows HID stacks drop
   * the undeclared report ID 0xBB, see PROTOCOL.md §2.4), `'unknown'` = try and see.
   */
  receive: 'yes' | 'no' | 'unknown'
  /**
   * Which pipe carries the frames (optional; added for the other families). 'interrupt' = HID
   * input/output reports, 'feature' = SET/GET_REPORT, 'gatt' = Web Bluetooth, 'bridge' = the local
   * root-libusb relay, 'mock' = in-memory.
   */
  link?: 'interrupt' | 'feature' | 'gatt' | 'bridge' | 'mock'
  /** Largest frame `send()` accepts in one call (optional; legacy transports: 64). */
  maxWrite?: number
}

export interface TransportEvents {
  packet: [Uint8Array]
  disconnect: [Error | undefined]
  /** Raw, transport-level notes (e.g. "inputreport with unexpected report id 0x06"). */
  debug: [string]
}

export interface Transport {
  readonly kind: string
  readonly isOpen: boolean
  readonly info: TransportDeviceInfo | null
  readonly capabilities: TransportCapabilities
  open(): Promise<void>
  close(): Promise<void>
  /** Send one complete frame (legacy: the 64-byte wire packet; byte 0 is 0xAA for control frames, 0x55 for OTA data). */
  send(packet: Uint8Array): Promise<void>
  onPacket(listener: (packet: Uint8Array) => void): () => void
  onDisconnect(listener: (reason?: Error) => void): () => void
  onDebug?(listener: (message: string) => void): () => void
}

/** Shared plumbing for transports. */
export abstract class BaseTransport implements Transport {
  abstract readonly kind: string
  abstract readonly isOpen: boolean
  abstract readonly info: TransportDeviceInfo | null
  abstract readonly capabilities: TransportCapabilities
  protected readonly events = new Emitter<TransportEvents>()

  abstract open(): Promise<void>
  abstract close(): Promise<void>
  abstract send(packet: Uint8Array): Promise<void>

  onPacket(listener: (packet: Uint8Array) => void): () => void {
    return this.events.on('packet', listener)
  }

  onDisconnect(listener: (reason?: Error) => void): () => void {
    return this.events.on('disconnect', listener)
  }

  onDebug(listener: (message: string) => void): () => void {
    return this.events.on('debug', listener)
  }

  protected emitPacket(packet: Uint8Array): void {
    this.events.emit('packet', packet)
  }

  protected emitDisconnect(reason?: Error): void {
    this.events.emit('disconnect', reason)
  }

  protected debug(message: string): void {
    this.events.emit('debug', message)
  }
}

export class TransportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TransportError'
  }
}
