<script lang="ts">
  /**
   * One transmitter channel on the faceplate: LED identity, editable name, TX plate and link
   * status at the head; the meter window of the USB channel it lands on; battery, mute and output.
   *
   * The meter measures a USB channel, not the mic: purple / yellow and the mic's name only in
   * Stereo (L = Mic 1, R = Mic 2). Mono, SafeTr and an unconfirmed mode (write-only) get a neutral
   * meter labelled with the channel ("Mix · L", "Main", "USB L").
   *
   * A value that can't be read shows "–" (tooltip "Unknown"), never words.
   */
  import { tick } from 'svelte'
  import { Pencil } from '@lucide/svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import BatteryCells from '../../lib/ui/BatteryCells.svelte'
  import MeterWindow from '../../lib/ui/MeterWindow.svelte'
  import { usbChannelMeters } from '../../lib/ui/meters'
  import { confidenceNote } from '../../lib/ui/confidence'
  import type { MeterState } from '../../lib/ui/types'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { meterCaption, micOutput } from './overview'
  import { sentClock } from './sent.svelte'

  interface Props {
    index: 0 | 1
    meter: { state: MeterState; message?: string }
    onstart: () => void
    /** Seconds of level history, or false (short screens). */
    history: number | false
    /** Phone layout: bolt without "Charging". */
    compact?: boolean
    /** Desktop: the window takes the module's spare height (only worth it with the history). */
    fill?: boolean
  }
  let { index, meter, onstart, history, compact = false, fill = false }: Props = $props()

  const channel = $derived(index === 0 ? 'tx1' : 'tx2')
  const defaultName = $derived(`Mic ${index + 1}`)
  const name = $derived(prefs.micLabel(index))

  // ------------------------------------------------------------------ status
  const unit = $derived(session.units ? session.units[channel] : null)
  /** TX status exists only when replies arrive (never faked on a write-only link). */
  const statusKnown = $derived(session.live && !!unit)
  const online = $derived(statusKnown && !!unit?.online)
  // The 6118 heartbeat carries mute/charging flags; the legacy M2/M2S heartbeat only when it is long enough.
  const flagsKnown = $derived(
    session.product?.family === '6118' || (session.state?.heartbeat?.payloadLength ?? 0) > 15,
  )
  const muted = $derived(online && flagsKnown && !!unit?.muted)
  const charging = $derived(flagsKnown && !!unit?.charging)
  const battery = $derived(unit?.battery ?? 0)

  // ------------------------------------------------------------------ meter + output
  const hasModes = $derived((session.caps?.channelModes.length ?? 0) > 0)
  /** Only receivers with a channel-mode control say what lands where (the Lark M2 has none). */
  const mode = $derived(session.channelModeSetting)
  /** What the USB channel carries is only known once the mode is read back. */
  const meterMode = $derived(session.usbChannelMode)
  const usb = $derived(usbChannelMeters(meterMode, [prefs.micLabel(0), prefs.micLabel(1)])[index])
  const caption = $derived(meterCaption(usb))
  const sourceChannel = $derived(audio.channelCount === 1 ? 0 : index)
  const read = () => audio.readChannel(sourceChannel)
  const output = $derived(hasModes ? micOutput(index, mode) : null)
  const outputSent = $derived(session.writeOnly && mode !== null)
  const sentTip = $derived(confidenceNote('sent', sentClock.at('channelMode')))

  // ------------------------------------------------------------------ stats
  /** Still waiting for the first status reply (live). */
  const reading = $derived(!statusKnown && !session.writeOnly)
  const batteryKnown = $derived(online && battery > 0)
  const muteKnown = $derived(online && flagsKnown)
  /** Why a value shows "–" (tooltip and accessible name). */
  const unknownWhy = $derived(statusKnown && !online ? 'Offline' : 'Unknown')

  // ------------------------------------------------------------------ fit
  let width = $state(0)
  let winH = $state(0)
  /** "Charging" in words only where the battery column has room (the bolt stays). */
  const chargingWords = $derived(!compact && width >= 560)
  /**
   * The history's dB labels sit 6 dB apart at the top (−6, −12); below ~150 px of history they
   * would touch, so −12 is left out (the dashed gridline stays). 150 px is the window's own chrome.
   */
  const crowded = $derived(history !== false && winH > 0 && winH - 150 < 150)

  // ---------------------------------------------------------------- inline rename
  let editing = $state(false)
  let draft = $state('')
  let input: HTMLInputElement | undefined = $state()
  let renameKey: HTMLButtonElement | undefined = $state()

  async function startEdit() {
    draft = name !== defaultName ? name : ''
    editing = true
    await tick()
    input?.focus()
    input?.select()
  }
  async function finish(save: boolean) {
    if (!editing) return
    if (save) prefs.setMicName(index, draft.trim())
    editing = false
    await tick()
    renameKey?.focus()
  }
  function onkey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      void finish(false)
    }
  }
</script>

<article class="mic" class:tight={!fill && !compact} class:offline={statusKnown && !online} aria-labelledby="mic-name-{index}" bind:clientWidth={width}>
  <div class="head">
    <!-- Identity: the colour this mic's LED glows (device-driven through --mic1 / --mic2). -->
    <Lamp color={index === 0 ? 'mic1' : 'mic2'} size="lg" state={statusKnown && !online ? 'off' : 'on'} />
    {#if editing}
      <input
        bind:this={input}
        bind:value={draft}
        class="name-input"
        maxlength="32"
        placeholder={defaultName}
        aria-label="Name for {defaultName}"
        onkeydown={onkey}
        onblur={() => finish(true)}
      />
    {:else}
      <h2 class="name" id="mic-name-{index}" title={name}>{name}</h2>
      <button
        bind:this={renameKey}
        type="button"
        class="rename"
        aria-label="Rename {name !== defaultName ? `${name} (${defaultName})` : defaultName}"
        title="Rename"
        onclick={startEdit}><Pencil size={16} strokeWidth={1.8} aria-hidden="true" /></button
      >
    {/if}
    <span class="tag"><Tag title="{defaultName}, transmitter {index + 1}">TX{index + 1}</Tag></span>
    <span class="link">
      {#if session.writeOnly}
        <span class="v" title="Unknown"
          ><Lamp color="neutral" size="sm" state="hollow" /><span class="mc-dash" aria-hidden="true">–</span><span
            class="visually-hidden">Status unknown</span
          ></span
        >
      {:else if !statusKnown}
        <Lamp color="neutral" size="sm" state="hollow" /><span class="lt">Reading…</span>
      {:else if online}
        <Lamp color="live" size="sm" state="on" /><span class="lt">Online</span>
      {:else}
        <!-- A mic docked in the charging case also reports offline (seen on a LARK A2). -->
        <span class="v" title="Take the mic out of the case, switch it on, or check its pairing"
          ><Lamp color="neutral" size="sm" state="off" /><span class="lt">Offline</span></span
        >
      {/if}
    </span>
  </div>

  <div class="win" class:fill={fill && meter.state === 'live'} class:crowded bind:clientHeight={winH}>
    {#key history}
      <MeterWindow
        {read}
        label={usb.label}
        tone={usb.tone}
        variant="channel"
        {history}
        caption={caption ?? undefined}
        state={meter.state}
        message={meter.message}
        {onstart}
        primary={index === 0}
        muted={muted && usb.tone !== 'neutral'}
      />
    {/key}
  </div>

  <dl class="stats" class:two={!output && !(session.writeOnly && hasModes)}>
    <div class="stat">
      <dt>Battery</dt>
      <dd>
        {#if reading}
          <span class="dim">Reading…</span>
        {:else if batteryKnown}
          <BatteryCells percent={battery} {charging} chargingText={chargingWords} label="{name} battery" />
        {:else}
          <BatteryCells percent={null} label="{name} battery" />
        {/if}
      </dd>
    </div>
    <div class="stat">
      <dt>Mute</dt>
      <dd title={muteKnown || reading ? undefined : unknownWhy}>
        {#if reading}
          <span class="dim">Reading…</span>
        {:else if muteKnown}
          <span class="mute" role="status" aria-label="{name}: {muted ? 'muted' : 'unmuted'}">
            {#if muted}
              <Lamp color="rec" size="sm" state="on" /><b class="muted">Muted</b>
            {:else}
              <span>Unmuted</span>
            {/if}
          </span>
        {:else}
          <span class="mc-dash" aria-hidden="true">–</span><span class="visually-hidden">{name} mute: {unknownWhy}</span>
        {/if}
      </dd>
    </div>
    {#if output || (session.writeOnly && hasModes)}
      <div class="stat">
        <dt>Output</dt>
        <dd title={!output ? unknownWhy : outputSent ? sentTip : undefined}>
          {#if !output}
            <span class="mc-dash" aria-hidden="true">–</span><span class="visually-hidden">{name} output: {unknownWhy}</span>
          {:else}
            <span class="v">
              {#if outputSent}<span class="mc-swatch mc-swatch--sent" aria-hidden="true"></span>{/if}<span class="side">{output.side}</span>
            </span>
            <span class="dim">{output.text}</span>
            {#if outputSent}<span class="visually-hidden">{sentTip}</span>{/if}
          {/if}
        </dd>
      </div>
    {/if}
  </dl>
</article>

<style>
  .mic {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
    min-height: 0;
    padding: 20px var(--channel-pad) 22px;
  }
  /* Compact meters (no history): tighter, so the receiver strip stays on a laptop screen. */
  .mic.tight {
    gap: 12px;
    padding-block: 14px 16px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--hit);
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-channel);
    font-weight: 660;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.015em;
    line-height: 1.1;
  }
  .offline .name {
    color: var(--ink-2);
  }
  .rename {
    position: relative;
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin-left: -6px;
    border: 0;
    border-radius: var(--r-key);
    background: transparent;
    color: var(--ink-2);
    -webkit-tap-highlight-color: transparent;
  }
  /* 44 px target */
  .rename::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .rename:hover {
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    color: var(--ink);
  }
  .name-input {
    flex: 1 1 auto;
    min-width: 0;
    max-width: 22ch;
    height: 40px;
    padding: 0 10px;
    border: 1.5px solid var(--ink);
    border-radius: var(--r-key);
    background: var(--key);
    color: var(--ink);
    font: 660 22px/1 var(--f-sans);
    font-stretch: var(--head-stretch);
    box-shadow: var(--recessed);
  }
  .name-input::placeholder {
    color: var(--ink-3);
  }
  .tag {
    display: inline-flex;
    flex: none;
  }
  .link {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
    font-size: 13px;
    color: var(--ink-2);
    white-space: nowrap;
  }

  .win {
    flex: none;
    display: grid;
    min-height: 0;
  }
  /* The window takes the module's spare height (desktop, with the level history). */
  .win.fill {
    flex: 1 1 auto;
  }

  .crowded :global(.ylab > span:nth-child(2)) {
    display: none;
  }

  .stats {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 16px;
  }
  .stats.two {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr);
  }
  .stat {
    min-width: 0;
  }
  .stat dt {
    margin-bottom: 5px;
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-2);
  }
  /* A value and its words wrap under each other when the column is narrow (never overlap). */
  .stat dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    min-height: 22px;
    min-width: 0;
    font-size: 14px;
  }
  .v {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  .mute {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
    min-width: 0;
  }
  .muted {
    font-weight: 650;
    color: var(--rec-ink);
  }
  .dim {
    min-width: 0;
    font-size: 13px;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .side {
    font: 500 14px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    white-space: nowrap;
  }

  @media (max-width: 599px) {
    .mic {
      gap: 12px;
      padding: 14px var(--gutter) 16px;
    }
    .head {
      gap: 10px;
    }
    .name {
      font-size: var(--t-channel-sm);
    }
    /* The plate moves to the right, next to the link status. */
    .tag {
      margin-left: auto;
    }
    .link {
      margin-left: 0;
      gap: 6px;
    }
    .stats {
      grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) minmax(0, 0.7fr);
      gap: 10px;
    }
    .stat dd {
      font-size: 13px;
    }
  }
  /* 320 px: the word stays visible (the lamp alone would say it by colour only); the name gives way. */
  @media (max-width: 359px) {
    .head {
      gap: 8px;
    }
    .link {
      font-size: 12px;
    }
  }
</style>
