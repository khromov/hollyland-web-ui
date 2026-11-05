<script lang="ts">
  /**
   * Detent fader for a stepped value (RX volume: 6 stops). A recessed slot with an ink fill up
   * to the value, numbered detents (the current one bold) and a mixer-style cap.
   * - Keyboard: the fader is one role="slider"; arrows / PageUp / PageDown step, Home / End jump,
   *   digits pick a stop. The focus ring is drawn around the cap.
   * - Pointer: press or drag anywhere on the fader; it snaps to the nearest stop and sends on
   *   release. Each stop's hit area is the full fader height and (W − 32) / (steps − 1) wide.
   *   A finger only moves it with a tap or a mostly horizontal drag: a vertical swipe that starts
   *   on the fader scrolls the page and changes nothing (touch-action: pan-y).
   * - Touch (pointer: coarse) or flanks="always": 46 px −/+ keys flank the fader.
   * - confidence 'sent': hatched cap, dashed fill (last sent, not confirmed; said in the tooltip);
   *   'unknown' / value null: no cap, dashed slot, "–"; any stop can still be picked.
   * Value is a 0-based stop index, like StepBar.
   */
  import { Minus, Plus } from '@lucide/svelte'
  import type { Confidence } from './types'
  import { getFieldContext } from './field'
  import { confidenceNote } from './confidence'

  interface Props {
    steps: number
    value: number | null
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    /** When a 'sent' value was sent, for the tooltip. */
    sentAt?: number | Date | null
    /** −/+ keys: on touch screens only (auto), always, or never. */
    flanks?: 'auto' | 'always' | 'never'
    /** Print the value ("6/6") to the right of the fader. Usually it sits at the module head. */
    showValue?: boolean
    format?: (i: number) => string
    onchange?: (index: number) => void
  }

  let {
    steps,
    value,
    label,
    disabled = false,
    pending = false,
    confidence = 'solid',
    sentAt = null,
    flanks = 'auto',
    showValue = false,
    format = (i) => `${i + 1}`,
    onchange,
  }: Props = $props()

  const field = getFieldContext()
  const blocked = $derived(field?.blocked ?? false)
  const inert = $derived(disabled || blocked)
  let rail: HTMLDivElement
  let dragValue: number | null = $state(null)
  const unknown = $derived(value === null || confidence === 'unknown')
  const shown = $derived(dragValue ?? (unknown ? null : value))
  const last = $derived(Math.max(1, steps - 1))
  const pos = (i: number) => `calc(16px + (100% - 32px) * ${i / last})`

  const note = $derived(unknown ? 'Unknown' : confidenceNote(confidence, sentAt))
  const valueText = $derived(unknown || value === null ? 'Unknown' : `${format(value)} of ${steps}${note ? `, ${note}` : ''}`)

  function commit(v: number) {
    if (inert) return
    if (v !== value || confidence !== 'solid') onchange?.(v)
  }

  function indexAt(clientX: number): number {
    const r = rail.getBoundingClientRect()
    const t = (clientX - r.left - 16) / Math.max(1, r.width - 32)
    return Math.max(0, Math.min(steps - 1, Math.round(t * last)))
  }
  /** Touch: where the finger went down, until the gesture reads as a drag (or a scroll). */
  let touch: { id: number; x: number; y: number } | null = null
  const SLOP = 8
  function down(e: PointerEvent) {
    if (inert || e.button !== 0) return
    if (e.pointerType === 'touch') {
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    rail.setPointerCapture(e.pointerId)
    dragValue = indexAt(e.clientX)
    rail.focus({ preventScroll: true })
  }
  function move(e: PointerEvent) {
    if (touch && touch.id === e.pointerId && dragValue === null) {
      const dx = Math.abs(e.clientX - touch.x)
      const dy = Math.abs(e.clientY - touch.y)
      if (dy > SLOP && dy > dx) {
        touch = null // a scroll: let the page have it
        return
      }
      if (dx > SLOP && dx >= dy) {
        touch = null
        rail.setPointerCapture(e.pointerId)
        dragValue = indexAt(e.clientX)
      }
      return
    }
    if (dragValue === null) return
    dragValue = indexAt(e.clientX)
  }
  function up(e: PointerEvent) {
    if (touch && touch.id === e.pointerId) {
      // A tap (no drag): pick the stop under the finger.
      touch = null
      commit(indexAt(e.clientX))
      return
    }
    if (dragValue === null) return
    const v = dragValue
    dragValue = null
    commit(v)
  }
  function cancel() {
    touch = null
    dragValue = null
  }
  function key(e: KeyboardEvent) {
    if (inert || steps <= 0) return
    const upKey = e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp'
    const downKey = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown'
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
    let v: number
    if (e.key === 'Home') v = 0
    else if (e.key === 'End') v = steps - 1
    else if (digit >= 0 && digit < steps) v = digit
    else if (value === null && (upKey || downKey)) v = 0
    else if (value !== null && upKey) v = Math.min(steps - 1, value + 1)
    else if (value !== null && downKey) v = Math.max(0, value - 1)
    else return
    e.preventDefault()
    commit(v)
  }
</script>

<div class="fader flanks-{flanks}" class:unknown class:sent={confidence === 'sent' && !unknown} class:flat={inert} class:pending>
  <button
    type="button"
    class="mc-key mc-key--icon flank"
    tabindex="-1"
    aria-label="Lower {label}"
    disabled={disabled || value === null || value <= 0}
    aria-disabled={blocked || undefined}
    onclick={() => value !== null && commit(value - 1)}><Minus size={20} strokeWidth={1.75} /></button
  >
  <div
    bind:this={rail}
    class="rail"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    title={note}
    aria-valuemin={1}
    aria-valuemax={steps}
    aria-valuenow={value === null ? undefined : value + 1}
    aria-valuetext={valueText}
    aria-disabled={inert || undefined}
    aria-describedby={field?.describedBy}
    aria-busy={pending || undefined}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancel}
    onkeydown={key}
  >
    <span class="slot"></span>
    {#if shown !== null}
      <span class="fill" style="width: calc((100% - 32px) * {shown / last})"></span>
    {/if}
    {#each Array.from({ length: steps }, (_, i) => i) as i (i)}
      <span class="det" class:cur={shown === i} style="left: {pos(i)}"><b>{format(i)}</b></span>
    {/each}
    {#if shown !== null}
      <span class="cap" style="left: {pos(shown)}"></span>
    {/if}
  </div>
  <button
    type="button"
    class="mc-key mc-key--icon flank"
    tabindex="-1"
    aria-label="Raise {label}"
    disabled={disabled || value === null || value >= steps - 1}
    aria-disabled={blocked || undefined}
    onclick={() => value !== null && commit(value + 1)}><Plus size={20} strokeWidth={1.75} /></button
  >
  {#if showValue}
    <span class="value" aria-hidden="true">
      {#if shown === null}<span class="mc-dash">–</span>{:else}{format(shown)}{/if}<small>/{steps}</small>
    </span>
  {/if}
</div>

<style>
  .fader {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }
  .flank {
    display: none;
    flex: none;
    width: 46px;
    min-height: 46px;
  }
  .flanks-always .flank {
    display: inline-flex;
  }
  @media (pointer: coarse) {
    .flanks-auto .flank {
      display: inline-flex;
    }
  }
  .rail {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 66px;
    touch-action: pan-y;
    cursor: pointer;
    border-radius: var(--r-key);
    -webkit-tap-highlight-color: transparent;
  }
  .rail:focus-visible {
    outline: none;
  }
  .slot {
    position: absolute;
    left: 16px;
    right: 16px;
    top: 24px;
    height: 6px;
    border-radius: 3px;
    background: var(--chassis-2);
    box-shadow:
      inset 0 1px 2px rgb(0 0 0 / 0.35),
      0 0 0 1px color-mix(in srgb, var(--key-edge) 60%, transparent);
  }
  .fill {
    position: absolute;
    left: 16px;
    top: 24px;
    height: 6px;
    border-radius: 3px;
    background: var(--ink);
    transition: width var(--dur-fast) var(--ease);
  }
  .det {
    position: absolute;
    top: 0;
    width: 32px;
    height: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }
  .det::before {
    content: '';
    width: 1px;
    height: 8px;
    margin-top: 8px;
    background: var(--ink-3);
  }
  .det b {
    position: absolute;
    bottom: 2px;
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-3);
  }
  .det.cur b {
    color: var(--ink);
    font-weight: 750;
  }
  .cap {
    position: absolute;
    top: 9px;
    width: 22px;
    height: 36px;
    transform: translateX(-50%);
    border-radius: var(--r-cap);
    background: var(--key);
    border: 1.5px solid var(--ink);
    box-shadow:
      0 2px 0 var(--key-shadow),
      inset 0 1px 0 var(--key-hi);
    transition: left var(--dur-fast) var(--ease);
    pointer-events: none;
  }
  .cap::after {
    content: '';
    position: absolute;
    left: 3px;
    right: 3px;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    background: var(--ink);
  }
  /* Focus: the ring stands off the cap (or the slot when nothing is known). */
  .rail:focus-visible .cap {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .unknown .rail:focus-visible .slot {
    outline: 2px solid var(--focus);
    outline-offset: 5px;
  }

  /* Sent, not confirmed */
  .sent .cap {
    background: var(--hatch-strong), var(--key);
    border-width: 2px;
  }
  .sent .fill {
    background: repeating-linear-gradient(90deg, var(--ink) 0 4px, transparent 4px 7px);
  }
  /* Unknown */
  .unknown .slot {
    background: transparent;
    box-shadow: none;
    border: 1.5px dashed var(--ink-3);
    top: 23px;
    height: 8px;
  }
  /* Disabled / blocked */
  .flat .rail {
    cursor: not-allowed;
  }
  .flat .fill {
    background: var(--ink-3);
  }
  .flat .cap {
    border-color: var(--ink-3);
    background: var(--chassis-2);
    box-shadow: none;
  }
  .flat .cap::after {
    background: var(--ink-3);
  }
  .flat .det.cur b {
    color: var(--ink-2);
  }
  .pending .fill {
    opacity: 0.55;
  }

  .value {
    flex: none;
    min-width: 3em;
    text-align: right;
    font: 500 var(--t-value) / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .value small {
    font-size: 14px;
    color: var(--ink-3);
    letter-spacing: 0;
  }
  @media (pointer: coarse) {
    .rail {
      height: 70px;
    }
  }
</style>
