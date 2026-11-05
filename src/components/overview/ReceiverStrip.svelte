<script lang="ts">
  /**
   * The receiver strip: home-screen device controls (features.md §4.3, §16), all RX-global, read
   * left to right like a mixer's control row: noise cancellation, volume, channel mode, Bel canto,
   * indicator light (with mic recognition nested under it). Label, value and control only.
   *
   * How much is known about a value is shown by the control's style (styles/instrument.css) and
   * said in the control's own tooltip / accessible description, never in visible captions:
   *  - read back from the receiver: solid
   *  - write-only link: last sent from this browser (hatched, "Last sent 17:42 · not confirmed")
   *    or never sent (dashed, "Unknown"). On/off settings become "Off | On" send pairs; the A2's
   *    noise on/off is a toggle, so it can't be sent blind and only the levels are offered.
   * What a module does is its title's tooltip (Module `description`).
   * Block rules (§4.4) are shown in place with a short reason (Blockable).
   */
  import Module from '../../lib/ui/Module.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import Fader from '../../lib/ui/Fader.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import { uid } from '../../lib/ui/field'
  import type { Confidence } from '../../lib/ui/types'
  import { session, type BlockReason } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Blockable from './Blockable.svelte'
  import Note from './Note.svelte'
  import { apply, sentClock } from './sent.svelte'
  import {
    BLOCK_SHORT,
    GATE_SHORT,
    LIGHT_OFF_TEXT,
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

  const text = (r: BlockReason) => (r ? BLOCK_SHORT[r] : null)
  const micBlock = $derived(text(session.blockReason('mic')))
  const noiseBlock = $derived(text(session.blockReason('noise')))
  /**
   * "No mic connected" blocks every module: it is said once above the strip and each control
   * points at it; reasons of a single module (mics muted, light off, volume locked) stay there.
   */
  const stripReasonId = uid('strip-reason')
  const rid = (reason: string | null, local: string) => (reason && reason === micBlock ? stripReasonId : local)
  const own = (reason: string | null) => (reason && reason !== micBlock ? reason : null)

  /**
   * Confidence of a value: read back (live), last sent (write-only), or unknown (never read or
   * sent). Unknown keys are dashed and still operable: sending a value is always possible.
   */
  const conf = (v: unknown): Confidence => (v === undefined || v === null ? 'unknown' : writeOnly ? 'sent' : 'solid')
  /** When a write-only value was sent from this browser (the controls' tooltip). */
  const at = (key: string) => (writeOnly ? sentClock.at(key) : null)

  // Firmware-gated features of this model the receiver doesn't offer: said (shortly) instead of
  // silently missing when the reason is permanent here (write-only, or firmware too old).
  const explain = (g: ReturnType<typeof session.gate>) => (g && (writeOnly || g.state === 'firmware-too-old') ? g.text : null)

  // ------------------------------------------------------------------ noise cancellation
  const ncMax = $derived(caps?.noiseMaxLevel ?? 0)
  const ncOptions = $derived(noiseOptions(ncMax))
  const ncLevel = $derived(s.noiseLevel !== undefined && s.noiseLevel > 0 ? s.noiseLevel : null)
  const ncLabel = $derived(noiseLabel(family))
  const ncShort = $derived(ncLabel === 'Noise cancellation' ? 'noise cancellation' : 'NC')
  /** The on/off command is a toggle: it can only be used when the current state is read back. */
  const ncSwitch = $derived(!!caps?.noiseToggle && !writeOnly)
  /** The model has the toggle (so "off" exists), but this link can't use it. */
  const ncToggleBlind = $derived(writeOnly && !!session.product?.capabilities?.noiseToggle)
  /** Lark M2 firmware without the on/off switch (live mode, RX version too old). */
  const ncToggleGate = $derived(!writeOnly && !caps?.noiseToggle ? session.gate('noiseToggle') : null)
  const ncOff = $derived(ncSwitch && s.noiseEnabled === false)
  /** Why the level keys can't be used: a block rule, or NC switched off (said in the toast only). */
  const ncKeysReason = $derived(noiseBlock ?? (ncOff ? `Turn on ${ncShort} first` : null))
  const ncReasonId = uid('nc-reason')
  const ncKeysReasonId = uid('nc-keys-reason')
  /** Title tooltip: the 6118 mic buttons toggle NC (they don't mute); off can't be sent blind. */
  const ncHint = $derived(
    ncToggleBlind ? "Can't be switched off here" : family === '6118' ? 'The button on either mic toggles this' : undefined,
  )

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
  /** Live: the tones wait for the switch (said in the toast only). Write-only: a tone can be sent at any time (it switches on). */
  const vpKeysReason = $derived(micBlock ?? (!writeOnly && vp !== undefined && !vp.enabled ? 'Turn on Bel canto first' : null))
  const vpReasonId = uid('vp-reason')

  // ------------------------------------------------------------------- light / recognition
  const ledGate = $derived(caps?.led ? null : explain(session.gate('led')))
  const recBlock = $derived(micBlock ?? (s.ledOn === false ? LIGHT_OFF_TEXT : null))
  const recReasonId = uid('rec-reason')
  const recOn = $derived(s.micRecognition === true && s.ledOn !== false)

  /**
   * Desktop: one row, weighted like the mockup (NC 1.05, volume 1, channel mode 1.08, Bel canto 1,
   * light 1). Write-only, Bel canto and the light carry wider "Off | On" pairs at their heads (the
   * light a nested one too): they take room from the volume fader, which can give it, so titles
   * and pairs stay on one line and the channel mode keys keep theirs.
   */
  const w = $derived(writeOnly ? { nc: 1, vol: 0.78, mode: 1.1, pair: 1.16 } : { nc: 1.05, vol: 1, mode: 1.08, pair: 1 })
  const columns = $derived(
    wide
      ? [
          ncMax > 0 && `minmax(0, ${w.nc}fr)`,
          steps > 0 && `minmax(0, ${w.vol}fr)`,
          modes.length > 0 && `minmax(0, ${w.mode}fr)`,
          caps?.voicePreset && `minmax(0, ${w.pair}fr)`,
          (caps?.led || ledGate) && `minmax(0, ${w.pair}fr)`,
        ]
          .filter(Boolean)
          .join(' ') || 'minmax(0, 1fr)'
      : 'var(--ov-cols, minmax(0, 1fr))',
  )
</script>

<!--
  An on/off setting at a module head: a slide switch when the value is read back; "Off | On" send
  keys when it can't be read (write-only) or the receiver didn't report it (live). Their tooltip
  says which ("Last sent 17:42 · not confirmed" / "Unknown").
-->
{#snippet onOff(
  value: boolean | undefined | null,
  label: string,
  busy: boolean,
  onchange: (v: boolean) => void,
  legends?: { on: string; off: string },
  sentAt?: number | null,
)}
  {#if writeOnly || value === undefined || value === null}
    <SendPair value={value ?? null} {label} {legends} {sentAt} pending={busy} {onchange} />
  {:else}
    <SlideSwitch checked={value} {label} pending={busy} {onchange} />
  {/if}
{/snippet}

<!-- A reason said in place (visible), or only to assistive tech (the control's own switch is right above it). -->
{#snippet reasonNote(id: string, reason: string | null)}
  {#if reason}<Note {id}>{reason}</Note>{/if}
{/snippet}
{#snippet quietReason(id: string, reason: string | null)}
  {#if reason}<span class="visually-hidden" {id}>{reason}</span>{/if}
{/snippet}

<!-- A firmware gate: two or three words, the whole reason in the tooltip. -->
{#snippet gateNote(full: string)}
  <Note title={full}>{GATE_SHORT}<span class="visually-hidden">: {full}</span></Note>
{/snippet}

{#if micBlock}
  <div class="strip-block">
    <Note id={stripReasonId}>{micBlock}</Note>
  </div>
{/if}
<Modules {columns} class="strip">
  {#if ncMax > 0}
    <Module title={ncLabel} description={ncHint} class="m-nc">
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
          sentAt={at('noiseLevel')}
          pendingValue={pending.noiseLevel ? ncLevel : null}
          onchange={(v) => apply('noiseLevel', session.setNoiseLevel(v))}
        />
      </Blockable>
      {@render reasonNote(ncReasonId, own(noiseBlock))}
      {#if !noiseBlock}{@render quietReason(ncKeysReasonId, ncOff ? ncKeysReason : null)}{/if}
      {#if ncToggleGate?.state === 'firmware-too-old'}{@render gateNote(ncToggleGate.text)}{/if}
    </Module>
  {/if}

  {#if steps > 0}
    <Module
      title={volumeLabel(family)}
      value={volume === null ? null : volume + 1}
      total={steps}
      confidence={conf(volume)}
      sentAt={at('volume')}
      class="m-vol"
    >
      <Blockable reason={volumeReason} reasonId={rid(volumeReason, volReasonId)}>
        <!-- The Lark M2 mobile RX (PID 7) doesn't report its volume (HLDeviceActivity reads it from PID 8 up). -->
        <Fader
          {steps}
          value={volume}
          label={volumeLabel(family)}
          pending={!!pending.volume}
          confidence={conf(volume)}
          sentAt={at('volume')}
          onchange={(i) => apply('volume', session.setVolume(i))}
        />
      </Blockable>
      {@render reasonNote(volReasonId, own(volumeReason))}
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
              at('voiceLocked'),
            )}
          {/snippet}
        </Module>
      {:else if lockGate}
        <Module title="Volume lock" nested pad="none" level={4}>
          {@render gateNote(lockGate)}
        </Module>
      {/if}
    </Module>
  {/if}

  {#if modes.length > 0}
    <Module title="Channel mode" class="m-mode">
      <Blockable reason={micBlock} reasonId={stripReasonId}>
        <KeyGroup
          options={modeOptions}
          value={mode}
          label="Channel mode"
          size="tall"
          confidence={conf(mode)}
          sentAt={at('channelMode')}
          pendingValue={pending.channelMode ? mode : null}
          onchange={(v) => apply('channelMode', session.setChannelMode(v))}
        />
      </Blockable>
    </Module>
  {/if}

  {#if caps?.voicePreset}
    <Module title="Bel canto preset" class="m-vp">
      {#snippet head()}
        <Blockable reason={micBlock} reasonId={stripReasonId} inline>
          {@render onOff(
            vp ? vp.enabled : undefined,
            'Bel canto preset',
            !!pending.voicePreset && vpAction === 'switch',
            setVoiceEnabled,
            undefined,
            at('voicePreset'),
          )}
        </Blockable>
      {/snippet}
      <Blockable reason={vpKeysReason} reasonId={rid(vpKeysReason, vpReasonId)}>
        <KeyGroup
          options={PRESET_OPTIONS}
          value={vp?.enabled ? vpPreset : null}
          label="Bel canto tone"
          confidence={vpKeysReason ? 'solid' : conf(vp?.enabled ? vpPreset : null)}
          sentAt={at('voicePreset')}
          pendingValue={pending.voicePreset && vpAction === 'preset' ? vpPreset : null}
          onchange={setVoicePreset}
        />
      </Blockable>
      {#if own(vpKeysReason)}{@render quietReason(vpReasonId, vpKeysReason)}{/if}
    </Module>
  {/if}

  {#if caps?.led}
    <Module title="Indicator light" class="m-led">
      {#snippet head()}
        <Blockable reason={micBlock} reasonId={stripReasonId} inline>
          {@render onOff(s.ledOn, 'Indicator Light Switch', !!pending.ledOn, (v) => apply('ledOn', session.setLed(v)), undefined, at('ledOn'))}
        </Blockable>
      {/snippet}
      {#if caps.micRecognition}
        <Module title="Mic recognition" description="Lights each mic in its own colour" nested pad="none" level={4}>
          {#snippet head()}
            <Blockable reason={recBlock} reasonId={rid(recBlock, recReasonId)} inline>
              {@render onOff(
                s.micRecognition,
                'Mic Recognition',
                !!pending.micRecognition,
                (v) => apply('micRecognition', session.setMicRecognition(v)),
                undefined,
                at('micRecognition'),
              )}
            </Blockable>
          {/snippet}
          {#if own(recBlock)}
            <Note id={recReasonId}>{recBlock}</Note>
          {:else if recOn && !recBlock}
            <ul class="ledpair" aria-label="Recognition colours">
              <li><Lamp color="mic1" size="sm" />{prefs.micLabel(0)}<span class="led-name">{ledNames[0]}</span></li>
              <li><Lamp color="mic2" size="sm" />{prefs.micLabel(1)}<span class="led-name">{ledNames[1]}</span></li>
            </ul>
          {/if}
        </Module>
      {/if}
    </Module>
  {:else if ledGate}
    <Module title="Indicator light" class="m-led">
      {@render gateNote(ledGate)}
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
  .led-name {
    color: var(--ink-3);
  }
</style>
