<script lang="ts">
  /**
   * A row of modules divided by vertical hairline rules, wrapping onto further rows with the
   * rules preserved (and no rule on the outer edges). Columns default to as many ≥ `min` wide as
   * fit; pass `columns` (a grid-template-columns value) for a fixed strip, e.g. "1.05fr 1fr 1.08fr 1fr 1fr".
   */
  import type { Snippet } from 'svelte'

  interface Props {
    columns?: string
    min?: string
    class?: string
    children: Snippet
  }
  let { columns, min = '220px', class: klass = '', children }: Props = $props()
</script>

<div class="modules {klass}" style="--min: {min}; {columns ? `--cols: ${columns}` : ''}">
  {@render children()}
</div>

<style>
  .modules {
    display: grid;
    grid-template-columns: var(--cols, repeat(auto-fit, minmax(min(100%, var(--min)), 1fr)));
    overflow: hidden;
    min-width: 0;
  }
  /* Rules drawn just outside each module's left and top edge: inner ones show, outer ones are
     clipped by the container, and an incomplete last row leaves no empty cells. */
  .modules > :global(*) {
    min-width: 0;
    box-shadow:
      -1px 0 0 var(--rule),
      0 -1px 0 var(--rule);
  }
</style>
