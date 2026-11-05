<script lang="ts">
  /**
   * Same API as before the redesign, but there are no cards any more: a Card is a faceplate
   * section under a hairline rule, its title in expanded Archivo. `channel` puts the mic's LED
   * (in a bezel) in front of the title instead of a coloured top border. `overline` is a small
   * sentence-case note after the title. New layouts use Panel / Modules / Module.
   */
  import type { Snippet } from 'svelte'
  import Lamp from './Lamp.svelte'

  interface Props {
    title?: string
    overline?: string
    /** Channel identity: the mic's LED in front of the title. */
    channel?: 'tx1' | 'tx2' | 'rx' | null
    dimmed?: boolean
    header?: Snippet
    children: Snippet
    class?: string
  }
  let { title, overline, channel = null, dimmed = false, header, children, class: klass = '' }: Props = $props()
  const headingId = `card-${Math.random().toString(36).slice(2)}`
</script>

<section class="card {klass}" class:dimmed data-channel={channel} aria-labelledby={title ? headingId : undefined}>
  {#if title || overline || header}
    <header>
      <div class="titles">
        {#if channel === 'tx1' || channel === 'tx2'}
          <Lamp color={channel === 'tx1' ? 'mic1' : 'mic2'} size="lg" state={dimmed ? 'off' : 'on'} />
        {/if}
        {#if title}<h2 id={headingId}>{title}</h2>{/if}
        {#if overline}<span class="note">{overline}</span>{/if}
      </div>
      {#if header}<div class="extra">{@render header()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    position: relative;
    padding: 18px 0 22px;
    border-top: 1px solid var(--rule);
    container-type: inline-size;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: var(--hit);
    margin-bottom: 6px;
  }
  .titles {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 12px;
    min-width: 0;
  }
  h2 {
    font-size: var(--t-section-sm);
    font-weight: 680;
    font-stretch: var(--head-stretch);
    line-height: 1.25;
  }
  .note {
    font-size: 13px;
    color: var(--ink-3);
  }
  .extra {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* Offline / unavailable: decorative parts fade, text keeps full contrast. */
  .dimmed :global(.dim-when-offline) {
    opacity: 0.45;
  }
  @media (min-width: 600px) {
    h2 {
      font-size: var(--t-section);
    }
  }
</style>
