<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title?: string
    overline?: string
    /** Channel identity rule on top of the card. */
    channel?: 'tx1' | 'tx2' | 'rx' | null
    dimmed?: boolean
    header?: Snippet
    children: Snippet
    class?: string
  }
  let { title, overline, channel = null, dimmed = false, header, children, class: klass = '' }: Props = $props()
  const headingId = `card-${Math.random().toString(36).slice(2)}`
</script>

<section
  class="card {klass}"
  class:dimmed
  data-channel={channel}
  aria-labelledby={title ? headingId : undefined}
>
  {#if title || overline || header}
    <header>
      <div class="titles">
        {#if overline}<div class="overline">{overline}</div>{/if}
        {#if title}<h2 id={headingId}>{title}</h2>{/if}
      </div>
      {#if header}<div class="extra">{@render header()}</div>{/if}
    </header>
  {/if}
  {@render children()}
</section>

<style>
  .card {
    position: relative;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4) var(--space-5) var(--space-5);
    box-shadow: var(--shadow-1);
    container-type: inline-size;
    transition: opacity var(--dur-fast);
  }
  .card[data-channel]::before {
    content: '';
    position: absolute;
    inset: -1px -1px auto;
    height: 3px;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    background: var(--channel-color, transparent);
  }
  .card[data-channel='tx1'] {
    --channel-color: var(--color-tx1);
  }
  .card[data-channel='tx2'] {
    --channel-color: var(--color-tx2);
  }
  .card[data-channel='rx'] {
    --channel-color: var(--color-rx);
  }
  /* Offline / unavailable: only the decorative parts fade. Text keeps full contrast, so the
     state is carried by words ("Disconnected", "Not connected…"), never by fading alone. */
  .dimmed {
    background: color-mix(in oklab, var(--color-surface-1) 70%, var(--color-bg));
    box-shadow: none;
  }
  .dimmed[data-channel]::before {
    opacity: 0.35;
  }
  .dimmed :global(.dim-when-offline) {
    opacity: 0.45;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
  }
  h2 {
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
  }
  .extra {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  @media (max-width: 479px) {
    .card {
      padding: var(--space-4);
    }
  }
</style>
