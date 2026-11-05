<script lang="ts">
  /**
   * Device page (features.md §6-§10): Device Information, Paired Devices, Firmware (versions
   * only, never flashed from the web), User Manual, Factory Reset and About.
   */
  import { RefreshCw, Eye, EyeOff, TriangleAlert, ExternalLink, BookOpen } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import KeyValue from '../../lib/ui/KeyValue.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import UnitPanel from './UnitPanel.svelte'
  import PairedDevices from './PairedDevices.svelte'
  import AboutCard from './AboutCard.svelte'
  import { serialText, versionText } from './identity'
  import { watchNarrow } from '../settings/feedback'

  const live = $derived(session.live)
  const writeOnly = $derived(session.writeOnly)
  const ready = $derived(session.phase === 'ready')
  const caps = $derived(session.caps)
  const product = $derived(session.product)
  const units = $derived(session.units)

  // User Manual: A2 camera variant (PID 1042) and the M2S (features.md §9, §16.1).
  const showManual = $derived(
    (product?.family === '6118' && session.isCameraVariant) || product?.family === '6302',
  )

  let revealSerial = $state(false)
  let narrow = $state(false)
  $effect(() => watchNarrow('(max-width: 479px)', (v) => (narrow = v)))

  const unitRows = $derived.by(() => {
    const status = (online: boolean): 'connected' | 'offline' | 'unknown' =>
      writeOnly ? 'unknown' : online ? 'connected' : 'offline'
    const rx = units?.rx
    const rxOnline = true // the app always treats the RX as online
    const mics = ([0, 1] as const).map((i) => {
      const u = i === 0 ? units?.tx1 : units?.tx2
      const online = !!u?.online
      const custom = !!prefs.micNames[i]?.trim()
      return {
        key: i === 0 ? 'tx1' : 'tx2',
        channel: (i === 0 ? 'tx1' : 'tx2') as 'tx1' | 'tx2',
        title: prefs.micLabel(i),
        overline: custom ? `Mic ${i + 1}` : `Transmitter ${i + 1}`,
        status: status(online),
        battery: live && online ? (u?.battery ?? null) : undefined,
        charging: !!u?.charging,
        serial: serialText(u?.serial, online),
        version: versionText(u?.version, online),
      }
    })
    return [
      {
        key: 'rx',
        channel: 'rx' as const,
        title: 'RX',
        overline: 'Receiver',
        status: (writeOnly ? 'unknown' : 'connected') as 'connected' | 'offline' | 'unknown',
        battery: live && caps?.rxBattery ? (rx?.battery ?? null) : undefined,
        charging: false, // the official app never animates the camera RX charge
        serial: serialText(rx?.serial, rxOnline),
        version: versionText(rx?.version, rxOnline),
      },
      ...mics,
    ]
  })

  // The official Device Information screen force-refreshes identity on entry.
  let refreshing = $state(false)
  async function refresh() {
    if (refreshing) return
    refreshing = true
    try {
      await session.refreshIdentity()
    } finally {
      refreshing = false
    }
  }
  let refreshedFor: unknown = null
  $effect(() => {
    const dev = session.device
    if (dev && session.live && session.phase === 'ready' && refreshedFor !== dev) {
      refreshedFor = dev
      void refresh()
    }
  })

  // ---- Factory reset ----
  let resetOpen = $state(false)
  let resetting = $state(false)
  async function doReset() {
    resetting = true
    try {
      await session.factoryReset()
    } finally {
      resetting = false
      resetOpen = false
    }
  }
</script>

<div class="page">
  <div class="intro">
    <h1>Device</h1>
    <p>Model, serial numbers, firmware, pairing and maintenance for the connected kit.</p>
  </div>

  <Card title="Device Information" overline="Identity">
    {#snippet header()}
      <Button
        size="sm"
        variant="secondary"
        loading={refreshing}
        disabled={!live || !ready}
        title={live ? 'Read serial numbers and firmware versions again' : "Can't be read on this system"}
        onclick={refresh}
      >
        {#snippet icon()}<RefreshCw />{/snippet}
        Refresh
      </Button>
    {/snippet}

    <div class="model-row">
      <dl class="model">
        <dt>Model</dt>
        <!-- The official app shows "LARK A2" for both A2 receivers (features.md §2, §6). -->
        <dd>
          {session.displayName || '--'}{#if product?.family === '6118' && session.isCameraVariant}{' '}<span
              class="variant">(camera receiver)</span
            >{/if}
        </dd>
      </dl>
      {#if !writeOnly}
        <Button size="sm" variant="ghost" aria-pressed={revealSerial} onclick={() => (revealSerial = !revealSerial)}>
          {#snippet icon()}{#if revealSerial}<EyeOff />{:else}<Eye />{/if}{/snippet}
          {revealSerial ? 'Hide serial numbers' : 'Show serial numbers'}
        </Button>
      {/if}
    </div>

    {#if writeOnly}
      <div class="notice">
        <Banner tone="info" title="Identity can't be read here">
          This system discards the receiver's replies, so serial numbers and firmware versions show as "--". Chrome on
          Linux or ChromeOS, or the local bridge, can read them.
        </Banner>
      </div>
    {/if}

    <div class="units">
      {#each unitRows as u (u.key)}
        <UnitPanel
          channel={u.channel}
          title={u.title}
          overline={u.overline}
          status={u.status}
          battery={u.battery}
          charging={u.charging}
          serial={u.serial}
          version={u.version}
          {revealSerial}
        />
      {/each}
    </div>
  </Card>

  <div class="grid">
    <div class="col">
      <PairedDevices />

      <Card title="Firmware" overline="Versions">
        <dl>
          {#each unitRows as u (u.key)}
            <KeyValue label={u.key === 'rx' ? 'RX' : u.title} value={u.version ? `V${u.version}` : null} mono />
          {/each}
        </dl>
        <p class="note">
          Firmware updates are done with the official HollyAudio app on a phone. Mic Console never installs firmware: an
          interrupted update can leave a receiver or mic unusable.
        </p>
      </Card>

      {#if showManual}
        <Card title="User Manual" overline="Help">
          <p class="note first">Manuals, quick-start guides and downloads for {session.displayName || 'your kit'} are on Hollyland's site.</p>
          <div class="links">
            <a class="link" href="https://www.hollyland.com/download" target="_blank" rel="noopener noreferrer">
              <BookOpen size={16} aria-hidden="true" />
              Manuals and downloads
              <ExternalLink size={14} aria-hidden="true" />
              <span class="visually-hidden">(opens in a new tab)</span>
            </a>
            <a class="link" href="https://www.hollyland.com/support" target="_blank" rel="noopener noreferrer">
              Product support
              <ExternalLink size={14} aria-hidden="true" />
              <span class="visually-hidden">(opens in a new tab)</span>
            </a>
          </div>
        </Card>
      {/if}
    </div>

    <div class="col">
      <AboutCard />
    </div>
  </div>

  {#if caps?.factoryReset}
    <section class="danger-zone" aria-labelledby="danger-title">
      <h2 id="danger-title" class="overline">Danger zone</h2>
      <div class="danger-card">
        <SettingRow
          stacked={narrow}
          label="Factory Reset"
          description={writeOnly
            ? "Restores the receiver's factory settings. This system can't confirm the reset."
            : "Restores the receiver's factory settings. Values remembered in this browser are cleared too."}
        >
          {#snippet control()}
            <Button variant="danger-outline" disabled={!ready} onclick={() => (resetOpen = true)}>Factory Reset</Button>
          {/snippet}
        </SettingRow>
      </div>
    </section>
  {/if}
</div>

<Dialog open={resetOpen} title="Factory Reset" tone="danger" blocking={resetting} onclose={() => (resetOpen = false)}>
  {#snippet icon()}<TriangleAlert size={22} />{/snippet}
  <p>Factory reset will erase some data. Continue?</p>
  {#if writeOnly}
    <p class="dlg-note">This system can't confirm the result.</p>
  {/if}
  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <Button variant="secondary" autofocus disabled={resetting} onclick={() => (resetOpen = false)}>Cancel</Button>
    <Button variant="danger" loading={resetting} onclick={doReset}>Confirm</Button>
  {/snippet}
</Dialog>

<style>
  .page {
    display: grid;
    gap: var(--space-5);
  }
  .intro h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-2xl);
  }
  .intro p {
    color: var(--color-text-muted);
    max-width: 70ch;
    margin-top: var(--space-1);
  }
  .model-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    margin-bottom: var(--space-3);
  }
  .model {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }
  .model dt {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .model dd {
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }
  .variant {
    font-size: var(--text-sm);
    font-weight: var(--weight-regular);
    color: var(--color-text-muted);
  }
  .notice {
    margin-bottom: var(--space-3);
  }
  .units {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
  }
  .grid {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  .col {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
  }
  @media (min-width: 900px) {
    .grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  dl {
    margin: 0;
  }
  .note {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-muted);
  }
  .note.first {
    margin-top: 0;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-5);
    margin-top: var(--space-2);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--hit-min);
    font-weight: var(--weight-medium);
  }
  .danger-zone {
    display: grid;
    gap: var(--space-2);
  }
  .danger-card {
    padding: var(--space-1) var(--space-5);
    border-radius: var(--radius-lg);
    border: 1px solid color-mix(in oklab, var(--color-danger) 40%, var(--color-border));
    background: var(--color-surface-1);
  }
  .dlg-note {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  @media (max-width: 479px) {
    .danger-card {
      padding: var(--space-1) var(--space-4);
    }
  }
</style>
