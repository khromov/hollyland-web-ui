<script lang="ts">
  /**
   * Mixer tab (MELO P1, session.extraPages): the track faders and mutes with the levels the receiver
   * pushes, the scenario, and the output volumes. The sections are the Settings components; with
   * this page in the tree, Settings no longer draws them.
   */
  import MixerSection from '../settings/MixerSection.svelte'
</script>

<div class="page-sections">
  <h1 class="visually-hidden">Mixer</h1>
  <MixerSection />
</div>

<style>
  .page-sections {
    display: grid;
    min-width: 0;
  }
</style>
