<script lang="ts">
  /**
   * "More Settings" equivalent (features.md §5 for the A2, §16.1 / §16.2 for the M2S / M2):
   * Feature Settings (receiver), Custom Functions (M2S) and this browser's preferences.
   * Every receiver setting is kit-wide (RX-global).
   */
  import { RotateCcw } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import BoolSetting from './BoolSetting.svelte'
  import CustomFunctions from './CustomFunctions.svelte'
  import AppPrefs from './AppPrefs.svelte'
  import { reportResult, watchNarrow } from './feedback'

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
  const hasFeatures = $derived(showSmartBattery || showAutoOff || showSpeaker)
  /** M2S Custom Functions need RX firmware above 2.0.0.9; explained when that can't be met here. */
  const customGate = $derived.by(() => {
    if (caps?.customButtons) return null
    const g = session.gate('customButtons')
    return g && (writeOnly || g.state === 'firmware-too-old') ? g.text : null
  })

  let narrow = $state(false)
  $effect(() => watchNarrow('(max-width: 479px)', (v) => (narrow = v)))

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
    reportResult(await session.setSmartBattery(on))
  }
  async function setAutoOff(on: boolean) {
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
    await session.applySpeakerPassthrough(on)
  }
</script>

<div class="page">
  <div class="intro">
    <h1>Settings</h1>
    <p>
      Receiver settings apply to the whole kit{session.product ? ` (${session.displayName})` : ''}. App preferences stay in
      this browser.
    </p>
  </div>

  <div class="layout">
    <div class="col main">
      <Card title="Feature Settings" overline="Receiver">
        {#if !hasFeatures}
          <p class="empty">This receiver has no extra settings here. Its controls are on the Overview page.</p>
        {/if}

        {#if showSmartBattery}
          <BoolSetting
            label="Smart battery life"
            description="A power-saving option of the receiver. The official app doesn't describe it further."
            value={s.smartBattery}
            pending={!!session.pending.smartBattery}
            disabled={!ready}
            {writeOnly}
            {narrow}
            onchange={setSmartBattery}
          />
        {/if}

        {#if showAutoOff}
          {#if is6118}
            <BoolSetting
              label="Mic auto power-off"
              description="Shut down after 15 minutes of inactivity"
              value={s.autoPowerOff}
              pending={!!session.pending.autoPowerOff}
              disabled={!ready}
              {writeOnly}
              {narrow}
              onchange={setAutoOff}
            />
          {:else}
            <BoolSetting
              label="Schedule power off"
              description="RX and MIC will automatically power off when not paired."
              value={s.autoPowerOff}
              choice={{ on: '15min', off: 'Never' }}
              pending={!!session.pending.autoPowerOff}
              disabled={!ready}
              {writeOnly}
              {narrow}
              onchange={setAutoOff}
            />
          {/if}
        {/if}

        {#if showSpeaker}
          <BoolSetting
            label={speakerLabel}
            description="Lets the phone or computer keep playing sound through its own speaker while the receiver is plugged in. Changing it restarts the receiver."
            value={s.speakerPassthrough}
            pending={session.speakerPending}
            disabled={!ready}
            {writeOnly}
            {narrow}
            onchange={askSpeaker}
          />
        {/if}

        {#if session.product?.family === '6301'}
          <p class="empty">The Lark M2 receiver has no channel-mode or auto power-off setting.</p>
        {/if}
      </Card>

      {#if caps?.customButtons}
        <CustomFunctions />
      {:else if customGate}
        <Card title="Custom Functions" overline="Receiver buttons">
          <SettingRow label="Custom Functions" disabledReason={customGate}>
            {#snippet control()}<Chip>Unavailable</Chip>{/snippet}
          </SettingRow>
        </Card>
      {/if}
    </div>

    <div class="col side">
      <AppPrefs {narrow} />
    </div>
  </div>
</div>

<Dialog open={speakerTarget !== null} title="Restart the receiver?" onclose={() => (speakerTarget = null)}>
  {#snippet icon()}<RotateCcw size={22} />{/snippet}
  <p>
    {speakerLabel}: <strong>{speakerTarget ? 'On' : 'Off'}</strong>.
  </p>
  <p class="dlg-text">The receiver will restart to apply this. Audio from the receiver stops for a few seconds.</p>
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
  .page {
    display: grid;
    gap: var(--space-5);
  }
  .intro h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-2xl);
  }
  .intro p {
    color: var(--color-text-muted);
    max-width: 70ch;
    margin-top: var(--space-1);
  }
  .layout {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .col {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 3fr) minmax(340px, 2fr);
    }
  }
  @media (min-width: 1600px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 520px;
    }
  }
  .empty {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    padding: var(--space-3) 0;
  }
  .dlg-text {
    margin-top: var(--space-2);
  }
  .dlg-warn {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-warning);
  }
  .dlg-note {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  strong {
    color: var(--color-text);
  }
</style>
