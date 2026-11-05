<script lang="ts">
  interface Props {
    /** 0..100, or null when unknown. */
    percent: number | null
    charging?: boolean
    /** Show the numeric value beside the glyph. */
    showText?: boolean
    size?: 'sm' | 'md'
    label?: string
  }

  let { percent, charging = false, showText = true, size = 'md', label = 'Battery' }: Props = $props()

  const known = $derived(percent !== null && percent > 0)
  const level = $derived(known ? Math.max(0, Math.min(100, percent!)) : 0)
  // Thresholds follow the official app: "Low" at 10 % or below.
  const tone = $derived(!known ? 'unknown' : charging ? 'charging' : level <= 10 ? 'critical' : level <= 20 ? 'low' : 'ok')
  const ariaText = $derived(
    known ? `${label} ${level} percent${charging ? ', charging' : level <= 10 ? ', low' : ''}` : `${label} unknown`,
  )
</script>

<span class="battery {size} {tone}" role="img" aria-label={ariaText}>
  <svg viewBox="0 0 26 14" aria-hidden="true">
    <rect class="shell" x="0.75" y="0.75" width="21.5" height="12.5" rx="3" />
    <rect class="nub" x="23" y="4.5" width="2.25" height="5" rx="1" />
    <rect class="fill" x="2.5" y="2.5" width={(18 * level) / 100} height="9" rx="1.6" />
    {#if charging}
      <path class="bolt" d="M12.6 2.2 8.4 7.6h3.1l-1 4.2 4.3-5.5h-3.1z" />
    {/if}
  </svg>
  {#if showText}
    <span class="text readout">{known ? `${level}%` : '--'}</span>
  {/if}
</span>

<style>
  .battery {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text);
  }
  svg {
    width: 26px;
    height: 14px;
    flex: none;
  }
  .sm svg {
    width: 20px;
    height: 11px;
  }
  .shell {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    opacity: 0.7;
  }
  .nub {
    fill: currentColor;
    opacity: 0.7;
  }
  .fill {
    fill: currentColor;
    transition: width var(--dur-fast) var(--ease-standard);
  }
  .bolt {
    fill: var(--color-surface-1);
    stroke: var(--color-surface-1);
    stroke-width: 0.6;
  }
  .text {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .sm .text {
    font-size: var(--text-xs);
  }
  .ok .fill {
    fill: var(--color-success);
  }
  .charging .fill {
    fill: var(--color-success);
  }
  .low {
    color: var(--color-warning);
  }
  .critical {
    color: var(--color-danger);
  }
  .unknown {
    color: var(--color-text-subtle);
  }
</style>
