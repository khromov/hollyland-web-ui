<script lang="ts">
  /** "Camera RX" battery row of the camera receiver (PID 1042), features.md §4.2. */
  import { Info } from '@lucide/svelte'
  import Battery from '../../lib/ui/Battery.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { cameraRxBatteryWord } from './overview'

  const battery = $derived(session.units?.rx.battery ?? 0)
  const word = $derived(cameraRxBatteryWord(battery))
</script>

<section class="cam" aria-label="Camera RX">
  <span class="badge" aria-hidden="true">RX</span>
  <h2 class="title">Camera RX</h2>
  <div class="value">
    {#if session.live}
      <!-- The app never animates charging on this row (updateBatteryClipState(..., false)). -->
      <Battery percent={battery > 0 ? battery : null} showText={battery > 0} label="Camera RX battery" />
      <span class="word" class:low={word === 'Low'}>{word}</span>
    {:else if session.writeOnly}
      <span class="unavailable"><Info size={14} aria-hidden="true" />Status unavailable on this platform</span>
    {:else}
      <span class="unavailable">Reading status…</span>
    {/if}
  </div>
</section>

<style>
  .cam {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 52px;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-lg);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-1);
    flex-wrap: wrap;
  }
  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 38px;
    height: 24px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--color-rx);
    color: var(--color-on-rx);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
  }
  .title {
    font-size: var(--text-md);
    line-height: var(--leading-md);
    font-weight: var(--weight-semibold);
  }
  .value {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .word {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .word.low {
    color: var(--color-danger);
    font-weight: var(--weight-medium);
  }
  .unavailable {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  @media (max-width: 479px) {
    .cam {
      padding: var(--space-2) var(--space-4);
    }
  }
</style>
