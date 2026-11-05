<script lang="ts">
  /**
   * A notice band under the header (send-only link, lost connection): a dark display window with
   * a mark (lamp or arrow) and either an uppercase lamp legend or a title, the explanation, keys,
   * and an optional expandable part. Same window, legend and keys as the Banner primitive, but laid
   * out as one band on wide screens (words left, keys right) so the panel keeps its height; stacked
   * on phones.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    /** The lamp or glyph at the left. */
    mark: Snippet
    /** Uppercase lamp legend ("Send-only link"). */
    legend?: string
    /** One sentence that follows the legend on the same line on wide screens. */
    lead?: string
    title?: string
    /** role="alert" for a lost link, "status" otherwise. */
    role?: 'status' | 'alert'
    children: Snippet
    /** Keys at the right (wide) or under the words (phone). */
    actions?: Snippet
    /** A short line under the keys, e.g. what the main key costs. */
    note?: Snippet
    /** Expanded details, full width under the band. */
    more?: Snippet
  }
  let { mark, legend, lead, title, role = 'status', children, actions, note, more }: Props = $props()
  const headId = `band-${Math.random().toString(36).slice(2, 8)}`
</script>

<div class="mc-window band" {role} aria-labelledby={headId}>
  <span class="mark" aria-hidden="true">{@render mark()}</span>
  <div class="text">
    {#if legend}
      <p class="legend-row">
        <span class="legend mc-lamp-legend" id={headId}>{legend}</span>
        {#if lead}<span class="lead">{lead}</span>{/if}
      </p>
    {/if}
    {#if title}<p class="title" id={legend ? undefined : headId}>{title}</p>{/if}
    <div class="body">{@render children()}</div>
  </div>
  {#if actions || note}
    <div class="acts">
      {#if actions}<div class="keys">{@render actions()}</div>{/if}
      {#if note}<p class="note">{@render note()}</p>{/if}
    </div>
  {/if}
  {#if more}<div class="more">{@render more()}</div>{/if}
</div>

<style>
  .band {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    column-gap: 12px;
    row-gap: 10px;
    padding: 12px 16px 14px 14px;
  }
  .mark {
    display: grid;
    place-items: center;
    height: 20px;
    color: var(--w-ink);
  }
  .text {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .legend-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .legend {
    display: flex;
    align-items: center;
    flex: none;
    min-height: 20px;
    color: var(--w-ink);
    letter-spacing: 0.05em;
  }
  .lead {
    font-size: 13px;
    line-height: var(--lh-body);
    color: #c9c8c3;
  }
  .title {
    display: flex;
    align-items: center;
    min-height: 20px;
    font-size: 14px;
    font-weight: 620;
    line-height: 1.35;
    color: var(--w-ink);
  }
  .body {
    display: grid;
    gap: 8px;
    font-size: 13px;
    line-height: var(--lh-body);
    color: #c9c8c3;
    max-width: 120ch;
  }
  .acts {
    grid-column: 2;
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  /* Keep the underline of quiet keys visible (the key label clips its overflow). */
  .keys :global(.mc-key--quiet .label),
  .more :global(.mc-key--quiet .label) {
    overflow: visible;
  }
  .note {
    font-size: 12px;
    line-height: 1.4;
    color: #c9c8c3;
  }
  .more {
    grid-column: 2 / -1;
    display: grid;
    justify-items: start;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--w-rule);
    font-size: 13px;
    line-height: var(--lh-body);
    color: #c9c8c3;
  }
  .more :global(p) {
    max-width: 78ch;
  }

  /* Wide: words left, keys right, as short as the keys allow. */
  @media (min-width: 960px) {
    .band {
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      padding: 10px 14px 10px 14px;
    }
    .mark {
      align-self: start;
    }
    .acts {
      grid-column: 3;
      justify-items: end;
      max-width: 340px;
    }
    .keys {
      justify-content: flex-end;
    }
    .note {
      text-align: right;
    }
    /* The legend and its sentence share one line. */
    .legend-row {
      flex-direction: row;
      align-items: baseline;
      column-gap: 14px;
    }
    .legend-row .legend {
      align-self: flex-start;
    }
    .legend-row .lead {
      padding-top: 1px;
    }
  }
</style>
