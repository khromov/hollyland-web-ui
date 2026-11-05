<script lang="ts">
  /**
   * Full-screen blocker while the receiver restarts to apply "External speaker without
   * unplugging" / "Phone Speaker" (features.md §5, §16.1). The page behind it is inert
   * (App.svelte), focus moves into the panel, and state changes are announced once each.
   * The header lamp blinks and the status line reads "Restarting" meanwhile; under reduced motion
   * nothing blinks and the words carry the state. The countdown sits in the readout; a restart the
   * receiver didn't confirm (status unavailable) says so in a tooltip and in the dialog's description.
   */
  import { onMount } from 'svelte'
  import Key from '../lib/ui/Key.svelte'
  import Lamp from '../lib/ui/Lamp.svelte'

  interface Props {
    /** Seconds until restart; 0 or null once the restart has been sent. */
    seconds: number | null
    /** The receiver confirmed the setting (false: sent where its status can't be read). */
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
  const unconfirmed = 'Not confirmed by the receiver'
  // Announced once per stage, not on every countdown tick.
  const announce = $derived(
    slow ? "The receiver hasn't come back yet." : counting ? 'The receiver restarts in a few seconds.' : 'Restarting the receiver.',
  )
</script>

<div class="overlay">
  <div
    bind:this={box}
    class="box"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="restart-title"
    aria-describedby={confirmed ? 'restart-desc' : 'restart-desc restart-note'}
    tabindex="-1"
  >
    <header>
      <Lamp color="live" state="on" blink />
      <h2 id="restart-title">Restarting the receiver</h2>
    </header>
    <div class="body">
      <div class="mc-window readout" aria-hidden="true" title={confirmed ? undefined : unconfirmed}>
        {#if counting}
          <span class="label">Restart in</span>
          <span class="num mono">{seconds}<small>s</small></span>
        {:else}
          <span class="label">Restarting</span>
          <span class="num mono wait">–</span>
        {/if}
      </div>
      <p id="restart-desc">Keep the receiver plugged in.</p>
      {#if !confirmed}<p id="restart-note" class="visually-hidden">{unconfirmed}.</p>{/if}
      <p class="visually-hidden" aria-live="polite" aria-atomic="true">{announce}</p>
      {#if slow}
        <div class="slow">
          <p>Taking too long? Re-plug the receiver.</p>
          <Key onclick={() => onstop?.()}>Stop waiting</Key>
        </div>
      {/if}
    </div>
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
    background: var(--scrim);
  }
  .box {
    width: min(460px, 100%);
    background: var(--chassis);
    border: 1px solid var(--key-edge);
    border-radius: var(--r-key);
    box-shadow: 0 2px 0 var(--key-shadow);
    overflow: hidden;
  }
  .box:focus {
    outline: none;
  }
  .box:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--rule);
  }
  h2 {
    font-size: 17px;
    font-weight: 680;
    font-stretch: var(--head-stretch);
    line-height: 1.3;
  }
  .body {
    display: grid;
    gap: 14px;
    padding: 16px 20px 20px;
  }
  .readout {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
  }
  .label {
    font-size: 13px;
    color: var(--w-ink-2);
  }
  .num {
    font-size: var(--t-timecode);
    font-weight: 420;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--w-ink);
  }
  .num small {
    margin-left: 4px;
    font-size: 22px;
    color: var(--w-ink-2);
  }
  .num.wait {
    font-size: 28px;
    color: var(--w-ink-2);
  }
  p {
    font-size: 14px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .slow {
    display: grid;
    justify-items: start;
    gap: 12px;
    padding-top: 14px;
    border-top: 1px solid var(--rule);
  }
</style>
