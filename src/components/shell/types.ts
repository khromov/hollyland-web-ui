import type { Route } from '../../lib/state/router.svelte'

/** A section tab in the header (desktop) or the bottom tab bar (phone). */
export interface HeaderTab {
  /** Where the tab goes. "Connect" goes to #/overview, which shows Connect until a receiver is connected. */
  route: Route
  label: string
}
