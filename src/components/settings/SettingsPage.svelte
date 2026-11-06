<script lang="ts">
  /**
   * "More Settings" equivalent (features.md §5 for the A2, §16.1 / §16.2 for the M2S / M2):
   * Feature Settings (receiver), Custom Functions (M2S) and this browser's preferences.
   * Every receiver setting is kit-wide (RX-global). Drawn as faceplate sections: a label rail,
   * modules divided by hairlines, the control at each module's head.
   */
  import { RotateCcw } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import { uid } from '../../lib/ui/field'
  import Button from '../../lib/ui/Button.svelte'
  import BoolSetting from './BoolSetting.svelte'
  import CustomFunctions from './CustomFunctions.svelte'
  import AppPrefs from './AppPrefs.svelte'
  import { reportResult } from './feedback'
  import { sentTimes } from './sent.svelte'
  import { GATE_SHORT } from '../overview/overview'
  import FamilySettings from './FamilySettings.svelte'

  const speakerDescId = uid('speaker-desc')

  /** Products on the family drivers (A1, M3, MAX 2, MELO P1) get the ControlSpec-driven page. */
  const generic = $derived(!!session.family && !session.isLegacy)

  const caps = $derived(session.caps)
  const is6118 = $derived(session.product?.family === '6118')
  const s = $derived(session.settings)
  const writeOnly = $derived(session.writeOnly)
  const ready = $derived(session.phase === 'ready')

  // Smart battery life: PID 1041 only (MoreSetting6118ActivityKt.shouldShowSmartBatteryItem).
  const showSmartBattery = $derived(!!caps?.smartBattery && !session.isCameraVariant)
  const showAutoOff = $derived(!!caps?.autoPowerOff)
  const showSpeaker = $derived(!!caps?.speakerPassthrough)
  const speakerLabel = $derived(is6118 ? 'External speaker without unplugging' : 'Phone Speaker')
  const featureCount = $derived(+showSmartBattery + +showAutoOff + +showSpeaker)
  /** M2S Custom Functions need RX firmware above 2.0.0.9; explained when that can't be met here. */
  const customGate = $derived.by(() => {
    if (caps?.customButtons) return null
    const g = session.gate('customButtons')
    return g && (writeOnly || g.state === 'firmware-too-old') ? g.text : null
  })

  // The official screen re-reads smart battery and speaker state on every start.
  let refreshedFor: unknown = null
  $effect(() => {
    const dev = session.device
    if (dev && session.live && session.phase === 'ready' && refreshedFor !== dev) {
      refreshedFor = dev
      void session.refreshSettings()
    }
  })

  async function setSmartBattery(on: boolean) {
    sentTimes.mark('smartBattery')
    reportResult(await session.setSmartBattery(on))
  }
  async function setAutoOff(on: boolean) {
    sentTimes.mark('autoPowerOff')
    reportResult(await session.setAutoPowerOff(on))
  }

  /** Speaker passthrough restarts the receiver, so it is confirmed first. */
  let speakerTarget: boolean | null = $state(null)
  function askSpeaker(on: boolean) {
    speakerTarget = on
  }
  async function applySpeaker() {
    const on = speakerTarget
    speakerTarget = null
    if (on === null) return
    sentTimes.mark('speakerPassthrough')
    await session.applySpeakerPassthrough(on)
  }
</script>

{#if generic}
<FamilySettings />
{:else}
<div class="settings">
  <h1 class="visually-hidden">Settings</h1>

  <Panel title="Feature Settings">
    {#if featureCount === 0}
      <p class="empty">No extra settings</p>
    {:else}
      <div class="mods">
        <!-- One or two modules keep a third of the row each instead of stretching across it. -->
        <Modules
          columns={featureCount >= 3
            ? 'repeat(auto-fit, minmax(min(100%, 250px), 1fr))'
            : 'repeat(auto-fill, minmax(min(100%, 360px), 1fr))'}
        >
          {#if showSmartBattery}
            <BoolSetting
              title="Smart battery life"
              value={s.smartBattery}
              pending={!!session.pending.smartBattery}
              disabled={!ready}
              {writeOnly}
              sentAt={sentTimes.at.smartBattery}
              onchange={setSmartBattery}
            />
          {/if}

          {#if showAutoOff}
            {#if is6118}
              <BoolSetting
                title="Mic auto power-off"
                hint="Shut down after 15 minutes of inactivity"
                value={s.autoPowerOff}
                pending={!!session.pending.autoPowerOff}
                disabled={!ready}
                {writeOnly}
                sentAt={sentTimes.at.autoPowerOff}
                onchange={setAutoOff}
              />
            {:else}
              <BoolSetting
                title="Schedule power off"
                hint="RX and MIC will automatically power off when not paired."
                value={s.autoPowerOff}
                choice={{ on: '15min', off: 'Never' }}
                pending={!!session.pending.autoPowerOff}
                disabled={!ready}
                {writeOnly}
                sentAt={sentTimes.at.autoPowerOff}
                onchange={setAutoOff}
              />
            {/if}
          {/if}

          {#if showSpeaker}
            <BoolSetting
              title={speakerLabel}
              hint="Changing it restarts the receiver"
              value={s.speakerPassthrough}
              pending={session.speakerPending}
              disabled={!ready}
              {writeOnly}
              sentAt={sentTimes.at.speakerPassthrough}
              onchange={askSpeaker}
            />
          {/if}
        </Modules>
      </div>
    {/if}
  </Panel>

  {#if caps?.customButtons}
    <CustomFunctions />
  {:else if customGate}
    <Panel title="Custom Functions">
      <p class="empty" title={customGate}>{GATE_SHORT}<span class="visually-hidden">: {customGate}</span></p>
    </Panel>
  {/if}

  <AppPrefs />
</div>
{/if}

<Dialog
  open={speakerTarget !== null}
  title="Restart the receiver?"
  onclose={() => (speakerTarget = null)}
  describedby="{speakerDescId}-what {speakerDescId}-effect"
>
  {#snippet icon()}<RotateCcw size={20} />{/snippet}
  <p id="{speakerDescId}-what">{speakerLabel}: <strong>{speakerTarget ? 'On' : 'Off'}</strong></p>
  {#if audio.recording}
    <p class="dlg-warn" id="{speakerDescId}-effect">A recording is running and may be lost.</p>
  {:else}
    <p id="{speakerDescId}-effect">Audio stops for a few seconds.</p>
  {/if}
  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <Button variant="secondary" autofocus onclick={() => (speakerTarget = null)}>Cancel</Button>
    <Button variant="primary" onclick={applySpeaker}>Restart and apply</Button>
  {/snippet}
</Dialog>

<style>
  .settings {
    display: grid;
    min-width: 0;
  }
  .mods {
    min-width: 0;
  }
  .empty {
    padding: 18px 0 22px;
    font-size: var(--t-body-sm);
    color: var(--ink-2);
  }
  .dlg-warn {
    color: var(--ink);
    font-weight: 600;
  }
  strong {
    color: var(--ink);
    font-weight: 650;
  }
  @media (min-width: 1280px) {
    .empty {
      padding-left: var(--module-pad);
    }
    .empty {
      padding-top: 24px;
    }
  }
  /* Phones: modules stack as full-width rows aligned with the section heading. */
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
