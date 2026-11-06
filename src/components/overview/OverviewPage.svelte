<script lang="ts">
  /**
   * Overview route. The legacy products (LARK A2 / A2S, Lark M2, LARK M2S, the 6501 group) keep
   * their hand-tuned page (LegacyOverview); the other families (LARK A1, M3, MAX 2, MELO P1) get
   * the faceplate drawn from their units and ControlSpecs (family/FamilyOverview).
   * `isLegacy` stays put while the link is lost or the receiver restarts, so the page doesn't swap.
   */
  import { session } from '../../lib/state/session.svelte'
  import LegacyOverview from './LegacyOverview.svelte'
  import FamilyOverview from './family/FamilyOverview.svelte'

  const generic = $derived(!session.isLegacy && session.family !== null)
</script>

{#if generic}
  <FamilyOverview />
{:else}
  <LegacyOverview />
{/if}
