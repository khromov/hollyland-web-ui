<script lang="ts">
  import { AudioLines, AudioLinesOff } from '@lucide/svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { session } from '../../lib/state/session.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Banner from '../../lib/ui/Banner.svelte'

  interface Props {
    compact?: boolean
  }
  let { compact = false }: Props = $props()

  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  const isMac = /mac/i.test(platform)
  // On Linux the bridge only detaches the HID driver, so USB audio keeps working (docs/BRIDGE.md).
  const isLinux = /linux/i.test(platform) && !/android/i.test(navigator.userAgent)

  /** On macOS the bridge captures the whole receiver, so its USB audio input is gone until it stops. */
  const audioHeldByBridge = $derived(
    session.transportKind === 'bridge' &&
      (session.phase === 'ready' || session.phase === 'lost' || session.phase === 'restarting') &&
      !isLinux,
  )
</script>

{#if audioHeldByBridge}
  <div class="start paused" class:compact role="note">
    <div class="icon" aria-hidden="true"><AudioLinesOff size={compact ? 20 : 28} /></div>
    <div class="text">
      <div class="title">USB audio paused</div>
      <p>
        The receiver's USB audio is paused while the local bridge holds it. Stop the bridge (Ctrl+C) to record or
        meter audio on this {isMac ? 'Mac' : 'computer'}.
      </p>
    </div>
  </div>
{:else}
  <div class="start" class:compact>
    <div class="icon" aria-hidden="true"><AudioLines size={compact ? 20 : 28} /></div>
    <div class="text">
      <div class="title">Live levels and recording</div>
      <p>
        The receiver is also a USB microphone. Allow microphone access to see live levels per mic, monitor, apply
        voice effects and record WAV files. Audio stays on this computer.
      </p>
      {#if audio.state === 'error' && audio.error}
        <Banner tone="danger">{audio.error}</Banner>
      {/if}
    </div>
    <Button variant={compact ? 'secondary' : 'primary'} loading={audio.state === 'starting'} onclick={() => audio.start()}>
      Enable audio
    </Button>
  </div>
{/if}

<style>
  .start {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-5);
    border-radius: var(--radius-lg);
    border: 1px dashed var(--color-border-strong);
    background: var(--color-surface-1);
  }
  .compact {
    padding: var(--space-3) var(--space-4);
  }
  .paused {
    grid-template-columns: auto 1fr;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    background: var(--color-accent-soft);
    color: var(--color-accent);
  }
  .paused .icon {
    background: var(--color-surface-3);
    color: var(--color-text-muted);
  }
  .compact .icon {
    width: 36px;
    height: 36px;
  }
  .title {
    font-weight: var(--weight-semibold);
  }
  p {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    margin-bottom: var(--space-2);
  }
  .compact p {
    display: none;
  }
  /* The bridge explanation is the whole message, so it stays visible in the compact card too. */
  .paused p,
  .compact.paused p {
    display: block;
    margin-bottom: 0;
  }
  @media (max-width: 559px) {
    .start {
      grid-template-columns: auto 1fr;
    }
    .start > :global(.btn) {
      grid-column: 1 / -1;
    }
  }
</style>
