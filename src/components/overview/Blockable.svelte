<script lang="ts">
  /**
   * The official app's touch interceptor: while `reason` is set, pointer, click and activation
   * keys are swallowed before they reach the control and the reason is shown as a toast.
   * The control stays focusable so keyboard and screen-reader users hear why it is unavailable.
   *
   * The controls inside draw the blocked look themselves (flat face, aria-disabled) from the
   * field context set here. The reason is said in place:
   * - `showReason` (default): a short line under the control
   * - `reasonId`: the reason is printed elsewhere (e.g. a switch at a module head whose reason
   *   sits in the module body); the control is described by that element
   */
  import type { Snippet } from 'svelte'
  import { getFieldContext, setFieldContext, uid } from '../../lib/ui/field'
  import { blockedToast } from './overview'

  interface Props {
    reason: string | null
    /** Print the reason under the control (ignored when `reasonId` is given). */
    showReason?: boolean
    /** id of an element elsewhere that says the reason. */
    reasonId?: string
    /** Lay the wrapper out inline (for a control at a module head). */
    inline?: boolean
    children: Snippet
  }
  let { reason, showReason = true, reasonId, inline = false, children }: Props = $props()

  const ownId = uid('block')
  const describe = $derived(reason ? (reasonId ?? (showReason ? ownId : undefined)) : undefined)

  // The control inside reports aria-disabled while blocked (and keeps the row's description).
  const parent = getFieldContext()
  setFieldContext({
    get describedBy() {
      return [describe, parent?.describedBy].filter(Boolean).join(' ') || undefined
    },
    get blocked() {
      return !!reason || (parent?.blocked ?? false)
    },
  })

  const KEYS = new Set(['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

  function swallow(e: Event) {
    e.preventDefault()
    e.stopPropagation()
  }
  function onpointerdown(e: PointerEvent) {
    if (reason) swallow(e)
  }
  function onclick(e: MouseEvent) {
    if (!reason) return
    swallow(e)
    blockedToast(reason)
  }
  function onkeydown(e: KeyboardEvent) {
    // Digits pick a fader stop, so they are activation keys too.
    if (!reason || !(KEYS.has(e.key) || /^[0-9]$/.test(e.key))) return
    swallow(e)
    blockedToast(reason)
  }
</script>

<div
  class="blockable"
  class:inline
  class:blocked={!!reason}
  onpointerdowncapture={onpointerdown}
  onclickcapture={onclick}
  onkeydowncapture={onkeydown}
  role="presentation"
>
  {@render children()}
  {#if reason && showReason && !reasonId}
    <p class="reason" id={ownId}>{reason}</p>
  {/if}
</div>

<style>
  .blockable {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .inline {
    display: inline-flex;
  }
  .blocked {
    cursor: not-allowed;
  }
  .blocked :global(*) {
    cursor: not-allowed;
  }
  .reason {
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
</style>
