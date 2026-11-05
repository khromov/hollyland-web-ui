<script lang="ts">
  /**
   * Recorder: round transport key, REC lamp and timecode, the format options, the take timeline
   * and the takes table (play, save, delete). Takes live in this tab until they are saved.
   */
  import { onMount } from 'svelte'
  import { Play, Pause, Trash2, Download, Check } from '@lucide/svelte'
  import { audio, type Take } from '../../lib/state/audio.svelte'
  import { usbChannelMeters, type UsbChannelMeter } from '../../lib/ui/meters'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import TakeTimeline from './TakeTimeline.svelte'
  import { player } from './playback.svelte'
  import { effectLabel, fmtLength, fmtSize, fmtTimecode, fmtTimeOfDay } from './format'

  interface Props {
    /** What each USB channel carries now (labels and colours). */
    channels: [UsbChannelMeter, UsbChannelMeter]
    /** Channel mode read from the receiver (null: not known). */
    channelMode: number | null
    names: [string, string]
  }
  let { channels, channelMode, names }: Props = $props()

  let width = $state(0)
  const stacked = $derived(width > 0 && width < 980)
  const compactTable = $derived(width > 0 && width < 640)

  const live = $derived(audio.state === 'running')
  const recording = $derived(audio.recording)
  const reason = $derived(
    !audio.supported
      ? "This browser can't capture audio inputs."
      : audio.meterState === 'paused'
        ? 'USB audio is paused while the local bridge runs.'
        : 'Recording needs live audio: start it in the Input window above.',
  )

  const opts = $derived(audio.recordOptions)
  const bytesPerMin = $derived(
    (audio.sampleRate || 48000) * 2 * (opts.bitDepth === 16 ? 2 : opts.bitDepth === 24 ? 3 : 4) * 60,
  )
  const nextEffect = $derived(effectLabel(opts.processed, audio.fx, channelMode, names))

  /** The take the timeline shows: the one loaded for playback, else the newest. */
  const shownTake = $derived(audio.takes.find((t) => t.id === player.takeId) ?? audio.takes[0] ?? null)
  const timelineLanes = $derived.by(() => {
    if (recording || !shownTake) return channels.map((c) => ({ label: c.label, side: c.side, tone: c.tone }))
    return usbChannelMeters(shownTake.channelMode, names).map((c) => ({ label: c.label, side: c.side, tone: c.tone }))
  })

  // Timecode at frame rate while recording (the store's recordSeconds ticks at 4 Hz).
  let tcMain: HTMLSpanElement | undefined = $state()
  let tcDec: HTMLElement | undefined = $state()
  onMount(() => {
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const s = audio.recording ? audio.engine.recordingSeconds : 0
      const [m, d] = fmtTimecode(s)
      if (tcMain && tcMain.textContent !== m) tcMain.textContent = m
      if (tcDec && tcDec.textContent !== d) tcDec.textContent = d
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  })

  // Spoken once per change (the timecode and size are not announced while they count).
  let announce = $state('')
  let wasRecording = false
  $effect(() => {
    const r = recording
    if (r === wasRecording) return
    wasRecording = r
    announce = r
      ? `Recording take ${audio.takeNumber}`
      : audio.takes[0]
        ? `Take ${audio.takes[0].number} saved in this tab, ${fmtLength(audio.takes[0].files[0]?.durationSec ?? 0)} long`
        : 'Recording stopped'
  })

  function toggleRecord() {
    if (recording) void audio.stopRecording()
    else {
      player.pause()
      audio.startRecording()
    }
  }

  // Delete asks once more inline (an unsaved take is gone for good).
  let confirmId: number | null = $state(null)
  let confirmTimer: ReturnType<typeof setTimeout> | null = null
  function askDelete(t: Take) {
    if (confirmId === t.id) {
      if (player.takeId === t.id) player.unload()
      audio.deleteTake(t.id)
      confirmId = null
      return
    }
    confirmId = t.id
    if (confirmTimer) clearTimeout(confirmTimer)
    confirmTimer = setTimeout(() => (confirmId = null), 4000)
  }

  const takeBytes = (t: Take) => t.files.reduce((a, f) => a + f.blob.size, 0)
  const takeFormat = (t: Take) =>
    `${t.options.bitDepth === 32 ? '32-bit float' : `${t.options.bitDepth}-bit`} · ${t.options.split ? '2 mono files' : 'stereo'}`
  const sideOf = (t: Take, i: number) => usbChannelMeters(t.channelMode, names)[i]?.side ?? (i ? 'R' : 'L')
</script>

<div class="rec" class:stacked bind:clientWidth={width}>
  <div class="left">
    <div class="transport">
      <div class="tkey">
        <button
          type="button"
          class="round"
          class:on={recording}
          disabled={!live && !recording}
          aria-label={recording ? `Stop recording take ${audio.takeNumber}` : `Record take ${audio.takeNumber}`}
          onclick={toggleRecord}
        >
          <i aria-hidden="true"></i>
        </button>
        <span class="tlabel" aria-hidden="true">{recording ? 'Stop' : 'Record'}</span>
      </div>
      <div class="status">
        <span class="recline" class:on={recording}>
          <Lamp color="rec" size="sm" state={recording ? 'on' : 'off'} blink={recording} />
          <span class="mc-lamp-legend" aria-hidden="true">Rec</span>
          <span class="take">Take {audio.takeNumber}</span>
          <span class="visually-hidden">{recording ? 'recording' : 'ready'}</span>
        </span>
        <span class="visually-hidden" aria-live="polite">{announce}</span>
        <span class="tc mono" class:idle={!recording} aria-hidden="true"
          ><span bind:this={tcMain}>00:00</span><small bind:this={tcDec}>.00</small></span
        >
        <span class="sub">
          {nextEffect}
          ·
          {#if recording}
            <span class="mono">{fmtSize(audio.recordBytes)}</span>
          {:else}
            <span class="mono">{fmtSize(bytesPerMin)}</span> per minute
          {/if}
        </span>
      </div>
    </div>
    {#if !live && !recording}
      <ConfidenceNote kind="disabled" text={reason} />
    {/if}

    <div class="opts">
      <div class="opt">
        <span class="ol" id="rec-src">Source</span>
        <KeyGroup
          size="sm"
          label="Recording source"
          options={[
            { value: 'raw', label: 'Raw input' },
            { value: 'fx', label: 'With effects' },
          ]}
          value={opts.processed ? 'fx' : 'raw'}
          disabled={recording}
          onchange={(v) => audio.setRecordOptions({ processed: v === 'fx' })}
        />
        {#if opts.processed && !audio.fxEnabled && !recording}
          <p class="hint">Voice effect is off, so this records the raw sound.</p>
        {/if}
      </div>
      <div class="opt">
        <span class="ol">Files</span>
        <KeyGroup
          size="sm"
          label="File layout"
          options={[
            { value: 'stereo', label: 'One stereo file' },
            { value: 'split', label: 'One file per channel' },
          ]}
          value={opts.split ? 'split' : 'stereo'}
          disabled={recording}
          onchange={(v) => audio.setRecordOptions({ split: v === 'split' })}
        />
      </div>
      <div class="opt">
        <span class="ol">Bit depth</span>
        <KeyGroup
          size="sm"
          label="Bit depth"
          options={[
            { value: 16, label: '16-bit' },
            { value: 24, label: '24-bit' },
            { value: 32, label: '32-bit float' },
          ]}
          value={opts.bitDepth}
          disabled={recording}
          onchange={(v) => audio.setRecordOptions({ bitDepth: v })}
        />
      </div>
      {#if recording}
        <ConfidenceNote kind="disabled" text="Source and format are locked while recording." />
      {/if}
    </div>
  </div>

  <div class="right">
    {#if audio.interruptedTake}
      {@const t = audio.interruptedTake}
      <Banner tone="danger" title="Recording interrupted">
        The audio input disappeared after <span class="mono">{fmtLength(t.files[0]?.durationSec ?? 0)}</span>. Take {t.number}
        up to that point is saved below.
        {#snippet actions()}
          <button type="button" class="mc-key mc-key--sm mc-key--light" onclick={() => audio.dismissInterruption()}>Dismiss</button>
        {/snippet}
      </Banner>
    {/if}

    <TakeTimeline take={shownTake} {recording} lanes={timelineLanes} />

    {#if audio.takes.length}
      <table class="takes" class:compact={compactTable}>
        <thead>
          <tr>
            <th scope="col">Take</th>
            <th scope="col">Started</th>
            <th scope="col">Length</th>
            <th scope="col">Effect</th>
            <th scope="col">Size</th>
            <th scope="col"><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each audio.takes as t (t.id)}
            {@const playing = player.isPlaying(t.id)}
            <tr class:shown={shownTake?.id === t.id}>
              <th scope="row" class="name">
                Take {t.number}
                {#if t.interrupted}<Chip tone="danger">Interrupted</Chip>{/if}
              </th>
              <td class="m started"><span class="cap">Started </span>{fmtTimeOfDay(t.createdAt)}</td>
              <td class="m len"><span class="cap">Length </span>{fmtLength(t.files[0]?.durationSec ?? 0)}</td>
              <td class="fx">{effectLabel(t.options.processed, t.fx, t.channelMode, names)}</td>
              <td class="size">
                <span class="m">{fmtSize(takeBytes(t))}</span>
                <span class="fmt">{takeFormat(t)}</span>
              </td>
              <td class="act">
                <div class="keys">
                  <button
                    type="button"
                    class="mc-key mc-key--sm"
                    class:is-selected={playing}
                    aria-pressed={playing}
                    aria-label="{playing ? 'Pause' : 'Play'} take {t.number}"
                    disabled={recording}
                    onclick={() => player.toggle(t)}
                  >
                    {#if playing}<Pause size={16} aria-hidden="true" />{:else}<Play size={16} aria-hidden="true" />{/if}
                    <span aria-hidden="true">{playing ? 'Pause' : 'Play'}</span>
                  </button>
                  {#each t.files as f, i (f.url)}
                    <a
                      class="mc-key mc-key--sm"
                      href={f.url}
                      download={f.name}
                      onclick={() => audio.markSaved(t.id, i)}
                      aria-label="Save take {t.number}{t.files.length > 1 ? `, ${sideOf(t, i)} channel` : ''} ({f.name}){t.saved[i] ? ', saved' : ''}"
                    >
                      {#if t.saved[i]}<Check size={16} aria-hidden="true" />{:else}<Download size={16} aria-hidden="true" />{/if}
                      <span aria-hidden="true">Save{t.files.length > 1 ? ` ${sideOf(t, i)}` : ''}</span>
                    </a>
                  {/each}
                  <button
                    type="button"
                    class="mc-key mc-key--sm"
                    class:mc-key--danger={confirmId === t.id}
                    class:mc-key--quiet={confirmId !== t.id}
                    class:del={confirmId !== t.id}
                    aria-label={confirmId === t.id ? `Confirm: delete take ${t.number}` : `Delete take ${t.number}`}
                    onclick={() => askDelete(t)}
                    onblur={() => {
                      if (confirmId === t.id) setTimeout(() => (confirmId = null), 200)
                    }}
                  >
                    {#if confirmId === t.id}Delete{:else}<Trash2 size={16} aria-hidden="true" />{/if}
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p class="keep">
      Takes stay in this tab until you save them. Reloading or closing the page discards them{audio.hasUnsaved
        ? ', so the browser asks first while one is unsaved'
        : ''}.
    </p>
  </div>
</div>

<style>
  .rec {
    display: grid;
    grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
    gap: 32px;
    align-items: start;
    min-width: 0;
  }
  .rec.stacked {
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
  }
  .mono,
  .m {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
  }
  .left {
    display: grid;
    gap: 18px;
    align-content: start;
    min-width: 0;
  }
  .transport {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .tkey {
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .round {
    position: relative;
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    border-radius: 50%;
    border: 1px solid var(--key-edge);
    background: var(--key);
    box-shadow: var(--raised);
    cursor: pointer;
    transition:
      box-shadow var(--dur-press) var(--ease),
      transform var(--dur-press) var(--ease);
  }
  .round:hover:not(:disabled) {
    background: var(--key-hover);
  }
  .round:active:not(:disabled) {
    transform: translateY(1px);
    box-shadow: var(--press-shadow);
  }
  .round i {
    display: block;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--rec);
  }
  .round.on {
    box-shadow: var(--press-shadow);
  }
  .round.on i {
    width: 24px;
    height: 24px;
    border-radius: 4px;
  }
  .round:disabled {
    cursor: not-allowed;
    background: var(--chassis-2);
    border-color: var(--rule);
    box-shadow: none;
  }
  .round:disabled i {
    background: var(--ink-3);
    opacity: 0.6;
  }
  .tlabel {
    font-size: 13px;
    font-weight: 560;
    color: var(--ink-2);
  }
  .status {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding-top: 2px;
  }
  .recline {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-3);
  }
  .recline.on .mc-lamp-legend {
    color: var(--rec-ink);
  }
  .take {
    font-size: 13px;
    font-weight: 620;
    color: var(--ink);
  }
  .tc {
    font-size: var(--t-timecode);
    font-weight: 420;
    letter-spacing: -0.03em;
    line-height: 1;
    white-space: nowrap;
  }
  .tc small {
    font-size: 24px;
    color: var(--ink-3);
    letter-spacing: -0.01em;
  }
  .tc.idle {
    color: var(--ink-3);
  }
  .sub {
    font-size: 13px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .sub .mono {
    font-size: 12.5px;
    color: var(--ink);
  }

  .opts {
    display: grid;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--rule);
  }
  .opt {
    display: grid;
    gap: 6px;
  }
  .ol {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .hint {
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-3);
  }

  .right {
    display: grid;
    gap: 16px;
    min-width: 0;
  }
  .keep {
    font-size: 12px;
    line-height: 1.45;
    color: var(--ink-3);
  }

  /* ---------- takes table ---------- */
  .takes {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .takes thead th {
    text-align: left;
    font-weight: 600;
    font-size: 12px;
    color: var(--ink-2);
    padding: 0 12px 8px 0;
    border-bottom: 1.5px solid var(--ink);
    white-space: nowrap;
  }
  .takes td,
  .takes tbody th {
    padding: 8px 12px 8px 0;
    height: 56px;
    border-bottom: 1px solid var(--rule);
    vertical-align: middle;
    text-align: left;
  }
  .takes tbody th.name {
    font-weight: 620;
    white-space: nowrap;
  }
  .takes tbody th.name :global(.chip) {
    margin-left: 6px;
  }
  .takes .m {
    font-size: 12.5px;
    white-space: nowrap;
  }
  .takes .cap {
    display: none;
  }
  .takes .fx {
    min-width: 0;
    line-height: 1.35;
  }
  .takes .size {
    white-space: nowrap;
  }
  .takes .size .m {
    display: block;
  }
  .fmt {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    color: var(--ink-3);
  }
  .takes .act {
    padding-right: 0;
  }
  .keys {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }
  .keys .mc-key {
    gap: 6px;
  }
  .keys .del {
    min-width: var(--hit);
    padding: 0 10px;
  }
  .takes tr.shown th.name {
    box-shadow: inset 3px 0 0 var(--ink);
    padding-left: 10px;
  }

  /* Narrow: each take is a block of lines instead of a table row. */
  .compact thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .compact,
  .compact tbody,
  .compact tr,
  .compact td,
  .compact tbody th {
    display: block;
  }
  .compact tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--rule);
  }
  .compact td,
  .compact tbody th {
    height: auto;
    padding: 0;
    border: 0;
  }
  .compact .cap {
    display: inline;
    margin-right: 6px;
    font-family: var(--f-sans);
    font-stretch: 100%;
    color: var(--ink-3);
  }
  .compact .name {
    grid-column: 1;
  }
  .compact .started {
    grid-column: 2;
    grid-row: 1;
    text-align: right;
  }
  .compact .len {
    grid-column: 2;
    grid-row: 2;
    text-align: right;
  }
  .compact .fx {
    grid-column: 1;
    grid-row: 2;
  }
  .compact .size {
    grid-column: 1 / -1;
    display: flex;
    gap: 10px;
    align-items: baseline;
  }
  .compact .size .m {
    display: inline;
  }
  .compact .fmt {
    display: inline;
    margin: 0;
  }
  .compact .act {
    grid-column: 1 / -1;
    padding-top: 6px;
  }
  .compact .keys {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .compact tr.shown th.name {
    box-shadow: none;
    padding-left: 0;
  }
  @media (max-width: 599px) {
    .tc {
      font-size: 36px;
    }
    .tc small {
      font-size: 20px;
    }
  }
</style>
