<script lang="ts" generics="T extends string | number">
  import type { SegmentOption } from './types'
  import { getFieldContext } from './field'

  interface Props {
    options: SegmentOption<T>[]
    value: T | null
    label: string
    disabled?: boolean
    /** Value currently being written; shows a spinner in that segment. */
    pendingValue?: T | null
    size?: 'sm' | 'md' | 'lg'
    onchange?: (value: T) => void
  }

  let { options, value, label, disabled = false, pendingValue = null, size = 'md', onchange }: Props = $props()

  const field = getFieldContext()
  let buttons: HTMLButtonElement[] = $state([])
  const selectedIndex = $derived(options.findIndex((o) => o.value === value))

  function choose(i: number) {
    const o = options[i]
    if (!o || o.disabled || disabled) return
    if (o.value !== value) onchange?.(o.value)
  }

  function onkeydown(e: KeyboardEvent, i: number) {
    const enabled = options.map((o, idx) => (!o.disabled ? idx : -1)).filter((x) => x >= 0)
    const pos = enabled.indexOf(i)
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next >= 0) {
      e.preventDefault()
      buttons[next]?.focus()
      choose(next)
    }
  }
</script>

<div
  class="seg {size}"
  class:disabled
  class:unset={selectedIndex < 0}
  role="radiogroup"
  aria-label={label}
  aria-describedby={field?.describedBy}
  aria-disabled={disabled || field?.blocked || undefined}
  style="--count: {options.length}; --index: {Math.max(selectedIndex, 0)}"
>
  {#if selectedIndex >= 0}
    <span class="pill" aria-hidden="true"></span>
  {/if}
  {#each options as o, i (o.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={o.value === value}
      tabindex={o.value === value || (selectedIndex < 0 && i === 0) ? 0 : -1}
      disabled={disabled || o.disabled}
      title={o.hint}
      class:selected={o.value === value}
      onclick={() => choose(i)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      {#if pendingValue !== null && pendingValue === o.value}
        <span class="spinner" aria-hidden="true"></span>
        <span class="visually-hidden">Applying</span>
      {/if}
      <span class="text">{o.label}</span>
    </button>
  {/each}
</div>

<style>
  .seg {
    --pad: 3px;
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--count), minmax(0, 1fr));
    padding: var(--pad);
    gap: 0;
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    isolation: isolate;
    min-height: var(--control-h-md);
  }
  /* Nothing selected (e.g. a value this system can't read): outline the segments so the
     choices still read as buttons, not as plain text (WCAG 1.4.11). */
  .seg.unset {
    border-color: var(--color-border-control);
  }
  .unset button + button {
    box-shadow: -1px 0 0 0 var(--color-border-control);
  }
  .sm {
    min-height: var(--control-h-sm);
  }
  .lg {
    min-height: var(--control-h-lg);
  }
  .pill {
    position: absolute;
    z-index: -1;
    top: var(--pad);
    bottom: var(--pad);
    left: var(--pad);
    width: calc((100% - 2 * var(--pad)) / var(--count));
    transform: translateX(calc(100% * var(--index)));
    background: var(--color-surface-1);
    border-radius: calc(var(--radius-md) - 3px);
    box-shadow: var(--shadow-1);
    border: 1px solid var(--color-border-control);
    transition: transform var(--dur-fast) var(--ease-standard);
  }
  :global([data-theme='light']) .pill {
    background: var(--color-surface-1);
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
    padding: 0 var(--space-2);
    background: transparent;
    border: 0;
    border-radius: calc(var(--radius-md) - 3px);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    transition: color var(--dur-fast) var(--ease-standard);
    -webkit-tap-highlight-color: transparent;
  }
  .lg button {
    font-size: var(--text-md);
  }
  button:hover:not(:disabled) {
    color: var(--color-text);
  }
  button.selected {
    color: var(--color-text);
  }
  button:disabled {
    color: var(--color-text-disabled);
  }
  .disabled .pill {
    opacity: 0.5;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spinner {
    flex: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Touch: every segment itself is a 44 px target, not just the track around it. */
  @media (pointer: coarse) {
    .seg {
      --pad: 2px;
      min-height: 0;
    }
    button {
      min-height: 44px;
    }
  }
</style>
