<script lang="ts">
  /**
   * Level history of both USB channels as two lanes on one time axis (oldest left, now right),
   * drawn from the shared buffer in the audio store (audio.history(c)). Each lane is bottom-anchored
   * on the meters' −60…0 dBFS scale; its dB marks sit in the label column, never over the bars.
   * The time axis belongs to the lanes alone (the bar meters above carry the dB scale).
   * Gaps (NaN slots: tab hidden, capture stopped) stay empty.
   */
  import { onMount } from 'svelte'
  import { audio, copyHistory } from '../../lib/state/audio.svelte'
  import { DB_FLOOR, dbToMeterPos } from '../../lib/audio/levels'
  import { formatDb } from '../../lib/ui/meters'
  import type { ChannelTone } from '../../lib/ui/types'

  interface Props {
    lanes: { label: string; tone: ChannelTone }[]
    seconds?: number
    /** Aligned with the strip meters above (label | plot | readout columns). */
    wide?: boolean
  }
  let { lanes, seconds = 30, wide = true }: Props = $props()

  const GRID = [-6, -36]
  let root: HTMLDivElement
  let canvases: HTMLCanvasElement[] = $state([])
  let loudEls: HTMLElement[] = $state([])
  const ticks = $derived(
    seconds <= 30 ? [30, 20, 10, 0].filter((t) => t <= seconds) : [60, 45, 30, 15, 0].filter((t) => t <= seconds),
  )

  type RGB = [number, number, number]
  function parse(s: string, fallback: RGB): RGB {
    const hex = /^#([0-9a-f]{6})$/i.exec(s.trim())
    if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB
    const rgb = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback
  }
  const mix = (a: RGB, b: RGB, t: number) =>
    `rgb(${Math.round(a[0] * t + b[0] * (1 - t))} ${Math.round(a[1] * t + b[1] * (1 - t))} ${Math.round(a[2] * t + b[2] * (1 - t))})`

  onMount(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sizes: { w: number; h: number }[] = []
    let dpr = window.devicePixelRatio || 1
    const fit = () => {
      dpr = window.devicePixelRatio || 1
      canvases.forEach((cv, i) => {
        if (!cv) return
        const r = cv.getBoundingClientRect()
        sizes[i] = { w: Math.max(1, Math.round(r.width * dpr)), h: Math.max(1, Math.round(r.height * dpr)) }
        cv.width = sizes[i].w
        cv.height = sizes[i].h
      })
      lastWritten = -1
    }
    const ro = new ResizeObserver(fit)
    canvases.forEach((cv) => cv && ro.observe(cv))
    ro.observe(root)

    let colors: { tone: RGB; unlit: RGB; hot: RGB }[] = []
    const readColors = () => {
      const cs = getComputedStyle(root)
      const unlit = parse(cs.getPropertyValue('--w-unlit'), [29, 29, 32])
      const hot = parse(cs.getPropertyValue('--hot'), [240, 84, 74])
      colors = lanes.map((l) => ({
        tone: parse(cs.getPropertyValue(l.tone === 'mic1' ? '--mic1' : l.tone === 'mic2' ? '--mic2' : '--w-ink'), [233, 232, 227]),
        unlit,
        hot,
      }))
    }

    let buf = new Float32Array(1)
    let raf = 0
    let lastWritten = -1
    let lastDraw = 0
    let lastColors = 0
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      if (reduced.matches && t - lastDraw < 250) return
      if (t - lastColors > 1000 || colors.length !== lanes.length) {
        lastColors = t
        readColors()
        lastWritten = -1
      }
      const view0 = audio.history(0)
      if (view0.written === lastWritten) return
      lastWritten = view0.written
      lastDraw = t
      const slots = Math.round(seconds * view0.rate)
      if (buf.length !== slots) buf = new Float32Array(slots)
      lanes.forEach((_, c) => {
        const cv = canvases[c]
        const sz = sizes[c]
        const col = colors[c]
        if (!cv || !sz || !col) return
        const ctx = cv.getContext('2d')
        if (!ctx) return
        const view = audio.history(c as 0 | 1)
        const valid = copyHistory(view, slots, buf)
        const { w, h } = sz
        ctx.clearRect(0, 0, w, h)
        ctx.lineWidth = Math.max(1, Math.round(dpr))
        ctx.setLineDash([3 * dpr, 3 * dpr])
        for (const g of GRID) {
          const y = Math.round(h - dbToMeterPos(g) * h) + 0.5
          ctx.strokeStyle = g === -6 ? 'rgb(240 84 74 / 0.34)' : 'rgb(255 255 255 / 0.10)'
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        ctx.setLineDash([])
        const step = w / slots
        const gap = step >= 2.5 ? Math.max(1, Math.round(step * 0.3)) : 0
        const body = mix(col.tone, col.unlit, 0.62)
        const hotBody = mix(col.hot, col.unlit, 0.75)
        const hotY = h - dbToMeterPos(-6) * h
        let loud = -Infinity
        for (let k = slots - valid; k < slots; k++) {
          const db = buf[k]
          if (!(db > DB_FLOOR + 0.5)) continue
          if (db > loud) loud = db
          const bh = Math.max(1, dbToMeterPos(db) * h)
          const x = Math.round(k * step)
          const x2 = Math.max(x + 1, Math.round((k + 1) * step) - gap)
          const top = Math.round(h - bh)
          ctx.fillStyle = k >= slots - 2 ? `rgb(${col.tone.join(' ')})` : body
          ctx.fillRect(x, top, x2 - x, h - top)
          if (top < hotY) {
            ctx.fillStyle = hotBody
            ctx.fillRect(x, top, x2 - x, Math.round(hotY) - top)
          }
        }
        const el = loudEls[c]
        if (el) el.textContent = loud > DB_FLOOR ? formatDb(loud) : '−∞'
      })
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })
</script>

<div class="hist" class:wide bind:this={root} aria-hidden="true">
  {#if !wide}<span class="h">Level history</span>{/if}
  {#each lanes as lane, c (c)}
    <div class="lane t-{lane.tone}">
      <div class="who">
        <b>{lane.label}</b>
        {#if wide}
          <span class="ylab">
            {#each GRID as g (g)}
              <span class="mono" class:hot={g === -6} style="bottom: {dbToMeterPos(g) * 100}%">−{Math.abs(g)}</span>
            {/each}
          </span>
        {/if}
      </div>
      <div class="plot"><canvas bind:this={canvases[c]}></canvas></div>
      <div class="loud">
        <span class="k">loudest</span>
        <span class="v mono" bind:this={loudEls[c]}>– –</span>
      </div>
    </div>
  {/each}
  <div class="axis">
    <span class="gut h">Level history</span>
    <span class="ticks">
      {#each ticks as t (t)}
        <span class="mono" class:first={t === seconds} class:last={t === 0} style="left: {(1 - t / seconds) * 100}%"
          >{t === 0 ? 'now' : `−${t} s`}</span
        >
      {/each}
    </span>
  </div>
</div>

<style>
  .hist {
    display: grid;
    gap: 8px;
    color: var(--w-ink);
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
  }
  .h {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.15;
    color: var(--w-ink-2);
  }
  .lane {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'who loud' 'plot plot';
    align-items: end;
    column-gap: 12px;
    row-gap: 6px;
    --tone-ink: var(--w-ink);
  }
  .t-mic1 {
    --tone-ink: var(--mic1-w);
  }
  .t-mic2 {
    --tone-ink: var(--mic2-w);
  }
  .who {
    grid-area: who;
    position: relative;
    align-self: stretch;
    min-width: 0;
  }
  .who b {
    display: block;
    font-size: 13px;
    font-weight: 620;
    line-height: 1.2;
    color: var(--tone-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .plot {
    grid-area: plot;
    position: relative;
    height: 40px;
    border-bottom: 1px solid var(--w-rule);
  }
  .plot canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .loud {
    grid-area: loud;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
  }
  .k {
    font-size: 12px;
    color: var(--w-ink-2);
  }
  .loud .v {
    font-size: 15px;
    font-weight: 450;
    color: var(--w-ink);
  }
  .axis {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .axis .gut {
    display: none;
  }
  .ticks {
    position: relative;
    height: 14px;
  }
  .ticks span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
    white-space: nowrap;
  }
  .ticks span.first {
    transform: none;
  }
  .ticks span.last {
    transform: translateX(-100%);
  }

  /* Wide: label | plot | readout columns, aligned with the strip meters above. */
  .wide .lane {
    grid-template-columns: var(--who-w) minmax(0, 1fr) var(--rd-w);
    grid-template-areas: 'who plot loud';
    column-gap: var(--col-gap);
    align-items: stretch;
  }
  .wide .plot {
    height: 30px;
  }
  .wide .who b {
    padding-top: 2px;
  }
  .ylab {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 30px;
  }
  .ylab span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
    font-size: 12px;
    line-height: 1;
    color: var(--w-ink-2);
  }
  .ylab span.hot {
    color: #f0877f;
  }
  .wide .loud {
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-end;
    gap: 4px;
    padding-bottom: 2px;
  }
  .wide .loud .v {
    font-size: 17px;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .wide .axis {
    grid-template-columns: var(--who-w) minmax(0, 1fr) var(--rd-w);
    column-gap: var(--col-gap);
  }
  .wide .axis .gut {
    display: block;
    align-self: start;
  }
</style>
