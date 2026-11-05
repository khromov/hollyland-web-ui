<script lang="ts">
  import { Usb, Copy, Check, Cable } from '@lucide/svelte'
  import Button from '../lib/ui/Button.svelte'
  import Banner from '../lib/ui/Banner.svelte'
  import KitGlyph from './KitGlyph.svelte'
  import { HOSTED_ORIGIN, NPM_PACKAGE_PUBLISHED, REPO_URL, bridgeStartHelp, pageContext } from '../lib/protocol'

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
  }: Props = $props()

  // The bridge command depends on where this page is served from (this computer or the hosted site).
  const startHelp = bridgeStartHelp()
  const notLocal = pageContext() !== 'loopback'
  const hostedHost = new URL(HOSTED_ORIGIN).host

  const bridgeBusy = $derived(busy && via === 'bridge')
  const hidBusy = $derived(busy && via !== 'bridge')

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

<div class="connect">
  <section class="card main" aria-labelledby="connect-title">
    {#if !supported}
      <h1 id="connect-title">This browser can't connect to USB receivers</h1>
      <p class="lead">
        Mic Console talks to the receiver with <strong>WebHID</strong>, which works in Chrome, Edge, Opera and other
        Chromium browsers on a desktop or laptop (Windows, macOS, Linux, ChromeOS). Safari, Firefox and phone browsers
        don't support it yet.
      </p>
      <div class="actions">
        <Button variant="primary" onclick={copyLink}>
          {#snippet icon()}{#if copied}<Check size={18} />{:else}<Copy size={18} />{/if}{/snippet}
          {copied ? 'Link copied' : 'Copy link for your computer'}
        </Button>
      </div>
      {#if !window.isSecureContext}
        <Banner tone="warning" title="Not a secure context">WebHID needs https:// or localhost.</Banner>
      {/if}
      {#if onbridge}
        <div class="bridge">
          <p class="hint">Already running the local bridge on this computer? It works without WebHID.</p>
          {#if error && !busy}
            <Banner tone="danger" title={error.title}>{error.detail}</Banner>
          {/if}
          <Button variant="secondary" loading={bridgeBusy} onclick={onbridge}>
            {#snippet icon()}<Cable size={18} />{/snippet}
            {bridgeBusy ? (step ?? 'Connecting…') : 'Connect through local bridge'}
          </Button>
        </div>
      {/if}
    {:else}
      <h1 id="connect-title">Connect your receiver</h1>
      <ol class="steps">
        <li><span class="n">1</span><p>Plug the receiver into this computer's USB-C port.</p></li>
        <li><span class="n">2</span><p>Switch on the transmitters (mics).</p></li>
        <li>
          <span class="n">3</span>
          <p>Press <strong>Connect receiver</strong> and pick "Wireless Microphone" in the browser's list.</p>
        </li>
      </ol>
      {#if error}
        <Banner tone="danger" title={error.title}>{error.detail}</Banner>
      {/if}
      <div class="actions">
        <Button variant="primary" size="lg" loading={hidBusy} disabled={bridgeBusy} onclick={onconnect}>
          {#snippet icon()}<Usb size={18} />{/snippet}
          {hidBusy ? (step ?? 'Connecting…') : 'Connect receiver'}
        </Button>
        {#if known && onreconnect && !busy}
          <Button variant="secondary" size="lg" onclick={onreconnect}>Reconnect {known.name}</Button>
        {/if}
      </div>
      {#if onbridge}
        <div class="bridge">
          <Button variant="secondary" loading={bridgeBusy} disabled={hidBusy} onclick={onbridge}>
            {#snippet icon()}<Cable size={18} />{/snippet}
            {bridgeBusy ? (step ?? 'Connecting…') : 'Connect through local bridge'}
          </Button>
          <p class="hint">
            Full read and write on a Mac. Start the bridge first; the receiver's USB audio pauses while it runs.
          </p>
          <details class="bridge-help">
            <summary>How to start the local bridge</summary>
            <ol>
              <li>
                In a terminal{startHelp.where ? `, ${startHelp.where}` : ''}, run <code>{startHelp.command}</code> and enter
                your computer password when asked.{#if startHelp.fromClone}
                  From a clone of the project, <code>{startHelp.fromClone}</code> does the same.{/if}
              </li>
              <li>Wait until it prints "captured", then press <strong>Connect through local bridge</strong>.</li>
              {#if notLocal}
                <li>
                  If Chrome asks whether this site may access apps and services on this device, choose
                  <strong>Allow</strong>: the bridge runs on this computer.
                </li>
              {/if}
              <li>
                Press <kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal when you're done. The receiver's audio comes back; if it
                doesn't, unplug and re-plug the receiver.
              </li>
            </ol>
            <p>
              The bridge only listens on this computer (127.0.0.1). It accepts pages served from this computer{NPM_PACKAGE_PUBLISHED
                ? `, and the hosted Mic Console (${hostedHost}) when started with --bridge-only`
                : ', and other sites only when they are named with --allow-origin'}. Details and options: <a href="{REPO_URL}/blob/main/docs/BRIDGE.md" target="_blank" rel="noreferrer"
                >docs/BRIDGE.md</a
              >.
            </p>
          </details>
        </div>
      {/if}
      <p class="note">
        Supported: LARK A2 (and A2 camera receiver), LARK M2 and LARK M2S. Settings are sent straight from this page to
        the receiver over USB; nothing is uploaded anywhere.
      </p>
    {/if}
  </section>

  <aside class="card side" aria-hidden="true">
    <KitGlyph animate={supported && !busy} />
    <p class="waiting">{supported ? (busy ? (step ?? 'Opening the receiver…') : 'Waiting for a receiver…') : 'Desktop Chromium required'}</p>
  </aside>

  <details class="help">
    <summary>The receiver isn't in the list</summary>
    <ul>
      <li>Unplug and re-plug it, or try another port or cable (it must be a data cable).</li>
      <li>Close the HollyAudio app or other pages that might be using it.</li>
      <li>
        Linux: allow access to the HID device with a udev rule, for example
        <code>SUBSYSTEM=="hidraw", ATTRS{'{'}idVendor{'}'}=="3547", MODE="0660", TAG+="uaccess"</code>, then re-plug.
      </li>
      <li>Windows: make sure it shows up as "Wireless Microphone" in Sound settings.</li>
    </ul>
  </details>

  <p class="disclaimer">
    Independent project. Not affiliated with or endorsed by Hollyland. LARK is a trademark of its owner.
  </p>
</div>

<style>
  .connect {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--space-5);
    max-width: 1040px;
    margin: clamp(16px, 6vh, 72px) auto 0;
  }
  .card {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-8);
    box-shadow: var(--shadow-1);
  }
  h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-2xl);
    margin-bottom: var(--space-4);
  }
  .lead {
    color: var(--color-text-muted);
    margin-bottom: var(--space-5);
  }
  .steps {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-5);
    display: grid;
    gap: var(--space-3);
  }
  .steps li {
    display: flex;
    gap: var(--space-3);
    align-items: baseline;
    color: var(--color-text-muted);
  }
  .steps p {
    min-width: 0;
  }
  .steps .n {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--color-surface-3);
    color: var(--color-text);
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
  }
  .steps strong {
    color: var(--color-text);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-5) 0;
  }
  .note {
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  .bridge {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    margin: 0 0 var(--space-5);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .bridge-help {
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .bridge-help summary {
    cursor: pointer;
    color: var(--color-text);
    font-weight: var(--weight-medium);
    padding-block: var(--space-3); /* 44 px touch target */
  }
  .bridge-help ol {
    margin: 0 0 var(--space-2);
    padding-left: var(--space-5);
    display: grid;
    gap: 6px;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 0 4px;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-surface-2);
  }
  .side {
    display: grid;
    place-items: center;
    align-content: center;
    gap: var(--space-4);
    background:
      radial-gradient(120% 80% at 50% 0%, var(--color-accent-soft), transparent 70%),
      var(--color-surface-1);
  }
  .waiting {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .help {
    grid-column: 1 / -1;
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    padding: 0 var(--space-2);
  }
  .help summary {
    cursor: pointer;
    color: var(--color-text);
    font-weight: var(--weight-medium);
    padding-block: var(--space-3); /* 44 px touch target */
  }
  .help ul {
    margin: var(--space-2) 0 0;
    display: grid;
    gap: 6px;
  }
  code {
    font-size: var(--text-xs);
    background: var(--color-surface-3);
    padding: 1px 4px;
    border-radius: 4px;
    word-break: break-all;
  }
  .disclaimer {
    grid-column: 1 / -1;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
  }
  @media (max-width: 767px) {
    .connect {
      grid-template-columns: 1fr;
    }
    .side {
      order: -1;
      padding: var(--space-5);
    }
    .card.main {
      padding: var(--space-5);
    }
  }
</style>
