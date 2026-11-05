<script lang="ts">
  import { onMount } from 'svelte'
  import { LayoutDashboard, AudioLines, SlidersHorizontal, Cpu, Bug } from '@lucide/svelte'
  import Toaster from './lib/ui/Toaster.svelte'
  import Banner from './lib/ui/Banner.svelte'
  import Button from './lib/ui/Button.svelte'
  import AppHeader from './components/AppHeader.svelte'
  import TabBar from './components/TabBar.svelte'
  import ConnectScreen from './components/ConnectScreen.svelte'
  import RestartOverlay from './components/RestartOverlay.svelte'
  import WriteOnlyBanner from './components/WriteOnlyBanner.svelte'
  import OverviewPage from './components/overview/OverviewPage.svelte'
  import SettingsPage from './components/settings/SettingsPage.svelte'
  import DevicePage from './components/device/DevicePage.svelte'
  import AudioPage from './components/audio/AudioPage.svelte'
  import ConsolePage from './components/console/ConsolePage.svelte'
  import { session } from './lib/state/session.svelte'
  import { router, type Route } from './lib/state/router.svelte'
  import { prefs } from './lib/state/prefs.svelte'
  import { BridgeError, BridgeTransport, isWebHidSupported, pageContext, resolveBridgeUrl } from './lib/protocol'

  const connected = $derived(session.phase === 'ready' || session.phase === 'restarting' || session.phase === 'lost')
  const viaBridge = $derived(session.transportKind === 'bridge')

  const allTabs = $derived(
    [
      { route: 'overview' as Route, label: 'Overview', icon: LayoutDashboard, needsDevice: true },
      { route: 'audio' as Route, label: 'Audio', icon: AudioLines, needsDevice: false },
      { route: 'settings' as Route, label: 'Settings', icon: SlidersHorizontal, needsDevice: true },
      { route: 'device' as Route, label: 'Device', icon: Cpu, needsDevice: true },
      ...(prefs.developer ? [{ route: 'console' as Route, label: 'Console', icon: Bug, needsDevice: false }] : []),
    ].filter((t) => connected || !t.needsDevice),
  )

  // Without a device, only Audio (and Console in developer mode) make sense; everything else
  // shows the connect screen.
  const showConnect = $derived(!connected && router.route !== 'audio' && router.route !== 'console')

  const statusText = $derived.by(() => {
    switch (session.phase) {
      case 'unsupported':
        return 'Browser not supported'
      case 'idle':
        return 'Not connected'
      case 'connecting':
        return session.step ?? 'Connecting…'
      case 'restarting':
        return 'Receiver restarting…'
      case 'lost':
        return 'Connection lost'
      case 'ready':
        return session.writeOnly
          ? 'Connected · write-only'
          : viaBridge
            ? 'Connected · bridge'
            : 'Connected'
    }
  })
  /** Short form for narrow headers (phones). */
  const statusShort = $derived.by(() => {
    switch (session.phase) {
      case 'unsupported':
        return 'Unsupported'
      case 'idle':
        return 'Not connected'
      case 'connecting':
        return 'Connecting…'
      case 'restarting':
        return 'Restarting…'
      case 'lost':
        return 'Connection lost'
      case 'ready':
        return session.writeOnly ? 'Write-only' : viaBridge ? 'Bridge' : 'Connected'
    }
  })
  const statusTone = $derived(
    session.phase === 'ready'
      ? session.writeOnly
        ? 'warning'
        : 'success'
      : session.phase === 'lost'
        ? 'danger'
        : session.phase === 'connecting' || session.phase === 'restarting'
          ? 'accent'
          : 'neutral',
  )

  const lastSeen = $derived(session.lastUpdate ? new Date(session.lastUpdate).toLocaleTimeString() : null)

  // Optional local USB bridge (docs/BRIDGE.md): full read/write where the OS drops replies.
  // `?bridge=<port>` points the page at a bridge started with --port. `npx mic-console` opens the
  // page with `?bridge=auto` (or `?bridge=<port>&auto=1`): connect through the bridge on load.
  const query = new URLSearchParams(location.search)
  const bridgeParam = query.get('bridge')
  const bridgeUrl = resolveBridgeUrl(bridgeParam === 'auto' ? null : bridgeParam)
  const autoBridge = bridgeParam === 'auto' || (query.has('auto') && query.get('auto') !== '0')
  /** How long the automatic connect waits for the bridge (sudo password, finding the receiver). */
  const AUTO_BRIDGE_WAIT_MS = 20_000
  let stopReplug: (() => void) | null = null

  /** `waitMs` > 0: keep trying while the bridge isn't up yet or has no receiver yet. */
  async function connectBridge(waitMs = 0) {
    // The bridge takes the receiver away from WebHID: leave a WebHID session first.
    if (session.transportKind !== 'bridge' && (session.phase === 'ready' || session.phase === 'lost' || session.phase === 'restarting')) {
      await session.disconnect()
    }
    const failure: { error: BridgeError | null } = { error: null }
    const deadline = Date.now() + waitMs
    await session.connectWith('bridge', async () => {
      if (waitMs > 0) session.step = 'Waiting for the local bridge…'
      for (;;) {
        try {
          // While waiting, one attempt also waits for the receiver until the deadline, so the
          // bridge doesn't see a new client every few seconds.
          const t = await BridgeTransport.connect(bridgeUrl, Math.max(3000, deadline - Date.now()))
          stopReplug?.()
          // After an unplug or an RX restart the bridge captures the receiver again: reattach.
          stopReplug = t.onReplug(() => {
            if (session.transportKind === 'bridge') void session.reattach(t)
          })
          return t
        } catch (e) {
          // Not listening yet (sudo is still asking for the password): try again shortly.
          if (e instanceof BridgeError && e.kind === 'not-running' && Date.now() + 1000 < deadline) {
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
          if (e instanceof BridgeError) failure.error = e
          throw e
        }
      }
    })
    if (failure.error && session.error) {
      const e = failure.error
      session.error = {
        title: e.title,
        // Opened by `npx mic-console` (a page on this computer), which starts and stops the bridge itself.
        // The hosted page with ?bridge=auto needs `npx mic-console --bridge-only`, which e.message names.
        detail:
          autoBridge && e.kind === 'not-running' && pageContext() === 'loopback'
            ? `No bridge answered at ${bridgeUrl}. It runs while "npx mic-console" runs in your terminal: start it again there, then press Connect through local bridge.`
            : e.message,
      }
    }
  }

  onMount(() => {
    // Development-only simulator: ?mock=a2|a2s|blind|m2s|m2scam|m2
    const mock = import.meta.env.DEV ? query.get('mock') : null
    if (mock) void session.connectMock(mock)
    else if (autoBridge) void connectBridge(AUTO_BRIDGE_WAIT_MS)
  })
</script>

<!-- While the receiver restarts, the overlay is the only interactive area (it is a modal). -->
<div class="shell" inert={session.phase === 'restarting'}>
<AppHeader
  {connected}
  deviceName={connected ? session.displayName : ''}
  {statusText}
  {statusShort}
  {statusTone}
  tabs={allTabs.map(({ route, label }) => ({ route, label }))}
  ondisconnect={connected ? () => session.disconnect() : undefined}
/>

<main class="main" class:with-tabbar={allTabs.length > 1}>
  {#if session.phase === 'lost'}
    <div class="banner-slot">
      <Banner tone="danger" title="Connection to the receiver was lost">
        {lastSeen ? `Last update ${lastSeen}. ` : ''}Values below are frozen. Plug the receiver back in{viaBridge
          ? ' and keep the bridge running'
          : ''}; the page reconnects automatically.
        {#snippet actions()}
          <Button size="sm" variant="secondary" onclick={() => (viaBridge ? connectBridge() : session.reconnect())}>
            Reconnect
          </Button>
          {#if !viaBridge && session.writeOnly}
            <Button size="sm" variant="ghost" onclick={() => connectBridge()}>Connect through local bridge</Button>
          {/if}
        {/snippet}
      </Banner>
    </div>
  {:else if session.phase === 'ready' && session.writeOnly}
    <div class="banner-slot"><WriteOnlyBanner /></div>
  {/if}

  {#if showConnect}
    <ConnectScreen
      supported={isWebHidSupported()}
      busy={session.phase === 'connecting'}
      step={session.step}
      error={session.error}
      known={session.known}
      onconnect={() => session.connect()}
      onreconnect={() => session.reconnect()}
      onbridge={() => connectBridge()}
      via={session.transportKind}
    />
    <p class="audio-only">
      Only want live levels, voice effects or recording? <a href="#/audio">Open Audio</a>. It works without a USB
      control connection.
    </p>
  {:else}
    <!-- Lost: the values stay visible but frozen; only the banner above is interactive. -->
    <div class="page" class:frozen={session.phase === 'lost'} inert={session.phase === 'lost'}>
      {#if router.route === 'overview'}
        <OverviewPage />
      {:else if router.route === 'audio'}
        <AudioPage channelMode={connected ? (session.settings.channelMode ?? null) : null} />
      {:else if router.route === 'settings'}
        <SettingsPage />
      {:else if router.route === 'device'}
        <DevicePage />
      {:else if router.route === 'console'}
        <ConsolePage connected={session.phase === 'ready'} sendRaw={(b) => session.sendRaw(b)} />
      {/if}
    </div>
  {/if}
</main>

{#if allTabs.length > 1}
  <TabBar tabs={allTabs} />
{/if}
</div>

{#if session.phase === 'restarting'}
  <RestartOverlay
    seconds={session.restartCountdown}
    confirmed={session.restartConfirmed}
    slow={session.restartSlow}
    onstop={() => session.stopWaitingForRestart()}
  />
{/if}

<Toaster />

<style>
  .main {
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--space-5) var(--gutter) calc(var(--space-12) + env(safe-area-inset-bottom));
  }
  @media (max-width: 1023px) {
    .main.with-tabbar {
      padding-bottom: calc(var(--tabbar-h) + var(--space-6) + env(safe-area-inset-bottom));
    }
  }
  .banner-slot {
    margin-bottom: var(--space-4);
  }
  .page.frozen {
    opacity: 0.6;
    pointer-events: none;
    filter: saturate(0.6);
  }
  .audio-only {
    text-align: center;
    margin-top: var(--space-5);
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
</style>
