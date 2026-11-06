<script lang="ts">
  /**
   * A fader for a range with many stops (dB gains, NC depth, mixer levels): the detent Fader's
   * recessed slot, ink fill and mixer cap, with scale marks only at a few values instead of a
   * numbered detent per stop.
   * - Keyboard: one role="slider"; arrows step, PageUp / PageDown move a tenth of the range,
   *   Home / End jump to the ends.
   * - Pointer: press or drag anywhere; it snaps to the nearest stop and sends on release. A finger
   *   only moves it with a tap or a mostly horizontal drag (a vertical swipe scrolls the page).
   * - Touch (pointer: coarse) or flanks="always": −/+ keys flank the slider.
   * - confidence 'sent': hatched cap, dashed fill; 'unknown' / value null: no cap, dashed slot.
   * `value` is the raw control value; `format` turns it into the printed one.
   */
  import { Minus, Plus } from '@lucide/svelte'
  import type { Confidence } from '../../lib/ui/types'
  import { confidenceNote } from '../../lib/ui/confidence'

  interface Props {
    min: number
    max: number
    step?: number
    value: number | null
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    sentAt?: number | Date | null
    /** Raw values to mark on the scale (default: the ends). */
    marks?: readonly number[]
    /** Raw value the ink fill starts from (a gain's 0 dB); default the minimum. */
    origin?: number
    flanks?: 'auto' | 'always' | 'never'
    format?: (raw: number) => string
    onchange?: (raw: number) => void
  }

  let {
    min,
    max,
    step = 1,
    value,
    label,
    disabled = false,
    pending = false,
    confidence = 'solid',
    sentAt = null,
    marks,
    origin,
    flanks = 'auto',
    format = (v) => String(v),
    onchange,
  }: Props = $props()

  let rail: HTMLDivElement
  let dragValue: number | null = $state(null)
  const unknown = $derived(value === null || confidence === 'unknown')
  const shown = $derived(dragValue ?? (unknown ? null : value))
  const span = $derived(Math.max(step, max - min))
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / span))
  const pos = (v: number) => `calc(16px + (100% - 32px) * ${frac(v)})`
  const note = $derived(unknown ? 'Unknown' : confidenceNote(confidence, sentAt))
  const valueText = $derived(unknown || value === null ? 'Unknown' : `${format(value)}${note ? `, ${note}` : ''}`)
  const scale = $derived(marks ?? [min, max])
  const from = $derived(origin !== undefined && origin > min && origin < max ? origin : min)

  function snap(v: number): number {
    const s = Math.round((v - min) / step) * step + min
    return Math.max(min, Math.min(max, Number(s.toFixed(6))))
  }
  function commit(v: number) {
    if (disabled) return
    const s = snap(v)
    if (s !== value || confidence !== 'solid') onchange?.(s)
  }
  function valueAt(clientX: number): number {
    const r = rail.getBoundingClientRect()
    const t = (clientX - r.left - 16) / Math.max(1, r.width - 32)
    return snap(min + Math.max(0, Math.min(1, t)) * span)
  }

  let touch: { id: number; x: number; y: number } | null = null
  const SLOP = 8
  function down(e: PointerEvent) {
    if (disabled || e.button !== 0) return
    if (e.pointerType === 'touch') {
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    rail.setPointerCapture(e.pointerId)
    dragValue = valueAt(e.clientX)
    rail.focus({ preventScroll: true })
  }
  function move(e: PointerEvent) {
    if (touch && touch.id === e.pointerId && dragValue === null) {
      const dx = Math.abs(e.clientX - touch.x)
      const dy = Math.abs(e.clientY - touch.y)
      if (dy > SLOP && dy > dx) {
        touch = null
        return
      }
      if (dx > SLOP && dx >= dy) {
        touch = null
        rail.setPointerCapture(e.pointerId)
        dragValue = valueAt(e.clientX)
      }
      return
    }
    if (dragValue === null) return
    dragValue = valueAt(e.clientX)
  }
  function up(e: PointerEvent) {
    if (touch && touch.id === e.pointerId) {
      touch = null
      commit(valueAt(e.clientX))
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
    if (disabled) return
    const big = Math.max(step, snap(min + span / 10) - min)
    const base = value ?? min
    let v: number
    if (e.key === 'Home') v = min
    else if (e.key === 'End') v = max
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value === null ? min : base + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value === null ? min : base - step
    else if (e.key === 'PageUp') v = base + big
    else if (e.key === 'PageDown') v = base - big
    else return
    e.preventDefault()
    commit(v)
  }
</script>

<div class="slider flanks-{flanks}" class:unknown class:sent={confidence === 'sent' && !unknown} class:flat={disabled} class:pending>
  <button
    type="button"
    class="mc-key mc-key--icon flank"
    tabindex="-1"
    aria-label="Lower {label}"
    disabled={disabled || value === null || value <= min}
    onclick={() => value !== null && commit(value - step)}><Minus size={20} strokeWidth={1.75} /></button
  >
  <div
    bind:this={rail}
    class="rail"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    title={note}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value ?? undefined}
    aria-valuetext={valueText}
    aria-disabled={disabled || undefined}
    aria-busy={pending || undefined}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={cancel}
    onkeydown={key}
  >
    <span class="slot"></span>
    {#if shown !== null}
      <span
        class="fill"
        style="left: {pos(Math.min(from, shown))}; width: calc((100% - 32px) * {Math.abs(frac(shown) - frac(from))})"
      ></span>
    {/if}
    {#each scale as m (m)}
      <span class="mark" style="left: {pos(m)}"><b>{format(m)}</b></span>
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
    disabled={disabled || value === null || value >= max}
    onclick={() => value !== null && commit(value + step)}><Plus size={20} strokeWidth={1.75} /></button
  >
</div>

<style>
  .slider {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
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
    height: 58px;
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
    top: 20px;
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
    top: 20px;
    height: 6px;
    border-radius: 3px;
    background: var(--ink);
    transition: width var(--dur-fast) var(--ease);
  }
  .mark {
    position: absolute;
    top: 0;
    width: 48px;
    height: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }
  .mark::before {
    content: '';
    width: 1px;
    height: 6px;
    margin-top: 6px;
    background: var(--ink-3);
  }
  .mark b {
    position: absolute;
    bottom: 1px;
    font: 500 11px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-3);
    white-space: nowrap;
  }
  .cap {
    position: absolute;
    top: 5px;
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
  .rail:focus-visible .cap {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .unknown .rail:focus-visible .slot {
    outline: 2px solid var(--focus);
    outline-offset: 5px;
  }
  .sent .cap {
    background: var(--hatch-strong), var(--key);
    border-width: 2px;
  }
  .sent .fill {
    background: repeating-linear-gradient(90deg, var(--ink) 0 4px, transparent 4px 7px);
  }
  .unknown .slot {
    background: transparent;
    box-shadow: none;
    border: 1.5px dashed var(--ink-3);
    top: 19px;
    height: 8px;
  }
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
  .pending .fill {
    opacity: 0.55;
  }
  @media (pointer: coarse) {
    .rail {
      height: 62px;
    }
  }
</style>
