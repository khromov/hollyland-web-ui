<script lang="ts">
  /**
   * Why there are no live levels, and the key that fixes it, as a dark display window.
   * Uses the shared audio.meterState, so it says the same as the meter windows:
   * first run ("Show live levels"), waiting, permission blocked, no input, USB audio paused while
   * the local bridge runs (macOS), or another error.
   */
  import { audio } from '../../lib/state/audio.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'

  interface Props {
    compact?: boolean
  }
  let { compact = false }: Props = $props()

  const mstate = $derived(audio.meterState)
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

  const title = $derived(
    {
      live: 'Live levels',
      idle: 'Live levels and recording',
      starting: 'Starting live audio',
      denied: 'Microphone access blocked',
      paused: 'USB audio paused',
      nodevice: 'No audio input',
      error: 'Live levels stopped',
    }[mstate],
  )
  const text = $derived(
    mstate === 'paused'
      ? `The receiver's USB audio is paused while the local bridge holds it. Stop the bridge (Ctrl+C) to see levels and record on this ${isMac ? 'Mac' : 'computer'}.`
      : mstate === 'denied'
        ? 'Microphone access is blocked for this page. Allow it in the site settings next to the address bar, then try again.'
        : mstate === 'nodevice'
          ? (audio.error ?? 'No audio input was found. Plug in the receiver, then try again.')
          : mstate === 'error'
            ? (audio.meterMessage ?? 'Live levels stopped.')
            : mstate === 'starting'
              ? 'Waiting for microphone access…'
              : 'The receiver is also a USB microphone. Allow microphone access to see live levels per channel, monitor, use voice effects and record. Audio stays on this computer.',
  )
  const action = $derived(
    mstate === 'idle'
      ? 'Show live levels'
      : mstate === 'denied' || mstate === 'nodevice' || (mstate === 'error' && audio.supported)
        ? 'Try again'
        : null,
  )
</script>

{#if mstate !== 'live'}
  <div class="mc-window start" class:compact role="status">
    <div class="msg">
      <p class="title">
        <span class="lamp" aria-hidden="true">
          {#if mstate === 'starting'}
            <span class="mc-spinner"></span>
          {:else}
            <Lamp color="rec" size="sm" state={mstate === 'denied' || mstate === 'error' || mstate === 'nodevice' ? 'on' : 'hollow'} />
          {/if}
        </span>
        {title}
      </p>
      <p class="text">{text}</p>
    </div>
    {#if action}
      <button type="button" class="mc-key mc-key--light {compact ? 'mc-key--sm' : ''}" onclick={() => audio.start()}>{action}</button>
    {/if}
  </div>
{/if}

<style>
  .start {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 14px;
    row-gap: 12px;
    padding: 18px 20px;
  }
  .compact {
    padding: 12px 16px;
  }
  .lamp {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-right: 8px;
    vertical-align: -1px;
  }
  .lamp .mc-spinner {
    width: 14px;
    height: 14px;
  }
  .msg {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 620;
    line-height: 1.3;
    color: var(--w-ink);
  }
  .text {
    max-width: 68ch;
    font-size: 13px;
    line-height: 1.45;
    color: var(--w-ink);
  }
  @media (max-width: 559px) {
    .start {
      grid-template-columns: minmax(0, 1fr);
    }
    .start .mc-key {
      justify-self: start;
    }
  }
</style>
