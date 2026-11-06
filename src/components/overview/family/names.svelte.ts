/**
 * Mic names for every page (family Overview and Device page, Settings > This browser). Mic 1 and Mic 2 share the browser-wide names of the
 * legacy pages (prefs.micNames), so a name set here shows on the Audio page too; Mic 3 and Mic 4
 * (4-mic kits) are kept here, in the same storage style. Defaults: the unit's display label
 * from the driver, else "Mic n".
 */
import type { MicUnit, UnitId } from '../../../lib/protocol/app'
import { prefs } from '../../../lib/state/prefs.svelte'

const EXTRA_KEY = 'mc.micNames.extra'

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(EXTRA_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

const SLOT: Partial<Record<UnitId, 0 | 1>> = { tx1: 0, tx2: 1 }

class MicNames {
  private extra: Record<string, string> = $state(load())

  /** "Mic 3" for tx3 (or the driver's label for the unit). */
  defaultName(unit: UnitId, u?: MicUnit | null): string {
    return u?.label?.trim() || `Mic ${unit.replace(/\D/g, '') || '1'}`
  }

  /** The stored text as typed (a text field's value), or ''. */
  raw(unit: UnitId): string {
    const slot = SLOT[unit]
    return (slot !== undefined ? prefs.micNames[slot] : this.extra[unit]) ?? ''
  }

  /** The name the user gave this mic in this browser, or '' (the default applies). */
  custom(unit: UnitId): string {
    return this.raw(unit).trim()
  }

  name(unit: UnitId, u?: MicUnit | null): string {
    return this.custom(unit) || this.defaultName(unit, u)
  }

  /** `asTyped`: keep the text as typed (a field being edited keeps its spaces); otherwise trimmed. */
  set(unit: UnitId, name: string, o: { asTyped?: boolean } = {}) {
    const v = (o.asTyped ? name : name.trim()).slice(0, 32)
    const slot = SLOT[unit]
    if (slot !== undefined) {
      prefs.setMicName(slot, v)
      return
    }
    this.extra = { ...this.extra, [unit]: v }
    try {
      localStorage.setItem(EXTRA_KEY, JSON.stringify(this.extra))
    } catch {
      /* storage unavailable */
    }
  }
}

export const micNames = new MicNames()
