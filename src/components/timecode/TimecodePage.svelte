<script lang="ts">
  /**
   * Timecode tab (LARK MAX 2 camera receiver and charging case, session.extraPages): the switch with
   * the receiver's timecode, mode, frame rate, timing method and Reset. With this page in the tree,
   * Settings no longer draws the section.
   */
  import TimecodeSection from '../settings/TimecodeSection.svelte'
</script>

<div class="page-sections">
  <h1 class="visually-hidden">Timecode</h1>
  <TimecodeSection />
</div>

<style>
  .page-sections {
    display: grid;
    min-width: 0;
  }
</style>
