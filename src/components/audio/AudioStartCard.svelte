<script lang="ts">
  import { AudioLines } from '@lucide/svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Banner from '../../lib/ui/Banner.svelte'

  interface Props {
    compact?: boolean
  }
  let { compact = false }: Props = $props()
</script>

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
  .icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: var(--radius-md);
    background: var(--color-accent-soft);
    color: var(--color-accent);
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
  @media (max-width: 559px) {
    .start {
      grid-template-columns: auto 1fr;
    }
    .start > :global(.btn) {
      grid-column: 1 / -1;
    }
  }
</style>
