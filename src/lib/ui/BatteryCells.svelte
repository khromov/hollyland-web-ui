<script lang="ts">
  /**
   * Battery as a 10-cell gauge plus the percentage in mono. Ink only: low is said in words.
   * percent null: an empty gauge with a dashed outline, "– –" and "Not readable" (write-only, or
   * not reported). Dashed means unknown; the hatch is kept for "last sent", so it isn't used here.
   * The words wrap under the gauge when the column is narrow.
   */
  import { Zap } from '@lucide/svelte'

  interface Props {
    /** 0..100, or null when it can't be read. */
    percent: number | null
    charging?: boolean
    /** Accessible name prefix, e.g. "Mic 1 battery". */
    label?: string
    showText?: boolean
    /** Words after "– –" when unknown. */
    unknownText?: string
    /** Show "Charging" next to the bolt (the bolt alone on narrow layouts). */
    chargingText?: boolean
  }

  let {
    percent,
    charging = false,
    label = 'Battery',
    showText = true,
    unknownText = 'Not readable',
    chargingText = true,
  }: Props = $props()

  const known = $derived(percent !== null && Number.isFinite(percent))
  const level = $derived(known ? Math.max(0, Math.min(100, Math.round(percent!))) : 0)
  const filled = $derived(known ? Math.max(level > 0 ? 1 : 0, Math.round(level / 10)) : 0)
  const low = $derived(known && !charging && level <= 10)
  const aria = $derived(
    known ? `${label} ${level} percent${charging ? ', charging' : low ? ', low' : ''}` : `${label}: ${unknownText.toLowerCase()}`,
  )
</script>

<span class="battery" class:unknown={!known} role="img" aria-label={aria}>
  <span class="gauge">
    <span class="cells" aria-hidden="true">
      {#each Array.from({ length: 10 }, (_, i) => i) as i (i)}
        <i class:f={i < filled}></i>
      {/each}
    </span>
    {#if showText}
      {#if known}
        <span class="num" aria-hidden="true">{level}<small>%</small></span>
      {:else}
        <span class="mc-dash" aria-hidden="true">– –</span>
      {/if}
    {/if}
  </span>
  {#if showText}
    {#if known}
      {#if low}<span class="word" aria-hidden="true">Low</span>{/if}
    {:else if unknownText}
      <span class="word dim" aria-hidden="true">{unknownText}</span>
    {/if}
  {/if}
  {#if charging && known}
    <span class="chg" aria-hidden="true"><Zap size={13} strokeWidth={2} />{#if chargingText}Charging{/if}</span>
  {/if}
</span>

<style>
  .battery {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    min-width: 0;
    min-height: 22px;
    font-size: 14px;
    white-space: nowrap;
  }
  .gauge {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
  .cells {
    position: relative;
    display: inline-grid;
    grid-auto-flow: column;
    gap: 2px;
    flex: none;
    height: 16px;
    padding: 2px;
    margin-right: 4px;
    border: 1.5px solid var(--ink);
    border-radius: var(--r-plate);
  }
  .cells::after {
    content: '';
    position: absolute;
    right: -5px;
    top: 3.5px;
    width: 2.5px;
    height: 6px;
    background: var(--ink);
    border-radius: 0 1px 1px 0;
  }
  .cells i {
    display: block;
    width: 4px;
    border-radius: 0.5px;
    background: color-mix(in srgb, var(--ink) 13%, transparent);
  }
  .cells i.f {
    background: var(--ink);
  }
  .unknown .cells {
    border-style: dashed;
    border-color: var(--ink-3);
  }
  .unknown .cells::after {
    background: var(--ink-3);
  }
  .unknown .cells i {
    background: transparent;
  }
  .num {
    font: 500 14px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums;
  }
  .num small {
    margin-left: 2px;
    font: 500 12px/1 var(--f-sans);
    color: var(--ink-2);
  }
  .word {
    font-size: 13px;
    font-weight: 600;
  }
  .word.dim {
    font-weight: 400;
    color: var(--ink-3);
  }
  .chg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--ink-2);
  }
</style>
