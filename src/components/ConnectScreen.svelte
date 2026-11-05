<script lang="ts">
  /**
   * The Connect page (no control link yet). Faceplate rows divided by rules:
   * 1. Connect: the steps, "Connect receiver", what works on which system; full control on a Mac
   *    through the local bridge (and its cost: USB audio pauses); "Receiver not in the list?".
   * 2. How it connects: the two USB links, drawn state-true, with the route to Audio.
   * Chrome's device chooser is described in words; nothing here imitates browser UI.
   */
  import { Check, ChevronRight, Copy } from '@lucide/svelte'
  import Key from '../lib/ui/Key.svelte'
  import Banner from '../lib/ui/Banner.svelte'
  import Lamp from '../lib/ui/Lamp.svelte'
  import DisplayWindow from '../lib/ui/DisplayWindow.svelte'
  import ConnectSchematic from './shell/ConnectSchematic.svelte'
  import { audio } from '../lib/state/audio.svelte'
  import { HOSTED_ORIGIN, NPM_PACKAGE_PUBLISHED, REPO_URL, bridgeStartHelp, pageContext } from '../lib/protocol'
  import { DISCLAIMER, platform, type Platform } from './shell/link.svelte'

  interface Props {
    supported: boolean
    busy: boolean
    /** Step text while connecting, e.g. "Reading settings…" */
    step?: string | null
    error?: { title: string; detail?: string } | null
    /** A previously granted device that can be reopened without the chooser. */
    known?: { name: string } | null
    onconnect: () => void
    onreconnect?: () => void
    /** Connect through the optional local USB bridge (docs/BRIDGE.md). */
    onbridge?: () => void
    /** Transport kind of the connection in progress ('webhid', 'bridge'…), to mark the right button busy. */
    via?: string | null
    /** Where the bridge is expected, e.g. "127.0.0.1:47321". */
    bridgeAddress?: string
  }
  let {
    supported,
    busy,
    step = null,
    error = null,
    known = null,
    onconnect,
    onreconnect,
    onbridge,
    via = null,
    bridgeAddress = '127.0.0.1:47321',
  }: Props = $props()

  // The bridge command depends on where this page is served from (this computer or the hosted site).
  const startHelp = bridgeStartHelp()
  const notLocal = pageContext() !== 'loopback'
  const hostedHost = new URL(HOSTED_ORIGIN).host

  const bridgeBusy = $derived(busy && via === 'bridge')
  const hidBusy = $derived(busy && via !== 'bridge')
  const bridgeError = $derived(error && via === 'bridge' ? error : null)
  const hidError = $derived(error && via !== 'bridge' ? error : null)
  const audioLive = $derived(audio.state === 'running' && audio.isHollyland)

  /** What works where. Linux and ChromeOS deliver the receiver's replies; macOS drops them. */
  const PLATFORMS: { name: string; on: Platform[]; mark: 'solid' | 'sent' | 'unknown'; what: string; note?: string }[] = [
    { name: 'Linux, ChromeOS', on: ['linux', 'chromeos'], mark: 'solid', what: 'read & write' },
    { name: 'macOS', on: ['mac'], mark: 'sent', what: 'send only', note: 'full control through the bridge' },
    { name: 'Windows', on: ['windows'], mark: 'unknown', what: 'not verified yet' },
  ]

  let copied = $state(false)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      /* ignore */
    }
  }
</script>

{#snippet platforms()}
  <ul class="platforms" aria-label="What works where">
    {#each PLATFORMS as p (p.name)}
      {@const here = p.on.includes(platform)}
      <li class:here>
        <span class="mc-swatch mc-swatch--{p.mark}" aria-hidden="true"></span>
        <span
          ><b>{p.name}</b>{#if here}<span class="here-tag">This computer</span>{/if} · {p.what}{#if p.note}<span
              class="p-note">&nbsp;· {p.note}</span
            >{/if}</span
        >
      </li>
    {/each}
  </ul>
{/snippet}

{#snippet audioRoute()}
  <div class="audio-route">
    <p>Only want live levels, voice effects or recording? Audio works without the control link.</p>
    <a class="mc-key mc-key--sm" href="#/audio">Open Audio</a>
  </div>
{/snippet}

<div class="connect">
  <section class="row" aria-labelledby="connect-title">
    <div class="rail">
      <p class="rail-title">Connect</p>
      <p class="rail-desc">Settings go straight from this page to the receiver over USB. Nothing is uploaded.</p>
    </div>
    <div class="panes">
      <!-- 1. Connect -->
      <div class="pane first">
        {#if supported}
          <h1 id="connect-title">Connect the receiver</h1>
          <ol class="steps">
            <li><span class="n">1</span><span>Plug the receiver into this computer’s USB-C port.</span></li>
            <li>
              <span class="n">2</span>
              <span
                >Switch on both mics. Mic 1 lights <span class="led"><Lamp size="sm" color="mic1" /></span> purple, Mic 2
                lights <span class="led"><Lamp size="sm" color="mic2" /></span> yellow.</span
              >
            </li>
            <li>
              <span class="n">3</span>
              <span
                >Press <b>Connect receiver</b>. Chrome lists the devices this page may use: choose “Wireless Microphone”,
                then Connect.</span
              >
            </li>
          </ol>
          {#if hidError}
            <Banner tone="danger" title={hidError.title}>{hidError.detail}</Banner>
          {/if}
          <div class="actions with-platforms">
            <Key variant="primary" size="lg" loading={hidBusy} disabled={bridgeBusy} onclick={onconnect}>
              {hidBusy ? (step ?? 'Connecting…') : 'Connect receiver'}
            </Key>
            {#if known && onreconnect && !busy}
              <Key size="lg" onclick={onreconnect}>Reconnect {known.name}</Key>
            {/if}
            {@render platforms()}
          </div>
          <p class="models">Works with LARK A2, A2S, M2 and M2S, in Chrome, Edge or another Chromium browser on a computer.</p>
        {:else}
          <h1 id="connect-title">This browser can’t connect to USB receivers</h1>
          <p class="lead">
            Mic Console talks to the receiver with WebHID, which works in Chrome, Edge, Opera and other Chromium browsers
            on a desktop or laptop. Safari, Firefox and phone browsers don’t support it yet.
          </p>
          {#if typeof window !== 'undefined' && !window.isSecureContext}
            <Banner tone="warning" title="Not a secure context">WebHID needs https:// or localhost.</Banner>
          {/if}
          <div class="actions">
            <Key variant="primary" size="lg" onclick={copyLink}>
              {#snippet icon()}{#if copied}<Check />{:else}<Copy />{/if}{/snippet}
              {copied ? 'Link copied' : 'Copy link for your computer'}
            </Key>
          </div>
          {@render platforms()}
          <p class="models">Works with LARK A2, A2S, M2 and M2S.</p>
        {/if}
      </div>

      <!-- 2. Bridge -->
      {#if onbridge}
        <div class="pane">
          <h2>Full control on a Mac</h2>
          <p class="body">
            {#if supported}
              Run the local bridge {startHelp.where ?? 'in a terminal'}. It asks for your password, and the receiver’s USB
              audio pauses while it runs: no live levels or recording until you stop it.
            {:else}
              Already running the local bridge on this computer? It works without WebHID. The receiver’s USB audio pauses
              while it runs.
            {/if}
          </p>
          <DisplayWindow code pad="sm" class="cmdwin">
            <span class="cmd">{startHelp.command}</span><span class="wait">wait for “captured”</span>
          </DisplayWindow>
          {#if startHelp.fromClone}
            <p class="small">From a clone of the project: <code>{startHelp.fromClone}</code></p>
          {/if}
          {#if bridgeError}
            <Banner tone="danger" title={bridgeError.title}>{bridgeError.detail}</Banner>
          {/if}
          <div class="actions">
            <Key size="lg" loading={bridgeBusy} disabled={hidBusy} onclick={onbridge}>
              {bridgeBusy ? (step ?? 'Connecting…') : 'Connect through local bridge'}
            </Key>
          </div>
          <p class="bridge-at">
            <Lamp size="sm" state={bridgeBusy ? 'on' : 'hollow'} blink={bridgeBusy} />
            <span>{bridgeError ? 'No answer from' : bridgeBusy ? 'Looking for' : 'Expects the bridge at'}</span>
            <span class="mono">{bridgeAddress}</span>
          </p>
          {#if platform === 'windows'}
            <p class="small">The bridge doesn’t run on Windows.</p>
          {:else if platform === 'linux' || platform === 'chromeos'}
            <p class="small">Not needed here: Chrome on {platform === 'linux' ? 'Linux' : 'ChromeOS'} reads and writes directly.</p>
          {/if}
          <details class="more">
            <summary><ChevronRight size={16} strokeWidth={2} aria-hidden="true" />More about the bridge</summary>
            <ol>
              {#if notLocal}
                <li>
                  If Chrome asks whether this site may access apps and services on this device, choose
                  <b>Allow</b>: the bridge runs on this computer.
                </li>
              {/if}
              <li>
                Press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal when you’re done. The receiver’s audio comes back; if it
                doesn’t, unplug and re-plug the receiver.
              </li>
              <li>
                The bridge only listens on this computer. It accepts pages served from this computer{NPM_PACKAGE_PUBLISHED
                  ? `, and the hosted Mic Console (${hostedHost}) when started with --bridge-only`
                  : ', and other sites only when they are named with --allow-origin'}. Details:
                <a href="{REPO_URL}/blob/main/docs/BRIDGE.md" target="_blank" rel="noreferrer">docs/BRIDGE.md</a>.
              </li>
            </ol>
          </details>
        </div>
      {/if}

      <!-- 3. Trouble -->
      <div class="pane">
        <h2>{supported ? 'Receiver not in the list?' : 'On a computer'}</h2>
        {#if supported}
          <ul class="trouble">
            <li>Unplug and re-plug it, or try another port. It must be a data cable.</li>
            <li>Close the HollyAudio app or other pages that might be using it.</li>
            <li>
              Linux: allow access with a udev rule, then re-plug:
              <!-- Same dark code window as the bridge command, so the page has one code style. -->
              <DisplayWindow code pad="sm" class="rulewin"
                ><code class="rule"
                  ><span>SUBSYSTEM=="hidraw",</span> <span>ATTRS{'{'}idVendor{'}'}=="3547",</span> <span>MODE="0660",</span>
                  <span>TAG+="uaccess"</span></code
                ></DisplayWindow
              >
            </li>
            <li>Windows: check it shows as “Wireless Microphone” in Sound settings.</li>
          </ul>
        {:else}
          <ul class="trouble">
            <li>Open this page in Chrome or Edge on a Mac, Windows, Linux or ChromeOS computer.</li>
            <li>Plug the receiver into that computer’s USB-C port.</li>
          </ul>
        {/if}
        {@render audioRoute()}
      </div>
    </div>
  </section>

  <section class="row how" aria-labelledby="how-title">
    <div class="rail">
      <h2 id="how-title" class="rail-title">How it connects</h2>
      <p class="rail-desc">The receiver gives this page two separate USB links.</p>
    </div>
    <div class="how-body">
      <ConnectSchematic {audioLive} control={!supported ? 'unsupported' : hidBusy ? 'connecting' : 'idle'} />
    </div>
  </section>

  <p class="disclaimer">{DISCLAIMER}. LARK is a trademark of its owner.</p>
</div>

<style>
  .connect {
    flex: 1;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    border-bottom: 1px solid var(--rule);
    min-width: 0;
  }
  .row.how {
    border-bottom: 0;
  }
  .rail {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
    padding: 20px 0 4px;
  }
  .row:first-child .rail {
    display: none;
  }
  .rail-title {
    font-size: var(--t-section-sm);
    font-weight: 680;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .rail-desc {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }

  /* Panes: rules drawn just outside each pane's left and top edge; the outer ones are clipped,
     so the rules survive wrapping. */
  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
    min-width: 0;
  }
  .pane {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    min-width: 0;
    padding: 24px 0;
    box-shadow:
      -1px 0 0 var(--rule),
      0 -1px 0 var(--rule);
  }
  .pane > :global(*) {
    max-width: 100%;
  }

  h1 {
    font-size: 26px;
    font-weight: 680;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  h2:not(.rail-title) {
    font-size: 18px;
    font-weight: 660;
    font-stretch: 106%;
    letter-spacing: -0.01em;
  }
  .minor {
    font-size: 14px;
    font-weight: 650;
    font-stretch: 100%;
  }
  .lead,
  .body {
    font-size: 14px;
    line-height: var(--lh-body);
    color: var(--ink-2);
    max-width: 60ch;
  }
  .small {
    font-size: 12px;
    line-height: var(--lh-body);
    color: var(--ink-3);
  }

  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
    max-width: 52ch;
  }
  .steps li {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 8px;
    font-size: 14.5px;
    line-height: 1.45;
  }
  .n {
    font-size: 13px;
    font-weight: 650;
    color: var(--ink-3);
    line-height: 1.6;
  }
  .steps b {
    font-weight: 650;
  }
  .led {
    display: inline-flex;
    vertical-align: -1px;
    margin: 0 1px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .platforms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
    font-size: 13px;
    line-height: 1.35;
    color: var(--ink-2);
  }
  .platforms li {
    display: grid;
    grid-template-columns: 12px minmax(0, 1fr);
    gap: 8px;
    align-items: baseline;
  }
  .platforms .mc-swatch {
    transform: translateY(1px);
  }
  .platforms b {
    font-weight: 600;
    color: var(--ink);
  }
  .p-note {
    color: var(--ink-3);
  }
  .here-tag {
    margin: 0 2px 0 8px;
    padding: 0 5px;
    border: 1px solid var(--rule);
    border-radius: var(--r-plate);
    font-size: 12px;
    color: var(--ink-2);
    white-space: nowrap;
  }
  .with-platforms {
    align-items: center;
    column-gap: 20px;
    row-gap: 14px;
  }
  .models {
    font-size: 12px;
    line-height: var(--lh-body);
    color: var(--ink-3);
  }

  .pane :global(.cmdwin) {
    flex-wrap: wrap;
    row-gap: 4px;
  }
  .cmd {
    min-width: 0;
    color: var(--w-ink);
    /* The hosted-site command (with --allow-origin https://…) is longer than the pane: wrap it
       rather than hiding the end behind a horizontal scroll. */
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .wait {
    font-size: 12px;
    color: var(--w-ink-2);
    white-space: nowrap;
  }
  .bridge-at {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .bridge-at .mono {
    color: var(--ink);
    font-size: 12px;
  }
  .more {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .more summary {
    display: flex;
    align-items: center;
    gap: 6px;
    list-style: none;
    min-height: var(--hit);
    cursor: pointer;
    color: var(--ink);
    font-weight: 560;
  }
  .more summary::-webkit-details-marker {
    display: none;
  }
  .more summary :global(svg) {
    transition: transform var(--dur-fast) var(--ease);
  }
  .more[open] summary :global(svg) {
    transform: rotate(90deg);
  }
  .more ol {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 6px;
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--key-edge);
    border-radius: 3px;
    background: var(--key);
    font-size: 12px;
  }

  .trouble {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
  }
  .trouble li {
    padding: 10px 0;
    border-top: 1px solid var(--rule-soft);
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .rule span {
    display: inline-block;
  }
  .trouble :global(.rulewin) {
    display: block;
    margin-top: 6px;
  }
  .rule {
    display: block;
    color: var(--w-ink);
    font-size: 12px;
    line-height: 1.5;
  }
  .audio-route {
    display: grid;
    justify-items: start;
    gap: 10px;
    margin-top: auto;
    padding-top: 6px;
  }
  .audio-route p {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }

  .how-body {
    min-width: 0;
    padding: 12px 0 28px;
  }

  .disclaimer {
    padding: 4px 0 24px;
    font-size: 12px;
    color: var(--ink-3);
  }

  /* ≥ 600: the bridge and troubleshooting panes sit side by side under the first. */
  @media (min-width: 600px) {
    .panes {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pane.first {
      grid-column: 1 / -1;
    }
    .pane:not(.first) {
      padding-left: 24px;
      padding-right: 8px;
    }
    .pane:not(.first):nth-child(2) {
      padding-left: 0;
      padding-right: 24px;
    }
    .disclaimer {
      display: none; /* the status line carries it */
    }
  }
  /* ≥ 1100: three panes in a row, as drawn. */
  @media (min-width: 1100px) {
    .panes {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(0, 0.9fr);
    }
    .pane.first {
      grid-column: auto;
      padding-right: 32px;
    }
    .pane:not(.first),
    .pane:not(.first):nth-child(2) {
      padding: 28px 32px 28px 28px;
    }
    .pane:last-child {
      padding-right: 0;
    }
    h1 {
      font-size: var(--t-page);
    }
  }
  /* ≥ 1280: the 168 px rail, like a spec sheet. */
  @media (min-width: 1280px) {
    .row {
      grid-template-columns: var(--rail-w) minmax(0, 1fr);
    }
    .row:first-child .rail {
      display: flex;
    }
    .rail {
      flex-direction: column;
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 6px;
      padding: 24px 20px 24px 0;
    }
    .rail-title {
      font-size: var(--t-section);
    }
    .panes,
    .how-body {
      border-left: 1px solid var(--rule);
    }
    .pane.first {
      padding: 28px 32px 28px 28px;
    }
    .how-body {
      display: flex;
      align-items: center;
      padding: 26px 0 22px 28px;
    }
    .how-body > :global(*) {
      flex: 1;
    }
  }
</style>
