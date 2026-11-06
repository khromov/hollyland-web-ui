<script lang="ts">
  /**
   * Monitoring tab (LARK MAX 2 wireless monitoring, session.extraPages): the switch, the monitor
   * earphones' play / pause, volume, pairing and batteries. With this page in the tree, Settings no
   * longer draws the section.
   */
  import MonitoringSection from '../settings/MonitoringSection.svelte'
</script>

<div class="page-sections">
  <h1 class="visually-hidden">Monitoring</h1>
  <MonitoringSection />
</div>

<style>
  .page-sections {
    display: grid;
    min-width: 0;
  }
</style>
