<script lang="ts">
  /**
   * Segmented peak/RMS meter drawn on a canvas at animation-frame rate.
   * It pulls levels through `read()` so Svelte never re-renders per frame.
   */
  import { onMount } from 'svelte'
  import { DB_FLOOR, MeterBallistics, dbToMeterPos } from '../audio/levels'

  interface Props {
    /** Returns the current { rmsDb, peakDb } or null when there is no signal source. */
    read: () => { rmsDb: number; peakDb: number } | null
    label: string
    orientation?: 'horizontal' | 'vertical'
    segments?: number
    muted?: boolean
    inactive?: boolean
    showScale?: boolean
  }

  let {
    read,
    label,
    orientation = 'horizontal',
    segments = 30,
    muted = false,
    inactive = false,
    showScale = true,
  }: Props = $props()

  let canvas: HTMLCanvasElement
  let wrap: HTMLDivElement
  let readoutText = $state('-- dB')
  let valueNow = $state(-60)
  let clipped = $state(false)
  const meter = new MeterBallistics()

  const SCALE = [0, -6, -12, -20, -40, -60]

  onMount(() => {
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let lastText = 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let w = 0
    let h = 0
    let dpr = 1

    const ro = new ResizeObserver(() => {
      dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(r.width * dpr))
      h = Math.max(1, Math.round(r.height * dpr))
      canvas.width = w
      canvas.height = h
    })
    ro.observe(canvas)

    const styles = getComputedStyle(wrap)
    const col = (name: string) => styles.getPropertyValue(name).trim()
    const colors = {
      off: col('--meter-off'),
      ok: col('--meter-ok'),
      hot: col('--meter-hot'),
      clip: col('--meter-clip'),
      peak: col('--meter-peak'),
    }

    const segColor = (db: number) => (db > -6 ? colors.clip : db > -12 ? colors.hot : colors.ok)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const dt = (now - last) / 1000
      if (reduced.matches && dt < 0.1) return
      last = now
      const lv = inactive ? null : read()
      if (lv) meter.update(lv.rmsDb, lv.peakDb, now, reduced.matches ? 10 : dt)
      else meter.update(DB_FLOOR, DB_FLOOR, now, dt)
      if (meter.clipped !== clipped) clipped = meter.clipped

      ctx.clearRect(0, 0, w, h)
      const horiz = orientation === 'horizontal'
      const n = segments
      const gap = Math.max(1, Math.round(2 * dpr))
      const len = horiz ? w : h
      const segLen = (len - gap * (n - 1)) / n
      const lit = dbToMeterPos(meter.level) * n
      const peakSeg = Math.min(n - 1, Math.floor(dbToMeterPos(meter.peakHold) * n))
      for (let i = 0; i < n; i++) {
        const segDb = DB_FLOOR + ((i + 0.5) / n) * -DB_FLOOR
        const on = i < lit
        ctx.fillStyle = on ? segColor(segDb) : colors.off
        if (i === peakSeg && meter.peakHold > DB_FLOOR + 1 && !on) ctx.fillStyle = colors.peak
        const p = i * (segLen + gap)
        if (horiz) ctx.fillRect(p, 0, segLen, h)
        else ctx.fillRect(0, h - p - segLen, w, segLen)
      }

      if (now - lastText > 1000) {
        lastText = now
        readoutText = meter.peakHold <= DB_FLOOR + 0.5 ? '-∞ dB' : `${Math.round(meter.peakHold)} dB`
        valueNow = Math.max(-60, Math.min(0, Math.round(meter.peakHold)))
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  })

  function clearClip() {
    meter.clipped = false
    clipped = false
  }
</script>

<div
  bind:this={wrap}
  class="meter {orientation}"
  class:muted
  class:inactive
  role="meter"
  aria-label="{label} level"
  aria-valuemin={-60}
  aria-valuemax={0}
  aria-valuenow={valueNow}
  aria-valuetext={readoutText}
>
  <div class="well">
    <canvas bind:this={canvas} aria-hidden="true"></canvas>
    {#if muted}<span class="state">MUTED</span>{:else if inactive}<span class="state">NO SIGNAL</span>{/if}
  </div>
  {#if showScale}
    <div class="scale" aria-hidden="true">
      {#each SCALE as s (s)}
        <span style="--pos: {dbToMeterPos(s)}">{s}</span>
      {/each}
    </div>
  {/if}
  <div class="readout-row">
    <span class="peak readout">pk {readoutText}</span>
    <button
      type="button"
      class="clip"
      class:lit={clipped}
      onclick={clearClip}
      aria-label={clipped ? 'Clip: lit, press to reset' : 'Clip: not lit'}
      title="Clip indicator (click to reset)">CLIP</button
    >
  </div>
</div>

<style>
  .meter {
    display: grid;
    gap: 6px;
    --meter-thickness: 14px;
  }
  .well {
    position: relative;
    background: var(--meter-well);
    border-radius: var(--radius-sm);
    box-shadow: var(--meter-inset);
    padding: 4px;
    overflow: hidden;
  }
  .horizontal .well canvas {
    width: 100%;
    height: var(--meter-thickness);
  }
  .vertical {
    grid-template-columns: auto auto;
    grid-template-rows: 1fr auto;
    height: 100%;
  }
  .vertical .well {
    grid-row: 1;
    grid-column: 1;
    width: calc(var(--meter-thickness) + 8px);
  }
  .vertical .well canvas {
    width: var(--meter-thickness);
    height: 100%;
    min-height: 160px;
  }
  canvas {
    display: block;
    transition: opacity var(--dur-fast);
  }
  .muted canvas,
  .inactive canvas {
    opacity: 0.4;
  }
  .state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    font-weight: var(--weight-semibold);
    color: var(--meter-scale);
    pointer-events: none;
  }
  .muted .state {
    color: var(--meter-clip);
  }
  .vertical .state {
    writing-mode: vertical-rl;
  }
  .scale {
    position: relative;
    height: 14px;
    font-size: var(--text-2xs);
    color: var(--color-text-subtle);
    font-variant-numeric: tabular-nums;
    margin: 0 4px;
  }
  .scale span {
    position: absolute;
    left: calc(var(--pos) * 100%);
    transform: translateX(-50%);
  }
  .scale span:first-child {
    transform: translateX(-100%);
  }
  .scale span:last-child {
    transform: none;
  }
  .vertical .scale {
    grid-row: 1;
    grid-column: 2;
    height: auto;
    width: 26px;
    margin: 4px 0;
  }
  .vertical .scale span {
    left: 0;
    top: calc((1 - var(--pos)) * 100%);
    transform: translateY(-50%);
  }
  .readout-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .vertical .readout-row {
    grid-column: 1 / -1;
    flex-direction: column;
    align-items: flex-start;
  }
  .peak {
    font-size: var(--text-xs);
    color: var(--color-text-muted);
  }
  .clip {
    position: relative;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    font-weight: var(--weight-semibold);
    padding: 2px 6px;
    border-radius: var(--radius-xs);
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text-subtle);
  }
  /* 44 px hit area around the small visual. */
  .clip::before {
    content: '';
    position: absolute;
    inset: 50% auto auto 50%;
    width: max(100%, 44px);
    height: max(100%, 44px);
    transform: translate(-50%, -50%);
  }
  .clip.lit {
    background: var(--meter-clip);
    border-color: var(--meter-clip);
    color: var(--color-on-danger);
  }
</style>
