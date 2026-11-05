<script lang="ts">
  /**
   * The link status from the session, in the StatusLine primitive.
   * - line (≥ 600 px): the 36 px line pinned to the bottom of the window:
   *   "● WebHID · two-way   Last reply 0.4 s ago   Firmware RX … · TX1 … · TX2 …   Independent project …"
   * - band (< 600 px): the 32 px band under the phone header, live connections only:
   *   "● Live · read & write · Reply 0.4 s                    RX 3.0.2.008"
   */
  import StatusLine from '../../lib/ui/StatusLine.svelte'
  import type { StatusItem } from '../../lib/ui/StatusLine.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { clock, formatAge, link } from './link.svelte'

  interface Props {
    variant: 'line' | 'band'
  }
  let { variant }: Props = $props()

  clock.use()

  // The firmware versions only fit from 960 px; below that the line keeps link and last reply.
  const media = typeof window !== 'undefined' ? window.matchMedia('(min-width: 960px)') : null
  let wide = $state(media?.matches ?? true)
  $effect(() => {
    if (!media) return
    const on = (e: MediaQueryListEvent) => (wide = e.matches)
    media.addEventListener('change', on)
    return () => media.removeEventListener('change', on)
  })

  const items = $derived(link.statusItems(clock.now, wide))

  const bandItems = $derived.by((): StatusItem[] => {
    const age = session.lastUpdate ? formatAge(clock.now - session.lastUpdate) : null
    return [
      { label: link.viaBridge ? 'Live · read & write · bridge' : 'Live · read & write' },
      ...(age ? [{ label: 'Reply', value: age }] : []),
    ]
  })
  const rxVersion = $derived(session.units?.rx.version ?? null)
</script>

{#if variant === 'line'}
  <footer class="line">
    <StatusLine {items} end={link.statusEnd} />
  </footer>
{:else}
  <!-- A landmark of its own: it sits between the header and main on phones. -->
  <section class="band" aria-label="Link status">
    <StatusLine variant="band" items={bandItems} label="Link status">
      {#snippet end()}{#if rxVersion}<span class="mono fw">RX {rxVersion}</span>{/if}{/snippet}
    </StatusLine>
  </section>
{/if}

<style>
  .line {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    background: var(--chassis);
  }
  .line :global(.status) {
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .fw {
    color: var(--ink-2);
  }
  /* The disclaimer gives way first, then the firmware, so the line never wraps. */
  @media (max-width: 1199px) {
    .line :global(.end) {
      display: none;
    }
  }
  @media (max-width: 599px) {
    .line {
      display: none;
    }
  }
  @media (min-width: 600px) {
    .band {
      display: none;
    }
  }
  @media (max-width: 359px) {
    .band :global(.end) {
      display: none;
    }
  }
</style>
