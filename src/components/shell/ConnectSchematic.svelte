<script lang="ts">
  /**
   * "How it connects": the receiver gives this page two separate USB links, USB audio (levels,
   * voice effects, recording) and USB control over WebHID (settings, battery, mute, firmware).
   * It explains why Audio works without the control link and what "send only" means.
   *
   * State-true: nothing is drawn as available unless this tab knows it is.
   * - USB audio: solid line and a lit lamp only while this tab is capturing the receiver's audio;
   *   otherwise dashed, "not started".
   * - USB control: dashed and "not connected" (this page only shows while there is no control
   *   link), blinking while connecting, "not in this browser" without WebHID.
   * ≥ 960 px: a left-to-right schematic. Below: the same links as a vertical list.
   */
  import Lamp from '../../lib/ui/Lamp.svelte'

  interface Props {
    /** This tab is capturing the receiver's USB audio. */
    audioLive: boolean
    control: 'idle' | 'connecting' | 'unsupported'
  }
  let { audioLive, control }: Props = $props()

  const audioState = $derived(audioLive ? 'live in this tab' : 'not started')
  const controlState = $derived(
    control === 'connecting' ? 'connecting…' : control === 'unsupported' ? 'not available in this browser' : 'not connected',
  )
  const controlLamp = $derived(control === 'connecting' ? ('on' as const) : ('hollow' as const))
</script>

{#snippet audioLabel()}
  <span class="link-title">
    <Lamp size="sm" color="live" state={audioLive ? 'on' : 'hollow'} />
    <span><b>USB audio</b> · {audioState}</span>
  </span>
{/snippet}
{#snippet audioDesc()}
  <span class="link-desc">Levels, voice effects, recording. Needs no control link.</span>
{/snippet}
{#snippet controlLabel()}
  <span class="link-title">
    <Lamp size="sm" color="live" state={controlLamp} blink={control === 'connecting'} />
    <span><b>USB control</b> (WebHID) · {controlState}</span>
  </span>
{/snippet}
{#snippet controlDesc()}
  <span class="link-desc">Settings, battery, mute, firmware.</span>
{/snippet}
{#snippet mic(n: 1 | 2)}
  <Lamp size="lg" color={n === 1 ? 'mic1' : 'mic2'} />
  <span class="node-text">
    <span class="node-name">Mic {n}</span>
    <span class="node-sub"><span class="mono">TX{n}</span> · {n === 1 ? 'purple' : 'yellow'} light</span>
  </span>
{/snippet}
{#snippet browserRows()}
  <span class="row-a"><a href="#/audio">Audio page</a> · {audioLive ? 'live' : 'works now'}</span>
  <span class="row-c">Overview, Settings, Device · {control === 'unsupported' ? 'need WebHID' : 'after you connect'}</span>
{/snippet}

<figure class="schematic">
  <figcaption class="visually-hidden">
    Mic 1 and Mic 2 reach the receiver over 2.4 GHz. The receiver gives this page two separate USB links: USB audio
    ({audioState}) and USB control ({controlState}).
  </figcaption>

  <!-- Wide: left to right -->
  <div class="wide">
    <div class="col mics">
      <div class="node mic m1">{@render mic(1)}</div>
      <div class="node mic m2">{@render mic(2)}</div>
    </div>
    <div class="col air" aria-hidden="true">
      <svg viewBox="0 0 100 232" preserveAspectRatio="none">
        <path d="M0 44.5 C 55 44.5, 45 100, 100 100" />
        <path d="M0 180.5 C 55 180.5, 45 126, 100 126" />
      </svg>
      <span class="ghz mono">2.4 GHz</span>
    </div>
    <div class="col rx">
      <div class="node receiver">
        <span class="node-name">Receiver</span>
        <span class="node-sub"><span class="mono">RX</span> · USB-C</span>
      </div>
    </div>
    <div class="col links">
      <div class="label-a">{@render audioLabel()}</div>
      <span class="wire a" class:live={audioLive} aria-hidden="true"></span>
      <div class="desc-a">{@render audioDesc()}</div>
      <span class="wire c" aria-hidden="true"></span>
      <div class="label-c">{@render controlLabel()}</div>
      <div class="desc-c">{@render controlDesc()}</div>
    </div>
    <div class="col browser">
      <div class="node tab">
        <span class="tab-head">
          <span class="node-name">This browser</span>
          <span class="node-sub">{control === 'unsupported' ? 'No WebHID' : 'WebHID available'}</span>
        </span>
        <span class="term a" class:live={audioLive} aria-hidden="true"></span>
        <span class="term c" aria-hidden="true"></span>
        {@render browserRows()}
      </div>
    </div>
  </div>

  <!-- Narrow: top to bottom -->
  <div class="narrow">
    <div class="pair">
      <div class="node mic">{@render mic(1)}</div>
      <div class="node mic">{@render mic(2)}</div>
    </div>
    <div class="drop"><span class="mono">2.4 GHz</span></div>
    <div class="node receiver">
      <span class="node-name">Receiver</span>
      <span class="node-sub"><span class="mono">RX</span> · USB-C</span>
    </div>
    <ul class="branches">
      <li class="branch" class:live={audioLive}>{@render audioLabel()}{@render audioDesc()}</li>
      <li class="branch dashed">{@render controlLabel()}{@render controlDesc()}</li>
    </ul>
    <div class="node tab">
      <span class="tab-head">
        <span class="node-name">This browser</span>
        <span class="node-sub">{control === 'unsupported' ? 'No WebHID' : 'WebHID available'}</span>
      </span>
      {@render browserRows()}
    </div>
  </div>
</figure>

<style>
  .schematic {
    margin: 0;
    min-width: 0;
  }
  .node {
    background: var(--key);
    border: 1px solid var(--key-edge);
    border-radius: var(--r-key);
  }
  .node-text,
  .receiver,
  .tab-head {
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .node-name {
    font-size: 14px;
    font-weight: 650;
    line-height: 1.2;
  }
  .node-sub {
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-3);
  }
  .mic {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
  }
  .receiver {
    align-content: center;
    padding: 0 18px;
    border: 1.5px solid var(--ink);
  }
  .link-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .link-title b {
    color: var(--ink);
    font-weight: 620;
  }
  .link-desc {
    font-size: 12px;
    line-height: 1.35;
    color: var(--ink-3);
  }
  .row-a,
  .row-c {
    font-size: 13px;
    color: var(--ink-2);
  }
  .row-a a {
    color: var(--ink);
    font-weight: 560;
  }

  /* ---------- wide ---------- */
  .wide {
    display: grid;
    grid-template-columns:
      minmax(168px, 190px) minmax(48px, 1fr) minmax(160px, 200px) minmax(250px, 3fr)
      minmax(220px, 300px);
    height: 232px;
  }
  .col {
    position: relative;
    min-width: 0;
  }
  .m1,
  .m2 {
    position: absolute;
    left: 0;
    right: 0;
    height: 60px;
  }
  .m1 {
    top: 14px;
  }
  .m2 {
    top: 150px;
  }
  .air svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .air path {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .ghz {
    position: absolute;
    top: 106px;
    left: 0;
    right: 0;
    text-align: center;
    font-size: 12px;
    color: var(--ink-3);
  }
  .rx .receiver {
    position: absolute;
    top: 72px;
    left: 0;
    right: 0;
    height: 82px;
  }
  .links > * {
    position: absolute;
    left: 20px;
    right: 14px;
  }
  .label-a {
    top: 68px;
  }
  .desc-a {
    top: 104px;
  }
  .label-c {
    top: 146px;
  }
  .desc-c {
    top: 168px;
  }
  .label-a,
  .label-c,
  .desc-a,
  .desc-c {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .desc-a .link-desc,
  .desc-c .link-desc {
    white-space: nowrap;
  }
  .wire {
    left: -1px;
    right: 0;
    height: 0;
  }
  .wire.a {
    top: 95px;
    border-top: 1.5px dashed var(--ink-3);
  }
  .wire.a.live {
    border-top: 1.5px solid var(--ink);
  }
  .wire.c {
    top: 135px;
    border-top: 1.5px dashed var(--ink-3);
  }
  .wide .tab {
    position: absolute;
    top: 20px;
    left: 6px;
    right: 0;
    height: 146px;
  }
  .wide .tab-head {
    position: absolute;
    top: 12px;
    left: 18px;
    right: 12px;
  }
  .wide .tab::before {
    content: '';
    position: absolute;
    top: 56px;
    left: 0;
    right: 0;
    border-top: 1px solid var(--rule);
  }
  .wide .row-a,
  .wide .row-c {
    position: absolute;
    left: 18px;
    right: 12px;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wide .row-a {
    top: 67px;
  }
  .wide .row-c {
    top: 107px;
  }
  .term {
    position: absolute;
    left: -7px;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    background: var(--chassis);
    border: 1.5px dashed var(--ink-3);
  }
  .term.a {
    top: 69px;
  }
  .term.a.live {
    background: var(--ink);
    border: 1.5px solid var(--ink);
  }
  .term.c {
    top: 109px;
  }

  /* ---------- narrow ---------- */
  .narrow {
    display: none;
  }
  @media (max-width: 959px) {
    .wide {
      display: none;
    }
    .narrow {
      display: grid;
      gap: 0;
      max-width: 560px;
    }
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .pair .mic {
    min-height: 60px;
    padding: 10px 12px;
    gap: 10px;
  }
  .drop {
    position: relative;
    height: 34px;
    margin-left: 24px;
    padding-left: 14px;
    border-left: 1.5px solid var(--ink);
    display: flex;
    align-items: center;
  }
  .drop .mono {
    font-size: 12px;
    color: var(--ink-3);
  }
  .narrow .receiver {
    min-height: 64px;
    padding: 12px 16px;
  }
  .branches {
    list-style: none;
    margin: 0 0 0 24px;
    padding: 0;
  }
  .branch {
    display: grid;
    gap: 4px;
    padding: 14px 0 14px 16px;
    border-left: 1.5px dashed var(--ink-3);
  }
  .branch.live {
    border-left: 1.5px solid var(--ink);
  }
  .branch .link-title {
    white-space: normal;
    align-items: flex-start;
  }
  .branch .link-title :global(.lamp) {
    margin-top: 2px;
  }
  .narrow .tab {
    display: grid;
    gap: 6px;
    padding: 12px 16px 14px;
  }
  .narrow .tab-head {
    padding-bottom: 8px;
    margin-bottom: 2px;
    border-bottom: 1px solid var(--rule);
  }
</style>
