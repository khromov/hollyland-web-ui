/**
 * Error classes shared by HollylandDevice (device.ts), the generic engine (core/engine.ts) and the app,
 * that need no command catalogue. Kept apart from device.ts so the app can check them (and the driver
 * registry can throw UnsupportedError) without loading the legacy driver: device.ts re-exports every one,
 * so `import { DisconnectedError } from './device'` keeps working. ReadOnlyError names the command from the
 * legacy catalogue (commands.ts) and stays in device.ts.
 */

/**
 * No reply within the timeout. `what` names the command in the message: HollylandDevice passes the legacy
 * command name (commands.ts commandName), the engine's RequestTimeoutError the catalogue name or 16-bit id.
 */
export class TimeoutError extends Error {
  readonly cmd: number
  constructor(cmd: number, ms: number, what = `0x${cmd.toString(16).toUpperCase().padStart(2, '0')}`) {
    super(`no reply to ${what} within ${ms} ms`)
    this.name = 'TimeoutError'
    this.cmd = cmd
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedError'
  }
}

export class RxUnavailableError extends Error {
  constructor(message = 'device replies are not delivered on this platform (see PROTOCOL.md §2.4); enable blindWrites to send unconfirmed') {
    super(message)
    this.name = 'RxUnavailableError'
  }
}

export class DestructiveCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DestructiveCommandError'
  }
}

export type PreconditionReason =
  | 'mic-disconnected'
  | 'all-mics-muted'
  | 'noise-off'
  | 'volume-locked'
  | 'both-mics-required'
  | 'led-off'

/** A write the official apps refuse in the current device state (see HollylandDeviceOptions.enforcePreconditions). */
export class PreconditionError extends Error {
  readonly reason: PreconditionReason
  constructor(reason: PreconditionReason, message: string) {
    super(message)
    this.name = 'PreconditionError'
    this.reason = reason
  }
}

export class DisconnectedError extends Error {
  constructor(message = 'device disconnected') {
    super(message)
    this.name = 'DisconnectedError'
  }
}
