<script lang="ts">
  /**
   * Overview: the front panel. Mirrors the official app's device home screen (features.md §4,
   * §12, §16): Mic 1 / Mic 2 with live levels, the Camera RX battery on the camera receiver, and
   * the RX-global controls as one strip.
   *
   * Layout (docs/design/instrument/spec.md):
   *  ≥ 1440  168 px label rail; channels side by side; the Transmitters row takes the free height
   *          so the meter windows grow; the receiver strip is one row of modules.
   *  1280+   the same without the rail (compact inline headings), so the strip keeps room for its keys.
   *  The level history is drawn only when the screen has room for it next to the whole receiver
   *  strip; without it the meter windows are compact and the strip takes the spare height.
   *  960+    channels side by side, strip wraps 3 + 2.
   *  600+    channels stacked (64 px history), strip 2 per row.
   *  < 600   single column, 36 px history, full-width rows.
   */
  import { untrack } from 'svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import MicModule from './MicModule.svelte'
  import CameraRxRow from './CameraRxRow.svelte'
  import ReceiverStrip from './ReceiverStrip.svelte'

  const family = $derived(session.product?.family ?? null)
  const showCameraRx = $derived(family === '6118' && session.isCameraVariant)

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
  const deskMq = media('(min-width: 1280px)')
  const phoneMq = media('(max-width: 599px)')
  const rail = $derived(railMq.value)
  const desk = $derived(deskMq.value)
  const phone = $derived(phoneMq.value)

  // --------------------------------------------- desktop: the meters take the free height
  let root: HTMLDivElement | undefined = $state()
  let avail = $state(0)
  /** Height the meter windows can have with everything else on screen. */
  let windowSpace = $state(0)
  /** Height from the top of the page to the status line (or the bottom of the window). */
  function measure() {
    if (!root) return
    const main = root.closest('main')
    const top = root.getBoundingClientRect().top + window.scrollY
    const pb = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
    const status = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-h')) || 0
    avail = Math.round(window.innerHeight - top - pb - status)
    // Everything but the windows keeps its height whether or not the history is drawn. Natural
    // heights are read with the stretching switched off for a moment (the strip or the windows
    // absorb the free height otherwise).
    const rx = root.querySelector<HTMLElement>('.rx-panel')
    const tx = root.querySelector<HTMLElement>('.tx-panel')
    const win = root.querySelector<HTMLElement>('.mic .win')
    if (rx && tx && win) {
      root.classList.add('measuring')
      windowSpace = avail - rx.offsetHeight - (tx.offsetHeight - win.offsetHeight)
      root.classList.remove('measuring')
    }
  }
  $effect(() => {
    if (!desk || !root) {
      avail = 0
      return
    }
    measure()
    window.addEventListener('resize', measure)
    // A band above the page (write-only, connection lost) moves the page down.
    const main = root.closest('main')
    const ro = new ResizeObserver(() => measure())
    if (main) ro.observe(main)
    ro.observe(root)
    return () => {
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  })
  // Session changes add or remove bands above the page: measure again once they have rendered.
  $effect(() => {
    void session.writeOnly
    void session.phase
    if (!desk) return
    const raf = requestAnimationFrame(() => untrack(measure))
    return () => cancelAnimationFrame(raf)
  })
  /**
   * Level history in the meter windows: on desktop only when the screen leaves room for it next
   * to the whole receiver strip (1280 × 720 keeps the strip in view without it). A window with
   * the history above its bar row needs about 230 px; when the page already overflows
   * (windowSpace ≤ 0) there is no room either.
   */
  const HISTORY_WINDOW_MIN = 230
  const history = $derived(desk && avail > 0 && windowSpace < HISTORY_WINDOW_MIN ? false : 10)
  /** Desktop with history: the meter windows absorb the free height. */
  const fillWindows = $derived(desk && avail > 0 && history !== false)

  // ------------------------------------------------------------------ meters
  const meter = $derived({ state: audio.meterState, message: audio.meterMessage })
  const startAudio = () => void audio.start()
  const foreignInput = $derived(audio.state === 'running' && !audio.isHollyland)

  // ------------------------------------------- identity colours (M2S can swap them)
  // TX light colour per TX: purple = 1, yellow = 2 (features.md §16, Custom Functions).
  const colors = $derived(session.settings.buttonColors)
  const tx1Yellow = $derived(colors?.tx1 === 2)
  const tx2Purple = $derived(colors?.tx2 === 1)
  const ledNames = $derived<[string, string]>([tx1Yellow ? 'yellow' : 'purple', tx2Purple ? 'purple' : 'yellow'])

  // ------------------------------------------------------------------ section words
  const onlineCount = $derived.by(() => {
    const u = session.units
    if (!session.live || !u) return null
    return (u.tx1.online ? 1 : 0) + (u.tx2.online ? 1 : 0)
  })
  const txSummary = $derived(
    session.writeOnly ? "Mic status can't be read here" : onlineCount === null ? 'Reading status…' : `${onlineCount} of 2 online`,
  )

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

{#snippet foreignNote()}
  These levels come from “{audio.deviceLabel || 'an audio input'}”, which doesn't look like the receiver. Pick
  the receiver's input on the <a href="#/audio">Audio</a> page.
{/snippet}

<div
  bind:this={root}
  class="overview"
  class:fill={desk && avail > 0}
  class:fill-windows={fillWindows}
  class:inline-heads={!rail}
  class:tx1-yellow={tx1Yellow}
  class:tx2-purple={tx2Purple}
  style={desk && avail > 0 ? `--ov-avail: ${avail}px` : undefined}
>
  <h1 class="visually-hidden">Overview</h1>

  <!-- Phones start with the channels (no heading); elsewhere the rail or an inline heading names the row. -->
  <Panel title="Transmitters" description={txSummary} {rail} fill={fillWindows} hideTitle={phone} class="tx-panel">
    {#snippet meta()}
      {#if rail}
        <p class="rail-note">Levels come from the receiver's USB audio in this browser.</p>
        {#if foreignInput}<p class="rail-note warn">{@render foreignNote()}</p>{/if}
      {/if}
    {/snippet}
    {#snippet aside()}
      {#if !rail && !phone && foreignInput}<span class="aside-note">{@render foreignNote()}</span>{/if}
    {/snippet}
    <div class="tx-body">
      <div class="channels">
        <MicModule index={0} {meter} onstart={startAudio} {history} compact={phone} fill={fillWindows} />
        <MicModule index={1} {meter} onstart={startAudio} {history} compact={phone} fill={fillWindows} />
      </div>
      {#if foreignInput && phone}
        <p class="input-note">{@render foreignNote()}</p>
      {/if}
    </div>
  </Panel>

  <Panel title="Receiver" description={phone ? undefined : 'These settings apply to both mics.'} {rail} class="rx-panel">
    {#snippet aside()}
      {#if phone}Applies to both mics{/if}
    {/snippet}
    {#snippet meta()}
      {#if showCameraRx}<CameraRxRow />{/if}
    {/snippet}
    <ReceiverStrip wide={desk} {ledNames} />
  </Panel>
</div>

<style>
  .overview {
    --hist-min: 96px;
    --hist-min-narrow: 36px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  /* M2S: the TX light colours can be swapped; identity follows the device. */
  .tx1-yellow {
    --mic1: #ffcc1a;
    --mic1-w: #ffcc1a;
  }
  .tx2-purple {
    --mic2: #9d6bff;
    --mic2-w: #b99aff;
  }

  .tx-body {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    height: 100%;
    min-height: 0;
  }
  .channels {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
  }
  /* Rules between the channels, like the receiver modules. */
  .channels > :global(* + *) {
    border-top: 1px solid var(--rule);
  }

  .rail-note {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .rail-note.warn {
    margin-top: 6px;
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
  .aside-note a {
    color: var(--ink);
  }
  .input-note {
    padding: 0 var(--channel-pad) 16px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .input-note a {
    color: var(--ink);
  }


  /* ---------------- receiver strip columns below 1280 ---------------- */
  .overview {
    --ov-cols: minmax(0, 1fr);
  }
  @media (min-width: 600px) {
    .overview {
      --ov-cols: repeat(2, minmax(0, 1fr));
      --hist-min: 64px;
      --hist-min-narrow: 64px;
    }
  }
  @media (min-width: 960px) {
    .overview {
      --ov-cols: repeat(3, minmax(0, 1fr));
      --hist-min: 96px;
      --hist-min-narrow: 72px;
    }
    .channels {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .channels > :global(* + *) {
      border-top: 0;
      border-left: 1px solid var(--rule);
    }
  }

  /* Inline section headings (no rail): compact, so the strip stays in view on short screens. */
  .inline-heads :global(.rx-panel > .head),
  .inline-heads :global(.tx-panel > .head) {
    padding-block: 12px 2px;
  }

  /* ---------------- desktop: fill the screen, meters absorb the spare height ---------------- */
  @media (min-width: 1280px) {
    .overview {
      --hist-min: 40px;
    }
    /* The page fills the window down to the status line. With the history the meter windows
       take the spare height; without it the windows stay compact and the receiver strip takes it
       (its module rules run down to the status line). */
    .fill {
      min-height: var(--ov-avail);
      grid-template-rows: auto minmax(0, 1fr);
    }
    .fill.fill-windows {
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .fill :global(.tx-panel) {
      min-height: 0;
    }
    .fill :global(.rx-panel) {
      grid-template-rows: auto minmax(0, 1fr);
    }
    .fill :global(.rx-panel.rail) {
      grid-template-rows: minmax(0, 1fr);
    }
    .fill :global(.rx-panel .strip) {
      height: 100%;
    }
    .fill:global(.measuring) {
      min-height: 0;
      grid-template-rows: auto auto;
    }
    .fill:global(.measuring) :global(.rx-panel .strip) {
      height: auto;
    }
  }

  /* ---------------- phone: rules run edge to edge, modules carry the gutter ---------------- */
  @media (max-width: 599px) {
    .overview {
      margin-inline: calc(-1 * var(--gutter));
    }
    .overview :global(.rx-panel > .head) {
      padding-inline: var(--gutter);
    }
    .input-note {
      padding-inline: var(--gutter);
    }
  }
</style>
