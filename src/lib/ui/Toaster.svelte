<script lang="ts">
  import { CircleCheck, CircleAlert, Info, TriangleAlert, X } from '@lucide/svelte'
  import { toasts } from './toast.svelte'

  const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info }
</script>

<!-- One live region for all toasts (no per-toast roles, so nothing is announced twice). -->
<div class="toaster" aria-live="polite" aria-relevant="additions">
  {#each toasts.items as t (t.id)}
    {@const Icon = icons[t.kind]}
    <!-- Hover / focus only pause the auto-dismiss timer; the toast itself is not a control. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="toast {t.kind}"
      onpointerenter={() => toasts.pause(t.id)}
      onpointerleave={() => toasts.resume(t.id)}
      onfocusin={() => toasts.pause(t.id)}
      onfocusout={() => toasts.resume(t.id)}
    >
      <Icon size={18} aria-hidden="true" />
      <span class="msg"
        >{#if t.kind === 'error'}<span class="visually-hidden">Error: </span>{:else if t.kind === 'warning'}<span
            class="visually-hidden">Warning: </span
          >{/if}{t.message}</span
      >
      {#if t.action}
        <button
          type="button"
          class="action"
          onclick={() => {
            t.action?.run()
            toasts.dismiss(t.id)
          }}>{t.action.label}</button
        >
      {/if}
      <button type="button" class="close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
        <X size={16} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    z-index: var(--z-toast);
    right: var(--gutter);
    bottom: calc(var(--gutter) + env(safe-area-inset-bottom));
    display: grid;
    gap: var(--space-2);
    width: min(380px, calc(100vw - 2 * var(--gutter)));
    pointer-events: none;
  }
  @media (max-width: 1023px) {
    .toaster {
      bottom: calc(var(--tabbar-h) + var(--space-3) + env(safe-area-inset-bottom));
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-2);
    animation: rise var(--dur-base) var(--ease-enter);
  }
  .success :global(svg:first-child) {
    color: var(--color-success);
  }
  .error :global(svg:first-child) {
    color: var(--color-danger);
  }
  .warning :global(svg:first-child) {
    color: var(--color-warning);
  }
  .info :global(svg:first-child) {
    color: var(--color-accent);
  }
  .msg {
    flex: 1;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .action {
    flex: none;
    min-height: 44px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-accent);
    font-weight: var(--weight-semibold);
    font-size: var(--text-sm);
    padding: 0 10px;
    margin: -6px 0;
  }
  .action:hover {
    background: var(--color-surface-3);
  }
  .close {
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--color-text-subtle);
    width: 44px;
    height: 44px;
    margin: -8px -6px -8px -8px;
    border-radius: var(--radius-sm);
  }
  .close:hover {
    background: var(--color-surface-3);
    color: var(--color-text);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
