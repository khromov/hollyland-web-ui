/**
 * Transport abstraction. Higher layers (codec, device) never touch WebHID / node-hid directly.
 *
 * Contract (see docs/PROTOCOL.md §2):
 *  - `send(packet)` receives a complete wire packet exactly as the device must see it on the
 *    interrupt-OUT endpoint, i.e. the 64-byte buffer that starts with `AA DD` (or `55` for OTA
 *    data). The transport is responsible for mapping byte 0 onto its own API (WebHID:
 *    `sendReport(packet[0], packet.subarray(1))`, hidapi: `write(packet)`).
 *  - `onPacket` delivers every raw interrupt-IN packet with the leading byte restored, so a
 *    control reply arrives as `BB DD cmd src lenHi lenLo payload…` exactly like Android's
 *    `bulkTransfer` sees it.
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
   * `'yes'` = verified, `'no'` = known to be filtered by the OS (macOS / Windows HID stacks drop
   * the undeclared report ID 0xBB, see PROTOCOL.md §2.4), `'unknown'` = try and see.
   */
  receive: 'yes' | 'no' | 'unknown'
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
  /** Send one 64-byte wire packet (byte 0 is 0xAA for control frames, 0x55 for OTA data). */
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
