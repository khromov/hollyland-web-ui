/**
 * Errors of the generic engine. The legacy error classes from device.ts are reused where the
 * meaning is the same, so UI code keeps one `instanceof` check per case:
 *   DisconnectedError, RxUnavailableError, DestructiveCommandError, UnsupportedError, TimeoutError.
 */
import { TimeoutError } from '../device'
import { hex16 } from './bytes'

export { DestructiveCommandError, DisconnectedError, RxUnavailableError, TimeoutError, UnsupportedError } from '../device'

/** No reply within the timeout. Extends the legacy TimeoutError; the message names a 16-bit id. */
export class RequestTimeoutError extends TimeoutError {
  constructor(cmd: number, ms: number, name?: string) {
    super(cmd, ms)
    this.name = 'TimeoutError'
    this.message = `no reply to ${name ?? hex16(cmd)} within ${ms} ms`
  }
}

/**
 * A control the official app does not offer in the current state (firmware gate, precondition
 * such as "NC is off" or "secondary receiver"). `reason` is machine readable.
 */
export class ControlUnavailableError extends Error {
  readonly reason: string
  readonly control: string
  constructor(control: string, reason: string, message?: string) {
    super(message ?? `${control} is not available right now (${reason})`)
    this.name = 'ControlUnavailableError'
    this.reason = reason
    this.control = control
  }
}

/** A value outside the control's options / range, or a missing / wrong unit. */
export class ControlValueError extends Error {
  readonly control: string
  constructor(control: string, message: string) {
    super(`${control}: ${message}`)
    this.name = 'ControlValueError'
    this.control = control
  }
}

/**
 * The engine refused to send a command for safety reasons other than destructive gating:
 * uncatalogued command from driver code, a non-read command in the probe / a background poll
 * (FAMILIES.md §2.3), a disruptive command without `confirm`, a notify-only id, or any OTA command.
 */
export class CommandSafetyError extends Error {
  readonly cmd: number
  constructor(cmd: number, message: string) {
    super(message)
    this.name = 'CommandSafetyError'
    this.cmd = cmd
  }
}
