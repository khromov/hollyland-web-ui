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
