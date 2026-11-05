<script lang="ts">
  /**
   * The persistent link status: "● Connected   Last reply 0.4 s   RX 3.0.2.008 · TX1 …".
   * Words are Archivo; measured values and hardware IDs are mono.
   * - variant 'line': the desktop 36 px line at the bottom (rule above)
   * - variant 'band': the phone 32 px band under the header (rule below)
   * Not a live region: it updates every second and would be noisy.
   */
  import type { Snippet } from 'svelte'
  import type { LampColor, LampState } from './types'
  import Lamp from './Lamp.svelte'

  export interface StatusItem {
    /** Words, e.g. "Connected" or "Last reply". */
    label?: string
    /** A measured value or ID, e.g. "0.4 s", "3.0.2.008". */
    value?: string
    lamp?: { color?: LampColor; state?: LampState; blink?: boolean }
  }

  interface Props {
    items: StatusItem[]
    /** Right-aligned text or content, e.g. "Unofficial · not affiliated with Hollyland". */
    end?: string | Snippet
    variant?: 'line' | 'band'
    label?: string
  }
  let { items, end, variant = 'line', label = 'Link status' }: Props = $props()
</script>

<div class="status {variant}" role="group" aria-label={label}>
  {#each items as it, i (i)}
    <span class="item">
      {#if it.lamp}<Lamp size="sm" color={it.lamp.color ?? 'live'} state={it.lamp.state ?? 'on'} blink={it.lamp.blink} />{/if}
      {#if it.label}<span class="label">{it.label}</span>{/if}
      {#if it.value}<span class="value">{it.value}</span>{/if}
    </span>
  {/each}
  {#if end}
    <span class="end">
      {#if typeof end === 'string'}{end}{:else}{@render end()}{/if}
    </span>
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 6px 22px;
    min-width: 0;
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-2);
  }
  .line {
    flex-wrap: wrap;
    min-height: var(--status-h);
    padding: 6px var(--gutter);
    border-top: 1px solid var(--rule);
  }
  .band {
    min-height: var(--status-band-h);
    padding: 6px var(--gutter);
    border-bottom: 1px solid var(--rule);
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
  }
  .value {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    color: var(--ink);
  }
  .end {
    margin-left: auto;
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .band .end {
    margin-left: auto;
  }
</style>
