<script lang="ts">
  /**
   * "Untested" next to the model name (header, menu, Device page) for products never run on
   * hardware (`session.untested`, from the registry's support record, docs/FAMILIES.md §4.3).
   * A status word in the Chip primitive; the tooltip says what was tested when anything was.
   */
  import Chip from '../../lib/ui/Chip.svelte'
  import { session } from '../../lib/state/session.svelte'

  const tip = $derived(session.testedOn.length ? `Tested: ${session.testedOn.join('; ')}` : 'Not tested on hardware yet')
</script>

<span class="plate" title={tip}><Chip>Untested</Chip></span>

<style>
  .plate {
    display: inline-flex;
    flex: none;
    align-self: center;
  }
  .plate :global(.chip) {
    min-height: 22px;
    font-weight: 560;
  }
</style>
