/**
 * The theme actually showing (the saved choice, or the system's when it is "system"), and the
 * browser chrome colour that goes with it. index.html sets both before first paint; this keeps
 * them right when the choice or the system preference changes at runtime.
 */
import { prefs } from '../../lib/state/prefs.svelte'

const CHROME = { light: '#E8E7E2', dark: '#141416' } as const

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
let systemDark = $state(media?.matches ?? false)
media?.addEventListener('change', (e) => (systemDark = e.matches))

export const theme = {
  get effective(): 'light' | 'dark' {
    return prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme
  },
  /** Call once from the app's script: keeps <meta name="theme-color"> in step. */
  syncChrome() {
    $effect(() => {
      const forced = prefs.theme === 'system' ? null : CHROME[prefs.theme]
      document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
        const dark = /dark/.test(m.getAttribute('media') ?? '')
        m.setAttribute('content', forced ?? (dark ? CHROME.dark : CHROME.light))
      })
    })
  },
}
