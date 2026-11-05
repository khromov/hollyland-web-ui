<script lang="ts">
  /**
   * A notice: a dark display window with a lamp (never a yellow or coloured banner, since
   * yellow is Mic 2's identity).
   *   sendonly  "→ SEND-ONLY LINK" band for the write-only link (macOS / Windows drop replies)
   *   danger    red lamp (connection lost, errors)
   *   warning   hollow lamp
   *   success   green lamp
   *   info      no lamp, an info glyph
   * Keys passed in `actions` sit on the dark window: use variant "light" for the main one and
   * "ghost" for quiet ones.
   */
  import type { Snippet } from 'svelte'
  import { ArrowRight, Info } from '@lucide/svelte'
  import Lamp from './Lamp.svelte'

  interface Props {
    tone?: 'info' | 'success' | 'warning' | 'danger' | 'sendonly'
    title?: string
    /** Uppercase lamp legend; defaults to "Send-only link" for tone="sendonly". */
    legend?: string
    children?: Snippet
    actions?: Snippet
  }
  let { tone = 'info', title, legend, children, actions }: Props = $props()
  const shownLegend = $derived(legend ?? (tone === 'sendonly' ? 'Send-only link' : undefined))
</script>

<div class="mc-window banner {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
  <span class="mark" aria-hidden="true">
    {#if tone === 'sendonly'}
      <ArrowRight size={18} strokeWidth={1.75} />
    {:else if tone === 'danger'}
      <Lamp color="rec" />
    {:else if tone === 'success'}
      <Lamp color="live" />
    {:else if tone === 'warning'}
      <Lamp state="hollow" />
    {:else}
      <Info size={16} strokeWidth={1.75} />
    {/if}
  </span>
  <div class="content">
    {#if shownLegend}<div class="legend mc-lamp-legend">{shownLegend}</div>{/if}
    {#if title}<div class="title">{title}</div>{/if}
    {#if children}<div class="text">{@render children()}</div>{/if}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  .banner {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    column-gap: 12px;
    padding: 12px 16px 14px 14px;
  }
  .mark {
    display: grid;
    place-items: center;
    height: 20px;
    color: var(--w-ink);
  }
  .content {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .legend {
    display: flex;
    align-items: center;
    min-height: 20px;
    color: var(--w-ink);
    letter-spacing: 0.05em;
  }
  .title {
    min-height: 20px;
    display: flex;
    align-items: center;
    font-size: 14px;
    font-weight: 620;
    line-height: 1.35;
    color: var(--w-ink);
  }
  .legend + .title {
    min-height: 0;
  }
  .text {
    font-size: 13px;
    line-height: var(--lh-body);
    color: #c9c8c3;
    max-width: 78ch;
  }
  .text :global(code) {
    color: var(--w-ink);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .danger .legend {
    color: #ff8a82;
  }
</style>
