/**
 * Errors of the generic engine. The legacy error classes (device-errors.ts, re-exported by device.ts) are reused where the
 * meaning is the same, so UI code keeps one `instanceof` check per case:
 *   DisconnectedError, RxUnavailableError, DestructiveCommandError, UnsupportedError, TimeoutError.
 */
import { TimeoutError } from '../device-errors'
import { hex16 } from './bytes'

export { DestructiveCommandError, DisconnectedError, RxUnavailableError, TimeoutError, UnsupportedError } from '../device-errors'
export { ControlUnavailableError, ControlValueError } from './control-errors'

/** No reply within the timeout. Extends the legacy TimeoutError; the message names a 16-bit id. */
export class RequestTimeoutError extends TimeoutError {
  constructor(cmd: number, ms: number, name?: string) {
    super(cmd, ms, name ?? hex16(cmd))
    this.name = 'TimeoutError'
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
