/**
 * Generic control writes for the renderer: the session's `setControl()` plus the official app's
 * "Setup successful" toast on a live link (failures already toast from the session), and the
 * session-backed context the pure helpers in controls.ts take.
 */
import { controlKey, type ControlSpec, type ControlValue, type UnitId } from '../../lib/protocol'
import { session } from '../../lib/state/session.svelte'
import { toasts } from '../../lib/ui/toast.svelte'
import type { Confidence } from '../../lib/ui/types'
import { isShown, optionReason, type ControlContext } from './controls'
import { REASON_TEXT } from '../../lib/state/reasons'

/** Send a control value (after any confirmation). Returns whether it went out. */
export async function sendControl(id: string, value: ControlValue, o: { unit?: UnitId; confirm?: boolean } = {}): Promise<boolean> {
  const live = session.live
  const ok = await session.setControl(id, value, o)
  if (ok && live && session.live) toasts.success('Setup successful', { timeout: 1500 })
  return ok
}

/** The session as the pure helpers see it. */
export const sessionContext: ControlContext = {
  get family() {
    return session.family
  },
  value: (id, unit) => session.value(id, unit),
  availability: (id, unit) => session.availability(id, unit),
}

/** Whether the control exists in the current state (see controls.ts isShown). */
export function shown(spec: ControlSpec, unit?: UnitId): boolean {
  return isShown(spec, sessionContext, unit)
}

/** Why a choice value is refused here: its reason code and a few words ("iOS app only"), or null. */
export function optionBlock(spec: ControlSpec, value: number): { code: string; text: string } | null {
  const r = optionReason(session.family, session.product, spec, value, session.micState?.values)
  return r ? { code: r, text: REASON_TEXT[r] ?? 'Unavailable' } : null
}

/** What the renderer needs to draw one control's value. */
export interface ControlView {
  value: ControlValue | undefined
  confidence: Confidence
  pending: boolean
  sentAt: number | null
  /** Why it is blocked (a few words), or null. */
  reason: string | null
  reasonCode: string | null
}

export function viewOf(spec: ControlSpec, unit?: UnitId): ControlView {
  const a = session.availability(spec.id, unit)
  return {
    value: session.value(spec.id, unit),
    confidence: session.confidence(spec.id, unit),
    pending: session.isPending(spec.id, unit),
    sentAt: session.sentAt[controlKey(spec.id, unit)] ?? null,
    reason: session.blockText(spec.id, unit),
    reasonCode: a?.reason ?? null,
  }
}
