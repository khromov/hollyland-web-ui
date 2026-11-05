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
  import Module from '../../lib/ui/Module.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import BoolSetting from './BoolSetting.svelte'
  import CustomFunctions from './CustomFunctions.svelte'
  import AppPrefs from './AppPrefs.svelte'
  import { reportResult } from './feedback'
  import { sentTimes } from './sent.svelte'

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

<div class="settings">
  <h1 class="visually-hidden">Settings</h1>

  <Panel
    title="Feature Settings"
    description={session.displayName
      ? `Stored on the ${session.displayName} receiver. They apply to the whole kit.`
      : 'Stored on the receiver. They apply to the whole kit.'}
    meta={session.product?.family === '6301' ? m2Note : undefined}
  >
    {#if featureCount === 0}
      <p class="empty">This receiver has no extra settings here. Its controls are on the Overview page.</p>
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
              description="A power-saving option of the receiver. The official app doesn't describe it further."
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
                description="Shut down after 15 minutes of inactivity"
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
                description="RX and MIC will automatically power off when not paired."
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
              description="Lets the phone or computer keep playing sound through its own speaker while the receiver is plugged in."
              value={s.speakerPassthrough}
              pending={session.speakerPending}
              disabled={!ready}
              {writeOnly}
              sentAt={sentTimes.at.speakerPassthrough}
              note="Changing it restarts the receiver."
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
    <Panel title="Custom Functions" description="Extra jobs for the receiver and mic buttons.">
      <div class="mods">
        <Modules min="250px">
          <Module title="Custom Functions">
            {#snippet foot()}<ConfidenceNote kind="disabled" text={customGate} />{/snippet}
          </Module>
        </Modules>
      </div>
    </Panel>
  {/if}

  <AppPrefs />
</div>

{#snippet m2Note()}The Lark M2 receiver has no channel-mode or auto power-off setting.{/snippet}

<Dialog open={speakerTarget !== null} title="Restart the receiver?" onclose={() => (speakerTarget = null)}>
  {#snippet icon()}<RotateCcw size={20} />{/snippet}
  <p>
    {speakerLabel}: <strong>{speakerTarget ? 'On' : 'Off'}</strong>.
  </p>
  <p>The receiver will restart to apply this. Audio from the receiver stops for a few seconds.</p>
  {#if audio.recording}
    <p class="dlg-warn">
      A recording is running. Stop it on the Audio page first: the receiver's audio input disappears during the
      restart, and the recording may be lost.
    </p>
  {/if}
  {#if writeOnly}
    <p class="dlg-note">This system can't confirm the change. The page reconnects when the receiver comes back.</p>
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
  .dlg-note {
    font-size: var(--t-body-sm);
    color: var(--ink-3);
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
