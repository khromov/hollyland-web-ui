<script lang="ts" generics="T extends string | number">
  /**
   * A row (or bank) of separate keys with a 6 px gap, one of which is chosen.
   * role="radiogroup": arrow keys move and choose, Home/End jump to the ends.
   *
   * The chosen key shows how much is known about it (`confidence`):
   * - solid: inverted, pressed in (read back from the receiver)
   * - sent: 2 px ink outline over a hatch (last sent from this browser, not confirmed)
   * - unknown: nothing is chosen (value={null}): every key is dashed, still operable
   * Disabled (or blocked through a Blockable / SettingRow field) keys go flat; put the reason
   * next to the group (ConfidenceNote kind="disabled" or the row's disabledReason).
   */
  import type { Snippet } from 'svelte'
  import type { Confidence, KeyOption } from './types'
  import { getFieldContext } from './field'
  import RoutingGlyph from './RoutingGlyph.svelte'

  interface Props {
    options: KeyOption<T>[]
    value: T | null
    label: string
    disabled?: boolean
    confidence?: Confidence
    /** Value being written: a spinner shows in that key. */
    pendingValue?: T | null
    size?: 'sm' | 'md' | 'lg' | 'tall'
    /** Number of columns; defaults to one row with every option. */
    columns?: number
    /** Custom key content (e.g. preset number, name and curve). */
    item?: Snippet<[KeyOption<T>, boolean]>
    id?: string
    onchange?: (value: T) => void
  }

  let {
    options,
    value,
    label,
    disabled = false,
    confidence = 'solid',
    pendingValue = null,
    size = 'md',
    columns,
    item,
    id,
    onchange,
  }: Props = $props()

  const field = getFieldContext()
  const blocked = $derived(field?.blocked ?? false)
  let buttons: HTMLButtonElement[] = $state([])
  const selectedIndex = $derived(options.findIndex((o) => o.value === value))
  const firstEnabled = $derived(options.findIndex((o) => !o.disabled))
  let width = $state(0)
  // Four keys in a narrow module go 2 × 2 rather than truncating their legends.
  const cols = $derived(columns ?? (options.length === 4 && width > 0 && width < 272 ? 2 : options.length))
  const tall = $derived(size === 'tall' || options.some((o) => o.glyph))

  function choose(i: number) {
    const o = options[i]
    if (!o || o.disabled || disabled) return
    if (o.value !== value || confidence !== 'solid') onchange?.(o.value)
  }

  function onkeydown(e: KeyboardEvent, i: number) {
    const enabled = options.map((o, idx) => (!o.disabled ? idx : -1)).filter((x) => x >= 0)
    if (!enabled.length) return
    const pos = Math.max(0, enabled.indexOf(i))
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(pos + 1) % enabled.length]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(pos - 1 + enabled.length) % enabled.length]
    else if (e.key === 'Home') next = enabled[0]
    else if (e.key === 'End') next = enabled[enabled.length - 1]
    if (next >= 0) {
      e.preventDefault()
      buttons[next]?.focus()
      if (!blocked) choose(next)
    }
  }
</script>

<div
  {id}
  bind:clientWidth={width}
  class="keys"
  class:tall
  role="radiogroup"
  aria-label={label}
  aria-describedby={field?.describedBy}
  aria-disabled={disabled || blocked || undefined}
  style="--cols: {cols}"
>
  {#each options as o, i (o.value)}
    {@const on = o.value === value}
    <button
      bind:this={buttons[i]}
      type="button"
      role="radio"
      aria-checked={on}
      tabindex={on || (selectedIndex < 0 && i === firstEnabled) ? 0 : -1}
      disabled={disabled || o.disabled}
      aria-disabled={blocked || undefined}
      title={o.hint}
      class="mc-key {size === 'sm' ? 'mc-key--sm' : size === 'lg' ? 'mc-key--lg' : ''} {tall ? 'mc-key--tall' : ''}"
      class:is-selected={on && confidence === 'solid'}
      class:is-sent={on && confidence === 'sent'}
      class:is-unknown={confidence === 'unknown' && !disabled && !blocked && !o.disabled}
      onclick={() => choose(i)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      {#if item}
        {@render item(o, on)}
      {:else}
        {#if o.glyph}<RoutingGlyph mode={o.glyph} />{/if}
        <span class="text">
          {#if pendingValue !== null && pendingValue === o.value}
            <span class="mc-spinner" aria-hidden="true"></span>
            <span class="visually-hidden">Applying</span>
          {/if}
          <span class="label">{o.label}</span>
        </span>
        {#if o.sub}<span class="sub">{o.sub}</span>{/if}
      {/if}
    </button>
  {/each}
</div>

<style>
  .keys {
    display: grid;
    /* Equal keys, but never narrower than their legend (a truncated legend is unreadable). */
    grid-template-columns: repeat(var(--cols), minmax(min-content, 1fr));
    gap: var(--s-1-5);
    min-width: 0;
  }
  .mc-key {
    min-width: 0;
    padding-inline: 7px;
  }
  .mc-key.is-sent {
    padding-inline: 6px;
  }
  .text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: inherit;
    opacity: 0.8;
  }
  .mc-spinner {
    width: 12px;
    height: 12px;
  }
</style>
