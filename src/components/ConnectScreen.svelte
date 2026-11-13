<script lang="ts">
  /**
   * The Connect page (no control link yet): one centred column, read top to bottom.
   *   title and the supported models → three steps → "Connect receiver" (USB) and, where the
   *   browser has Web Bluetooth, "Connect over Bluetooth" → collapsed extras:
   *   "Full status on macOS / Linux (local bridge)" (macOS and Linux only) and "Receiver not in the list?".
   * The links come from `session.connectPaths`: a browser with Web Bluetooth but no WebHID
   * (Android Chrome) gets the Bluetooth steps; one with neither gets the reason and a "Copy link"
   * key. The models line is generated from the registry (connect/models.ts).
   * Nothing here imitates browser UI.
   */
  import { Check, Copy } from '@lucide/svelte'
  import Key from '../lib/ui/Key.svelte'
  import Banner from '../lib/ui/Banner.svelte'
  import Lamp from '../lib/ui/Lamp.svelte'
  import Disclosure from './connect/Disclosure.svelte'
  import CodeWindow from './connect/CodeWindow.svelte'
  import { bluetoothProductsLine, connectableModels, modelsLine } from './connect/models'
  import { REPO_URL, bridgeStartHelp, pageContext } from '../lib/protocol/app'
  import { session } from '../lib/state/session.svelte'
  import { reconnectUsb } from '../lib/state/links'
  import { DISCLAIMER, PLATFORM_NAME, platform } from './shell/link.svelte'

  interface Props {
    /** WebHID is available. Kept for callers; the page reads every link from `session.connectPaths`. */
    supported?: boolean
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
  /** The hosted site reaches the bridge on 127.0.0.1 only after Chrome's local network prompt. */
  const notLocal = pageContext() !== 'loopback'
  const onMac = platform === 'mac'
  const onLinux = platform === 'linux'
  /** macOS and Linux drop the receiver's replies; the bridge (which runs on both) reads them. */
  const bridgeForStatus = onMac || onLinux
  const onPhone = platform === 'android' || platform === 'ios'
  /** The bridge holds the whole receiver except on Linux/ChromeOS, so its USB audio pauses (docs/BRIDGE.md). */
  const pausesAudio = platform !== 'linux' && platform !== 'chromeos'

  /** Links this browser offers: WebHID ("Connect receiver") and Web Bluetooth ("Connect over Bluetooth"). */
  const usb = session.connectPaths.usb
  const bluetooth = session.connectPaths.bluetooth
  /** Phones and browsers with Web Bluetooth only (Android Chrome): the Bluetooth path is the main one. */
  const bluetoothOnly = bluetooth && !usb
  const supported = usb || bluetooth

  const allModels = `For the ${modelsLine(connectableModels())}.`
  /** "LARK MAX 2 charging case and MELO P1": what the Bluetooth chooser can list. */
  const btProducts = bluetoothProductsLine()
  /** Bluetooth only: the products by name (the MAX 2 receiver itself doesn't connect over Bluetooth). */
  const subtitle = bluetoothOnly ? `For the ${btProducts}.` : allModels
  /** "Bluetooth: " before a help line, unless Bluetooth is the only link on the page. */
  const btPrefix = bluetoothOnly ? '' : 'Bluetooth: '
  /** The user's headline; without WebHID it says Bluetooth (neither "USB" nor "computer" is true there). */
  const headline = bluetoothOnly
    ? `Control your Hollyland microphone ${onPhone ? 'from your phone' : 'over Bluetooth'}`
    : 'Control your Hollyland USB microphone from your computer'

  const bridgeBusy = $derived(busy && via === 'bridge')
  const btBusy = $derived(busy && via === 'web-bluetooth')
  const hidBusy = $derived(busy && via !== 'bridge' && via !== 'web-bluetooth')
  const bridgeError = $derived(error && via === 'bridge' ? error : null)
  /** USB and Bluetooth errors, under the keys. */
  const linkError = $derived(error && via !== 'bridge' ? error : null)

  /** Every USB HID device in the chooser: products whose vendor id is unconfirmed (registry rows). */
  function connectAnyUsb() {
    void session.connect({ anyDevice: true })
  }
  function connectBluetooth() {
    void session.connectBluetooth()
  }
  /**
   * "Reconnect <name>" reopens a granted USB receiver. After a Bluetooth attempt the session's
   * reconnect() would retry Bluetooth, so the USB path is named here.
   */
  function reconnectKnown() {
    if (session.transportKind === 'web-bluetooth') void session.connectWith('webhid', () => reconnectUsb())
    else onreconnect?.()
  }

  /**
   * The bridge is offered on macOS and Linux (where it is the way to full control). Elsewhere it shows
   * up only while a bridge connection is under way or has just failed: `npx hollyland-web-ui`
   * opens the page with ?bridge=auto, and its waiting text and errors must stay visible.
   */
  const showBridge = $derived(!!onbridge && (bridgeForStatus || via === 'bridge'))
  let bridgeOpen = $state(false)
  $effect(() => {
    if (bridgeBusy || bridgeError) bridgeOpen = true
  })

  /** The bridge disclosure sits far below the main key; the pointer under the key jumps to it. */
  let bridgeSection: HTMLElement | undefined = $state()
  /** A bridge error is said once, in the open disclosure: bring it into view (?bridge=auto opens the page scrolled to the top). */
  let bridgeErrorEl: HTMLElement | undefined = $state()
  $effect(() => {
    if (!bridgeError || !bridgeErrorEl) return
    const el = bridgeErrorEl
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' }))
  })
  function showBridgeDetails() {
    bridgeOpen = true
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => {
      bridgeSection?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
      bridgeSection?.querySelector('summary')?.focus({ preventScroll: true })
    })
  }

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
  <div class="column">
    <header class="intro">
      <h1>{headline}</h1>
      <p class="subtitle">{subtitle}</p>
    </header>

    {#if supported}
      <section class="start" aria-label="Connect">
        <ol class="steps">
          {#if bluetoothOnly}
            <li><span class="n" aria-hidden="true">1</span><span>Turn on Bluetooth.</span></li>
            <li><span class="n" aria-hidden="true">2</span><span>Switch on the charging case or receiver.</span></li>
            <li><span class="n" aria-hidden="true">3</span><span>Press <b>Connect over Bluetooth</b> and pick it in the list.</span></li>
          {:else}
            <li><span class="n" aria-hidden="true">1</span><span>Plug in the receiver.</span></li>
            <li><span class="n" aria-hidden="true">2</span><span>Switch on the mics.</span></li>
            <li><span class="n" aria-hidden="true">3</span><span>Press <b>Connect receiver</b> and pick it in the list.</span></li>
          {/if}
        </ol>

        <div class="actions">
          {#if usb}
            <Key variant="primary" size="lg" loading={hidBusy} disabled={bridgeBusy || btBusy} onclick={onconnect}>
              {hidBusy ? (step ?? 'Connecting…') : 'Connect receiver'}
            </Key>
          {/if}
          {#if usb && known && onreconnect && !busy}
            <Key size="lg" onclick={reconnectKnown}>Reconnect {known.name}</Key>
          {/if}
          {#if bluetooth}
            <Key
              variant={bluetoothOnly ? 'primary' : 'default'}
              size="lg"
              loading={btBusy}
              disabled={bridgeBusy || hidBusy}
              onclick={connectBluetooth}
            >
              {btBusy ? (step ?? 'Connecting…') : 'Connect over Bluetooth'}
            </Key>
          {/if}
        </div>
        <!-- Only while the bridge disclosure is closed: open, it shows the progress and the error itself. -->
        {#if (bridgeBusy || bridgeError) && !(showBridge && bridgeOpen)}
          <p class="status" role="status">
            <Lamp size="sm" color={bridgeError ? 'rec' : 'live'} blink={bridgeBusy} />
            <span>
              {#if bridgeError}<b>{bridgeError.title}</b>{:else}Connecting through the local bridge…{/if}
              {#if showBridge}<button type="button" class="jump" onclick={showBridgeDetails}>Show details</button>{/if}
            </span>
          </p>
        {/if}
        {#if linkError}
          <Banner tone="danger" title={linkError.title}>{linkError.detail}</Banner>
        {/if}
      </section>
    {:else}
      <section class="start" aria-labelledby="unsupported-title">
        <div class="unsupported">
          <h2 id="unsupported-title">This browser can’t connect to the receiver</h2>
          <p>{onPhone ? 'Open this page in Chrome or Edge on a computer.' : 'Open this page in Chrome or Edge.'}</p>
        </div>
        {#if typeof window !== 'undefined' && !window.isSecureContext}
          <Banner tone="warning" title="Needs https:// or localhost" />
        {/if}
        <div class="actions">
          <Key variant="primary" size="lg" onclick={copyLink}>
            {#snippet icon()}{#if copied}<Check />{:else}<Copy />{/if}{/snippet}
            {copied ? 'Link copied' : 'Copy link'}
          </Key>
        </div>
      </section>
    {/if}

    {#if showBridge || supported}
      <div class="more mc-rule-top">
        {#if showBridge}
          <div bind:this={bridgeSection}>
            <Disclosure
              title={bridgeForStatus ? `Full status on ${PLATFORM_NAME[platform]} (local bridge)` : 'Local bridge'}
              bind:open={bridgeOpen}
            >
              <div class="cmd">
                <p class="small">{startHelp.where ? `Run ${startHelp.where}:` : 'Run in a terminal:'}</p>
                <CodeWindow text={startHelp.command} copyLabel="Copy the bridge command" />
                {#if startHelp.fromClone}
                  <p class="small">From a clone: <code class="wrap">{startHelp.fromClone}</code></p>
                {/if}
              </div>
              <Key
                size="lg"
                loading={bridgeBusy}
                disabled={hidBusy || btBusy}
                title="Bridge at {bridgeAddress}"
                onclick={onbridge}
              >
                {bridgeBusy ? (step ?? 'Connecting…') : 'Connect through local bridge'}
              </Key>
              {#if bridgeError}
                <div class="bridge-error" bind:this={bridgeErrorEl}>
                  <Banner tone="danger" title={bridgeError.title}>{bridgeError.detail}</Banner>
                </div>
              {/if}

              <ul class="facts">
                {#if pausesAudio}<li>Pauses USB audio while it runs.</li>{/if}
                {#if onLinux}<li>USB audio keeps working. No sudo with the udev rules under “Receiver not in the list?”.</li>{/if}
                <li>Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>.</li>
                {#if notLocal}<li>If Chrome asks, choose <b>Allow</b>.</li>{/if}
                <li>
                  <a href="{REPO_URL}/blob/main/docs/BRIDGE.md" target="_blank" rel="noreferrer">docs/BRIDGE.md</a>
                </li>
              </ul>
            </Disclosure>
          </div>
        {/if}

        {#if supported}
          <Disclosure title="Receiver not in the list?">
            <!-- Every HID device in the chooser: for receivers whose USB vendor id isn't confirmed. -->
            {#if usb}
              <Key disabled={busy} onclick={connectAnyUsb}>Show all USB devices</Key>
            {/if}
            <ul class="facts">
              {#if usb}
                <li>LARK A2 shows as “Wireless Microphone”.</li>
                <li>Re-plug it or try another port.</li>
                <li>Use a data cable, not charge-only.</li>
                <li>Close HollyAudio and other tabs using it.</li>
                <li>
                  <p>Linux: save as <code class="wrap">/etc/udev/rules.d/70-hollyland.rules</code></p>
                  <CodeWindow
                    text={'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3547", MODE="0660", TAG+="uaccess"\nSUBSYSTEM=="usb", ATTR{idVendor}=="3547", MODE="0660", TAG+="uaccess"'}
                    copyLabel="Copy the udev rules"
                  />
                  <p>The second line lets the local bridge run without sudo.</p>
                  <p>then run <code>sudo udevadm control --reload</code> and re-plug.</p>
                </li>
                <li>Windows: check Sound settings.</li>
              {/if}
              {#if bluetooth}
                <li>{btPrefix}{btProducts} only.</li>
                <li>{btPrefix ? `${btPrefix}disconnect` : 'Disconnect'} it from other phones and apps.</li>
                {#if platform === 'android'}<li>Android: allow Chrome to find nearby devices.</li>{/if}
              {/if}
            </ul>
          </Disclosure>
        {/if}
      </div>
    {/if}

    <p class="disclaimer">{DISCLAIMER}</p>
  </div>
</div>

<style>
  .connect {
    flex: 1;
    min-width: 0;
    padding: 56px 0 48px;
  }
  .column {
    display: flex;
    flex-direction: column;
    max-width: 680px;
    margin: 0 auto;
  }

  /* ---- Title ---- */
  .intro {
    display: grid;
    gap: 12px;
  }
  h1 {
    font-size: var(--t-page);
    font-weight: 680;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.02em;
    line-height: 1.15;
    text-wrap: balance;
  }
  /* The models line: one line in the column where it fits. */
  .subtitle {
    font-size: 16px;
    line-height: 1.5;
    color: var(--ink-2);
    text-wrap: pretty;
  }

  /* ---- Steps and the main key ---- */
  .start {
    display: grid;
    justify-items: start;
    gap: 20px;
    margin-top: 32px;
  }
  .start > :global(*) {
    max-width: 100%;
  }
  /* Notices span the column rather than hugging their text. */
  .start > :global(.mc-window),
  .more :global(.disclosure .body > .mc-window),
  .bridge-error {
    justify-self: stretch;
  }
  .bridge-error {
    width: 100%;
    scroll-margin-bottom: 24px;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .steps li {
    display: grid;
    grid-template-columns: 26px minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    font-size: 15px;
    line-height: 1.5;
    color: var(--ink);
  }
  /* Step number: a small engraved plate. */
  .n {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-top: -1px;
    border: 1px solid var(--rule);
    border-radius: var(--r-plate);
    font-size: 13px;
    font-weight: 650;
    color: var(--ink-2);
  }
  b {
    font-weight: 650;
    color: var(--ink);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .start .actions {
    margin-top: 4px;
  }
  .status {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--ink-2);
  }
  /* Level with the first line when the text wraps (14 px × 1.5 line, 12 px lamp). */
  .status > :global(.lamp) {
    align-self: flex-start;
    margin-top: 4.5px;
  }
  /* "Show details": a text link that opens the bridge disclosure and scrolls to it. */
  .jump {
    margin-left: 4px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--ink);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .jump:hover {
    text-decoration-thickness: 2px;
  }

  .unsupported {
    display: grid;
    gap: 8px;
  }
  h2 {
    font-size: 18px;
    font-weight: 660;
    line-height: 1.3;
  }
  .unsupported p {
    font-size: 15px;
    line-height: 1.55;
    color: var(--ink-2);
    max-width: 62ch;
  }

  /* ---- Collapsed extras ---- */
  .more {
    margin-top: 40px;
  }
  /* The bridge command: "Run in a terminal:" over the code window. */
  .cmd {
    display: grid;
    gap: 6px;
    width: 100%;
    min-width: 0;
  }
  .small {
    font-size: 13px;
    color: var(--ink-3);
  }
  .facts {
    margin: 0;
    padding-left: 20px;
    display: grid;
    gap: 6px;
    width: 100%;
  }
  .facts li {
    padding-left: 4px;
  }
  .facts li > :global(* + *) {
    margin-top: 10px;
  }
  code {
    font-size: 12.5px;
    color: var(--ink);
    white-space: nowrap;
  }
  code.wrap {
    white-space: normal;
    overflow-wrap: anywhere;
  }
  kbd {
    padding: 0 4px;
    border: 1px solid var(--key-edge);
    border-radius: 3px;
    background: var(--key);
    font-size: 12px;
  }

  .disclaimer {
    margin-top: 32px;
    font-size: 12px;
    color: var(--ink-3);
  }

  @media (max-width: 599px) {
    .connect {
      padding: 28px 0 32px;
    }
    h1 {
      font-size: 26px;
    }
    .subtitle {
      font-size: 15px;
    }
    .start {
      margin-top: 28px;
    }
    .start .actions,
    .start .actions > :global(*) {
      width: 100%;
    }
  }
  /* ≥ 600 px the status line along the bottom carries the disclaimer. */
  @media (min-width: 600px) {
    .disclaimer {
      display: none;
    }
  }
</style>
