<script lang="ts">
  /**
   * The link status from the session, in the StatusLine primitive.
   * - line (≥ 600 px): the 36 px line pinned to the bottom of the window:
   *   "● Connected   Last reply 0.4 s ago   Firmware RX … · TX1 … · TX2 …   Unofficial · …"
   *   (only the disclaimer while there is no session: the header says "Not connected")
   * - band (< 600 px): the 32 px band under the phone header, live connections only:
   *   "Last reply 0.4 s                    RX 3.0.2.008"
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
    return [...(link.viaBridge ? [{ label: 'Bridge' }] : []), ...(age ? [{ label: 'Last reply', value: age }] : [])]
  })
  const rxVersion = $derived(session.units?.rx.version ?? null)
</script>

{#if variant === 'line'}
  <footer class="line" class:bare={items.length === 0}>
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
  /* The disclaimer gives way first, then the firmware, so the line never wraps. Without a
     session the line holds the disclaimer only, at every width. */
  @media (max-width: 1199px) {
    .line:not(.bare) :global(.end) {
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
