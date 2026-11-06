<script lang="ts">
  /**
   * Settings for the products on the family drivers (LARK A1, LARK M3, LARK MAX 2, MELO P1): the
   * product's "More Settings" controls and the set-and-forget ones (pageOf → 'settings'), then this
   * browser's preferences. The Mixer, Timecode and Wireless Monitoring have pages of their own
   * (src/components/mixer, timecode, monitoring); a section is drawn here only for a product whose
   * extraPages don't list it. Every control comes from the product's ControlSpec list; the
   * Overview's controls are not repeated here.
   */
  import { session } from '../../lib/state/session.svelte'
  import { pageOf } from '../controls/controls'
  import AppPrefs from './AppPrefs.svelte'
  import ControlSection from './ControlSection.svelte'
  import TimecodeSection from './TimecodeSection.svelte'
  import MonitoringSection from './MonitoringSection.svelte'
  import MixerSection from './MixerSection.svelte'
  import { itemsOn, type ExtraSection } from './placement'

  const family = $derived(session.family)
  /**
   * The product has controls for the section, and no tab of its own shows them (App.svelte renders
   * src/components/<page>/<Page>Page.svelte for every page in session.extraPages).
   */
  function showsExtra(s: ExtraSection): boolean {
    if (session.extraPages.includes(s)) return false
    return session.controls.some((c) => pageOf(c, family) === s)
  }
  const items = $derived(itemsOn('settings', session.controls, family))

  // The official More Settings screens re-read their values on entry.
  let refreshedFor: unknown = null
  $effect(() => {
    const mic = session.mic
    if (mic && session.live && session.phase === 'ready' && refreshedFor !== mic) {
      refreshedFor = mic
      void session.refreshSettings()
    }
  })
</script>

<div class="settings">
  <h1 class="visually-hidden">Settings</h1>

  {#if showsExtra('mixer')}<MixerSection />{/if}
  {#if showsExtra('timecode')}<TimecodeSection />{/if}
  {#if showsExtra('monitoring')}<MonitoringSection />{/if}

  <ControlSection title="Feature Settings" {items} />

  <AppPrefs />
</div>

<style>
  .settings {
    display: grid;
    min-width: 0;
  }
</style>
