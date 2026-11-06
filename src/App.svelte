<script lang="ts">
  import { onMount, type Component } from 'svelte'
  import Toaster from './lib/ui/Toaster.svelte'
  import AppHeader from './components/AppHeader.svelte'
  import type { HeaderTab } from './components/shell/types'
  import TabBar from './components/TabBar.svelte'
  import ConnectScreen from './components/ConnectScreen.svelte'
  import RestartOverlay from './components/RestartOverlay.svelte'
  import WriteOnlyBanner from './components/WriteOnlyBanner.svelte'
  import LostBand from './components/shell/LostBand.svelte'
  import LinkStatus from './components/shell/LinkStatus.svelte'
  import UntestedNotice from './components/shell/UntestedNotice.svelte'
  import OverviewPage from './components/overview/OverviewPage.svelte'
  import SettingsPage from './components/settings/SettingsPage.svelte'
  import DevicePage from './components/device/DevicePage.svelte'
  import AudioPage from './components/audio/AudioPage.svelte'
  import ConsolePage from './components/console/ConsolePage.svelte'
  import { session, type ExtraPage } from './lib/state/session.svelte'
  import { router, type Route } from './lib/state/router.svelte'
  import { prefs } from './lib/state/prefs.svelte'
  import { BridgeError, BridgeTransport, bridgeStartSentence, isWebHidSupported, pageContext, resolveBridgeUrl } from './lib/protocol/app'
  import { link } from './components/shell/link.svelte'
  import { theme } from './components/shell/theme.svelte'

  theme.syncChrome()

  const connected = $derived(link.connected)

  // Pages only some products have (session.extraPages): each one lives at
  // src/components/<page>/<Page>Page.svelte and appears here once that file exists.
  const extraPageModules = import.meta.glob<{ default: Component }>(
    ['./components/mixer/MixerPage.svelte', './components/timecode/TimecodePage.svelte', './components/monitoring/MonitoringPage.svelte'],
    { eager: true },
  )
  const EXTRA_PAGE: Record<ExtraPage, { label: string; path: string }> = {
    mixer: { label: 'Mixer', path: './components/mixer/MixerPage.svelte' },
    timecode: { label: 'Timecode', path: './components/timecode/TimecodePage.svelte' },
    monitoring: { label: 'Monitoring', path: './components/monitoring/MonitoringPage.svelte' },
  }
  const extraPages = $derived(session.extraPages.filter((p) => !!extraPageModules[EXTRA_PAGE[p].path]))
  const extraTab = (p: ExtraPage): HeaderTab => ({ route: p, label: EXTRA_PAGE[p].label })
  /** The page component of an extra route, when this product has that page. */
  function extraPageOf(route: Route): Component | null {
    const p = extraPages.find((x) => x === route)
    return p ? (extraPageModules[EXTRA_PAGE[p].path]?.default ?? null) : null
  }

  // Without a device, only Audio (and Console in developer mode) make sense; everything else
  // shows the connect screen.
  const showConnect = $derived(!connected && router.route !== 'audio' && router.route !== 'console')

  const tabs = $derived<HeaderTab[]>([
    ...(connected
      ? [
          { route: 'overview' as const, label: 'Overview' },
          ...(extraPages.includes('mixer') ? [extraTab('mixer')] : []),
          { route: 'audio' as const, label: 'Audio' },
          ...extraPages.filter((p) => p !== 'mixer').map(extraTab),
          { route: 'settings' as const, label: 'Settings' },
          { route: 'device' as const, label: 'Device' },
        ]
      : [
          { route: 'overview' as const, label: 'Connect' },
          { route: 'audio' as const, label: 'Audio' },
        ]),
    ...(prefs.developer ? [{ route: 'console' as const, label: 'Console' }] : []),
  ])
  const currentTab = $derived(
    showConnect ? 'Connect' : (tabs.find((t) => t.route === router.route)?.label ?? ''),
  )

  // Optional local USB bridge (docs/BRIDGE.md): full status where the browser can't read the receiver.
  // `?bridge=<port>` points the page at a bridge started with --port. `npx hollyland-web-ui` opens the
  // page with `?bridge=auto` (or `?bridge=<port>&auto=1`): connect through the bridge on load.
  const query = new URLSearchParams(location.search)
  const bridgeParam = query.get('bridge')
  const bridgeUrl = resolveBridgeUrl(bridgeParam === 'auto' ? null : bridgeParam)
  /** "127.0.0.1:47321", for the Connect page. */
  const bridgeAddress = (() => {
    try {
      return new URL(bridgeUrl).host
    } catch {
      return bridgeUrl
    }
  })()
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
        // Opened by `npx hollyland-web-ui` (a page on this computer), which starts and stops the bridge itself.
        // Otherwise the Connect page prints the start command right above the error, so the
        // detail only says what to do, not the command again.
        detail:
          e.kind === 'not-running'
            ? autoBridge && pageContext() === 'loopback'
              ? `Run "npx hollyland-web-ui" again in your terminal.`
              : 'Start the bridge, then retry.'
            : e.message.replace(` ${bridgeStartSentence()}.`, ' Start it, then retry.'),
      }
    }
  }

  // Development-only design-system style guide at #/styleguide (not part of production builds).
  let devHash = $state(import.meta.env.DEV ? location.hash : '')
  if (import.meta.env.DEV) window.addEventListener('hashchange', () => (devHash = location.hash))

  onMount(() => {
    // Development-only simulator: ?mock=<preset id> for every registry mock preset
    // (a2, a2s, blind, m2, m2s, m2scam, a1, a1-4mic, m3, m3cam4, max2, max2box, melo …).
    const mock = import.meta.env.DEV ? query.get('mock') : null
    if (mock) void session.connectMock(mock)
    else if (autoBridge) void connectBridge(AUTO_BRIDGE_WAIT_MS)
  })
</script>

{#if import.meta.env.DEV && devHash === '#/styleguide'}
  {#await import('./components/styleguide/StyleGuide.svelte') then m}<m.default />{/await}
{:else}
  <!-- While the receiver restarts, the overlay is the only interactive area (it is a modal). -->
  <div class="shell" inert={session.phase === 'restarting'}>
    <AppHeader {tabs} current={currentTab} ondisconnect={connected ? () => session.disconnect() : undefined} />

    {#if session.phase === 'ready' && session.live}
      <LinkStatus variant="band" />
    {/if}

    <!-- One strip at most, by priority: the lost link, the write-only link (which also carries the
         untested-model words on a first connection), the untested-model notice. -->
    {#if session.phase === 'lost'}
      <div class="band">
        <LostBand onreconnect={() => (link.viaBridge ? connectBridge() : session.reconnect())} onbridge={() => connectBridge()} />
      </div>
    {:else if session.phase === 'ready' && session.writeOnly}
      <div class="band"><WriteOnlyBanner onbridge={() => connectBridge()} /></div>
    {:else if session.untestedNotice}
      <div class="band"><UntestedNotice /></div>
    {/if}

    <main class="main">
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
          bridgeAddress={bridgeAddress}
        />
      {:else}
        <!-- Lost: the values stay visible but frozen; only the band above is interactive. -->
        <div class="page" class:frozen={session.phase === 'lost'} inert={session.phase === 'lost'}>
          {#if router.route === 'overview'}
            <OverviewPage />
          {:else if router.route === 'audio'}
            <AudioPage channelMode={connected ? session.usbChannelMode : null} />
          {:else if router.route === 'settings'}
            <SettingsPage />
          {:else if router.route === 'device'}
            <DevicePage />
          {:else if router.route === 'console'}
            <ConsolePage connected={session.phase === 'ready'} sendRaw={(b) => session.sendRaw(b)} />
          {:else}
            {@const ExtraPageView = extraPageOf(router.route)}
            {#if ExtraPageView}
              <ExtraPageView />
            {:else}
              <OverviewPage />
            {/if}
          {/if}
        </div>
      {/if}
    </main>

    <LinkStatus variant="line" />
    {#if tabs.length > 1}
      <TabBar {tabs} current={currentTab} />
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
{/if}

<Toaster />

<style>
  /* The faceplate: header, optional band, the page (absorbs spare height), status line.
     Pages render inside .page, a column flex box: a page root with flex: 1 fills the window
     between the header and the status line (the Overview meters grow on tall screens). */
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--chassis);
  }
  .main {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0 var(--gutter);
  }
  .page {
    flex: 1 0 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  /* Frozen after a lost link: inert and greyed (no fading, so text keeps its contrast). */
  .page.frozen {
    filter: grayscale(1);
  }
  .band {
    padding: 12px var(--gutter) 0;
  }
  @media (max-width: 599px) {
    .band {
      padding-top: 12px;
    }
  }

  /* Where the toasts sit: above the status line, or above the phone tab bar. */
  :global(:root) {
    --toast-offset: calc(var(--status-h) + 12px);
  }
  @media (max-width: 599px) {
    :global(:root) {
      --toast-offset: calc(var(--tabbar-h) + 12px);
    }
  }
</style>
