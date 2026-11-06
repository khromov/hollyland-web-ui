<script lang="ts">
  /**
   * The lost-connection band: a dark window with a red lamp over the frozen page. The page below
   * keeps the last values (inert, greyed); the receiver reconnects by itself when it is plugged
   * back in, or with Reconnect. The time of the last reply is in the status line.
   */
  import Key from '../../lib/ui/Key.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Band from './Band.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { link, platform } from './link.svelte'

  interface Props {
    onreconnect: () => void
    /** Offered when the lost link couldn't read status (WebHID on macOS): the bridge can. */
    onbridge?: () => void
  }
  let { onreconnect, onbridge }: Props = $props()
</script>

<Band title="Connection lost" role="alert">
  {#snippet mark()}<Lamp color="rec" />{/snippet}
  <p>
    {link.viaBridge
      ? 'Plug the receiver back in; keep the bridge running.'
      : session.transportKind === 'web-bluetooth'
        ? 'Turn the receiver on and bring it closer.'
        : 'Plug the receiver back in.'}
  </p>
  {#snippet actions()}
    <Key variant="light" onclick={onreconnect}>Reconnect</Key>
    {#if onbridge && !link.viaBridge && session.writeOnly && platform !== 'windows'}
      <Key variant="quiet" onclick={onbridge}>Connect through local bridge</Key>
    {/if}
  {/snippet}
</Band>
