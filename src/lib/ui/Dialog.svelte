<script lang="ts">
  /**
   * Modal dialog on <dialog>. On narrow screens it docks to the bottom as a sheet.
   * Focus is trapped by the browser's modal dialog; Esc closes unless `blocking`.
   */
  import type { Snippet } from 'svelte'
  import { X } from '@lucide/svelte'

  interface Props {
    open: boolean
    title: string
    /** Prevent closing via Esc, backdrop or the close button (e.g. during an operation). */
    blocking?: boolean
    tone?: 'neutral' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    onclose?: () => void
    children: Snippet
    actions?: Snippet
    icon?: Snippet
  }

  let { open, title, blocking = false, tone = 'neutral', size = 'sm', onclose, children, actions, icon }: Props =
    $props()

  let el: HTMLDialogElement
  const titleId = `dlg-${Math.random().toString(36).slice(2)}`

  $effect(() => {
    if (!el) return
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  })

  function requestClose() {
    if (!blocking) onclose?.()
  }
</script>

<dialog
  bind:this={el}
  class="dialog {tone} {size}"
  aria-labelledby={titleId}
  oncancel={(e) => {
    e.preventDefault()
    requestClose()
  }}
  onclick={(e) => {
    if (e.target === el) requestClose()
  }}
>
  <div class="panel">
    <header>
      {#if icon}<span class="icon">{@render icon()}</span>{/if}
      <h2 id={titleId}>{title}</h2>
      {#if !blocking}
        <button type="button" class="close" aria-label="Close" onclick={requestClose}><X size={18} /></button>
      {/if}
    </header>
    <div class="body">{@render children()}</div>
    {#if actions}
      <footer>{@render actions()}</footer>
    {/if}
  </div>
</dialog>

<style>
  .dialog {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    max-width: calc(100vw - 2 * var(--gutter));
    max-height: calc(100dvh - 2 * var(--gutter));
    width: 440px;
  }
  .md {
    width: 560px;
  }
  .lg {
    width: 720px;
  }
  .dialog::backdrop {
    background: var(--color-scrim);
    backdrop-filter: blur(2px);
  }
  .dialog[open] {
    animation: pop var(--dur-slow) var(--ease-enter);
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-3);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-5) var(--space-2);
  }
  h2 {
    flex: 1;
    font-size: var(--text-xl);
    line-height: var(--leading-xl);
  }
  .icon {
    display: grid;
    place-items: center;
    color: var(--color-accent);
  }
  .danger .icon {
    color: var(--color-danger);
  }
  .close {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-subtle);
  }
  .close:hover {
    background: var(--color-surface-3);
    color: var(--color-text);
  }
  .body {
    padding: var(--space-2) var(--space-5) var(--space-5);
    overflow: auto;
    color: var(--color-text-muted);
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--color-border);
    background: var(--color-surface-1);
  }
  @media (max-width: 559px) {
    .dialog {
      width: 100vw;
      max-width: 100vw;
      margin: auto 0 0;
    }
    .panel {
      border-radius: var(--radius-xl) var(--radius-xl) 0 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
    footer {
      flex-direction: column-reverse;
    }
    footer :global(.btn) {
      width: 100%;
    }
    .dialog[open] {
      animation: slide-up var(--dur-slow) var(--ease-enter);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
  }
</style>
