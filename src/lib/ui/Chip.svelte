<script lang="ts">
  /**
   * A short status word ("Connected", "Offline", "Unknown") as an outline tag in sentence case.
   * The tone adds a lamp in front of the word; the word carries the meaning, not the colour.
   */
  import type { Snippet } from 'svelte'
  import Lamp from './Lamp.svelte'

  interface Props {
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
    /** Unknown / not read: dashed outline and a hollow lamp. */
    unknown?: boolean
    children: Snippet
  }
  let { tone = 'neutral', unknown = false, children }: Props = $props()
</script>

<span class="chip {tone}" class:unknown>
  {#if unknown}
    <Lamp size="sm" state="hollow" />
  {:else if tone === 'success'}
    <Lamp size="sm" color="live" />
  {:else if tone === 'danger'}
    <Lamp size="sm" color="rec" />
  {:else if tone === 'warning'}
    <Lamp size="sm" state="hollow" />
  {/if}
  {@render children()}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 0 8px;
    border: 1px solid var(--rule);
    border-radius: var(--r-plate);
    font-size: 12px;
    line-height: 1.2;
    font-weight: 540;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .success,
  .danger,
  .accent {
    color: var(--ink);
  }
  .accent {
    border-color: var(--ink);
  }
  .unknown {
    border-style: dashed;
    border-color: var(--ink-3);
  }
</style>
