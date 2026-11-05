<script lang="ts">
  /**
   * The caption under a control that says how much is known about it, with the matching swatch
   * (same vocabulary as ConfidenceNote, but the text is a snippet so values and times stay mono):
   * - sent: "Last sent 17:42 · not confirmed"
   * - unknown: "Not read · choose one to send it"
   * - disabled: why the control can't be used
   * - info: a plain footnote without a swatch
   */
  import type { Snippet } from 'svelte'

  interface Props {
    kind: 'sent' | 'unknown' | 'disabled' | 'info'
    id?: string
    children: Snippet
  }
  let { kind, id, children }: Props = $props()
</script>

<p class="note k-{kind}" {id}>
  {#if kind !== 'info'}<span class="mc-swatch mc-swatch--{kind}" aria-hidden="true"></span>{/if}
  <span class="text">{@render children()}</span>
</p>

<style>
  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .mc-swatch {
    margin-top: 1px;
  }
  .k-unknown,
  .k-info {
    color: var(--ink-3);
  }
  .text :global(.mono) {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: 12px;
    color: var(--ink);
  }
  .text :global(b) {
    font-weight: 600;
    color: var(--ink-2);
  }
</style>
