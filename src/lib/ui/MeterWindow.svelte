<script lang="ts">
  /**
   * A dark display window with a channel's level: segmented bar meter (instant attack, 20 dB/s
   * release, peak hold 1500 ms, red-tinted top 6 dB), an optional level history on its own time
   * axis, a big mono RMS readout with the held peak, and a CLIP lamp (click to reset).
   *
   * Levels are pulled through `read()` at animation-frame rate and drawn on canvases, so Svelte
   * never re-renders per frame. Drawing pauses while the document is hidden. Under reduced
   * motion the meter updates at 10 Hz with no decay trail, and lamps never blink.
   *
   * `state` other than 'live' shows a short state inside the window (an error says its fix), with
   * the key that fixes it where there is one (first run: only the "Show live levels" key).
   *
   * Variants:
   *   channel  Overview: the level history (optional) across the full width on top, its own time
   *            axis; under it the bar + dB scale on the left, with a caption and the CLIP lamp
   *            above the bar, and the readout cluster (RMS, peak, loudest) beside the bar row.
   *            Without history the window is just that bar row (compact).
   *   strip    Audio page row: label column, bar + scale, RMS / Peak / CLIP readouts. Use `bare`
   *            and stack several inside one .mc-window.
   *   compact  Small: bar + scale with a small readout (legacy LevelMeter)
   */
  import type { Snippet } from 'svelte'
  import { onMount } from 'svelte'
  import { DB_FLOOR, MeterBallistics, dbToMeterPos } from '../audio/levels'
  import type { ChannelTone, MeterState } from './types'
  import { formatDb } from './meters'
  import Lamp from './Lamp.svelte'

  interface Props {
    /** Current { rmsDb, peakDb } of this channel, or null when there is no signal source. */
    read: () => { rmsDb: number; peakDb: number } | null
    /** What the channel carries: "Mic 1", "Mix · L", "Main", "Safety −6 dB", "L". */
    label: string
    /** Purple / yellow only when the channel truly carries that mic (see usbChannelMeters). */
    tone?: ChannelTone
    variant?: 'channel' | 'strip' | 'compact'
    /** Strip variant: second line under the label, e.g. "Left · TX1". */
    sub?: string
    state?: MeterState
    /** Replaces the default sentence for the current state. */
    message?: string
    /** Action for idle / denied / error ("Show live levels", "Try again"). */
    onstart?: () => void
    /** Replaces the default action key. */
    action?: Snippet
    /** Seconds of level history to draw (channel variant), or false. */
    history?: number | false
    /** Number of segments; 'auto' is 40, or 28 in a narrow window. */
    segments?: number | 'auto'
    /** The mic reports mute (its channel is silent on purpose). */
    muted?: boolean
    /** No window chrome (to stack strips inside one .mc-window). */
    bare?: boolean
    /** Channel variant: what the channel carries, above the bar ("USB L"). */
    tag?: string
    caption?: string
    /** Strip variant: print the dB scale under the bar (stacked strips share one scale). */
    scale?: boolean
    /**
     * Several windows on one screen: only the primary one carries the first-run sentence and
     * key; the others say they are waiting.
     */
    primary?: boolean
  }

  let {
    read,
    label,
    tone = 'neutral',
    variant = 'channel',
    sub,
    state: mstate = 'live',
    message,
    onstart,
    action,
    history = false,
    segments = 'auto',
    muted = false,
    bare = false,
    tag,
    caption,
    scale = true,
    primary = true,
  }: Props = $props()

  const GRID = [-6, -12, -24, -36, -48]
  const HIST_RATE = 15 // samples per second

  let root: HTMLDivElement
  let barCanvas: HTMLCanvasElement
  let histCanvas: HTMLCanvasElement | undefined = $state()
  let width = $state(0)
  let stackW = $state(0)
  let histH = $state(0)
  let intEl: HTMLSpanElement | undefined = $state()
  let decEl: HTMLElement | undefined = $state()
  let peakEl: HTMLElement | undefined = $state()
  let maxEl: HTMLElement | undefined = $state()
  let clipped = $state(false)
  let announce = $state('')
  let ariaNow = $state(DB_FLOOR)
  let liveAria = $state('')
  const meter = new MeterBallistics()

  const narrow = $derived(width > 0 && width < 520)
  // Segments and scale marks follow the bar's own width, so labels never collide.
  const nSegs = $derived(segments === 'auto' ? (stackW === 0 || stackW >= 330 ? 40 : 28) : segments)
  const marks = $derived(
    stackW === 0 || stackW >= 330
      ? [-60, -48, -36, -24, -18, -12, -6, 0]
      : stackW >= 200
        ? [-60, -36, -18, -6, 0]
        : [-60, -36, -12, 0],
  )
  const showHistory = $derived(variant === 'channel' && history !== false && history > 0)
  const gridLabels = $derived(showHistory && !narrow && histH >= 90)
  const live = $derived(mstate === 'live')

  /** A secondary window says only that it waits, and offers no key of its own. */
  const secondary = $derived(!primary && (mstate === 'idle' || mstate === 'denied' || mstate === 'error'))
  /** A short state, or an error with its fix. First run says nothing: the key says it. */
  const sentence = $derived(
    (secondary && mstate === 'idle' ? 'No live levels' : null) ??
      message ??
      {
        live: '',
        idle: '',
        starting: 'Waiting for microphone access…',
        denied: 'Microphone blocked. Allow it in site settings.',
        paused: 'Paused while the bridge runs',
        nodevice: 'No receiver audio input',
        error: 'Live levels stopped',
      }[mstate],
  )
  const actionLabel = $derived(
    secondary ? null : mstate === 'idle' ? 'Show live levels' : mstate === 'denied' || mstate === 'error' ? 'Try again' : null,
  )

  const ariaText = $derived(live ? liveAria || `${label}, no level yet` : `${label}: ${sentence || 'no live levels'}`)

  type RGB = [number, number, number]
  function parse(s: string, fallback: RGB): RGB {
    s = s.trim()
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
    if (hex) {
      let h = hex[1]
      if (h.length === 3) h = h.replace(/./g, (c) => c + c)
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
    }
    const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    return fallback
  }
  const mix = (a: RGB, b: RGB, t: number) =>
    `rgb(${Math.round(a[0] * t + b[0] * (1 - t))} ${Math.round(a[1] * t + b[1] * (1 - t))} ${Math.round(a[2] * t + b[2] * (1 - t))})`

  function setText(db: number, peak: number, max: number | null) {
    const t = live ? formatDb(db) : '–'
    const dot = t.indexOf('.')
    if (intEl) intEl.textContent = dot >= 0 ? t.slice(0, dot) : t
    if (decEl) decEl.textContent = dot >= 0 ? t.slice(dot) : ''
    if (peakEl) peakEl.textContent = live ? formatDb(peak) : '–'
    if (maxEl) maxEl.textContent = live && max !== null ? formatDb(max) : '–'
  }

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const bctx = barCanvas.getContext('2d')!
    let hctx: CanvasRenderingContext2D | null = null
    let dpr = window.devicePixelRatio || 1
    let bw = 1
    let bh = 1
    let hw = 1
    let hh = 1

    const fit = () => {
      dpr = window.devicePixelRatio || 1
      const r = barCanvas.getBoundingClientRect()
      bw = Math.max(1, Math.round(r.width * dpr))
      bh = Math.max(1, Math.round(r.height * dpr))
      barCanvas.width = bw
      barCanvas.height = bh
      if (histCanvas) {
        const q = histCanvas.getBoundingClientRect()
        hw = Math.max(1, Math.round(q.width * dpr))
        hh = Math.max(1, Math.round(q.height * dpr))
        histCanvas.width = hw
        histCanvas.height = hh
        hctx = histCanvas.getContext('2d')
        histH = q.height
      } else {
        hctx = null
      }
    }
    const ro = new ResizeObserver(fit)
    ro.observe(barCanvas)
    ro.observe(root)
    if (histCanvas) ro.observe(histCanvas)

    // Colours: read from tokens (so a device-driven --mic1/--mic2 override follows), refreshed 1 Hz.
    let colors = {
      tone: [233, 232, 227] as RGB,
      unlit: [29, 29, 32] as RGB,
      hot: [240, 84, 74] as RGB,
      rule: 'rgb(255 255 255 / 0.09)',
    }
    const readColors = () => {
      const cs = getComputedStyle(root)
      const toneVar = tone === 'mic1' ? '--mic1' : tone === 'mic2' ? '--mic2' : '--w-ink'
      colors = {
        tone: parse(cs.getPropertyValue(toneVar), [233, 232, 227]),
        unlit: parse(cs.getPropertyValue('--w-unlit'), [29, 29, 32]),
        hot: parse(cs.getPropertyValue('--hot'), [240, 84, 74]),
        rule: 'rgb(255 255 255 / 0.10)',
      }
    }
    readColors()

    const N = Math.max(10, Math.round((typeof history === 'number' ? history : 10) * HIST_RATE))
    const hist = new Float32Array(N).fill(DB_FLOOR)
    let head = 0
    let sampleMax = DB_FLOOR
    let lastSample = 0
    let fast = DB_FLOOR
    let raf = 0
    let last = performance.now()
    let lastDraw = 0
    let lastText = 0
    let lastAria = 0
    let lastColors = 0
    let wasLive = false

    const drawBar = () => {
      const n = nSegs
      const gap = Math.max(1, Math.round(2 * dpr))
      const segW = (bw - gap * (n - 1)) / n
      // Segments are lit up to the ballistic RMS level, the same value the readout prints. While
      // the level falls (the input is below it), the two segments above it fade out as the decay
      // tail; the held peak is lit on its own. At the floor nothing is lit.
      const lvl = meter.level > DB_FLOOR + 0.5 ? dbToMeterPos(meter.level) * n : 0
      const decaying = !reduced.matches && lvl > 0 && fast < meter.level - 0.5
      const pkI = meter.peakHold > DB_FLOOR + 0.5 ? Math.min(n - 1, Math.ceil(dbToMeterPos(meter.peakHold) * n) - 1) : -1
      const unlit = mix(colors.tone, colors.unlit, 0.15)
      const hotUnlit = mix(colors.hot, colors.unlit, 0.2)
      bctx.clearRect(0, 0, bw, bh)
      for (let i = 0; i < n; i++) {
        const topDb = DB_FLOOR + ((i + 1) / n) * -DB_FLOOR
        const hot = topDb > -6 + 1e-6
        let a = 0
        if (live) {
          if (i + 0.5 < lvl) a = 1
          else if (decaying && i - Math.floor(lvl - 0.5) === 1) a = 0.55
          else if (decaying && i - Math.floor(lvl - 0.5) === 2) a = 0.3
          if (i === pkI) a = 1
        }
        bctx.fillStyle = a === 0 ? (hot ? hotUnlit : unlit) : mix(hot ? colors.hot : colors.tone, colors.unlit, a)
        const x = Math.round(i * (segW + gap))
        const x2 = Math.round(i * (segW + gap) + segW)
        bctx.fillRect(x, 0, Math.max(1, x2 - x), bh)
      }
    }

    const drawHist = () => {
      if (!hctx) return
      hctx.clearRect(0, 0, hw, hh)
      // Gridlines first, so bars sit over them (no label ever crosses a bar: labels live in a gutter).
      hctx.lineWidth = Math.max(1, Math.round(dpr))
      hctx.setLineDash([3 * dpr, 3 * dpr])
      // A short strip (phones) keeps only the red −6 line: five lines 6–9 px apart read as hatching.
      const grid = narrow || hh / dpr < 60 ? [-6] : GRID
      for (const g of grid) {
        const y = Math.round(hh - dbToMeterPos(g) * hh) + 0.5
        hctx.strokeStyle = g === -6 ? 'rgb(240 84 74 / 0.32)' : colors.rule
        hctx.beginPath()
        hctx.moveTo(0, y)
        hctx.lineTo(hw, y)
        hctx.stroke()
      }
      hctx.setLineDash([])
      if (!live) return
      const step = hw / N
      // Thin bars with a visible gap, like a printed level log.
      const gap = step >= 2.5 ? Math.max(1, Math.round(step * 0.32)) : 0
      const old = mix(colors.tone, colors.unlit, 0.42)
      const fresh = `rgb(${colors.tone.join(' ')})`
      for (let k = 0; k < N; k++) {
        const db = hist[(head + k) % N]
        if (db <= DB_FLOOR + 0.5) continue
        const h = Math.max(1, dbToMeterPos(db) * hh)
        const x = Math.round(k * step)
        const x2 = Math.round((k + 1) * step) - gap
        hctx.fillStyle = k >= N - 2 ? fresh : old
        hctx.fillRect(x, Math.round(hh - h), Math.max(1, x2 - x), Math.ceil(h))
      }
    }

    const histMax = () => {
      let m = DB_FLOOR
      for (let i = 0; i < N; i++) if (hist[i] > m) m = hist[i]
      return m
    }

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) {
        last = t
        return
      }
      if (reduced.matches && t - lastDraw < 100) return
      const dt = Math.min(0.25, (t - last) / 1000)
      last = t
      lastDraw = t
      if (t - lastColors > 1000) {
        lastColors = t
        readColors()
      }

      if (live !== wasLive) {
        wasLive = live
        meter.reset()
        hist.fill(DB_FLOOR)
        fast = DB_FLOOR
        if (clipped) clipped = false
      }
      const lv = live ? read() : null
      const rms = lv ? lv.rmsDb : DB_FLOOR
      const pk = lv ? lv.peakDb : DB_FLOOR
      meter.update(rms, pk, t, reduced.matches ? 10 : dt)
      fast = rms
      if (meter.clipped && !clipped) {
        clipped = true
        announce = `${label} clipped`
      }

      if (showHistory) {
        sampleMax = Math.max(sampleMax, rms)
        if (t - lastSample >= 1000 / HIST_RATE) {
          hist[head] = live ? sampleMax : DB_FLOOR
          head = (head + 1) % N
          sampleMax = DB_FLOOR
          lastSample = t
        }
      }

      drawBar()
      if (showHistory) drawHist()

      if (t - lastText >= (reduced.matches ? 250 : 125)) {
        lastText = t
        setText(meter.level, meter.peakHold, showHistory ? histMax() : null)
      }
      if (t - lastAria >= 1000) {
        lastAria = t
        ariaNow = Math.max(DB_FLOOR, Math.min(0, Math.round(meter.level)))
        if (live)
          liveAria = `${label}, ${formatDb(meter.level)} dBFS, peak ${formatDb(meter.peakHold)}${clipped ? ', clipped' : ''}`
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  function resetClip() {
    meter.clipped = false
    clipped = false
    announce = ''
  }
</script>

{#snippet clipKey()}
  <button
    type="button"
    class="clip"
    onclick={resetClip}
    aria-label={clipped ? `${label} clipped. Reset the clip lamp` : `${label} clip lamp: not lit`}
    title={clipped ? 'Clipped: click to reset' : 'Lights when the level reaches 0 dBFS'}
  >
    <Lamp color="rec" size="sm" state={clipped ? 'on' : 'off'} /><span class="mc-lamp-legend">Clip</span>
  </button>
{/snippet}

<div
  bind:this={root}
  bind:clientWidth={width}
  class="mw v-{variant} t-{tone}"
  class:mc-window={!bare}
  class:bare
  class:narrow
  class:history={showHistory}
  class:labelled={gridLabels}
  class:offline={!live}
  class:inflow={!live}
  class:clipped
  class:noscale={!scale}
>
  {#if variant === 'strip'}
    <div class="who">
      <b>{label}</b>
      {#if sub}<span class="mono sub">{sub}</span>{/if}
    </div>
  {/if}

  {#if variant === 'channel'}
    <!-- Above the bar: what the channel carries, the mic's mute flag and the CLIP lamp. -->
    <div class="top">
      {#if caption}
        <span class="cap">{#if tag}<b>{tag}</b>{' · '}{/if}{caption}</span>
      {/if}
      {#if muted}<span class="muted">Muted</span>{/if}
      {@render clipKey()}
    </div>
  {/if}

  {#if showHistory}
    <div class="histblock" aria-hidden="true">
      <div class="hist-head">
        {#if gridLabels}<span class="gut"></span>{/if}
        <span class="mono">−{history} s</span>
        {#if !narrow}<span class="loud">loudest <b class="mono" bind:this={maxEl}>–</b></span>{/if}
        <span class="now mono">now</span>
      </div>
      <div class="hist">
        {#if gridLabels}
          <span class="ylab">
            {#each GRID as g (g)}
              <span class="mono" class:hot={g === -6} style="bottom: {dbToMeterPos(g) * 100}%">−{Math.abs(g)}</span>
            {/each}
          </span>
        {/if}
        <div class="plot"><canvas bind:this={histCanvas}></canvas></div>
      </div>
      <span class="sep"></span>
    </div>
  {/if}

  <div class="stack" bind:clientWidth={stackW}>
    <div class="bar-row">
      {#if gridLabels}<span class="gut mono" aria-hidden="true">{label.length <= 2 ? label : ''}</span>{/if}
      <div
        class="bar"
        role="meter"
        aria-label="{label} level"
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={ariaNow}
        aria-valuetext={ariaText}
      >
        <canvas bind:this={barCanvas}></canvas>
      </div>
    </div>
    {#if scale}
      <div class="scale-row" aria-hidden="true">
        {#if gridLabels}<span class="gut mono">dB</span>{/if}
        <span class="scale">
          {#each marks as m, i (m)}
            <span
              class="mono"
              class:first={i === 0}
              class:last={i === marks.length - 1}
              style="left: {dbToMeterPos(m) * 100}%">{m === 0 ? '0' : `−${Math.abs(m)}`}</span
            >
          {/each}
        </span>
      </div>
    {/if}
  </div>

  <div class="col">
    {#if variant === 'strip'}
      <span class="cell" aria-hidden="true">
        <span class="k">RMS</span>
        <span class="v mono"><span bind:this={intEl}>–</span><small bind:this={decEl}></small></span>
      </span>
      <span class="cell" aria-hidden="true">
        <span class="k">Peak</span>
        <span class="v mono" bind:this={peakEl}>–</span>
      </span>
      {@render clipKey()}
    {:else}
      {#if variant === 'compact'}{@render clipKey()}{/if}
      <!-- One cluster beside the bar row: nothing floats in an empty column. -->
      <div class="readout" aria-hidden="true">
        {#if variant === 'channel'}<span class="k">RMS dBFS</span>{/if}
        <span class="big mono"><span bind:this={intEl}>–</span><small bind:this={decEl}></small></span>
        <span class="k">peak <b class="mono" bind:this={peakEl}>–</b></span>
      </div>
    {/if}
  </div>

  {#if !live}
    <div class="overlay" class:row={variant !== 'channel' || narrow} class:quiet={secondary}>
      {#if sentence}
        <p>
          {#if mstate === 'starting'}<span class="mc-spinner" aria-hidden="true"></span>{/if}
          {sentence}
        </p>
      {/if}
      {#if action && !secondary}
        {@render action()}
      {:else if actionLabel && onstart}
        <button type="button" class="mc-key mc-key--light {variant === 'channel' && !narrow ? '' : 'mc-key--sm'}" onclick={onstart}
          >{actionLabel}</button
        >
      {/if}
    </div>
  {/if}

  <span class="visually-hidden" aria-live="polite">{announce}</span>
</div>

<style>
  .mw {
    --tone-ink: var(--w-ink);
    --gut: 30px;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 140px;
    column-gap: 24px;
    padding: 14px 18px 10px 16px;
    min-width: 0;
    color: var(--w-ink);
  }
  .bare {
    color: var(--w-ink);
  }
  .t-mic1 {
    --tone-ink: var(--mic1-w);
  }
  .t-mic2 {
    --tone-ink: var(--mic2-w);
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
  }

  /* ---------- channel: areas ----------
     compact            history (wide)         narrow (phone)
     top   col          hist  hist             top   top
     stack col          top   col              hist  col
                        stack col              stack col          */
  .v-channel {
    grid-template-areas: 'top col' 'stack col';
    grid-template-rows: auto auto;
    align-content: center;
    row-gap: 8px;
  }
  .v-channel.history {
    grid-template-areas: 'hist hist' 'top col' 'stack col';
    grid-template-rows: minmax(0, 1fr) auto auto;
    align-content: stretch;
  }
  .v-channel.narrow {
    grid-template-areas: 'top top' 'stack col';
  }
  .v-channel.history.narrow {
    grid-template-areas: 'top top' 'hist col' 'stack col';
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .narrow .top {
    align-self: start;
  }
  .v-channel .top {
    grid-area: top;
  }
  .v-channel .histblock {
    grid-area: hist;
  }
  .v-channel .stack {
    grid-area: stack;
  }
  .v-channel .col {
    grid-area: col;
  }

  /* ---------- top: caption, mute, CLIP ---------- */
  .top {
    align-self: end;
    display: flex;
    align-items: center;
    gap: 6px 12px;
    min-width: 0;
    min-height: 20px;
  }
  .cap {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    line-height: 1.3;
    color: var(--w-ink-2);
  }
  .cap b {
    font-weight: 620;
    color: var(--w-ink);
  }
  .muted {
    font-size: 12px;
    font-weight: 650;
    color: var(--w-ink);
  }
  .top .clip {
    margin-left: auto;
  }

  /* ---------- history: its own time axis, across the window ---------- */
  .histblock {
    display: grid;
    grid-template-rows: auto minmax(var(--hist-min, 96px), 1fr) auto;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .hist-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
  }
  .hist-head .gut {
    flex: none;
    width: calc(var(--gut) - 12px);
  }
  .hist-head .loud {
    margin-left: auto;
    font-size: 12px;
  }
  .hist-head .loud b {
    margin-left: 4px;
    font-size: 13px;
    font-weight: 500;
    color: var(--w-ink);
  }
  .hist-head .now {
    margin-left: auto;
  }
  .hist-head .loud + .now {
    margin-left: 20px;
  }
  .hist {
    position: relative;
    display: grid;
    min-height: 0;
  }
  .labelled .hist {
    grid-template-columns: var(--gut) minmax(0, 1fr);
  }
  /* The plot takes its height from the grid track; the canvas never sizes it (absolute). */
  .plot {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .plot canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }
  .ylab {
    position: relative;
  }
  .ylab span {
    position: absolute;
    left: 0;
    transform: translateY(50%);
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
  }
  .ylab span.hot {
    color: #f0877f;
  }
  .sep {
    height: 1px;
    margin: 4px 0 4px;
    background: var(--w-rule);
  }

  /* ---------- bar + scale ---------- */
  .stack {
    display: grid;
    align-content: end;
    gap: 6px;
    min-width: 0;
    min-height: 0;
  }
  .bar-row,
  .scale-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .labelled .bar-row,
  .labelled .scale-row {
    grid-template-columns: var(--gut) minmax(0, 1fr);
  }
  .gut {
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
    align-self: center;
  }
  .bar canvas {
    display: block;
    width: 100%;
    height: 30px;
  }
  .scale {
    position: relative;
    height: 18px;
  }
  .scale span {
    position: absolute;
    top: 6px;
    transform: translateX(-50%);
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
  }
  .scale span::before {
    content: '';
    position: absolute;
    left: 50%;
    top: -6px;
    width: 1px;
    height: 3px;
    background: #55555b;
  }
  .scale span.first {
    transform: none;
  }
  .scale span.first::before {
    left: 0;
  }
  .scale span.last {
    transform: translateX(-100%);
  }
  .scale span.last::before {
    left: auto;
    right: 0;
  }

  /* ---------- readout cluster ---------- */
  .col {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-end;
    gap: 10px;
    min-width: 0;
    text-align: right;
  }
  .clip {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 7px;
    padding: 2px 0 2px 6px;
    margin: -2px 0;
    border: 0;
    border-radius: 3px;
    background: none;
    color: var(--w-ink-2);
    -webkit-tap-highlight-color: transparent;
  }
  /* 44 px target around the small lamp legend */
  .clip::after {
    content: '';
    position: absolute;
    inset: 50% -6px auto auto;
    width: max(100%, 64px);
    height: 44px;
    transform: translateY(-50%);
  }
  .clipped .clip {
    color: #ff8a82;
  }
  .k {
    font-size: 12px;
    line-height: 1.2;
    color: var(--w-ink-2);
  }
  .k b {
    font-size: 13px;
    font-weight: 500;
    color: var(--w-ink);
  }
  .readout {
    display: grid;
    justify-items: end;
    gap: 5px;
    /* The readout's baseline sits level with the bar, above the dB scale. */
    padding-bottom: 20px;
  }
  .big {
    font-size: var(--t-readout);
    font-weight: 450;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--tone-ink);
    white-space: nowrap;
  }
  .big small {
    font-size: var(--t-readout-dec);
    letter-spacing: -0.01em;
  }
  .offline .big,
  .offline .k b,
  .offline .loud b {
    color: var(--w-ink-2);
  }
  /* No level: the sentence replaces the meter (nothing peeks out from under it). */
  .v-channel.offline > :not(.overlay, .visually-hidden) {
    visibility: hidden;
  }

  /* ---------- narrow (phone) ---------- */
  .narrow {
    grid-template-columns: minmax(0, 1fr) 92px;
    column-gap: 14px;
    padding: 12px 12px 8px;
  }
  .narrow .histblock {
    grid-template-rows: auto minmax(var(--hist-min-narrow, 36px), 1fr) auto;
  }
  .narrow .bar canvas {
    height: 22px;
  }
  .narrow .big {
    font-size: var(--t-readout-sm);
  }
  .narrow .big small {
    font-size: var(--t-readout-sm-dec);
  }
  .narrow .readout {
    padding-bottom: 18px;
    gap: 4px;
  }

  /* ---------- compact ---------- */
  .v-compact {
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 16px;
    padding: 10px 12px 6px;
  }
  .v-compact .bar canvas {
    height: 16px;
  }
  .v-compact .col {
    justify-content: flex-end;
    gap: 4px;
  }
  .v-compact .readout {
    padding-bottom: 0;
    gap: 2px;
  }
  .v-compact .big {
    font-size: 20px;
  }
  .v-compact .big small {
    font-size: 14px;
  }

  /* ---------- strip (Audio page rows) ---------- */
  .v-strip {
    grid-template-columns: 96px minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 20px;
    padding: 14px 20px 10px;
  }
  .v-strip.bare {
    padding-inline: 0;
  }
  .who {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .who b {
    font-size: 15px;
    font-weight: 650;
    font-stretch: var(--head-stretch);
    color: var(--tone-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who .sub {
    font-size: 12px;
    color: var(--w-ink-2);
    white-space: nowrap;
  }
  .v-strip .bar canvas {
    height: 32px;
  }
  .v-strip .col {
    flex-direction: row;
    align-items: flex-end;
    gap: 22px;
    padding-bottom: 18px;
  }
  .v-strip.noscale .col {
    padding-bottom: 0;
    align-items: center;
  }
  .cell {
    display: grid;
    justify-items: end;
    gap: 5px;
    min-width: 76px;
  }
  .cell .v {
    font-size: 22px;
    font-weight: 450;
    letter-spacing: -0.02em;
    line-height: 1;
    color: var(--tone-ink);
    white-space: nowrap;
  }
  .cell .v small {
    font-size: inherit;
  }
  .offline .cell .v {
    color: var(--w-ink-2);
  }
  .v-strip.narrow {
    grid-template-columns: minmax(0, 1fr) auto;
    row-gap: 10px;
  }
  .v-strip.narrow .stack {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .v-strip.narrow .col {
    padding-bottom: 0;
    gap: 14px;
  }
  .v-strip.narrow .cell {
    min-width: 0;
  }
  .v-strip.narrow .cell .v {
    font-size: 18px;
  }

  /* ---------- overlay: why there are no levels ---------- */
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px 20px;
    text-align: center;
    border-radius: inherit;
    background: var(--window);
  }
  /* Compact and strip windows are short: the sentence replaces the meter instead of covering it,
     so the window grows to fit it. */
  .inflow {
    grid-template-columns: minmax(0, 1fr);
  }
  .inflow .stack,
  .inflow .col {
    display: none;
  }
  /* Channel windows collapse to their one-line state when there are no levels (no empty black box). */
  .v-channel.inflow > :not(.overlay, .visually-hidden) {
    display: none;
  }
  .v-strip.inflow {
    grid-template-columns: 96px minmax(0, 1fr);
  }
  .v-strip.inflow.narrow {
    grid-template-columns: minmax(0, 1fr);
  }
  .inflow .overlay {
    position: relative;
    inset: auto;
    padding: 0;
    background: none;
    min-height: 44px;
  }
  .overlay p {
    max-width: 44ch;
    font-size: 14px;
    line-height: 1.45;
    color: var(--w-ink);
  }
  .overlay.quiet p {
    color: var(--w-ink-2);
  }
  .overlay p .mc-spinner {
    display: inline-block;
    vertical-align: -2px;
    margin-right: 6px;
    width: 12px;
    height: 12px;
  }
  .overlay.row {
    flex-direction: row;
    justify-content: flex-start;
    text-align: left;
    gap: 14px;
    padding: 10px 14px;
  }
  .overlay.row p {
    font-size: 13px;
    flex: 1;
  }
  .narrow .overlay.row {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 10px;
  }
  .narrow .overlay.row p {
    flex: none;
  }
  .overlay .mc-key {
    flex: none;
  }
</style>
