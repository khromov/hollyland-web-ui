<script lang="ts">
  /**
   * The Audio page's two-channel meter window: one strip meter per USB channel (labelled by what
   * the channel carries in the current channel mode) sharing one dB scale between the bars, then
   * the level history of both channels on its own time axis. When there are no levels, the window
   * shows a short state (an error adds its fix) and the key that starts audio.
   */
  import { audio } from '../../lib/state/audio.svelte'
  import MeterWindow from '../../lib/ui/MeterWindow.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import type { UsbChannelMeter } from '../../lib/ui/meters'
  import HistoryLanes from './HistoryLanes.svelte'

  interface Props {
    channels: [UsbChannelMeter, UsbChannelMeter]
    /** Second line under each label ("Left · TX1"). */
    subs: [string, string]
    /** Tooltip / aria-description for the window, e.g. why the channels are labelled L / R. */
    note?: string
  }
  let { channels, subs, note }: Props = $props()

  let width = $state(0)
  /** Wide enough to line the history up under the bars (label | bar | readouts). */
  const wide = $derived(width === 0 || width >= 720)
  const mstate = $derived(audio.meterState)

  /** Short state, and for errors the fix. */
  const title = $derived(
    {
      live: '',
      idle: 'Live audio off',
      starting: 'Waiting for microphone access…',
      denied: 'Microphone blocked',
      paused: 'Paused while the bridge runs',
      nodevice: 'No audio input',
      error: 'Live levels stopped',
    }[mstate],
  )
  const detail = $derived(
    mstate === 'denied'
      ? 'Allow it in site settings, then try again.'
      : mstate === 'nodevice'
        ? 'Plug in the receiver, then try again.'
        : mstate === 'error'
          ? (audio.meterMessage ?? null)
          : null,
  )
  const actionLabel = $derived(
    mstate === 'idle' ? 'Show live levels' : mstate === 'denied' || mstate === 'nodevice' || (mstate === 'error' && audio.supported) ? 'Try again' : null,
  )
</script>

<div class="mc-window iw" class:wide bind:clientWidth={width} title={note}>
  {#if note}<span class="visually-hidden">{note}</span>{/if}
  {#if mstate === 'live'}
    <div class="strips">
      {#each channels as ch, c (c)}
        <MeterWindow
          variant="strip"
          bare
          read={() => audio.readChannel(c)}
          label={ch.label}
          tone={ch.tone}
          sub={subs[c]}
          scale={c === 0}
        />
      {/each}
    </div>
    <div class="rule" aria-hidden="true"></div>
    <HistoryLanes lanes={channels.map((ch) => ({ label: ch.label, tone: ch.tone }))} seconds={30} {wide} />
  {:else}
    <div class="state" role="status" title={mstate === 'paused' ? 'Stop the bridge (Ctrl+C in its terminal) to use audio here.' : undefined}>
      <div class="msg">
        <p class="title">
          <span class="lamp" aria-hidden="true">
            {#if mstate === 'starting'}
              <span class="mc-spinner"></span>
            {:else}
              <Lamp state={mstate === 'denied' || mstate === 'error' || mstate === 'nodevice' ? 'on' : 'hollow'} color="rec" size="sm" />
            {/if}
          </span>
          {title}
        </p>
        {#if detail}<p class="text">{detail}</p>{/if}
      </div>
      {#if actionLabel}
        <button type="button" class="mc-key mc-key--light" onclick={() => audio.start()}>{actionLabel}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .iw {
    --who-w: 120px;
    --rd-w: 256px;
    --col-gap: 20px;
    display: grid;
    padding: 6px 24px 12px;
    min-width: 0;
  }
  .strips {
    display: grid;
  }
  /* Line the strips' columns up with the history lanes below (MeterWindow strip internals). */
  .wide .strips :global(.v-strip:not(.narrow)) {
    grid-template-columns: var(--who-w) minmax(0, 1fr) var(--rd-w);
    column-gap: var(--col-gap);
  }
  .wide .strips :global(.v-strip:not(.narrow) .col) {
    justify-content: flex-end;
  }
  /* Narrow phones: the second label line gives way to the readouts instead of running under them. */
  .strips :global(.v-strip .who .sub) {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .strips :global(.v-strip.bare) {
    padding-top: 10px;
    padding-bottom: 6px;
  }
  .rule {
    height: 1px;
    margin: 6px 0 12px;
    background: var(--w-rule);
  }
  .state {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 14px;
    row-gap: 12px;
    padding: 12px 0 6px;
    min-height: 68px;
  }
  .lamp {
    display: inline-grid;
    place-items: center;
    width: 14px;
    height: 14px;
    margin-right: 8px;
    vertical-align: -1px;
  }
  .lamp .mc-spinner {
    width: 14px;
    height: 14px;
  }
  .msg {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 620;
    line-height: 1.3;
    color: var(--w-ink);
  }
  .text {
    max-width: 68ch;
    font-size: 14px;
    line-height: 1.45;
    color: var(--w-ink);
    opacity: 0.86;
  }
  @media (max-width: 599px) {
    .iw {
      padding: 4px 14px 12px;
    }
    .state {
      grid-template-columns: minmax(0, 1fr);
      padding: 12px 0 6px;
    }
    .state .mc-key {
      justify-self: start;
    }
  }
</style>
