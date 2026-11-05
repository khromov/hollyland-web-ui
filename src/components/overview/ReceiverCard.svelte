<script lang="ts">
  /**
   * Home-screen device controls (features.md §4.3, §16): every one is RX-global.
   * Block rules (§4.4) are applied with <Blockable>, values come from session.settings
   * (live heartbeat, or what this browser last sent in write-only mode).
   */
  import { ChevronRight, Info } from '@lucide/svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import StepBar from '../../lib/ui/StepBar.svelte'
  import { session, BLOCK_TEXT, type BlockReason } from '../../lib/state/session.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import BoolControl from './BoolControl.svelte'
  import Blockable from './Blockable.svelte'
  import {
    CHANNEL_MODE_HINT,
    CHANNEL_MODE_LABEL,
    PRESET_OPTIONS,
    VOLUME_LOCKED_TEXT,
    noiseLabel,
    noiseOptions,
    normaliseChannelMode,
    volumeLabel,
  } from './overview'

  const caps = $derived(session.caps)
  const s = $derived(session.settings)
  const family = $derived(session.product?.family ?? null)
  const writeOnly = $derived(session.writeOnly)
  const pending = $derived(session.pending)

  const text = (r: BlockReason) => (r ? BLOCK_TEXT[r] : null)
  const micBlock = $derived(text(session.blockReason('mic')))
  const noiseBlock = $derived(text(session.blockReason('noise')))

  /** The app toasts "Setup successful" after every home set; only claim it when the device confirmed. */
  async function apply(write: Promise<boolean>) {
    const ok = await write
    if (ok && session.live) toasts.success('Setup successful', { timeout: 1500 })
  }

  // ------------------------------------------------------------------ noise cancellation
  const ncMax = $derived(caps?.noiseMaxLevel ?? 0)
  const ncOptions = $derived(noiseOptions(ncMax))
  const ncLevel = $derived(s.noiseLevel !== undefined && s.noiseLevel > 0 ? s.noiseLevel : null)
  /** The on/off command is a toggle: it can only be used when the current state is read back. */
  const ncSwitch = $derived(!!caps?.noiseToggle && !writeOnly)
  const ncLevelsVisible = $derived(ncSwitch ? s.noiseEnabled === true : true)
  const ncLabel = $derived(noiseLabel(family))
  /**
   * Seen on a LARK A2 (2026-11-05): switching NC on brings back the last level used, and the
   * button on either transmitter toggles NC (it does not mute). Only claimed for the A2 family.
   */
  const ncButtonToggles = $derived(family === '6118')
  const ncDescription = $derived(
    family === '6118'
      ? 'Reduces steady background noise. Turning it on restores the last level used. Pressing the button on either mic also toggles it; this card follows within a second.'
      : 'Noise cancellation: reduces steady background noise.',
  )
  /** Lark M2 firmware without the on/off switch (live mode, RX version too old). */
  const ncNoToggleFirmware = $derived(!writeOnly && !caps?.noiseToggle)

  // Firmware-gated features of this model the receiver doesn't offer: explained instead of
  // silently missing when the reason is permanent here (write-only, or firmware too old).
  const explain = (g: ReturnType<typeof session.gate>) => (g && (writeOnly || g.state === 'firmware-too-old') ? g.text : null)
  const ledGate = $derived(caps?.led ? null : explain(session.gate('led')))
  const lockGate = $derived(caps?.voiceLock || !session.isCameraVariant ? null : explain(session.gate('voiceLock')))

  // ------------------------------------------------------------------------ volume
  const steps = $derived(caps?.volumeSteps ?? 0)
  const volume = $derived(s.volume !== undefined && s.volume >= 0 && s.volume < steps ? s.volume : null)
  const lockVisible = $derived(!!caps?.voiceLock && session.isCameraVariant)
  const locked = $derived(lockVisible && s.voiceLocked === true)
  const volumeReason = $derived(micBlock ?? (locked ? VOLUME_LOCKED_TEXT : null))

  // ------------------------------------------------------------------- channel mode
  const modes = $derived(caps?.channelModes ?? [])
  const modeOptions = $derived(modes.map((m) => ({ value: m, label: CHANNEL_MODE_LABEL[m] ?? `Mode ${m}`, hint: CHANNEL_MODE_HINT[m] })))
  const mode = $derived(normaliseChannelMode(s.channelMode, family) ?? null)
  const modeDescription = $derived(
    mode !== null && CHANNEL_MODE_HINT[mode]
      ? CHANNEL_MODE_HINT[mode]
      : modes.includes(2)
        ? 'SafeTr: safety track, second channel recorded 6 dB lower.'
        : undefined,
  )

  // ------------------------------------------------------------------ bel canto preset
  const vp = $derived(s.voicePreset)
  const vpPreset = $derived(vp && vp.preset >= 0 && vp.preset <= 2 ? vp.preset : null)
  let vpAction: 'switch' | 'preset' = $state('switch')
  function setVoiceEnabled(on: boolean) {
    vpAction = 'switch'
    // Switch -> setBeautyVoice(enable, currentPreset). Balance when the current preset was never read.
    void apply(session.setVoicePreset(on, vpPreset ?? 2))
  }
  function setVoicePreset(p: number) {
    vpAction = 'preset'
    void apply(session.setVoicePreset(true, p))
  }

  // ------------------------------------------------------------------- light / recognition
  const recognitionVisible = $derived(!!caps?.micRecognition && s.ledOn !== false)
</script>

{#snippet unavailable(label: string, reason: string)}
  <SettingRow {label} disabledReason={reason}>
    {#snippet control()}<Chip>Unavailable</Chip>{/snippet}
  </SettingRow>
{/snippet}

<Card title="Receiver" overline={session.displayName} channel="rx" class="receiver-card">
  <p class="scope">
    {#if writeOnly}
      <Info size={14} aria-hidden="true" />
      <span>These settings apply to both mics. Values shown were last sent from this browser.</span>
    {:else}
      <span>These settings apply to both mics.</span>
    {/if}
  </p>

  <div class="controls">
    {#if ncMax > 0}
      <div class="group">
        {#if ncSwitch}
          <SettingRow label={ncLabel} description={ncDescription} disabledReason={noiseBlock}>
            {#snippet control()}
              <Blockable reason={noiseBlock}>
                <BoolControl
                  value={s.noiseEnabled}
                  label={ncLabel}
                  pending={!!pending.noiseEnabled}
                  onchange={(v) => apply(session.setNoiseEnabled(v))}
                />
              </Blockable>
            {/snippet}
            {#if ncLevelsVisible}
              <Blockable reason={noiseBlock}>
                <SegmentedControl
                  options={ncOptions}
                  value={ncLevel}
                  label="{ncLabel} level"
                  pendingValue={pending.noiseLevel ? ncLevel : null}
                  onchange={(v) => apply(session.setNoiseLevel(v))}
                />
              </Blockable>
            {/if}
          </SettingRow>
        {:else}
          <SettingRow
            label={ncLabel}
            description={writeOnly ? 'Choose a level to send it to the receiver.' : ncDescription}
            disabledReason={noiseBlock}
            stacked
          >
            {#snippet control()}
              <Blockable reason={noiseBlock}>
                <SegmentedControl
                  options={ncOptions}
                  value={ncLevel}
                  label="{ncLabel} level"
                  pendingValue={pending.noiseLevel ? ncLevel : null}
                  onchange={(v) => apply(session.setNoiseLevel(v))}
                />
              </Blockable>
            {/snippet}
            {#if ncNoToggleFirmware}
              {@const g = session.gate('noiseToggle')}
              {#if g?.state === 'firmware-too-old'}
                <p class="note">
                  <Info size={14} aria-hidden="true" />
                  <span>The on/off switch {g.text.charAt(0).toLowerCase() + g.text.slice(1)}</span>
                </p>
              {/if}
            {:else if session.product?.capabilities?.noiseToggle}
              <p class="note">
                <Info size={14} aria-hidden="true" />
                <span>
                  Turning noise cancellation fully off needs a live connection (Linux, ChromeOS or the local bridge). The
                  receiver only offers an on/off toggle, and this browser can't read which state it is in.{#if ncButtonToggles}{' '}Pressing
                    the button on either mic also toggles it, and turning it on restores the last level used.{/if}
                </span>
              </p>
            {/if}
          </SettingRow>
        {/if}
      </div>
    {/if}

    {#if steps > 0}
      <div class="group">
        <SettingRow label={volumeLabel(family)} disabledReason={volumeReason} stacked>
          {#snippet control()}
            <Blockable reason={volumeReason}>
              <StepBar
                {steps}
                value={volume}
                label={volumeLabel(family)}
                pending={!!pending.volume}
                onchange={(i) => apply(session.setVolume(i))}
              />
            </Blockable>
          {/snippet}
        </SettingRow>
        {#if lockVisible}
          <!-- The official lock handler has no "mic offline" check (HLDevice6302Activity.onClick voice_lock). -->
          <SettingRow label="Volume lock" description="Stops volume changes until unlocked.">
            {#snippet control()}
              <BoolControl
                value={s.voiceLocked}
                label="Volume lock"
                pending={!!pending.voiceLocked}
                onchange={(v) => apply(session.setVoiceLock(v))}
              />
            {/snippet}
          </SettingRow>
        {:else if lockGate}
          {@render unavailable('Volume lock', lockGate)}
        {/if}
      </div>
    {/if}

    {#if modes.length > 0}
      <div class="group">
        <SettingRow label="Channel Mode" description={modeDescription} disabledReason={micBlock} stacked>
          {#snippet control()}
            <Blockable reason={micBlock}>
              <SegmentedControl
                options={modeOptions}
                value={mode}
                label="Channel Mode"
                pendingValue={pending.channelMode ? mode : null}
                onchange={(v) => apply(session.setChannelMode(v))}
              />
            </Blockable>
          {/snippet}
        </SettingRow>
      </div>
    {/if}

    {#if caps?.voicePreset}
      <div class="group">
        <SettingRow label="Bel canto preset" description="On-receiver voice tone." disabledReason={micBlock}>
          {#snippet control()}
            <Blockable reason={micBlock}>
              <BoolControl
                value={vp?.enabled}
                label="Bel canto preset"
                pending={!!pending.voicePreset && vpAction === 'switch'}
                onchange={setVoiceEnabled}
              />
            </Blockable>
          {/snippet}
          {#if vp?.enabled}
            <Blockable reason={micBlock}>
              <SegmentedControl
                options={PRESET_OPTIONS}
                value={vpPreset}
                label="Bel canto preset"
                pendingValue={pending.voicePreset && vpAction === 'preset' ? vpPreset : null}
                onchange={setVoicePreset}
              />
            </Blockable>
          {/if}
        </SettingRow>
      </div>
    {/if}

    {#if caps?.led}
      <div class="group">
        <SettingRow
          label="Indicator Light Switch"
          description="Turns the indicator lights on or off."
          disabledReason={micBlock}
        >
          {#snippet control()}
            <Blockable reason={micBlock}>
              <BoolControl
                value={s.ledOn}
                label="Indicator Light Switch"
                pending={!!pending.ledOn}
                onchange={(v) => apply(session.setLed(v))}
              />
            </Blockable>
          {/snippet}
        </SettingRow>
        {#if recognitionVisible}
          <SettingRow
            label="Mic Recognition"
            description="Uses the indicator lights to tell Mic 1 and Mic 2 apart."
            disabledReason={micBlock}
          >
            {#snippet control()}
              <Blockable reason={micBlock}>
                <BoolControl
                  value={s.micRecognition}
                  label="Mic Recognition"
                  pending={!!pending.micRecognition}
                  onchange={(v) => apply(session.setMicRecognition(v))}
                />
              </Blockable>
            {/snippet}
          </SettingRow>
        {/if}
      </div>
    {:else if ledGate}
      <div class="group">
        {@render unavailable('Indicator Light Switch', ledGate)}
      </div>
    {/if}
  </div>

  <a class="more" href="#/settings">
    <span>More Settings</span>
    <ChevronRight size={16} aria-hidden="true" />
  </a>
</Card>

<style>
  .scope {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-muted);
    margin-bottom: var(--space-1);
  }
  .scope :global(svg) {
    flex: none;
    margin-top: 3px;
    color: var(--color-warning);
  }
  .controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    column-gap: var(--space-6);
  }
  .group {
    border-top: 1px solid var(--color-border);
    min-width: 0;
  }
  .group:first-child {
    border-top: 0;
  }
  .group > :global(.row + .row) {
    border-top: 1px dashed var(--color-border);
  }
  @container (min-width: 640px) {
    .controls {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .group:nth-child(2) {
      border-top: 0;
    }
  }
  .note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-subtle);
  }
  .note :global(svg) {
    flex: none;
    margin-top: 3px;
  }
  .more {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--hit-min);
    margin: var(--space-2) 0 calc(-1 * var(--space-2));
    border-top: 1px solid var(--color-border);
    color: var(--color-text);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .more:hover {
    color: var(--color-accent);
  }
  .more :global(svg) {
    color: var(--color-text-subtle);
  }
</style>
