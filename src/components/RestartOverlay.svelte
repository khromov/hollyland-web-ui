<script lang="ts">
  /**
   * Full-screen blocker while the receiver restarts to apply "External speaker without
   * unplugging" / "Phone Speaker" (features.md §5, §16.1). The page behind it is inert
   * (App.svelte), focus moves into the box, and state changes are announced once each.
   */
  import { onMount } from 'svelte'
  import { RotateCcw } from '@lucide/svelte'
  import Button from '../lib/ui/Button.svelte'

  interface Props {
    /** Seconds until restart; 0 or null once the restart has been sent. */
    seconds: number | null
    /** The receiver confirmed the setting (false: sent blind on a write-only system). */
    confirmed: boolean
    /** The receiver is taking longer than usual to come back. */
    slow?: boolean
    /** "Stop waiting": leave the overlay (back to the page, or the lost banner). */
    onstop?: () => void
  }
  let { seconds, confirmed, slow = false, onstop }: Props = $props()

  let box: HTMLDivElement
  onMount(() => box.focus())

  const counting = $derived(!!seconds && seconds > 0)
  const unit = $derived(seconds === 1 ? 'second' : 'seconds')
  const title = $derived(
    counting
      ? confirmed
        ? `Settings successful. The device will restart in ${seconds} seconds.` // official wording, verbatim
        : `Sent. The receiver will be restarted in ${seconds} ${unit}.`
      : confirmed
        ? 'Restarting the receiver…'
        : 'Restart sent. Waiting for the receiver…',
  )
  const desc = $derived(
    confirmed
      ? 'Keep the receiver plugged in. This page reconnects automatically when it comes back.'
      : "This system can't confirm the setting or the restart. Keep the receiver plugged in; this page reconnects when it comes back.",
  )
  // Announced once per stage, not on every countdown tick.
  const announce = $derived(
    slow
      ? "The receiver hasn't come back yet. You can stop waiting; the page still reconnects when it's plugged in."
      : counting
        ? confirmed
          ? 'Settings successful. The receiver restarts in a few seconds.'
          : 'Sent. The receiver will be restarted in a few seconds.'
        : 'Restarting the receiver.',
  )
</script>

<div class="overlay">
  <div
    bind:this={box}
    class="box"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="restart-title"
    aria-describedby="restart-desc"
    tabindex="-1"
  >
    <RotateCcw size={28} aria-hidden="true" />
    <h2 id="restart-title">{title}</h2>
    <p id="restart-desc">{desc}</p>
    <p class="visually-hidden" aria-live="polite" aria-atomic="true">{announce}</p>
    {#if slow}
      <div class="slow">
        <p>This is taking longer than usual. If the receiver doesn't come back, unplug it and plug it in again.</p>
        <Button variant="secondary" onclick={() => onstop?.()}>Stop waiting</Button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    padding: var(--gutter);
    background: var(--color-scrim);
    backdrop-filter: blur(3px);
  }
  .box {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    max-width: 420px;
    padding: var(--space-8) var(--space-6);
    text-align: center;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-3);
  }
  .box:focus {
    outline: none;
  }
  .box:focus-visible {
    outline: var(--focus-width) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }
  .box > :global(svg) {
    color: var(--color-accent);
    animation: spin 1.6s linear infinite;
  }
  h2 {
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
  }
  p {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .slow {
    display: grid;
    justify-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }
  @keyframes spin {
    to {
      transform: rotate(-360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .box > :global(svg) {
      animation: none;
    }
  }
</style>
