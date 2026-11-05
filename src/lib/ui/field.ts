/**
 * Field context: lets a control rendered inside <SettingRow> (and <Blockable>) expose the row's
 * description / unavailable reason through aria-describedby, and a block through
 * aria-disabled, without every caller wiring ids by hand.
 */
import { getContext, setContext } from 'svelte'

const KEY = Symbol('field')

export interface FieldContext {
  /** id of the element describing the control (description or reason), if any. */
  readonly describedBy: string | undefined
  /** True while the control is blocked (it stays focusable but does nothing). */
  readonly blocked: boolean
}

export function setFieldContext(ctx: FieldContext): void {
  setContext(KEY, ctx)
}

export function getFieldContext(): FieldContext | undefined {
  return getContext<FieldContext | undefined>(KEY)
}

let n = 0
export function uid(prefix = 'f'): string {
  n += 1
  return `${prefix}-${n.toString(36)}`
}
