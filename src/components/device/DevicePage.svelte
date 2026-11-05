<script lang="ts">
  /**
   * Device page (features.md §6-§10): Device Information, Paired Devices, Firmware (versions
   * only, never flashed from the web), User Manual, About and Factory Reset. Drawn as a spec
   * sheet: label rail, hairline-divided modules, measured values and IDs in mono. Factory Reset
   * sits alone at the bottom under a strong ink rule.
   */
  import { RefreshCw, ExternalLink } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import { uid } from '../../lib/ui/field'
  import UnitPanel from './UnitPanel.svelte'
  import PairedDevices from './PairedDevices.svelte'
  import AboutCard from './AboutCard.svelte'
  import { serialText, versionText } from './identity'

  const resetDescId = uid('reset-desc')

  const live = $derived(session.live)
  const writeOnly = $derived(session.writeOnly)
  const ready = $derived(session.phase === 'ready')
  const caps = $derived(session.caps)
  const product = $derived(session.product)
  const units = $derived(session.units)

  // User Manual: A2 camera variant (PID 1042, the A2S) and the M2S (features.md §9, §16.1).
  const showManual = $derived((product?.family === '6118' && session.isCameraVariant) || product?.family === '6302')

  const connection = $derived.by(() => {
    const kind = session.transportKind
    if (!kind) return null
    const VIA: Record<string, string> = {
      webhid: 'USB',
      'webhid-feature': 'USB',
      bridge: 'Local bridge',
      'web-bluetooth': 'Bluetooth',
      mock: 'Simulator',
    }
    return VIA[kind] ?? kind
  })
  const usbId = $derived(
    product
      ? `${product.vendorId.toString(16).padStart(4, '0')}:${product.productId.toString(16).padStart(4, '0')}`
      : null,
  )

  type UnitStatusKind = 'connected' | 'online' | 'offline' | 'unknown'
  const unitRows = $derived.by(() => {
    const rx = units?.rx
    const rxOnline = true // the app always treats the RX as online
    const mics = ([0, 1] as const).map((i) => {
      const u = i === 0 ? units?.tx1 : units?.tx2
      const online = !!u?.online
      const custom = !!prefs.micNames[i]?.trim()
      return {
        key: i === 0 ? 'tx1' : 'tx2',
        channel: (i === 0 ? 'tx1' : 'tx2') as 'tx1' | 'tx2',
        name: prefs.micLabel(i),
        sub: custom ? `Mic ${i + 1}` : null,
        status: (writeOnly ? 'unknown' : online ? 'online' : 'offline') as UnitStatusKind,
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
        name: 'Receiver',
        sub: null,
        status: (writeOnly ? 'unknown' : 'connected') as UnitStatusKind,
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

  // ---- Factory reset: typed confirmation ----
  const CONFIRM_WORD = 'reset'
  let resetOpen = $state(false)
  let resetting = $state(false)
  let typed = $state('')
  const typedOk = $derived(typed.trim().toLowerCase() === CONFIRM_WORD)
  function openReset() {
    typed = ''
    resetOpen = true
  }
  async function doReset() {
    if (!typedOk) return
    resetting = true
    try {
      await session.factoryReset()
    } finally {
      resetting = false
      resetOpen = false
    }
  }
</script>

<div class="device">
  <h1 class="visually-hidden">Device</h1>

  <Panel title="Device Information">
    {#snippet aside()}
      <Key
        size="sm"
        loading={refreshing}
        disabled={!live || !ready}
        title={live ? 'Read serial numbers and firmware versions again' : 'Status unavailable'}
        onclick={refresh}
      >
        {#snippet icon()}<RefreshCw />{/snippet}
        Read again
      </Key>
    {/snippet}

    <dl class="spec">
      <div class="spec-item model">
        <dt>Model</dt>
        <!-- The official app shows "LARK A2" for both A2 receivers (features.md §2, §6). -->
        <dd>
          <span class="mono model-name">{session.displayName || '–'}</span>
          {#if product?.family === '6118' && session.isCameraVariant}<span class="variant">Camera receiver</span>{/if}
        </dd>
      </div>
      <div class="spec-item">
        <dt>Connection</dt>
        <dd>{connection ?? '–'}</dd>
      </div>
      <div class="spec-item">
        <dt>USB ID</dt>
        <dd class="mono">{usbId ?? '–'}</dd>
      </div>
    </dl>

    <div class="units">
      <Modules min="260px">
        {#each unitRows as u (u.key)}
          <UnitPanel
            channel={u.channel}
            name={u.name}
            sub={u.sub}
            status={u.status}
            battery={u.battery}
            charging={u.charging}
            serial={u.serial}
            version={u.version}
          />
        {/each}
      </Modules>
    </div>

    <p class="firmware" title="Hollyland Web UI never installs firmware: an interrupted update can leave a unit unusable">
      <span class="k">Firmware updates</span><span>HollyAudio app</span>
    </p>
  </Panel>

  <PairedDevices />

  {#if showManual}
    <Panel title="User Manual">
      <div class="links">
        <a class="mc-key mc-key--sm" href="https://www.hollyland.com/download" target="_blank" rel="noopener noreferrer">
          Manuals and downloads
          <ExternalLink size={15} aria-hidden="true" />
          <span class="visually-hidden">(opens in a new tab)</span>
        </a>
        <a class="mc-key mc-key--sm mc-key--quiet" href="https://www.hollyland.com/support" target="_blank" rel="noopener noreferrer">
          Product support
          <ExternalLink size={15} aria-hidden="true" />
          <span class="visually-hidden">(opens in a new tab)</span>
        </a>
      </div>
    </Panel>
  {/if}

  <AboutCard />

  {#if caps?.factoryReset}
    <Panel title="Factory Reset" class="danger-zone">
      <div class="danger">
        <Key variant="danger-outline" disabled={!ready} title="Also clears the values remembered in this browser" onclick={openReset}
          >Factory Reset</Key
        >
      </div>
    </Panel>
  {/if}
</div>

<Dialog
  open={resetOpen}
  title="Factory Reset"
  tone="danger"
  blocking={resetting}
  onclose={() => (resetOpen = false)}
  describedby={resetDescId}
>
  <p id={resetDescId}>This erases the receiver's settings.</p>
  <label class="typed">
    <span>Type <b class="mono">{CONFIRM_WORD}</b> to confirm</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      autofocus
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      bind:value={typed}
      disabled={resetting}
      onkeydown={(e) => e.key === 'Enter' && typedOk && doReset()}
    />
  </label>
  {#snippet actions()}
    <Button variant="secondary" disabled={resetting} onclick={() => (resetOpen = false)}>Cancel</Button>
    <Button variant="danger" loading={resetting} disabled={!typedOk} onclick={doReset}>Confirm</Button>
  {/snippet}
</Dialog>

<style>
  .device {
    display: grid;
    min-width: 0;
  }
  /* Spec strip: label above value, like the stats row under a channel. */
  .spec {
    display: flex;
    flex-wrap: wrap;
    gap: 14px 40px;
    padding: 4px 0 18px;
  }
  .spec-item {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  dt {
    font-size: 13px;
    color: var(--ink-2);
  }
  dd {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    min-height: 28px;
    align-content: center;
    font-size: 14px;
  }
  dd.mono {
    font-size: 14px;
  }
  .model-name {
    font-size: 22px;
    font-weight: 500;
    line-height: 1.1;
  }
  .variant {
    font-size: 13px;
    color: var(--ink-2);
  }
  .units {
    min-width: 0;
    border-top: 1px solid var(--rule);
  }
  .firmware {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 16px;
    padding: 14px 0 18px;
    border-top: 1px solid var(--rule);
    font-size: 14px;
  }
  .firmware .k {
    font-size: 13px;
    color: var(--ink-2);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0 20px;
  }
  .links :global(svg) {
    color: var(--ink-2);
  }
  .danger {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    padding: 4px 0 24px;
  }
  /* Factory Reset sits alone at the bottom, under the one strong ink rule of the page. */
  .device :global(.danger-zone) {
    margin-top: -1px;
    border-top: 1.5px solid var(--ink);
  }
  .typed {
    display: grid;
    gap: 6px;
    margin-top: 14px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .typed b {
    color: var(--ink);
    font-weight: 600;
  }
  .typed input {
    height: var(--hit);
    padding: 0 12px;
    border-radius: var(--r-key);
    border: 1px solid var(--key-edge);
    background: var(--key);
    box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.12);
    font: 500 14px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink);
  }
  .typed input:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  @media (min-width: 600px) {
    .spec,
    .firmware,
    .links,
    .danger {
      padding-inline: var(--module-pad);
    }
    .spec {
      padding-top: 6px;
    }
  }
  @media (min-width: 1280px) {
    .spec {
      padding-top: 22px;
    }
    .links,
    .danger {
      padding-top: 24px;
    }
  }
  @media (max-width: 599px) {
    .units {
      --module-pad: 0px;
    }
  }
</style>
