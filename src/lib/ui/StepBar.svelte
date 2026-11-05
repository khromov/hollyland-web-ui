<script lang="ts">
  /**
   * A row of N tappable/draggable steps (like the app's VolumeSegmentBar).
   * Value is a 0-based step index. Emits on pointer release, and on keys.
   * An unknown value (null, e.g. write-only mode) can be set from the keyboard too: the arrow
   * keys and Home start at the lowest step, End picks the highest, digits pick a step.
   */
  import { getFieldContext } from './field'

  interface Props {
    steps: number
    value: number | null
    label: string
    disabled?: boolean
    pending?: boolean
    /** Display text for a step index, e.g. i => `${i + 1}`. */
    format?: (i: number) => string
    onchange?: (index: number) => void
  }

  let { steps, value, label, disabled = false, pending = false, format = (i) => `${i + 1}`, onchange }: Props =
    $props()

  const field = getFieldContext()
  let track: HTMLDivElement
  let dragValue: number | null = $state(null)
  const shown = $derived(dragValue ?? value)

  function indexAt(clientX: number): number {
    const r = track.getBoundingClientRect()
    const t = (clientX - r.left) / r.width
    return Math.max(0, Math.min(steps - 1, Math.floor(t * steps)))
  }

  function down(e: PointerEvent) {
    if (disabled) return
    track.setPointerCapture(e.pointerId)
    dragValue = indexAt(e.clientX)
  }
  function move(e: PointerEvent) {
    if (dragValue === null) return
    dragValue = indexAt(e.clientX)
  }
  function up() {
    if (dragValue === null) return
    const v = dragValue
    dragValue = null
    if (v !== value) onchange?.(v)
  }
  function key(e: KeyboardEvent) {
    if (disabled || steps <= 0) return
    let v: number
    const up = e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp'
    const down = e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown'
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
    if (e.key === 'Home') v = 0
    else if (e.key === 'End') v = steps - 1
    else if (digit >= 0 && digit < steps) v = digit
    else if (value === null && (up || down)) v = 0 // unknown: start at the lowest step
    else if (value !== null && up) v = Math.min(steps - 1, value + 1)
    else if (value !== null && down) v = Math.max(0, value - 1)
    else return
    e.preventDefault()
    if (v !== value) onchange?.(v)
  }
</script>

<div class="stepbar" class:disabled class:pending>
  <div
    bind:this={track}
    class="track"
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={1}
    aria-valuemax={steps}
    aria-valuenow={value === null ? undefined : value + 1}
    aria-valuetext={value === null ? 'unknown, use the arrow keys to set it' : `${format(value)} of ${steps}`}
    aria-disabled={disabled || field?.blocked || undefined}
    aria-describedby={field?.describedBy}
    aria-busy={pending || undefined}
    style="--steps: {steps}"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (dragValue = null)}
    onkeydown={key}
  >
    {#each Array.from({ length: steps }, (_, i) => i) as i (i)}
      <span class="step" class:on={shown !== null && i <= shown} style="--h: {0.45 + (0.55 * (i + 1)) / steps}"></span>
    {/each}
  </div>
  <span class="value readout" aria-hidden="true">{shown === null ? '--' : format(shown)}<small>/{steps}</small></span>
</div>

<style>
  .stepbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
  }
  .track {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(var(--steps), 1fr);
    align-items: end;
    gap: 4px;
    height: var(--control-h-md);
    padding: 4px 0;
    touch-action: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .step {
    height: calc(var(--h) * 100%);
    border-radius: var(--radius-xs);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-control);
    transition: background-color var(--dur-fast) var(--ease-standard);
  }
  .step.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .disabled .track {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .pending .step.on {
    background: color-mix(in oklab, var(--color-accent) 60%, transparent);
  }
  .value {
    min-width: 3.2em;
    text-align: right;
    font-weight: var(--weight-medium);
    font-size: var(--text-lg);
  }
  .value small {
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
    font-weight: var(--weight-regular);
  }
  @media (pointer: coarse) {
    .track {
      height: var(--control-h-lg);
    }
  }
</style>
