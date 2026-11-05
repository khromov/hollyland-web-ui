<script lang="ts">
  /**
   * Modal dialog on <dialog>: a faceplate panel with hairline-divided header, body and keys.
   * On narrow screens it docks to the bottom as a sheet. Focus is trapped by the browser's modal
   * dialog; Esc closes unless `blocking`.
   */
  import type { Snippet } from 'svelte'
  import { X } from '@lucide/svelte'
  import Lamp from './Lamp.svelte'

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
    /**
     * Id(s) of the body text that says the consequence ("This erases the receiver's settings."),
     * read out with the title when the dialog opens.
     */
    describedby?: string
  }

  let { open, title, blocking = false, tone = 'neutral', size = 'sm', onclose, children, actions, icon, describedby }: Props =
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
  aria-describedby={describedby}
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
      {#if icon}<span class="icon">{@render icon()}</span>{:else if tone === 'danger'}<Lamp color="rec" />{/if}
      <h2 id={titleId}>{title}</h2>
      {#if !blocking}
        <button type="button" class="mc-key mc-key--quiet mc-key--icon close" aria-label="Close" onclick={requestClose}
          ><X size={18} /></button
        >
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
    color: var(--ink);
    max-width: calc(100vw - 2 * var(--gutter));
    max-height: calc(100dvh - 2 * var(--gutter));
    width: 460px;
  }
  .md {
    width: 580px;
  }
  .lg {
    width: 760px;
  }
  .dialog::backdrop {
    background: var(--scrim);
  }
  .dialog[open] {
    animation: pop var(--dur-base) var(--ease-enter, ease-out);
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: inherit;
    background: var(--chassis);
    border: 1px solid var(--key-edge);
    border-radius: var(--r-key);
    box-shadow: 0 2px 0 var(--key-shadow);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 8px 8px 8px 20px;
    border-bottom: 1px solid var(--rule);
  }
  h2 {
    flex: 1;
    font-size: 18px;
    font-weight: 680;
    font-stretch: var(--head-stretch);
    line-height: 1.25;
  }
  .icon {
    display: grid;
    place-items: center;
    color: var(--ink);
  }
  .body {
    padding: 16px 20px 20px;
    overflow: auto;
    font-size: 14px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .body :global(p + p) {
    margin-top: 10px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--rule);
  }
  @media (max-width: 559px) {
    .dialog {
      width: 100vw;
      max-width: 100vw;
      margin: auto 0 0;
    }
    .panel {
      border-radius: var(--r-key) var(--r-key) 0 0;
      border-bottom: 0;
      padding-bottom: env(safe-area-inset-bottom);
    }
    footer {
      flex-direction: column-reverse;
    }
    footer :global(.mc-key) {
      width: 100%;
    }
    .dialog[open] {
      animation: slide-up var(--dur-base) var(--ease-enter, ease-out);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
  }
</style>
