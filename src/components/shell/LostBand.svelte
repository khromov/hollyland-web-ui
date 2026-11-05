<script lang="ts">
  /**
   * The lost-connection band: a dark window with a red lamp over the frozen page. The page below
   * keeps the last values (inert, greyed); the receiver reconnects by itself when it is plugged
   * back in, or with Reconnect.
   */
  import Key from '../../lib/ui/Key.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Band from './Band.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { clock, formatAge, link, platform } from './link.svelte'

  interface Props {
    onreconnect: () => void
    /** Offered when the lost link was a write-only WebHID one: the bridge gives full control. */
    onbridge?: () => void
  }
  let { onreconnect, onbridge }: Props = $props()

  clock.use()
  const age = $derived(session.lastUpdate ? formatAge(clock.now - session.lastUpdate) : null)
</script>

<!-- The alert holds only static words: the ticking age sits outside it, so screen readers announce
     the loss once instead of on every tick (the age can still be read in place). -->
<div class="lost">
  <Band title="Connection to the receiver was lost" role="alert">
    {#snippet mark()}<Lamp color="rec" />{/snippet}
    <p>
      The values below are frozen. Plug the receiver back in{link.viaBridge ? ' and keep the bridge running' : ''}; the
      page reconnects by itself.
    </p>
    {#snippet actions()}
      <Key variant="light" onclick={onreconnect}>Reconnect</Key>
      {#if onbridge && !link.viaBridge && session.writeOnly && platform !== 'windows'}
        <Key variant="quiet" onclick={onbridge}>Connect through local bridge</Key>
      {/if}
    {/snippet}
  </Band>
  {#if age}<p class="age">Last reply <span class="mono">{age}</span> ago</p>{/if}
</div>

<style>
  .lost {
    position: relative;
  }
  /* The age reads as part of the band (bottom right inside the window) but isn't in its live region. */
  .age {
    position: absolute;
    left: 46px;
    bottom: 12px;
    font-size: 12px;
    line-height: 1.4;
    color: #c9c8c3;
  }
  .lost :global(.band) {
    padding-bottom: 34px;
  }
</style>
