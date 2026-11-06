<script lang="ts">
  /**
   * One mic on the family Overview (LARK A1, M3, MAX 2, MELO P1): editable name, TX plate and
   * link status at the head; the meter window when there is one per mic (USB channel or the
   * device's own levels); battery, mute and, where the product has it, the mic's gain.
   *
   * Mute is a switch where the product can set it (A1, M3, MELO P1) and a word where it only
   * reports it. No identity colour: LED colours differ per product, so the lamps stay neutral.
   * A value that can't be read shows "–" (tooltip "Unknown"), never words.
   */
  import { tick } from 'svelte'
  import { Pencil } from '@lucide/svelte'
  import { CONTROL, type UnitId } from '../../../lib/protocol'
  import Lamp from '../../../lib/ui/Lamp.svelte'
  import Tag from '../../../lib/ui/Tag.svelte'
  import BatteryCells from '../../../lib/ui/BatteryCells.svelte'
  import MeterWindow from '../../../lib/ui/MeterWindow.svelte'
  import { session } from '../../../lib/state/session.svelte'
  import ControlInput from '../../controls/ControlInput.svelte'
  import { cleanLabel } from '../../controls/controls'
  import { shown, viewOf } from '../../controls/write'
  import { micNames } from './names.svelte'
  import type { MicMeter } from './meters'

  interface Props {
    unit: UnitId
    meter: MicMeter | null
    /** Phone layout. */
    compact?: boolean
    /** Four mics in a row: smaller name. */
    dense?: boolean
    /** A reason said once above the mics (it blocks every mic's mute / gain): pointed at, not repeated. */
    shared?: { text: string; id: string } | null
  }
  let { unit, meter, compact = false, dense = false, shared = null }: Props = $props()

  const n = $derived(Number(unit.replace(/\D/g, '')) || 1)
  const u = $derived(session.micState?.units[unit] ?? null)
  const defaultName = $derived(micNames.defaultName(unit, u))
  const name = $derived(micNames.name(unit, u))
  const headingId = $derived(`fmic-name-${unit}`)

  // ------------------------------------------------------------------ status
  /** TX status exists only when replies arrive (never faked on a write-only link). */
  const statusKnown = $derived(session.live && !!u)
  const online = $derived(statusKnown && !!u?.online)
  const reading = $derived(!statusKnown && !session.writeOnly)
  const battery = $derived(u?.battery ?? 0)
  const batteryKnown = $derived(online && battery > 0)
  const charging = $derived(!!u?.charging)
  const unknownWhy = $derived(statusKnown && !online ? 'Offline' : 'Unknown')

  // ------------------------------------------------------------------ mute + gain
  const muteSpec = $derived(session.control(CONTROL.MIC_MUTE))
  /**
   * Firmware too old for the mute command (A1 below 1.0.1.3), or its version not known (still reading, or a
   * write-only link that never reads it): the status word only, as the official app.
   */
  const muteGated = $derived.by(() => {
    const code = muteSpec?.perUnit?.includes(unit) ? viewOf(muteSpec, unit).reasonCode : null
    return code === 'firmware-too-old' || code === 'version-unknown'
  })
  const canMute = $derived(!!muteSpec?.perUnit?.includes(unit) && !muteGated)
  const muteValue = $derived(canMute ? viewOf(muteSpec!, unit).value : undefined)
  const muted = $derived(online && (muteValue === true || (muteValue === undefined && u?.muted === true)))
  /** The product reports mute for this mic (A1, M3, MELO P1); the MAX 2 does not. */
  const showMute = $derived(canMute || u?.muted !== undefined)
  const muteReason = $derived(canMute ? viewOf(muteSpec!, unit).reason : null)
  const muteReasonId = $derived(`fmic-mute-reason-${unit}`)

  const gainSpec = $derived(session.control(CONTROL.MIC_GAIN))
  const gainReason = $derived(gainSpec?.perUnit?.includes(unit) ? viewOf(gainSpec, unit).reasonCode : null)
  /** Per-mic gain, unless a firmware gate replaced it with a shared control (MELO P1 Near / Mid / Far). */
  const showGain = $derived(
    !!gainSpec?.perUnit?.includes(unit) &&
      shown(gainSpec, unit) &&
      gainReason !== 'firmware-too-old' &&
      gainReason !== 'version-unknown' &&
      gainReason !== 'two-mic-mode',
  )
  const gainReasonText = $derived(showGain ? viewOf(gainSpec!, unit).reason : null)
  const gainReasonId = $derived(`fmic-gain-reason-${unit}`)

  /** "Charging" in words beside the bolt where the battery column has room (two mics, not phone). */
  const chargingWords = $derived(!compact && !dense)

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
    if (save) micNames.set(unit, draft)
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

<article
  class="mic"
  class:dense
  class:compact
  class:offline={statusKnown && !online}
  aria-labelledby={headingId}
>
  <div class="head">
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
      <h2 class="name" id={headingId} title={name}>{name}</h2>
      <button
        bind:this={renameKey}
        type="button"
        class="rename"
        aria-label="Rename {name !== defaultName ? `${name} (${defaultName})` : defaultName}"
        title="Rename"
        onclick={startEdit}><Pencil size={16} strokeWidth={1.8} aria-hidden="true" /></button
      >
    {/if}
    <span class="tag"><Tag title="{defaultName}, transmitter {n}">TX{n}</Tag></span>
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
        <Lamp color="neutral" size="sm" state="off" /><span class="lt">Offline</span>
      {/if}
    </span>
  </div>

  {#if meter}
    <div class="win">
      <MeterWindow
        read={meter.read}
        label={meter.label}
        tone="neutral"
        variant="channel"
        history={false}
        caption={meter.caption}
        state={meter.state}
        message={meter.message}
        onstart={meter.onstart}
        primary={meter.primary}
        muted={muted}
      />
    </div>
  {/if}

  <dl class="stats" class:one={!showMute}>
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
    {#if showMute}
      <div class="stat">
        <dt>Mute</dt>
        <dd title={canMute || reading || online ? undefined : unknownWhy}>
          {#if reading}
            <span class="dim">Reading…</span>
          {:else if canMute && muteSpec && (online || session.writeOnly)}
            <ControlInput
              spec={muteSpec}
              {unit}
              label="{name} mute"
              inline
              reasonId={muteReason ? (muteReason === shared?.text ? shared.id : muteReasonId) : undefined}
            />
            {#if muteReason && muteReason !== shared?.text}<span class="visually-hidden" id={muteReasonId}>{muteReason}</span>{/if}
          {:else if online && u?.muted !== undefined}
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
    {/if}
  </dl>

  {#if showGain && gainSpec}
    <div class="gain">
      <ControlInput
        spec={gainSpec}
        {unit}
        label="{name} {cleanLabel(gainSpec.label).toLowerCase()}"
        caption={cleanLabel(gainSpec.label)}
        faderSize="sm"
        faderValue
        reasonId={gainReasonText ? (gainReasonText === shared?.text ? shared.id : gainReasonId) : undefined}
      />
      {#if gainReasonText && gainReasonText !== shared?.text}<span class="visually-hidden" id={gainReasonId}>{gainReasonText}</span>{/if}
    </div>
  {/if}
</article>

<style>
  .mic {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    min-height: 0;
    padding: 14px var(--channel-pad) 16px;
  }
  .mic.dense {
    padding-inline: var(--module-pad);
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
  .dense .name {
    font-size: var(--t-channel-sm);
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
  .rename::after {
    content: '';
    position: absolute;
    inset: -4px;
  }
  .rename:hover {
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    color: var(--ink);
  }
  .dense .rename {
    margin-left: -8px;
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
  .v {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .win {
    display: grid;
    min-height: 0;
  }
  /* Four in a row: windows keep one height whether or not they carry the first-run key. */
  .dense .win {
    min-height: 86px;
  }

  .stats {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 16px;
  }
  .stats.one {
    grid-template-columns: minmax(0, 1fr);
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
  .stat dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    min-height: 22px;
    min-width: 0;
    font-size: 14px;
  }
  .mute {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 8px;
  }
  .muted {
    font-weight: 650;
    color: var(--rec-ink);
  }
  .dim {
    font-size: 13px;
    color: var(--ink-3);
    white-space: nowrap;
  }

  .gain {
    display: grid;
    min-width: 0;
  }

  @media (max-width: 599px) {
    .mic,
    .mic.dense {
      gap: 12px;
      padding: 14px var(--gutter) 16px;
    }
    .head {
      gap: 10px;
    }
    .name {
      font-size: var(--t-channel-sm);
    }
    .tag {
      margin-left: auto;
    }
    .link {
      margin-left: 0;
      gap: 6px;
    }
    .stats {
      gap: 10px;
    }
    .stat dd {
      font-size: 13px;
    }
  }
  @media (max-width: 359px) {
    .head {
      gap: 8px;
    }
    .link {
      font-size: 12px;
    }
  }
</style>
