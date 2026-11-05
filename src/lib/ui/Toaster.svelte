<script lang="ts">
  /**
   * Toasts as small dark display windows with a lamp: success green, error red, warning hollow,
   * info none. They sit above the status line (desktop) or the tab bar (phone); the shell can
   * move them with --toast-offset.
   */
  import { X } from '@lucide/svelte'
  import { toasts } from './toast.svelte'
  import Lamp from './Lamp.svelte'
</script>

<!-- One live region for all toasts (no per-toast roles, so nothing is announced twice). -->
<div class="toaster" aria-live="polite" aria-relevant="additions">
  {#each toasts.items as t (t.id)}
    <!-- Hover / focus only pause the auto-dismiss timer; the toast itself is not a control. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="mc-window toast {t.kind}"
      onpointerenter={() => toasts.pause(t.id)}
      onpointerleave={() => toasts.resume(t.id)}
      onfocusin={() => toasts.pause(t.id)}
      onfocusout={() => toasts.resume(t.id)}
    >
      <span class="mark" aria-hidden="true">
        {#if t.kind === 'success'}<Lamp color="live" size="sm" />{:else if t.kind === 'error'}<Lamp
            color="rec"
            size="sm"
          />{:else if t.kind === 'warning'}<Lamp state="hollow" size="sm" />{:else}<Lamp
            color="neutral"
            state="off"
            size="sm"
          />{/if}
      </span>
      <span class="msg"
        >{#if t.kind === 'error'}<span class="visually-hidden">Error: </span>{:else if t.kind === 'warning'}<span
            class="visually-hidden">Warning: </span
          >{/if}{t.message}</span
      >
      {#if t.action}
        <button
          type="button"
          class="mc-key mc-key--sm action"
          onclick={() => {
            t.action?.run()
            toasts.dismiss(t.id)
          }}>{t.action.label}</button
        >
      {/if}
      <button type="button" class="mc-key mc-key--quiet mc-key--icon close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
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
    bottom: calc(var(--toast-offset, calc(var(--status-h) + 12px)) + env(safe-area-inset-bottom));
    display: grid;
    gap: 8px;
    width: min(400px, calc(100vw - 2 * var(--gutter)));
    pointer-events: none;
  }
  @media (max-width: 1023px) {
    .toaster {
      bottom: calc(var(--toast-offset, calc(var(--tabbar-h) + 12px)) + env(safe-area-inset-bottom));
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 4px 4px 4px 14px;
    animation: rise var(--dur-base) var(--ease-enter, ease-out);
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
  }
  .msg {
    flex: 1;
    padding: 8px 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--w-ink);
  }
  .action {
    flex: none;
  }
  .close {
    flex: none;
    color: var(--w-ink-2);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
