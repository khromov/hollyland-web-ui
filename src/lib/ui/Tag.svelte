<script lang="ts">
  /** Outline plate for a hardware ID, e.g. TX1 / TX2 / RX. Mono, never filled. */
  import type { Snippet } from 'svelte'

  interface Props {
    children: Snippet
    /** Accessible expansion, e.g. "Transmitter 1". */
    title?: string
  }
  let { children, title }: Props = $props()
</script>

<span class="tag" {title}>{@render children()}</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    flex: none;
    height: 24px;
    padding: 0 7px;
    border: 1px solid var(--rule);
    border-radius: var(--r-plate);
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-2);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
</style>
