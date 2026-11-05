import { toasts } from '../../lib/ui/toast.svelte'
import { session } from '../../lib/state/session.svelte'

/**
 * Toast after a settings write, like the official app ("Setup successful" / "Setup failed").
 * Failures are already reported by session.write(), so only success is handled here. In
 * write-only mode the write can't be confirmed, and the toast says so.
 */
export function reportResult(ok: boolean): void {
  if (!ok) return
  if (session.live) toasts.success('Setup successful', { timeout: 2000 })
  else toasts.info("Sent. This system can't confirm it.", { timeout: 2500 })
}
