<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline'
    size?: 'sm' | 'md' | 'lg'
    loading?: boolean
    block?: boolean
    icon?: Snippet
    children?: Snippet
  }

  let {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    children,
    disabled,
    type = 'button',
    class: klass = '',
    ...rest
  }: Props = $props()
</script>

<button
  {...rest}
  {type}
  class="btn {variant} {size} {klass}"
  class:block
  class:loading
  disabled={disabled || loading}
  aria-busy={loading || undefined}
>
  {#if loading}
    <span class="spinner" aria-hidden="true"></span>
  {:else if icon}
    <span class="icon" aria-hidden="true">{@render icon()}</span>
  {/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
</button>

<style>
  .btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: var(--control-h-md);
    padding: 0 var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font-weight: var(--weight-medium);
    font-size: var(--text-md);
    line-height: 1;
    white-space: nowrap;
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard),
      color var(--dur-fast) var(--ease-standard),
      transform var(--dur-instant) var(--ease-standard);
    -webkit-tap-highlight-color: transparent;
  }
  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .btn.loading:disabled {
    opacity: 0.8;
  }
  .sm {
    min-height: var(--control-h-sm);
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    border-radius: var(--radius-sm);
  }
  .lg {
    min-height: var(--control-h-lg);
    padding: 0 var(--space-6);
    font-size: var(--text-lg);
  }
  .block {
    display: flex;
    width: 100%;
  }
  /* Touch: small and medium buttons grow to the touch-target minimum. */
  @media (pointer: coarse) {
    .sm,
    .md {
      min-height: var(--hit-min);
    }
  }

  .primary {
    background: var(--color-accent);
    color: var(--color-on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }
  .secondary {
    background: var(--color-surface-3);
    color: var(--color-text);
    border-color: var(--color-border);
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: color-mix(in oklab, var(--color-surface-3) 80%, var(--color-text) 6%);
  }
  .ghost {
    background: transparent;
    color: var(--color-text-muted);
  }
  .ghost:hover:not(:disabled) {
    background: var(--color-surface-3);
    color: var(--color-text);
  }
  .danger {
    background: var(--color-danger);
    color: var(--color-on-danger);
  }
  .danger:hover:not(:disabled) {
    background: color-mix(in oklab, var(--color-danger) 88%, white 12%);
  }
  .danger-outline {
    background: transparent;
    color: var(--color-danger);
    border-color: color-mix(in oklab, var(--color-danger) 55%, transparent);
  }
  .danger-outline:hover:not(:disabled) {
    background: var(--color-danger-soft);
  }

  .icon {
    display: inline-flex;
    width: 18px;
    height: 18px;
  }
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
  .spinner {
    width: 16px;
    height: 16px;
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
</style>
