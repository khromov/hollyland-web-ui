<script lang="ts">
  /**
   * The official app's touch interceptor: while `reason` is set, pointer, click and activation
   * keys are swallowed before they reach the control and the reason is shown as a toast.
   * The control stays focusable so keyboard and screen-reader users hear why it is unavailable.
   */
  import type { Snippet } from 'svelte'
  import { getFieldContext, setFieldContext } from '../../lib/ui/field'
  import { blockedToast } from './overview'

  interface Props {
    reason: string | null
    children: Snippet
  }
  let { reason, children }: Props = $props()

  // The control inside reports aria-disabled while blocked (and keeps the row's description).
  const parent = getFieldContext()
  setFieldContext({
    get describedBy() {
      return parent?.describedBy
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
    if (!reason || !KEYS.has(e.key)) return
    swallow(e)
    blockedToast(reason)
  }
</script>

<div
  class="blockable"
  class:blocked={!!reason}
  onpointerdowncapture={onpointerdown}
  onclickcapture={onclick}
  onkeydowncapture={onkeydown}
  role="presentation"
>
  {@render children()}
</div>

<style>
  .blockable {
    min-width: 0;
  }
  .blocked {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .blocked :global(*) {
    cursor: not-allowed;
  }
</style>
