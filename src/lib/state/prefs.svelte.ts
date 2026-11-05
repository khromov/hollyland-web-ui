/** Per-browser preferences persisted to localStorage (best effort). */

export type ThemePref = 'system' | 'dark' | 'light'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable */
  }
}

class Prefs {
  theme: ThemePref = $state(loadTheme())
  developer: boolean = $state(load('mc.developer', false))
  allowRawWrites: boolean = $state(load('mc.rawWrites', false))
  /** User-editable channel names, e.g. "Interview A". */
  micNames: [string, string] = $state(load('mc.micNames', ['', '']))

  setTheme(t: ThemePref) {
    this.theme = t
    try {
      if (t === 'system') localStorage.removeItem('mc.theme')
      else localStorage.setItem('mc.theme', t)
    } catch {
      /* noop */
    }
    applyTheme(t)
  }

  setDeveloper(v: boolean) {
    this.developer = v
    save('mc.developer', v)
    if (!v) this.setAllowRawWrites(false)
  }

  setAllowRawWrites(v: boolean) {
    this.allowRawWrites = v
    save('mc.rawWrites', v)
  }

  setMicName(i: 0 | 1, name: string) {
    const next: [string, string] = [...this.micNames]
    next[i] = name.slice(0, 32)
    this.micNames = next
    save('mc.micNames', next)
  }

  micLabel(i: 0 | 1): string {
    return this.micNames[i]?.trim() || `Mic ${i + 1}`
  }
}

function loadTheme(): ThemePref {
  try {
    const t = localStorage.getItem('mc.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(t: ThemePref) {
  const el = document.documentElement
  if (t === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', t)
}

export const prefs = new Prefs()
