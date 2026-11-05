<script lang="ts">
  import { tick } from 'svelte'
  import { Info, Mic, MicOff, Pencil } from '@lucide/svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import Battery from '../../lib/ui/Battery.svelte'
  import LevelMeter from '../../lib/ui/LevelMeter.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import { meterSource, micBatteryWord, normaliseChannelMode } from './overview'

  interface Props {
    index: 0 | 1
  }
  let { index }: Props = $props()

  const channel = $derived(index === 0 ? 'tx1' : 'tx2')
  const defaultName = $derived(`Mic ${index + 1}`)
  const name = $derived(prefs.micLabel(index))
  const customName = $derived(name !== defaultName)

  const unit = $derived(session.units ? session.units[channel] : null)
  /** TX status exists only when replies arrive (never faked in write-only mode). */
  const statusKnown = $derived(session.live && !!unit)
  const online = $derived(statusKnown && !!unit?.online)
  // The 6118 heartbeat carries mute/charging flags; the legacy M2/M2S heartbeat only when it is long enough.
  const flagsKnown = $derived(
    session.product?.family === '6118' || (session.state?.heartbeat?.payloadLength ?? 0) > 15,
  )
  const muted = $derived(online && flagsKnown && !!unit?.muted)
  const charging = $derived(flagsKnown && !!unit?.charging)
  const battery = $derived(unit?.battery ?? 0)
  const showBattery = $derived(online && battery > 0)
  const batteryWord = $derived(micBatteryWord(battery, charging))

  const running = $derived(audio.state === 'running')
  const source = $derived(
    meterSource(
      index,
      normaliseChannelMode(session.settings.channelMode, session.product?.family ?? null),
      (c) => audio.readChannel(c),
      audio.channelCount,
    ),
  )

  const MUTE_HELP = 'Mute is set with the button on the mic. The receiver reports it here, but it cannot be changed from this page.'

  // ---------------------------------------------------------------- inline rename
  let editing = $state(false)
  let draft = $state('')
  let input: HTMLInputElement | undefined = $state()
  let nameButton: HTMLButtonElement | undefined = $state()

  async function startEdit() {
    draft = customName ? name : ''
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
    nameButton?.focus()
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

<Card {channel} dimmed={statusKnown && !online} class="mic-card">
  <div class="head">
    <span class="badge dim-when-offline" aria-hidden="true">TX{index + 1}</span>
    <div class="names">
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
        <h2 class="name">
          <button
            bind:this={nameButton}
            type="button"
            class="name-btn"
            title="Rename"
            aria-label="{name}. Rename {defaultName}"
            onclick={startEdit}
          >
            <span class="name-text">{name}</span>
            <Pencil size={14} aria-hidden="true" class="pencil" />
          </button>
        </h2>
      {/if}
      <div class="sub">{customName || editing ? defaultName : 'Transmitter ' + (index + 1)}</div>
    </div>
    <div class="flags">
      {#if statusKnown && !online}
        <Chip>Disconnected</Chip>
      {:else if online && flagsKnown}
        <button
          type="button"
          class="mute"
          class:on={muted}
          title={MUTE_HELP}
          aria-label="{muted ? 'Muted' : 'Unmuted'}, {name}"
          aria-describedby="mute-help-{index}"
          onclick={() => toasts.info(MUTE_HELP)}
        >
          {#if muted}
            <MicOff size={14} aria-hidden="true" /><span>MUTED</span>
          {:else}
            <Mic size={14} aria-hidden="true" /><span>Unmuted</span>
          {/if}
        </button>
        <span id="mute-help-{index}" class="visually-hidden">{MUTE_HELP}</span>
      {/if}
    </div>
  </div>

  <div class="status">
    {#if session.writeOnly}
      <span class="unavailable"><Info size={14} aria-hidden="true" />Status unavailable on this platform</span>
    {:else if !statusKnown}
      <span class="unavailable">Reading status…</span>
    {:else if !online}
      <span class="unavailable">Not connected. Turn the mic on or check its pairing.</span>
    {:else if showBattery}
      <Battery percent={battery} {charging} label="{name} battery" />
      <span class="word" class:low={batteryWord === 'Low'}>{batteryWord}</span>
    {:else}
      <span class="unavailable">Connected</span>
    {/if}
  </div>

  <div class="level">
    <div class="level-head">
      <span class="overline">Level</span>
      {#if running}<span class="caption">{source.caption}</span>{/if}
    </div>
    {#if running}
      <LevelMeter
        read={source.read}
        label={name}
        segments={30}
        muted={muted}
        inactive={statusKnown && (!online || muted)}
      />
    {:else}
      <div class="meter-off" aria-label="{name} level: audio not enabled" role="img">
        <span>Audio not enabled</span>
      </div>
    {/if}
  </div>
</Card>

<style>
  :global(.mic-card) {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--space-3);
    margin-top: var(--space-1);
  }
  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 38px;
    height: 24px;
    margin-top: 2px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--channel-color);
    color: var(--color-on-tx1);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
  }
  :global(.mic-card[data-channel='tx2']) .badge {
    color: var(--color-on-tx2);
  }
  .names {
    min-width: 0;
  }
  .name {
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
    min-width: 0;
  }
  .name-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 28px;
    margin: -2px -6px;
    padding: 2px 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    font: inherit;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
    text-align: left;
    position: relative;
  }
  .name-btn::before {
    content: '';
    position: absolute;
    inset: -8px -4px;
  }
  .name-btn:hover {
    background: var(--color-surface-3);
  }
  .name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name-btn :global(.pencil) {
    flex: none;
    color: var(--color-text-subtle);
    opacity: 0;
    transition: opacity var(--dur-fast);
  }
  .name-btn:hover :global(.pencil),
  .name-btn:focus-visible :global(.pencil) {
    opacity: 1;
  }
  @media (hover: none) {
    .name-btn :global(.pencil) {
      opacity: 1;
    }
  }
  .name-input {
    width: 100%;
    min-height: 32px;
    margin: -2px 0;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-accent);
    background: var(--color-surface-3);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }
  .name-input:focus-visible {
    outline-offset: 0;
  }
  .sub {
    font-size: var(--text-xs);
    line-height: var(--leading-xs);
    color: var(--color-text-subtle);
  }
  .flags {
    display: flex;
    align-items: center;
    min-height: 28px;
  }
  .mute {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-strong);
    background: transparent;
    color: var(--color-text-muted);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    cursor: help;
  }
  .mute::before {
    content: '';
    position: absolute;
    inset: -8px -2px;
  }
  .mute.on {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-on-danger);
  }
  .status {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 24px;
    flex-wrap: wrap;
  }
  .word {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .word.low {
    color: var(--color-danger);
    font-weight: var(--weight-medium);
  }
  .unavailable {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-subtle);
  }
  .unavailable :global(svg) {
    flex: none;
  }
  .level {
    margin-top: auto;
    display: grid;
    gap: 6px;
  }
  .level-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }
  .caption {
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
  }
  .level :global(.meter.horizontal) {
    --meter-thickness: 18px;
  }
  .meter-off {
    display: grid;
    place-items: center;
    height: 26px;
    border-radius: var(--radius-sm);
    background: var(--meter-well);
    box-shadow: var(--meter-inset);
  }
  .meter-off span {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    font-weight: var(--weight-semibold);
    text-transform: uppercase;
    color: var(--meter-scale);
  }
  @media (pointer: coarse) {
    .mute {
      min-height: 32px;
    }
  }
</style>
