<script lang="ts">
  /**
   * A hardware key. Raised at rest, sinks when pressed or selected.
   * - `selected`: a latching key (renders aria-pressed); pressed in and backlit (solid)
   * - `confidence`: 'sent' (2 px outline over a hatch) or 'unknown' (dashed) for write-only state
   * - `disabled` or a blocked field: flat recessed face. Blocked keys stay focusable.
   * Use KeyGroup for a set of mutually exclusive keys (radiogroup with arrow keys).
   */
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import type { Confidence } from './types'
  import { getFieldContext } from './field'

  interface Props extends HTMLButtonAttributes {
    variant?: 'default' | 'primary' | 'quiet' | 'danger' | 'danger-outline' | 'light'
    size?: 'sm' | 'md' | 'lg' | 'tall' | 'icon'
    /** Latching key state; omit for a momentary key. */
    selected?: boolean
    confidence?: Confidence
    loading?: boolean
    block?: boolean
    icon?: Snippet
    children?: Snippet
  }

  let {
    variant = 'default',
    size = 'md',
    selected,
    confidence = 'solid',
    loading = false,
    block = false,
    icon,
    children,
    disabled,
    type = 'button',
    class: klass = '',
    ...rest
  }: Props = $props()

  const field = getFieldContext()
  const blocked = $derived(field?.blocked ?? false)
</script>

<button
  aria-describedby={field?.describedBy}
  {...rest}
  {type}
  class="mc-key {variant !== 'default' ? `mc-key--${variant}` : ''} {size !== 'md' ? `mc-key--${size}` : ''} {klass}"
  class:mc-key--block={block}
  class:is-selected={selected === true && confidence === 'solid'}
  class:is-sent={confidence === 'sent' && selected !== false}
  class:is-unknown={confidence === 'unknown'}
  aria-pressed={selected === undefined ? undefined : selected}
  aria-disabled={blocked || undefined}
  disabled={disabled || loading}
  aria-busy={loading || undefined}
>
  {#if loading}
    <span class="mc-spinner" aria-hidden="true"></span>
  {:else if icon}
    <span class="icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
</button>

<style>
  .icon {
    display: inline-flex;
    width: 18px;
    height: 18px;
    flex: none;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
