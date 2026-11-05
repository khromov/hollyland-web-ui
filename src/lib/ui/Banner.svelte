<script lang="ts">
  import type { Snippet } from 'svelte'
  import { CircleAlert, Info, TriangleAlert, CircleCheck } from '@lucide/svelte'

  interface Props {
    tone?: 'info' | 'success' | 'warning' | 'danger'
    title?: string
    children?: Snippet
    actions?: Snippet
  }
  let { tone = 'info', title, children, actions }: Props = $props()
  const Icon = $derived({ info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }[tone])
</script>

<div class="banner {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
  <Icon size={20} aria-hidden="true" />
  <div class="content">
    {#if title}<div class="title">{title}</div>{/if}
    {#if children}<div class="text">{@render children()}</div>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--tone-border);
    background: var(--tone-bg);
  }
  .banner > :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--tone-fg);
  }
  .info {
    --tone-fg: var(--color-accent);
    --tone-bg: var(--color-accent-soft);
    --tone-border: color-mix(in oklab, var(--color-accent) 35%, transparent);
  }
  .success {
    --tone-fg: var(--color-success);
    --tone-bg: var(--color-success-soft);
    --tone-border: color-mix(in oklab, var(--color-success) 35%, transparent);
  }
  .warning {
    --tone-fg: var(--color-warning);
    --tone-bg: var(--color-warning-soft);
    --tone-border: color-mix(in oklab, var(--color-warning) 35%, transparent);
  }
  .danger {
    --tone-fg: var(--color-danger);
    --tone-bg: var(--color-danger-soft);
    --tone-border: color-mix(in oklab, var(--color-danger) 35%, transparent);
  }
  .content {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-weight: var(--weight-semibold);
    color: var(--color-text);
  }
  .text {
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-muted);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    flex-wrap: wrap;
  }
  @media (max-width: 559px) {
    .banner {
      flex-wrap: wrap;
    }
    .actions {
      width: 100%;
      padding-left: 32px;
    }
  }
</style>
