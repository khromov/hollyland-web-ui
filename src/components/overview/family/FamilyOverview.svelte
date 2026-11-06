<script lang="ts">
  /**
   * Overview for the product families on the generic device API (LARK A1, M3, MAX 2, MELO P1):
   * the same faceplate as the legacy Overview, drawn from the session's units and ControlSpecs.
   *
   *  Transmitters  2 or 4 mic modules (session.micSlots): name, link, battery, mute, per-mic gain,
   *                and a meter per mic when each mic has its own source (meters.ts); four mics on a
   *                two-channel USB output get one USB L / R pair above them.
   *  Receiver      the kit around the receiver (receivers, case, earphones, remote), then the
   *                receiver-wide controls of the home screen as one strip of modules
   *                (controls.ts pageOf / buildModules). Settings, timecode, monitoring and mixer
   *                controls live on their own pages.
   *
   * Layout follows the legacy page: a 168 px label rail at ≥ 1440 px, channels side by side from
   * 960 px (four mics: 2 × 2, a row of four from 1280 px), single column below 600 px. The
   * receiver strip takes the spare height so its rules run down to the status line.
   */
  import { untrack } from 'svelte'
  import { CONTROL, type ControlSpec } from '../../../lib/protocol/app'
  import Panel from '../../../lib/ui/Panel.svelte'
  import Modules from '../../../lib/ui/Modules.svelte'
  import MeterWindow from '../../../lib/ui/MeterWindow.svelte'
  import { uid } from '../../../lib/ui/field'
  import { session } from '../../../lib/state/session.svelte'
  import { audio } from '../../../lib/state/audio.svelte'
  import { toasts } from '../../../lib/ui/toast.svelte'
  import Note from '../Note.svelte'
  import ControlModule from '../../controls/ControlModule.svelte'
  import { MIC_MODULE_CONTROLS, buildModules, moduleNeed, pageOf, stripColumns } from '../../controls/controls'
  import { shown, viewOf } from '../../controls/write'
  import FamilyMicModule from './FamilyMicModule.svelte'
  import UnitsRow from './UnitsRow.svelte'
  import { micNames } from './names.svelte'
  import { deviceReading, usbChannelCount, usbChannelLabel, type MicMeter } from './meters'

  // ------------------------------------------------------------------ breakpoints
  function media(q: string) {
    const m = typeof window !== 'undefined' ? window.matchMedia(q) : null
    let v = $state(m?.matches ?? false)
    $effect(() => {
      if (!m) return
      const on = () => (v = m.matches)
      m.addEventListener('change', on)
      return () => m.removeEventListener('change', on)
    })
    return {
      get value() {
        return v
      },
    }
  }
  const railMq = media('(min-width: 1440px)')
  const phoneMq = media('(max-width: 599px)')
  const rail = $derived(railMq.value)
  const phone = $derived(phoneMq.value)

  const family = $derived(session.family)
  const slots = $derived(session.micSlots)
  const four = $derived(slots.length > 2)

  // ------------------------------------------------------------------ meters
  const deviceLevels = $derived(session.hasDeviceLevels)
  /** The receiver is a USB audio input of this computer (not a Bluetooth charging case). */
  const usbAudio = $derived(!deviceLevels && session.product?.idKind !== 'app' && session.transportKind !== 'web-bluetooth')
  const modeValue = $derived(session.value(CONTROL.CHANNEL_MODE))
  /** What the USB channels carry is only known once the mode is read back. */
  const mode = $derived(session.live && typeof modeValue === 'number' ? modeValue : undefined)
  const usbChannels = $derived(usbChannelCount(family, mode))
  /** Four USB channels are expected, but the browser opened fewer. */
  const fewerOpened = $derived(audio.state === 'running' && audio.channelCount > 0 && audio.channelCount < slots.length && slots.length > 2)
  const perMic = $derived(deviceLevels || (usbAudio && slots.length <= usbChannels && !fewerOpened))
  const usbPair = $derived(usbAudio && !perMic)

  // Device-pushed levels (MELO P1): stream while this page is shown.
  $effect(() => {
    if (!deviceLevels) return
    return untrack(() => session.useLevels())
  })

  const startAudio = () => void audio.start()
  const foreignInput = $derived(usbAudio && audio.state === 'running' && !audio.isHollyland)

  function usbMeter(c: number, micName: string, primary: boolean): MicMeter {
    const l = usbChannelLabel(family, mode, c, micName)
    return {
      read: () => audio.readChannel(audio.channelCount === 1 ? 0 : c),
      label: l.label,
      caption: l.caption ?? undefined,
      state: audio.meterState,
      message: audio.meterMessage,
      onstart: startAudio,
      primary,
    }
  }
  function deviceMeter(i: number, micName: string): MicMeter {
    const key = i === 0 ? 'mic1' : 'mic2'
    return {
      read: () => {
        const l = session.levels
        return deviceReading(l?.inputs?.[key], l?.at)
      },
      label: micName,
      state: session.levelsActive ? 'live' : session.writeOnly ? 'error' : 'starting',
      message: session.levelsActive ? undefined : session.writeOnly ? 'No levels' : 'Starting levels…',
      primary: i === 0,
    }
  }
  function meterFor(i: number): MicMeter | null {
    const unit = slots[i]
    const name = micNames.name(unit, session.micState?.units[unit])
    if (deviceLevels) return i < 2 ? deviceMeter(i, name) : null
    if (perMic) return usbMeter(i, name, i === 0)
    return null
  }
  /** The pair above four mics always says what it carries ("USB L", "Mix · L", or the mic in 4-track). */
  const pairMeters = $derived.by(() => {
    if (!usbPair) return []
    return [0, 1].map((c) => {
      const unit = slots[c]
      const m = usbMeter(c, micNames.name(unit, session.micState?.units[unit]), c === 0)
      return { ...m, caption: m.caption ?? m.label }
    })
  })

  // ------------------------------------------------------------------ section words
  const onlineCount = $derived.by(() => {
    const u = session.micState?.units
    if (!session.live || !u) return null
    return slots.filter((id) => u[id]?.online).length
  })
  const txSummary = $derived(
    session.writeOnly ? undefined : onlineCount === null ? 'Reading…' : `${onlineCount} of ${slots.length} online`,
  )

  /**
   * A reason that blocks every mute and gain drawn in the mic modules (secondary receiver, a value that a
   * write-only link can't read) is said once above the mics; the modules point at it. Mirrors what
   * FamilyMicModule draws as a control (not the gated ones, not an offline mic's mute).
   */
  const txSharedId = uid('tx-reason')
  const txShared = $derived.by(() => {
    const reasons: (string | null)[] = []
    const units = session.micState?.units
    for (const unit of slots) {
      const mute = session.control(CONTROL.MIC_MUTE)
      if (mute?.perUnit?.includes(unit)) {
        const v = viewOf(mute, unit)
        const drawn = v.reasonCode !== 'firmware-too-old' && v.reasonCode !== 'version-unknown' && (session.writeOnly || (session.live && !!units?.[unit]?.online))
        if (drawn) reasons.push(v.reason)
      }
      const gain = session.control(CONTROL.MIC_GAIN)
      if (gain?.perUnit?.includes(unit) && shown(gain, unit)) {
        const v = viewOf(gain, unit)
        if (v.reasonCode !== 'firmware-too-old' && v.reasonCode !== 'version-unknown' && v.reasonCode !== 'two-mic-mode') reasons.push(v.reason)
      }
    }
    const first = reasons[0]
    return reasons.length >= 2 && first && reasons.every((r) => r === first) ? { text: first, id: txSharedId } : null
  })

  // ---------------------------------------- "Mic 1 Connected" / "Mic 1 Disconnected" toasts
  // Compared from the first status poll on: before it the mics fill in one by one (the MAX 2 charging case pushes
  // each mic's state after connecting), which is not a change the user made.
  let prevOnline: Record<string, boolean> | null = null
  $effect(() => {
    const u = session.micState?.units
    if (!session.live || !u || session.phase !== 'ready' || !session.micState?.lastStatusAt) {
      prevOnline = null
      return
    }
    const cur: Record<string, boolean> = {}
    for (const id of slots) cur[id] = !!u[id]?.online
    const prev = prevOnline
    prevOnline = cur
    if (!prev) return
    untrack(() => {
      for (const id of slots) {
        if (id in prev && cur[id] !== prev[id]) toasts.info(`${micNames.name(id, u[id])} ${cur[id] ? 'Connected' : 'Disconnected'}`)
      }
    })
  })

  // ------------------------------------------------------------------ receiver strip
  /** Receiver-wide controls of the home screen (per-mic ones are in the mic modules). */
  const stripSpecs = $derived(
    session.controls.filter(
      (c: ControlSpec) => pageOf(c, family) === 'overview' && !c.perUnit && !MIC_MODULE_CONTROLS.includes(c.id) && shown(c),
    ),
  )
  const modules = $derived(buildModules(stripSpecs).filter((m) => m.head || m.body.some((s) => shown(s))))

  /**
   * A reason that blocks most of the strip (no mic connected, secondary receiver) is said once
   * above it; the modules it blocks point at that line instead of repeating it.
   */
  const sharedId = uid('strip-reason')
  const shared = $derived.by(() => {
    const count = new Map<string, number>()
    for (const m of modules) {
      const reasons = new Set(
        [m.head, ...m.body].filter((s): s is ControlSpec => !!s).map((s) => viewOf(s).reason).filter((r): r is string => !!r),
      )
      for (const r of reasons) count.set(r, (count.get(r) ?? 0) + 1)
    }
    let best: string | null = null
    let n = 0
    for (const [r, k] of count) if (k > n) [best, n] = [r, k]
    return best && n >= 2 && n * 2 >= modules.length ? { text: best, id: sharedId } : null
  })

  /**
   * Width of the strip, read in the next animation frame: a column change re-lays out the keys
   * (which measure themselves), so reading it inside the observer callback would loop.
   */
  let stripWidth = $state(0)
  function measureStrip(node: HTMLElement) {
    let raf = 0
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => (stripWidth = w))
    })
    ro.observe(node)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }
  /** Column weights: each column as wide as its widest module needs, the spare width shared. */
  const weights = $derived(
    phone ? [1] : stripColumns(modules.map((m) => moduleNeed(m, { sendKeys: session.writeOnly })), stripWidth || 1200),
  )
  const cols = $derived(weights.length)
  const rows = $derived(Math.max(1, Math.ceil(modules.length / cols)))
  const columns = $derived(weights.map((w) => `minmax(0, ${w}fr)`).join(' '))
</script>

{#snippet foreignNote()}
  <span title="Levels from “{audio.deviceLabel || 'an audio input'}”, not the receiver">Wrong input</span> ·
  <a href="#/audio">Change</a>
{/snippet}

<div class="overview" class:inline-heads={!rail}>
  <h1 class="visually-hidden">Overview</h1>

  <Panel title="Transmitters" description={txSummary} {rail} hideTitle={phone} class="tx-panel">
    {#snippet meta()}
      {#if rail && foreignInput}<p class="rail-note">{@render foreignNote()}</p>{/if}
    {/snippet}
    {#snippet aside()}
      {#if !rail && !phone && foreignInput}<span class="aside-note">{@render foreignNote()}</span>{/if}
    {/snippet}
    {#if usbPair}
      <div class="pair">
        {#each pairMeters as m, c (c)}
          <div class="pw">
            <MeterWindow
              read={m.read}
              label={m.label}
              tone="neutral"
              variant="channel"
              history={false}
              caption={m.caption}
              state={m.state}
              message={m.message}
              onstart={m.onstart}
              primary={m.primary}
            />
          </div>
        {/each}
      </div>
    {/if}
    {#if txShared}
      <div class="tx-note"><Note id={txShared.id}>{txShared.text}</Note></div>
    {/if}
    <div class="channels" class:four>
      {#each slots as unit, i (unit)}
        <FamilyMicModule {unit} meter={meterFor(i)} compact={phone} dense={four} shared={txShared} />
      {/each}
    </div>
    {#if foreignInput && phone}
      <p class="input-note">{@render foreignNote()}</p>
    {/if}
  </Panel>

  <Panel title="Receiver" {rail} fill class="rx-panel">
    <div class="rx-body">
      <UnitsRow />
      {#if shared}
        <div class="strip-block"><Note id={shared.id}>{shared.text}</Note></div>
      {/if}
      {#if modules.length}
        <div class="strip-wrap" {@attach measureStrip} style="--rows: {rows > 1 ? `repeat(${rows - 1}, auto) ` : ''}minmax(0, 1fr)">
          <Modules {columns} class="strip">
            {#each modules as def (def.key)}
              <ControlModule {def} {shared} />
            {/each}
          </Modules>
        </div>
      {/if}
    </div>
  </Panel>
</div>

<style>
  .overview {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .overview > :global(.rx-panel) {
    flex: 1 0 auto;
  }

  .channels {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }
  .channels > :global(* + *) {
    border-top: 1px solid var(--rule);
  }
  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    padding: 14px var(--channel-pad) 4px;
  }

  .pw {
    display: grid;
    min-width: 0;
  }

  .rx-body {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .strip-wrap {
    flex: 1 0 auto;
    display: grid;
    min-width: 0;
  }
  .strip-wrap > :global(.strip) {
    grid-template-rows: var(--rows);
  }
  .strip-block {
    padding: 14px var(--module-pad) 12px;
    border-bottom: 1px solid var(--rule);
  }
  .strip-block :global(.note),
  .tx-note :global(.note) {
    font-size: 13px;
  }
  .tx-note {
    padding: 12px var(--channel-pad) 0;
  }

  .rail-note {
    margin-top: 6px;
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink);
  }
  .aside-note {
    display: block;
    max-width: 72ch;
    font-size: 12px;
    line-height: 1.4;
    text-align: right;
    color: var(--ink);
  }
  .rail-note a,
  .aside-note a,
  .input-note a {
    color: var(--ink);
  }
  .input-note {
    padding: 0 var(--gutter) 16px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }

  .inline-heads :global(.rx-panel > .head),
  .inline-heads :global(.tx-panel > .head) {
    padding-block: 12px 2px;
  }

  @media (min-width: 600px) {
    .channels.four {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .channels.four > :global(*) {
      border-top: 0;
    }
    .channels.four > :global(:nth-child(n + 3)) {
      border-top: 1px solid var(--rule);
    }
    .channels.four > :global(:nth-child(2n)) {
      border-left: 1px solid var(--rule);
    }
    .pair {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 960px) {
    .channels:not(.four) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .channels:not(.four) > :global(* + *) {
      border-top: 0;
      border-left: 1px solid var(--rule);
    }
  }
  @media (min-width: 1280px) {
    .channels.four {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .channels.four > :global(:nth-child(n + 3)) {
      border-top: 0;
    }
    .channels.four > :global(* + *) {
      border-left: 1px solid var(--rule);
    }
  }

  @media (max-width: 599px) {
    .overview {
      margin-inline: calc(-1 * var(--gutter));
    }
    .overview :global(.rx-panel > .head) {
      padding-inline: var(--gutter);
    }
    .pair {
      padding-inline: var(--gutter);
    }
    .strip-block,
    .tx-note {
      padding-inline: var(--gutter);
    }
  }
</style>
