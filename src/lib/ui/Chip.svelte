<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
    children: Snippet
  }
  let { tone = 'neutral', children }: Props = $props()
</script>

<span class="chip {tone}">{@render children()}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-2xs);
    line-height: var(--leading-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    white-space: nowrap;
    background: var(--color-surface-3);
    color: var(--color-text-muted);
  }
  .success {
    background: var(--color-success-soft);
    color: var(--color-success);
  }
  .warning {
    background: var(--color-warning-soft);
    color: var(--color-warning);
  }
  .danger {
    background: var(--color-danger-soft);
    color: var(--color-danger);
  }
  .accent {
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
</style>
