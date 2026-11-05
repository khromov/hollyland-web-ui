<script lang="ts">
  /**
   * Audio: the receiver's USB audio in the browser. Two-channel meter window with level history,
   * monitoring, voice-effect profiles (a port of the app's DSP; the mics are not changed) and a
   * WAV recorder. Works without a control (WebHID) connection.
   */
  import { onDestroy } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { usbChannelMeters } from '../../lib/ui/meters'
  import { VOICE_FX_LATENCY } from '../../lib/audio/voicefx'
  import Panel from '../../lib/ui/Panel.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import InputWindow from './InputWindow.svelte'
  import MonitorFader from './MonitorFader.svelte'
  import VoiceEffects from './VoiceEffects.svelte'
  import Recorder from './Recorder.svelte'
  import { player } from './playback.svelte'

  interface Props {
    /** Channel mode reported by the receiver: 0 mono, 1 stereo, 2 safety track, null unknown. */
    channelMode?: number | null
  }
  let { channelMode = null }: Props = $props()

  const MODE_NAMES = ['Mono', 'Stereo', 'SafeTr']

  /** Labels follow what the USB channels carry, and only a mode read back from the receiver counts. */
  const mode = $derived(session.writeOnly ? null : channelMode)
  const sentMode = $derived(session.writeOnly && session.phase === 'ready' ? session.channelModeSetting : null)
  const names = $derived([prefs.micLabel(0), prefs.micLabel(1)] as [string, string])
  const channels = $derived(usbChannelMeters(mode, names))
  const subs = $derived.by((): [string, string] => {
    switch (mode) {
      case 1:
        return ['Left · TX1', 'Right · TX2']
      case 0:
        return ['both mics', 'both mics']
      case 2:
        return ['Left · mix', 'Right · backup']
      default:
        return ['', '']
    }
  })

  const running = $derived(audio.state === 'running')
  const rate = $derived(audio.sampleRate ? `${Math.round(audio.sampleRate / 100) / 10} kHz` : null)
  const inputName = $derived(running ? audio.deviceLabel || 'Audio input' : "Receiver's USB audio")
  const fxLatencyMs = (VOICE_FX_LATENCY / 48).toFixed(1)
  const showSelect = $derived(running && audio.inputs.length > 1)

  onDestroy(() => player.unload())
</script>

<div class="audio-page">
  <h1 class="visually-hidden">Audio</h1>

  <Panel title="Input" description={inputName}>
    {#snippet meta()}
      {#if running}
        <span class="meta">USB audio <span class="mono">{rate} · {audio.channelCount} ch</span></span>
      {/if}
    {/snippet}
    {#snippet aside()}
      {#if running}
        <div class="input-ctl">
          {#if showSelect}
            <label class="mc-key mc-key--sm pick">
              <span aria-hidden="true">Change input</span>
              <ChevronDown size={14} aria-hidden="true" />
              <select
                aria-label="Audio input"
                value={audio.selectedInput}
                onchange={(e) => audio.selectInput(e.currentTarget.value)}
              >
                {#each audio.inputs as d (d.deviceId)}
                  <option value={d.deviceId}>{d.label || 'Unnamed input'}</option>
                {/each}
              </select>
            </label>
          {/if}
          <button type="button" class="mc-key mc-key--sm" onclick={() => audio.stop()}>Stop live audio</button>
        </div>
      {/if}
    {/snippet}
    <div class="body">
      <InputWindow {channels} {subs} />

      {#if sentMode !== null}
        <ConfidenceNote
          kind="sent"
          text="Channel mode last sent: {MODE_NAMES[sentMode] ?? 'unknown'}, not confirmed. Channels are labelled L and R until the receiver confirms it."
        />
      {:else if session.writeOnly && session.phase === 'ready'}
        <ConfidenceNote kind="unknown" text="Channel mode not read, so the channels are labelled L and R." />
      {/if}
      {#if running && !audio.isHollyland}
        <p class="warn">
          <Lamp state="hollow" size="sm" />
          <span
            ><b>{audio.deviceLabel || 'This input'}</b> doesn't look like the receiver. {showSelect
              ? 'Choose its input (usually “Wireless Microphone”) next to Input.'
              : 'Plug in the receiver, then stop and start live audio.'}</span
          >
        </p>
      {/if}

      <div class="monitor">
        <span class="m-title">Monitor on this computer</span>
        <MonitorFader
          value={audio.monitor}
          label="Monitor on this computer"
          disabled={!running}
          onchange={(v) => audio.setMonitor(v)}
        />
        <!-- A measured value in mono; the word "Off" in Archivo (mono is for values only). -->
        <span class="vhead" aria-hidden="true"
          >{#if audio.monitor > 0}<span class="num">{Math.round(audio.monitor * 100)}</span><small>%</small>{:else}<span
              class="off">Off</span
            >{/if}</span
        >
        <div class="m-foot">
          {#if running}
            Plays the channels, with effects, on this computer's output. Use headphones to avoid feedback.
          {:else}
            <ConfidenceNote
              kind="disabled"
              text={audio.meterState === 'paused' ? 'USB audio is paused while the local bridge runs.' : 'Monitoring needs live audio.'}
            />
          {/if}
        </div>
      </div>
    </div>
  </Panel>

  <Panel title="Voice effect" description="Runs in this browser, on monitoring and recordings. The mics are not changed.">
    {#snippet meta()}
      <span class="meta">Adds <span class="mono">{fxLatencyMs} ms</span> of delay</span>
    {/snippet}
    <div class="body">
      <VoiceEffects {channels} />
    </div>
  </Panel>

  <Panel title="Recorder" description="Saves WAV files in this browser.">
    {#snippet meta()}
      <span class="meta"
        ><span class="mono"
          >{rate ?? '48 kHz'} · {audio.recordOptions.bitDepth === 32 ? '32-bit float' : `${audio.recordOptions.bitDepth}-bit`}</span
        ><br />{audio.recordOptions.split ? 'One file per channel' : 'One stereo file'}</span
      >
    {/snippet}
    <div class="body">
      <Recorder {channels} channelMode={mode} {names} />
    </div>
  </Panel>
</div>

<style>
  .audio-page {
    display: grid;
    min-width: 0;
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .meta {
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .meta .mono {
    font-size: 12px;
    white-space: nowrap;
  }
  .body {
    display: grid;
    gap: 14px;
    min-width: 0;
    padding: 4px 0 24px;
  }
  .warn {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-2);
  }
  .warn :global(.lamp) {
    margin-top: 3px;
  }
  .warn b {
    font-weight: 620;
    color: var(--ink);
  }
  .input-ctl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .pick {
    position: relative;
    gap: 6px;
  }
  /* The invisible select covers the whole key, border included (44 px under touch). */
  .pick select {
    position: absolute;
    inset: -1px;
    width: calc(100% + 2px);
    height: calc(100% + 2px);
    opacity: 0;
    cursor: pointer;
    font-size: 14px;
  }
  .pick:has(select:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }

  /* Monitor: title and note | fader | value */
  .monitor {
    display: grid;
    grid-template-columns: minmax(200px, 300px) minmax(0, 1fr) 72px;
    grid-template-areas: 'title fader value' 'foot fader value';
    align-items: center;
    column-gap: 24px;
    row-gap: 2px;
    padding-top: 6px;
    border-top: 1px solid var(--rule);
  }
  .m-title {
    grid-area: title;
    align-self: end;
    font-size: var(--t-control);
    font-weight: 660;
    line-height: var(--lh-head);
  }
  .m-foot {
    grid-area: foot;
    align-self: start;
    font-size: 12px;
    line-height: var(--lh-body);
    color: var(--ink-3);
  }
  .monitor :global(.fader) {
    grid-area: fader;
  }
  .vhead {
    grid-area: value;
    text-align: right;
    line-height: 1;
    color: var(--ink);
  }
  .vhead .num {
    font: 500 24px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
  }
  .vhead small {
    font-size: 14px;
    color: var(--ink-3);
    margin-left: 1px;
  }
  .off {
    font-size: 18px;
    font-weight: 600;
    color: var(--ink-3);
  }

  @media (min-width: 1280px) {
    .body {
      padding: 20px 0 20px 28px;
    }
    .input-ctl {
      flex-direction: column;
      align-items: stretch;
      margin-top: 14px;
    }
  }
  @media (max-width: 759px) {
    .monitor {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'title value' 'fader fader' 'foot foot';
    }
    .m-title {
      align-self: center;
    }
  }
</style>
