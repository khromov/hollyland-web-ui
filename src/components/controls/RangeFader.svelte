<script lang="ts">
  /**
   * Fader for a range with many stops (gain in dB, NC depth, monitoring volume): the detent
   * Fader's slot, fill and cap, with labelled ends (and 0 on a range that crosses it) instead of
   * a numbered stop each. A line above the rail carries an optional caption (left) and the value
   * ("+4 dB", right); `showValue={false}` when the module head prints the value instead.
   * - Keyboard: one role="slider"; arrows step, PageUp / PageDown move a tenth of the range,
   *   Home / End jump to the ends.
   * - Pointer: press or drag anywhere; it snaps to the nearest stop and sends on release. A
   *   finger moves it only with a mostly horizontal drag (a vertical swipe scrolls the page).
   * - Touch (pointer: coarse): −/+ keys flank it.
   * - bipolar (the range crosses 0): the fill runs from 0 to the value.
   * - confidence 'sent': hatched cap, dashed fill; 'unknown' / value null: no cap, dashed slot, "–".
   * `value` and `onchange` use raw (wire) units; `offset` turns them into display units.
   */
  import { Minus, Plus } from '@lucide/svelte'
  import type { Confidence } from '../../lib/ui/types'
  import { getFieldContext } from '../../lib/ui/field'
  import { confidenceNote } from '../../lib/ui/confidence'
  import { formatNumber } from './controls'

  interface Props {
    min: number
    max: number
    step?: number
    /** Raw value, or null when unknown. */
    value: number | null
    /** Added to raw values for display. */
    offset?: number
    unit?: string
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    sentAt?: number | Date | null
    /** −/+ keys: on touch screens only (auto), always, or never. */
    flanks?: 'auto' | 'always' | 'never'
    /** 'sm': a lower rail for compact rows (mic modules). */
    size?: 'lg' | 'sm'
    /** Words left of the value above the rail ("Level 1", "Mic Gain"). */
    caption?: string
    /** Print the value above the rail (false when the module head shows it). */
    showValue?: boolean
    onchange?: (raw: number) => void
  }

  let {
    min,
    max,
    step = 1,
    value,
    offset = 0,
    unit = '',
    label,
    disabled = false,
    pending = false,
    confidence = 'solid',
    sentAt = null,
    flanks = 'auto',
    size = 'lg',
    caption,
    showValue = true,
    onchange,
  }: Props = $props()

  const field = getFieldContext()
  const blocked = $derived(field?.blocked ?? false)
  const inert = $derived(disabled || blocked)
  let rail: HTMLDivElement
  let dragValue: number | null = $state(null)
  const unknown = $derived(value === null || confidence === 'unknown')
  const shown = $derived(dragValue ?? (unknown ? null : value))
  const span = $derived(Math.max(step, max - min))
  const bipolar = $derived(min + offset < 0 && max + offset > 0)
  const signed = $derived(bipolar)
  /** Raw value at display 0 (bipolar ranges), where the fill starts. */
  const zero = $derived(bipolar ? -offset : min)
  const frac = (raw: number) => Math.max(0, Math.min(1, (raw - min) / span))
  const pos = (raw: number) => `calc(16px + (100% - 32px) * ${frac(raw)})`
  const fmt = (raw: number) => formatNumber(raw + offset, signed)

  const ends = $derived(bipolar ? [min, zero, max] : [min, max])
  const ticks = $derived([0, 0.25, 0.5, 0.75, 1].map((t) => min + t * span))

  const note = $derived(unknown ? 'Unknown' : confidenceNote(confidence, sentAt))
  const valueText = $derived(
    unknown || value === null ? 'Unknown' : `${fmt(value)}${unit ? ` ${unit}` : ''}${note ? `, ${note}` : ''}`,
  )

  function snap(raw: number): number {
    const k = Math.round((raw - min) / step)
    return Math.max(min, Math.min(max, min + k * step))
  }
  function commit(v: number) {
    if (inert) return
    const s = snap(v)
    if (s !== value || confidence !== 'solid') onchange?.(s)
  }
  function rawAt(clientX: number): number {
    const r = rail.getBoundingClientRect()
    const t = (clientX - r.left - 16) / Math.max(1, r.width - 32)
    return snap(min + Math.max(0, Math.min(1, t)) * span)
  }

  let touch: { id: number; x: number; y: number } | null = null
  const SLOP = 8
  function down(e: PointerEvent) {
    if (inert || e.button !== 0) return
    if (e.pointerType === 'touch') {
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    rail.setPointerCapture(e.pointerId)
    dragValue = rawAt(e.clientX)
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
        dragValue = rawAt(e.clientX)
      }
      return
    }
    if (dragValue === null) return
    dragValue = rawAt(e.clientX)
  }
  function up(e: PointerEvent) {
    if (touch && touch.id === e.pointerId) {
      touch = null
      commit(rawAt(e.clientX))
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
    if (inert) return
    const big = Math.max(step, snap(min + span / 10) - min)
    const base = value ?? zero
    let v: number
    if (e.key === 'Home') v = min
    else if (e.key === 'End') v = max
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value === null ? zero : base + step
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value === null ? zero : base - step
    else if (e.key === 'PageUp') v = base + big
    else if (e.key === 'PageDown') v = base - big
    else return
    e.preventDefault()
    commit(v)
  }
</script>

<div class="rf flanks-{flanks} size-{size}" class:unknown class:sent={confidence === 'sent' && !unknown} class:flat={inert} class:pending>
  {#if caption || showValue}
    <div class="top">
      {#if caption}<span class="caption">{caption}</span>{/if}
      {#if showValue}
        <span class="value" aria-hidden="true">
          {#if shown === null}<span class="mc-dash">–</span>{:else}{fmt(shown)}{#if unit}<small>{unit}</small>{/if}{/if}
        </span>
      {/if}
    </div>
  {/if}
  <div class="row">
    <button
      type="button"
      class="mc-key mc-key--icon flank"
      tabindex="-1"
      aria-label="Lower {label}"
      disabled={disabled || value === null || value <= min}
      aria-disabled={blocked || undefined}
      onclick={() => value !== null && commit(value - step)}><Minus size={20} strokeWidth={1.75} /></button
    >
    <div
      bind:this={rail}
      class="rail"
      role="slider"
      tabindex={disabled ? -1 : 0}
      aria-label={label}
      title={note}
      aria-valuemin={min + offset}
      aria-valuemax={max + offset}
      aria-valuenow={value === null ? undefined : value + offset}
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
      {#each ticks as t, i (i)}
        <span class="tick" style="left: {pos(t)}"></span>
      {/each}
      {#if shown !== null}
        {@const a = Math.min(frac(zero), frac(shown))}
        {@const b = Math.max(frac(zero), frac(shown))}
        <span class="fill" style="left: calc(16px + (100% - 32px) * {a}); width: calc((100% - 32px) * {b - a})"></span>
      {/if}
      {#each ends as e (e)}
        <span class="end" class:first={e === min} class:last={e === max} style="left: {pos(e)}">{fmt(e)}</span>
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
      aria-disabled={blocked || undefined}
      onclick={() => value !== null && commit(value + step)}><Plus size={20} strokeWidth={1.75} /></button
    >
  </div>
</div>

<style>
  .rf {
    display: grid;
    gap: 2px;
    width: 100%;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }
  .caption {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
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
    height: 66px;
    touch-action: pan-y;
    cursor: pointer;
    border-radius: var(--r-key);
    -webkit-tap-highlight-color: transparent;
  }
  .size-sm .rail {
    height: 56px;
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
  .size-sm .slot,
  .size-sm .fill {
    top: 19px;
  }
  .tick {
    position: absolute;
    top: 8px;
    width: 1px;
    height: 8px;
    background: var(--ink-3);
    transform: translateX(-50%);
    pointer-events: none;
  }
  .size-sm .tick {
    top: 5px;
    height: 6px;
  }
  .fill {
    position: absolute;
    top: 24px;
    height: 6px;
    border-radius: 3px;
    background: var(--ink);
    transition:
      width var(--dur-fast) var(--ease),
      left var(--dur-fast) var(--ease);
  }
  .end {
    position: absolute;
    bottom: 2px;
    transform: translateX(-50%);
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-3);
    white-space: nowrap;
    pointer-events: none;
  }
  /* The end labels stay inside the rail. */
  .end.first {
    transform: translateX(-16px);
  }
  .end.last {
    transform: translateX(calc(-100% + 16px));
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
  .size-sm .cap {
    top: 6px;
    height: 32px;
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
    top: 23px;
    height: 8px;
  }
  .size-sm.unknown .slot {
    top: 18px;
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
  .value {
    flex: none;
    margin-left: auto;
    font: 500 18px / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .size-sm .value {
    font-size: 15px;
  }
  .value small {
    margin-left: 3px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .flat .value {
    color: var(--ink-2);
  }
  @media (pointer: coarse) {
    .rail {
      height: 70px;
    }
  }
</style>
