<script lang="ts">
  /**
   * The receiver strip: home-screen device controls (features.md §4.3, §16), all RX-global, read
   * left to right like a mixer's control row: noise cancellation, volume, channel mode, Bel canto,
   * indicator light (with mic recognition nested under it).
   *
   * Every control says how much is known about its value (styles/instrument.css):
   *  - live link: read back from the receiver (solid)
   *  - write-only link: last sent from this browser (hatched, "Last sent 17:42 · not confirmed")
   *    or never sent (nothing chosen, "Not read"). On/off settings become "Off | On" send pairs;
   *    the A2's noise on/off is a toggle, so it can't be sent blind and only the levels are offered.
   * Block rules (§4.4) are shown in place with their reason (Blockable).
   */
  import type { Snippet } from 'svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import Fader from '../../lib/ui/Fader.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import { uid } from '../../lib/ui/field'
  import type { Confidence } from '../../lib/ui/types'
  import { session, BLOCK_TEXT, type BlockReason } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Blockable from './Blockable.svelte'
  import Note from './Note.svelte'
  import { apply, sentClock } from './sent.svelte'
  import {
    CHANNEL_MODE_FOOT,
    CHANNEL_MODE_LABEL,
    PRESET_OPTIONS,
    VOLUME_LOCKED_TEXT,
    channelModeOptions,
    noiseLabel,
    noiseOptions,
    volumeLabel,
  } from './overview'

  interface Props {
    /** One row of modules (≥ 1280 px); otherwise the page's --ov-cols per breakpoint. */
    wide: boolean
    /** LED colour names of TX1 / TX2 (M2S can swap them). */
    ledNames: [string, string]
  }
  let { wide, ledNames }: Props = $props()

  const caps = $derived(session.caps)
  const s = $derived(session.settings)
  const family = $derived(session.product?.family ?? null)
  const writeOnly = $derived(session.writeOnly)
  const pending = $derived(session.pending)

  const text = (r: BlockReason) => (r ? BLOCK_TEXT[r] : null)
  const micBlock = $derived(text(session.blockReason('mic')))
  const noiseBlock = $derived(text(session.blockReason('noise')))
  /**
   * "Mic not connected" blocks every module: it is said once above the strip and each control
   * points at it; reasons of a single module (all mics muted, light off, volume locked) stay there.
   */
  const stripReasonId = uid('strip-reason')
  const rid = (reason: string | null, local: string) => (reason && reason === micBlock ? stripReasonId : local)
  const own = (reason: string | null) => (reason && reason !== micBlock ? reason : null)

  /**
   * Confidence of a value: read back (live), last sent (write-only), or unknown (never read or
   * sent). Unknown keys are dashed and still operable: sending a value is always possible.
   */
  const conf = (v: unknown): Confidence => (v === undefined || v === null ? 'unknown' : writeOnly ? 'sent' : 'solid')

  // Firmware-gated features of this model the receiver doesn't offer: explained instead of
  // silently missing when the reason is permanent here (write-only, or firmware too old).
  const explain = (g: ReturnType<typeof session.gate>) => (g && (writeOnly || g.state === 'firmware-too-old') ? g.text : null)

  // ------------------------------------------------------------------ noise cancellation
  const ncMax = $derived(caps?.noiseMaxLevel ?? 0)
  const ncOptions = $derived(noiseOptions(ncMax))
  const ncLevel = $derived(s.noiseLevel !== undefined && s.noiseLevel > 0 ? s.noiseLevel : null)
  const ncLabel = $derived(noiseLabel(family))
  /** The on/off command is a toggle: it can only be used when the current state is read back. */
  const ncSwitch = $derived(!!caps?.noiseToggle && !writeOnly)
  /** The model has the toggle (so "off" exists), but this link can't use it. */
  const ncToggleBlind = $derived(writeOnly && !!session.product?.capabilities?.noiseToggle)
  /** Lark M2 firmware without the on/off switch (live mode, RX version too old). */
  const ncToggleGate = $derived(!writeOnly && !caps?.noiseToggle ? session.gate('noiseToggle') : null)
  const ncOff = $derived(ncSwitch && s.noiseEnabled === false)
  /** Why the level keys can't be used: a block rule, or NC switched off. */
  const ncKeysReason = $derived(noiseBlock ?? (ncOff ? 'Switch on to choose a level.' : null))
  const ncReasonId = uid('nc-reason')
  const ncKeysReasonId = uid('nc-keys-reason')

  // ------------------------------------------------------------------------ volume
  const steps = $derived(caps?.volumeSteps ?? 0)
  const volume = $derived(s.volume !== undefined && s.volume >= 0 && s.volume < steps ? s.volume : null)
  const lockVisible = $derived(!!caps?.voiceLock && session.isCameraVariant)
  const lockGate = $derived(caps?.voiceLock || !session.isCameraVariant ? null : explain(session.gate('voiceLock')))
  const locked = $derived(lockVisible && s.voiceLocked === true)
  const volumeReason = $derived(micBlock ?? (locked ? VOLUME_LOCKED_TEXT : null))
  const volReasonId = uid('vol-reason')

  // ------------------------------------------------------------------- channel mode
  const modes = $derived(caps?.channelModes ?? [])
  const modeOptions = $derived(channelModeOptions(modes))
  const mode = $derived(session.channelModeSetting)

  // ------------------------------------------------------------------ bel canto preset
  const vp = $derived(s.voicePreset)
  const vpPreset = $derived(vp && vp.preset >= 0 && vp.preset <= 2 ? vp.preset : null)
  let vpAction: 'switch' | 'preset' = $state('switch')
  function setVoiceEnabled(on: boolean) {
    vpAction = 'switch'
    // Switch -> setBeautyVoice(enable, currentPreset). Balance when the current preset was never read.
    void apply('voicePreset', session.setVoicePreset(on, vpPreset ?? 2))
  }
  function setVoicePreset(p: number) {
    vpAction = 'preset'
    void apply('voicePreset', session.setVoicePreset(true, p))
  }
  /** Live: the tones wait for the switch. Write-only: a tone can be sent at any time (it switches on). */
  const vpKeysReason = $derived(micBlock ?? (!writeOnly && vp !== undefined && !vp.enabled ? 'Switch on to choose a tone.' : null))
  const vpReasonId = uid('vp-reason')

  // ------------------------------------------------------------------- light / recognition
  const ledGate = $derived(caps?.led ? null : explain(session.gate('led')))
  const recBlock = $derived(micBlock ?? (s.ledOn === false ? 'Mic recognition needs the indicator light on.' : null))
  const recReasonId = uid('rec-reason')
  const recOn = $derived(s.micRecognition === true && s.ledOn !== false)

  /** Desktop: one row, weighted like the mockup (NC 1.05, volume 1, channel mode 1.08, Bel canto 1, light 1). */
  const columns = $derived(
    wide
      ? [
          ncMax > 0 && 'minmax(0, 1.05fr)',
          steps > 0 && 'minmax(0, 1fr)',
          modes.length > 0 && 'minmax(0, 1.08fr)',
          caps?.voicePreset && 'minmax(0, 1fr)',
          (caps?.led || ledGate) && 'minmax(0, 1fr)',
        ]
          .filter(Boolean)
          .join(' ') || 'minmax(0, 1fr)'
      : 'var(--ov-cols, minmax(0, 1fr))',
  )
</script>

<!--
  An on/off setting at a module head: a slide switch when the value is read back; "Off | On" send
  keys when it can't be read (write-only) or the receiver didn't report it (live). The caption under
  the control says which (bool note).
-->
{#snippet onOff(value: boolean | undefined | null, label: string, busy: boolean, onchange: (v: boolean) => void, legends?: { on: string; off: string })}
  {#if writeOnly || value === undefined || value === null}
    <SendPair value={value ?? null} {label} {legends} pending={busy} {onchange} />
  {:else}
    <SlideSwitch checked={value} {label} pending={busy} {onchange} />
  {/if}
{/snippet}

<!-- The confidence caption under a control: write-only "Last sent 17:42 · not confirmed" / "Not read";
     live "Not read: the receiver didn't report it". -->
{#snippet sentNote(key: string, value: unknown, what?: Snippet)}
  {#if value === undefined || value === null}
    <Note kind="unknown">{writeOnly ? 'Not read · pick one to send it' : "Not read: the receiver didn't report it"}</Note>
  {:else if writeOnly}
    {@const at = sentClock.time(key)}
    <Note kind="sent">
      {#if what}{@render what()}{#if at}&nbsp;at <span class="mono">{at}</span>{/if}{:else}Last sent{#if at}&nbsp;<span class="mono">{at}</span>{/if}{/if} · not confirmed
    </Note>
  {/if}
{/snippet}

{#snippet unknownVolume()}Unknown · last sent <span class="mono">{(volume ?? 0) + 1}</span>{/snippet}
{#snippet vpWhat()}Last sent <b>{vp?.enabled ? (PRESET_OPTIONS[vpPreset ?? 2]?.label ?? 'On') : 'Off'}</b>{/snippet}

{#snippet reasonNote(id: string, reason: string | null)}
  {#if reason}<Note kind="disabled" {id}>{reason}</Note>{/if}
{/snippet}

{#if micBlock}
  <div class="strip-block">
    <Note kind="disabled" id={stripReasonId}>{micBlock}</Note>
  </div>
{/if}
<Modules {columns} class="strip">
  {#if ncMax > 0}
    <Module title={ncLabel} description="Reduces steady background noise such as fans and traffic." class="m-nc">
      {#snippet head()}
        {#if ncSwitch}
          <Blockable reason={noiseBlock} reasonId={rid(noiseBlock, ncReasonId)} inline>
            {@render onOff(s.noiseEnabled, ncLabel, !!pending.noiseEnabled, (v) => apply('noiseEnabled', session.setNoiseEnabled(v)))}
          </Blockable>
        {/if}
      {/snippet}
      <Blockable reason={ncKeysReason} reasonId={rid(ncKeysReason, ncKeysReason === noiseBlock ? ncReasonId : ncKeysReasonId)}>
        <KeyGroup
          options={ncOptions}
          value={ncOff ? null : ncLevel}
          label="{ncLabel} level"
          confidence={ncOff ? 'solid' : writeOnly ? conf(ncLevel) : s.noiseLevel === undefined ? 'unknown' : 'solid'}
          pendingValue={pending.noiseLevel ? ncLevel : null}
          onchange={(v) => apply('noiseLevel', session.setNoiseLevel(v))}
        />
      </Blockable>
      {@render reasonNote(ncReasonId, own(noiseBlock))}
      {#if !noiseBlock && ncOff}
        <Note kind="disabled" id={ncKeysReasonId}>Switch on to choose a level.</Note>
      {/if}
      {#if !ncOff && (writeOnly || s.noiseLevel === undefined)}{@render sentNote('noiseLevel', writeOnly ? ncLevel : undefined)}{/if}
      {#if ncSwitch && s.noiseEnabled === undefined}{@render sentNote('noiseEnabled', undefined)}{/if}
      {#if ncToggleBlind}
        <Note kind="disabled">Turning {ncLabel === 'NC' || ncLabel === 'NC Level' ? 'NC' : 'noise cancellation'} off needs a live connection.</Note>
      {:else if ncToggleGate?.state === 'firmware-too-old'}
        <Note kind="disabled">The on/off switch {ncToggleGate.text.charAt(0).toLowerCase() + ncToggleGate.text.slice(1)}</Note>
      {/if}
      {#snippet foot()}
        {#if family === '6118'}The button on either mic switches this on or off; it doesn't mute.{/if}
      {/snippet}
    </Module>
  {/if}

  {#if steps > 0}
    <Module
      title={volumeLabel(family)}
      description="Output level to the camera or computer."
      value={volume === null ? null : volume + 1}
      total={steps}
      confidence={conf(volume)}
      class="m-vol"
    >
      <Blockable reason={volumeReason} reasonId={rid(volumeReason, volReasonId)}>
        <Fader
          {steps}
          value={volume}
          label={volumeLabel(family)}
          pending={!!pending.volume}
          confidence={conf(volume)}
          onchange={(i) => apply('volume', session.setVolume(i))}
        />
      </Blockable>
      {@render reasonNote(volReasonId, own(volumeReason))}
      {#if writeOnly && volume !== null}
        {@render sentNote('volume', volume, unknownVolume)}
      {:else if volume === null}
        <!-- The Lark M2 mobile RX (PID 7) doesn't report its volume (HLDeviceActivity reads it from PID 8 up). -->
        <Note kind="unknown">{writeOnly ? 'Not read · pick a step to send it' : "Not read: the receiver didn't report it"}</Note>
      {/if}
      {#if lockVisible}
        <!-- The official lock handler has no "mic offline" check (HLDevice6302Activity.onClick voice_lock). -->
        <Module title="Volume lock" nested pad="none" level={4}>
          {#snippet head()}
            {@render onOff(
              s.voiceLocked,
              'Volume lock',
              !!pending.voiceLocked,
              (v) => apply('voiceLocked', session.setVoiceLock(v)),
              writeOnly || s.voiceLocked === undefined ? { off: 'Unlocked', on: 'Locked' } : undefined,
            )}
          {/snippet}
          {@render sentNote('voiceLocked', s.voiceLocked)}
        </Module>
      {:else if lockGate}
        <Module title="Volume lock" nested pad="none" level={4}>
          <Note kind="disabled">{lockGate}</Note>
        </Module>
      {/if}
      {#snippet foot()}Lower it if the camera's input clips.{/snippet}
    </Module>
  {/if}

  {#if modes.length > 0}
    <Module title="Channel mode" description="How the two mics reach the output." class="m-mode">
      <Blockable reason={micBlock} reasonId={stripReasonId}>
        <KeyGroup
          options={modeOptions}
          value={mode}
          label="Channel mode"
          size="tall"
          confidence={conf(mode)}
          pendingValue={pending.channelMode ? mode : null}
          onchange={(v) => apply('channelMode', session.setChannelMode(v))}
        />
      </Blockable>
      {@render sentNote('channelMode', mode)}
      {#snippet foot()}
        {#if mode !== null && CHANNEL_MODE_FOOT[mode]}
          <b>{CHANNEL_MODE_LABEL[mode]}</b> · {CHANNEL_MODE_FOOT[mode]}
        {:else if modes.includes(2)}
          SafeTr adds a safety copy 6 dB lower.
        {/if}
      {/snippet}
    </Module>
  {/if}

  {#if caps?.voicePreset}
    <Module title="Bel canto preset" description="On-receiver voice tone." class="m-vp">
      {#snippet head()}
        <Blockable reason={micBlock} reasonId={stripReasonId} inline>
          {@render onOff(vp ? vp.enabled : undefined, 'Bel canto preset', !!pending.voicePreset && vpAction === 'switch', setVoiceEnabled)}
        </Blockable>
      {/snippet}
      <Blockable reason={vpKeysReason} reasonId={rid(vpKeysReason, vpReasonId)}>
        <KeyGroup
          options={PRESET_OPTIONS}
          value={vp?.enabled ? vpPreset : null}
          label="Bel canto tone"
          confidence={vpKeysReason ? 'solid' : conf(vp?.enabled ? vpPreset : null)}
          pendingValue={pending.voicePreset && vpAction === 'preset' ? vpPreset : null}
          onchange={setVoicePreset}
        />
      </Blockable>
      {@render reasonNote(vpReasonId, own(vpKeysReason))}
      {#if writeOnly || vp === undefined}{@render sentNote('voicePreset', vp, vpWhat)}{/if}
    </Module>
  {/if}

  {#if caps?.led}
    <Module title="Indicator light" description="Status LEDs on both mics." class="m-led">
      {#snippet head()}
        <Blockable reason={micBlock} reasonId={stripReasonId} inline>
          {@render onOff(s.ledOn, 'Indicator Light Switch', !!pending.ledOn, (v) => apply('ledOn', session.setLed(v)))}
        </Blockable>
      {/snippet}
      {@render sentNote('ledOn', s.ledOn)}
      {#if caps.micRecognition}
        <Module title="Mic recognition" nested pad="none" level={4}>
          {#snippet head()}
            <Blockable reason={recBlock} reasonId={rid(recBlock, recReasonId)} inline>
              {@render onOff(s.micRecognition, 'Mic Recognition', !!pending.micRecognition, (v) =>
                apply('micRecognition', session.setMicRecognition(v)),
              )}
            </Blockable>
          {/snippet}
          {#if own(recBlock)}
            <!-- Blocked: only the reason (a "pick one to send it" next to it would contradict it). -->
            <Note kind="disabled" id={recReasonId}>{recBlock}</Note>
          {:else if recBlock}
            <!-- said above the strip -->
          {:else}
            {@render sentNote('micRecognition', s.micRecognition)}
            {#if recOn}
              <ul class="ledpair" aria-label="Recognition colours">
                <li><Lamp color="mic1" size="sm" />{prefs.micLabel(0)} glows {ledNames[0]}</li>
                <li><Lamp color="mic2" size="sm" />{prefs.micLabel(1)} glows {ledNames[1]}</li>
              </ul>
            {:else if !writeOnly && s.micRecognition !== undefined}
              <p class="hint">Lights each mic in its own colour.</p>
            {/if}
          {/if}
        </Module>
      {/if}
    </Module>
  {:else if ledGate}
    <Module title="Indicator light" class="m-led">
      <Note kind="disabled">{ledGate}</Note>
    </Module>
  {/if}
</Modules>

<style>
  :global(.strip) .ledpair {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .ledpair li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .strip-block {
    padding: 14px var(--module-pad) 12px;
    border-bottom: 1px solid var(--rule);
  }
  .strip-block :global(.note) {
    font-size: 13px;
  }
  @media (max-width: 599px) {
    .strip-block {
      padding-inline: var(--gutter);
    }
  }
  .hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-3);
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    color: var(--ink);
  }
</style>
