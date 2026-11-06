/**
 * Control errors of the generic API (core/controls.ts, the engine, LegacyMicDevice). No imports, so the app's
 * control helpers do not pull the engine or the legacy driver; core/errors.ts re-exports both.
 */

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
