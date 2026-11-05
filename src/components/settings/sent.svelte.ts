import { session } from '../../lib/state/session.svelte'
import { toasts } from '../../lib/ui/toast.svelte'
import { sentClock } from '../overview/sent.svelte'

/**
 * When this page last sent each receiver setting (write-only mode shows "Last sent 17:42 ·
 * not confirmed"). In memory only: a value remembered from an earlier visit has no time, and
 * its caption says "Last sent from this browser" instead.
 */
class SentTimes {
  at: Record<string, number> = $state({})

  mark(key: string): void {
    this.at = { ...this.at, [key]: Date.now() }
  }

  clear(): void {
    this.at = {}
  }
}

export const sentTimes = new SentTimes()

/** One name and tooltip for "forget" wherever it is offered (status strip, Settings). */
export const FORGET_LABEL = 'Forget remembered values'
export const FORGET_TIP = 'Clear the values last sent from this browser'

/** Forget every value (and time) remembered from blind writes, with the same toast everywhere. */
export function forgetRemembered(): void {
  session.forgetSent()
  sentTimes.clear()
  sentClock.clear()
  toasts.info('Remembered values cleared', { timeout: 2500 })
}
