/**
 * Overview write helpers: the "Setup successful" toast of the official app (live links only) and,
 * on a write-only link, when each setting was last sent ("Last sent 17:42 · not confirmed").
 *
 * The session already remembers the values sent blind; it doesn't keep the time, so the Overview
 * keeps it here per receiver model (localStorage). Values sent from other pages show without a time.
 */
import { session } from '../../lib/state/session.svelte'
import { toasts } from '../../lib/ui/toast.svelte'
import { formatSentAt, loadSentAt, saveSentAt, type SentAt } from './overview'

class SentClock {
  /** Bumped on every write to storage, so `map` is read again. */
  private version = $state(0)
  /** Times for the attached receiver model; follows the product reactively. */
  private map = $derived.by((): SentAt => {
    void this.version
    return loadSentAt(session.product?.productId)
  })

  mark(key: string) {
    saveSentAt(session.product?.productId, { ...this.map, [key]: Date.now() })
    this.version++
  }

  /** Forget every time (with "Forget sent values"). */
  clear() {
    saveSentAt(session.product?.productId, {})
    this.version++
  }

  /** "17:42", "yesterday 17:42" or "3 Nov 17:42"; null when the time isn't known. */
  time(key: string): string | null {
    return formatSentAt(this.map[key])
  }
}

export const sentClock = new SentClock()

/** Send one Overview setting. Returns whether it went out (confirmed, or sent blind). */
export async function apply(key: string, write: Promise<boolean>): Promise<boolean> {
  const blind = session.writeOnly
  const ok = await write
  if (ok && session.live) toasts.success('Setup successful', { timeout: 1500 })
  if (ok && blind) sentClock.mark(key)
  return ok
}
