<script lang="ts">
  /**
   * Take timeline: one lane per USB channel (coloured only when the channel carries that mic),
   * drawn from the take's peak envelope, a mono ruler and a playhead.
   * - recording: the take in progress grows from the left; the red playhead is "now"
   * - a finished take: the playhead follows playback; click or use the arrow keys to seek
   * - nothing yet: the window says what will appear here
   */
  import { onMount } from 'svelte'
  import { audio, type Take } from '../../lib/state/audio.svelte'
  import { DB_FLOOR, dbToMeterPos } from '../../lib/audio/levels'
  import type { ChannelTone } from '../../lib/ui/types'
  import { player } from './playback.svelte'
  import { fmtClock, fmtLength } from './format'

  interface Props {
    take: Take | null
    recording: boolean
    lanes: { label: string; side: string; tone: ChannelTone }[]
  }
  let { take, recording, lanes }: Props = $props()

  let root: HTMLDivElement
  let canvas: HTMLCanvasElement | undefined = $state()
  let head: HTMLSpanElement | undefined = $state()
  let headLabel: HTMLElement | undefined = $state()

  const mode = $derived(recording ? 'recording' : take ? 'take' : 'empty')
  const takeDur = $derived(take?.files[0]?.durationSec ?? 0)
  /** Seconds the ruler spans. */
  const range = $derived(
    mode === 'recording'
      ? Math.max(60, Math.ceil((audio.recordSeconds * 1.25 + 5) / 30) * 30)
      : Math.max(1, takeDur),
  )
  let rulerW = $state(0)
  const maxTicks = $derived(Math.max(3, Math.min(7, Math.floor((rulerW || 600) / 84))))
  const step = $derived(niceStep(range, maxTicks))
  const ticks = $derived(Array.from({ length: Math.floor(range / step) + 1 }, (_, i) => i * step).filter((t) => t <= range))

  function niceStep(r: number, max: number): number {
    for (const s of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]) if (r / s <= max - 1) return s
    return 7200
  }

  type RGB = [number, number, number]
  function parse(s: string, fallback: RGB): RGB {
    const hex = /^#([0-9a-f]{6})$/i.exec(s.trim())
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB
    const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback
  }

  onMount(() => {
    let w = 1
    let h = 1
    let dpr = 1
    const fit = () => {
      if (!canvas) return
      dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(r.width * dpr))
      h = Math.max(1, Math.round(r.height * dpr))
      canvas.width = w
      canvas.height = h
      dirty = true
    }
    const ro = new ResizeObserver(fit)
    ro.observe(root)

    let colors: RGB[] = []
    const readColors = () => {
      const cs = getComputedStyle(root)
      colors = lanes.map((l) =>
        parse(cs.getPropertyValue(l.tone === 'mic1' ? '--mic1' : l.tone === 'mic2' ? '--mic2' : '--w-ink'), [233, 232, 227]),
      )
    }

    let dirty = true
    let raf = 0
    let lastLen = -1
    let lastTake: Take | null = null
    let lastMode = ''
    let lastRange = 0
    let lastColors = 0
    let observed: HTMLCanvasElement | undefined

    const draw = (len: number, at: (c: number, i: number) => number, rate: number) => {
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      const n = lanes.length
      const laneGap = Math.round(6 * dpr)
      const laneH = (h - laneGap * (n - 1)) / n
      const colW = Math.max(2, Math.round(3 * dpr))
      const barW = Math.max(1, colW - Math.max(1, Math.round(dpr)))
      const cols = Math.floor(w / colW)
      const pxPerSec = w / range
      for (let c = 0; c < n; c++) {
        const top = c * (laneH + laneGap)
        const mid = Math.round(top + laneH / 2)
        const color = colors[c] ?? [233, 232, 227]
        // Dashed centre line: silence and the part of the ruler not recorded yet.
        ctx.strokeStyle = 'rgb(255 255 255 / 0.12)'
        ctx.lineWidth = Math.max(1, Math.round(dpr))
        ctx.setLineDash([3 * dpr, 3 * dpr])
        ctx.beginPath()
        ctx.moveTo(0, mid + 0.5)
        ctx.lineTo(w, mid + 0.5)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = `rgb(${color.join(' ')})`
        for (let k = 0; k < cols; k++) {
          const t0 = (k * colW) / pxPerSec
          const t1 = ((k + 1) * colW) / pxPerSec
          const i0 = Math.floor(t0 * rate)
          const i1 = Math.min(len, Math.max(i0 + 1, Math.ceil(t1 * rate)))
          if (i0 >= len) break
          let m = -Infinity
          for (let i = i0; i < i1; i++) {
            const v = at(c, i)
            if (v > m) m = v
          }
          if (!(m > DB_FLOOR + 10)) continue
          const amp = dbToMeterPos(m)
          const bh = Math.max(2 * dpr, Math.round(amp * (laneH - 2)))
          ctx.fillRect(k * colW, Math.round(mid - bh / 2), barW, bh)
        }
      }
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      if (canvas !== observed) {
        if (observed) ro.unobserve(observed)
        if (canvas) ro.observe(canvas)
        observed = canvas
        fit()
      }
      const now = performance.now()
      if (now - lastColors > 1000) {
        lastColors = now
        readColors()
        dirty = true
      }
      if (mode !== lastMode || take !== lastTake || range !== lastRange) {
        lastMode = mode
        lastTake = take
        lastRange = range
        dirty = true
      }
      let pos = 0
      if (mode === 'recording') {
        const len = audio.liveEnvelope.length()
        if (len !== lastLen || dirty) {
          lastLen = len
          draw(len, audio.liveEnvelope.at, audio.liveEnvelope.rate)
          dirty = false
        }
        pos = audio.engine.recordingSeconds
      } else if (mode === 'take' && take) {
        const env = take.envelope
        if (dirty) {
          if (env) draw(env.peak[0].length, (c, i) => env.peak[c]?.[i] ?? NaN, env.rate)
          else canvas?.getContext('2d')?.clearRect(0, 0, w, h)
          dirty = false
        }
        pos = player.takeId === take.id ? player.currentTime() : -1
      }
      if (head) {
        head.style.display = pos >= 0 && mode !== 'empty' ? '' : 'none'
        head.style.left = `${Math.min(100, (pos / range) * 100)}%`
        head.classList.toggle('flip', pos / range > 0.85)
      }
      if (headLabel) headLabel.textContent = fmtClock(pos)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  function seekTo(el: HTMLElement, clientX: number) {
    if (mode !== 'take' || !take) return
    const r = el.getBoundingClientRect()
    player.seek(take, ((clientX - r.left) / r.width) * range)
  }
  /**
   * Mouse and pen seek on press. A finger seeks only on a tap: the plot lets vertical swipes
   * scroll the page (touch-action: pan-y), and a swipe that starts here must not move playback.
   */
  let touchStart: { id: number; x: number; y: number } | null = null
  function seekAt(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touchStart = { id: e.pointerId, x: e.clientX, y: e.clientY }
      return
    }
    seekTo(e.currentTarget as HTMLElement, e.clientX)
  }
  function seekUp(e: PointerEvent) {
    const t = touchStart
    touchStart = null
    if (!t || t.id !== e.pointerId) return
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) <= 10) seekTo(e.currentTarget as HTMLElement, e.clientX)
  }
  function seekKey(e: KeyboardEvent) {
    if (mode !== 'take' || !take) return
    const cur = player.takeId === take.id ? player.currentTime() : 0
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0
    if (d) player.seek(take, cur + d)
    else if (e.key === 'Home') player.seek(take, 0)
    else if (e.key === 'End') player.seek(take, takeDur)
    else if (e.key === ' ' || e.key === 'Enter') void player.toggle(take)
    else return
    e.preventDefault()
  }
</script>

<div class="mc-window tl" bind:this={root}>
  {#if mode === 'empty'}
    <p class="empty">Each take appears here as it records: one lane per channel, with its level over time.</p>
  {:else}
    <div class="top">
      <span class="name">
        {#if mode === 'recording'}Take {audio.takeNumber}{:else if take}Take {take.number}{/if}
      </span>
      {#if mode === 'take' && take}
        <span class="mono dim">{player.takeId === take.id ? fmtLength(player.position) : '00:00.0'} / {fmtLength(takeDur)}</span>
      {/if}
    </div>
    <div class="body">
      <div class="gut" aria-hidden="true">
        {#each lanes as l (l.side)}
          <span class="mono t-{l.tone}">{l.side}</span>
        {/each}
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="plot"
        class:seekable={mode === 'take'}
        role={mode === 'take' ? 'slider' : 'img'}
        tabindex={mode === 'take' ? 0 : undefined}
        aria-label={mode === 'take' && take
          ? `Take ${take.number} playback position`
          : `Take ${audio.takeNumber} levels while recording, ${lanes.map((l) => l.label).join(' and ')}`}
        aria-valuemin={mode === 'take' ? 0 : undefined}
        aria-valuemax={mode === 'take' ? Math.round(takeDur) : undefined}
        aria-valuenow={mode === 'take' ? Math.round(player.takeId === take?.id ? player.position : 0) : undefined}
        aria-valuetext={mode === 'take' ? `${fmtClock(player.takeId === take?.id ? player.position : 0)} of ${fmtClock(takeDur)}` : undefined}
        onpointerdown={seekAt}
        onpointerup={seekUp}
        onpointercancel={() => (touchStart = null)}
        onkeydown={seekKey}
      >
        <canvas bind:this={canvas}></canvas>
        <span class="head" class:rec={mode === 'recording'} bind:this={head} aria-hidden="true"><em class="mono" bind:this={headLabel}></em></span>
      </div>
      <span></span>
      <div class="ruler" aria-hidden="true" bind:clientWidth={rulerW}>
        {#each ticks as t, i (t)}
          <span class="mono" class:first={i === 0} class:last={i > 0 && (range - t) / range < 0.08} style="left: {(t / range) * 100}%">{fmtClock(t)}</span>
        {/each}
      </div>
    </div>
    {#if mode === 'take' && take && !take.envelope}
      <p class="note">No level overview for this take.</p>
    {/if}
  {/if}
</div>

<style>
  .tl {
    display: grid;
    gap: 8px;
    padding: 12px 16px 10px 12px;
    min-width: 0;
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
  }
  .empty {
    display: grid;
    align-items: center;
    min-height: 104px;
    padding: 0 6px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--w-ink);
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    padding-left: 28px;
  }
  .name {
    font-size: 13px;
    font-weight: 620;
    color: var(--w-ink);
  }
  .dim {
    font-size: 12px;
    color: var(--w-ink-2);
  }
  .body {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    column-gap: 8px;
    row-gap: 6px;
  }
  .gut {
    display: grid;
    grid-template-rows: 1fr 1fr;
    row-gap: 6px;
    align-items: center;
    font-size: 12px;
    color: var(--w-ink-2);
  }
  .gut .t-mic1 {
    color: var(--mic1-w);
  }
  .gut .t-mic2 {
    color: var(--mic2-w);
  }
  .plot {
    position: relative;
    height: 78px;
    border-radius: 2px;
  }
  .plot.seekable {
    cursor: pointer;
    touch-action: pan-y;
  }
  .plot:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .head {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--w-ink);
    pointer-events: none;
  }
  .head.rec {
    background: var(--hot);
  }
  .head em {
    position: absolute;
    top: -2px;
    left: 6px;
    font-size: 12px;
    font-weight: 600;
    font-style: normal;
    line-height: 1;
    color: var(--w-ink);
    background: var(--window);
    padding: 1px 3px;
    white-space: nowrap;
  }
  .head.rec em {
    color: #ff8a82;
  }
  .head:global(.flip) em {
    left: auto;
    right: 6px;
  }
  .ruler {
    position: relative;
    height: 14px;
  }
  .ruler span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
    white-space: nowrap;
  }
  .ruler span.first {
    transform: none;
  }
  .ruler span.last {
    transform: translateX(-100%);
  }
  .note {
    font-size: 12px;
    color: var(--w-ink-2);
    padding-left: 28px;
  }
</style>
