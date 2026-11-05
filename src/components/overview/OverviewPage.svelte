<script lang="ts">
  /**
   * Home dashboard, mirroring the official app's device home screen (features.md §4, §12, §16):
   * Mic 1 / Mic 2 status with live levels, the Camera RX row on the camera receiver, and the
   * RX-global device controls.
   */
  import { untrack } from 'svelte'
  import { AudioLines } from '@lucide/svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import AudioStartCard from '../audio/AudioStartCard.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import MicCard from './MicCard.svelte'
  import CameraRxRow from './CameraRxRow.svelte'
  import ReceiverCard from './ReceiverCard.svelte'
  import {
    CHANNEL_MODE_LABEL,
    PRESET_OPTIONS,
    formatClock,
    noiseLevelName,
    normaliseChannelMode,
    volumeLabel,
  } from './overview'

  const caps = $derived(session.caps)
  const family = $derived(session.product?.family ?? null)
  const s = $derived(session.settings)
  const showCameraRx = $derived(family === '6118' && session.isCameraVariant)
  const running = $derived(audio.state === 'running')

  // ------------------------------------------------------------------- receiver summary line
  const summary = $derived.by(() => {
    const parts: string[] = []
    if (!caps) return parts
    const mode = normaliseChannelMode(s.channelMode, family)
    if (caps.channelModes.length && mode !== undefined) parts.push(CHANNEL_MODE_LABEL[mode] ?? `Mode ${mode}`)
    if (caps.volumeSteps > 0 && s.volume !== undefined && s.volume < caps.volumeSteps) {
      parts.push(`${volumeLabel(family)} ${s.volume + 1}/${caps.volumeSteps}`)
    }
    if (caps.noiseMaxLevel > 0) {
      if (s.noiseEnabled === false) parts.push('NC Off')
      else {
        const nc = noiseLevelName(s.noiseLevel, caps.noiseMaxLevel)
        // Write-only: a level was sent, but whether NC is on can't be read (features.md §21 #1).
        if (nc) parts.push(s.noiseEnabled === undefined && session.writeOnly ? `NC ${nc} (on/off unknown)` : `NC ${nc}`)
      }
    }
    if (caps.voicePreset && s.voicePreset) {
      const p = PRESET_OPTIONS.find((o) => o.value === s.voicePreset!.preset)?.label
      parts.push(s.voicePreset.enabled ? `Bel canto ${p ?? 'on'}` : 'Bel canto off')
    }
    return parts
  })
  const firmware = $derived(session.units?.rx.version)

  // ----------------------------------------------------------------------- last update clock
  let now = $state(Date.now())
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(t)
  })
  const age = $derived(session.lastUpdate ? Math.max(0, Math.round((now - session.lastUpdate) / 1000)) : null)
  const stale = $derived(age !== null && age > 3)

  // ---------------------------------------- "Mic 1 Connected" / "Mic 1 Disconnected" toasts
  let prevOnline: [boolean, boolean] | null = null
  $effect(() => {
    const u = session.units
    if (!session.live || !u || session.phase !== 'ready') {
      prevOnline = null
      return
    }
    const cur: [boolean, boolean] = [u.tx1.online, u.tx2.online]
    const prev = prevOnline
    prevOnline = cur
    if (!prev) return
    untrack(() => {
      for (const i of [0, 1] as const) {
        if (cur[i] !== prev[i]) toasts.info(`${prefs.micLabel(i)} ${cur[i] ? 'Connected' : 'Disconnected'}`)
      }
    })
  })
</script>

<div class="overview">
  <header class="top">
    <div class="heading">
      <h1>Overview</h1>
      {#if summary.length || firmware}
        <p class="summary">
          <span class="rx-tag">Receiver</span>
          <span class="clip">
            <span class="parts">
              {#each summary as part (part)}<span class="part">{part}</span>{/each}
              {#if firmware}<span class="part fw">FW <span class="mono">{firmware}</span></span>{/if}
            </span>
          </span>
        </p>
      {/if}
    </div>
    <div class="sync" class:stale>
      {#if session.live && session.lastUpdate}
        <span class="dot" aria-hidden="true"></span>
        <span>
          {stale ? 'Last update' : 'Live · updated'}
          <span class="readout">{formatClock(session.lastUpdate)}</span>{#if stale}&nbsp;({age} s ago){/if}
        </span>
      {:else if session.writeOnly}
        <span class="dot write" aria-hidden="true"></span>
        <span>Write-only · values last sent from this browser</span>
      {/if}
    </div>
  </header>

  <div class="layout">
    <div class="mics-col">
      {#if showCameraRx}
        <CameraRxRow />
      {/if}
      <div class="mics">
        <MicCard index={0} />
        <MicCard index={1} />
      </div>
      {#if !audio.supported}
        <p class="audio-note">
          <AudioLines size={14} aria-hidden="true" />Live levels need a browser that can capture audio inputs.
        </p>
      {:else if !running}
        <AudioStartCard compact />
      {:else if !audio.isHollyland}
        <Banner tone="warning">
          The levels come from "{audio.deviceLabel || 'an audio input'}", which doesn't look like the receiver. Pick
          the receiver's input on the <a href="#/audio">Audio</a> page.
        </Banner>
      {/if}
    </div>
    <div class="rx-col">
      <ReceiverCard />
    </div>
  </div>
</div>

<style>
  .overview {
    display: grid;
    gap: var(--space-5);
  }
  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-2) var(--space-6);
    flex-wrap: wrap;
  }
  .heading {
    min-width: 0;
  }
  h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-2xl);
  }
  .summary {
    display: flex;
    align-items: baseline;
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .rx-tag {
    flex: none;
    margin-right: var(--space-2);
    font-size: var(--text-2xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--color-text-subtle);
  }
  /* Each part carries its own leading separator; the clip hides the one that starts a line. */
  .clip {
    min-width: 0;
    overflow: hidden;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    margin-left: -18px;
  }
  .part {
    white-space: nowrap;
  }
  .part::before {
    content: '·';
    display: inline-block;
    width: 18px;
    text-align: center;
    color: var(--color-text-disabled);
  }
  .fw .mono {
    font-size: var(--text-xs);
  }
  .sync {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
    white-space: nowrap;
  }
  .sync .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-success);
    flex: none;
  }
  .sync .dot.write {
    background: var(--color-warning);
  }
  .sync.stale {
    color: var(--color-warning);
  }
  .sync.stale .dot {
    background: var(--color-warning);
  }
  .layout {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }
  .mics-col {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
    container-type: inline-size;
  }
  .mics {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: minmax(0, 1fr);
  }
  @container (min-width: 520px) {
    .mics {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .audio-note {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  .rx-col {
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 380px;
    }
    .rx-col {
      position: sticky;
      top: calc(var(--header-h) + var(--space-4));
    }
  }
  @media (max-width: 559px) {
    .sync {
      white-space: normal;
    }
  }
</style>
