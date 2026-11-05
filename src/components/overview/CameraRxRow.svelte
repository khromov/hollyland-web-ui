<script lang="ts">
  /**
   * "Camera RX" battery of the camera receiver (PID 1042), features.md §4.2: "--" when 0,
   * "Low" at 10 % or below, otherwise "Normal". The app never shows charging on this row.
   * Sits with the Receiver section heading.
   */
  import BatteryCells from '../../lib/ui/BatteryCells.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { cameraRxBatteryWord } from './overview'

  const battery = $derived(session.units?.rx.battery ?? 0)
  const word = $derived(cameraRxBatteryWord(battery))
</script>

<div class="cam" role="group" aria-label="Camera RX battery">
  <span class="k">Camera RX</span>
  {#if session.live}
    <!-- The app never animates charging on this row (updateBatteryClipState(..., false)). -->
    <BatteryCells percent={battery > 0 ? battery : null} label="Camera RX battery" unknownText="" />
    {#if word === 'Normal'}<span class="w">Normal</span>{/if}
  {:else if session.writeOnly}
    <BatteryCells percent={null} label="Camera RX battery" />
  {:else}
    <span class="w">Reading…</span>
  {/if}
</div>

<style>
  .cam {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    font-size: 13px;
    color: var(--ink);
  }
  .k {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .w {
    font-size: 13px;
    color: var(--ink-3);
  }
</style>
