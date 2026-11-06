<script lang="ts">
  /**
   * Device page for the products on the family drivers (LARK A1, LARK M3, LARK MAX 2, MELO P1):
   * Device Information (model, connection, USB ID) and one module per unit of the kit, with its
   * serial number (masked until revealed), firmware version and battery where it is reported:
   * the receiver (and the other receivers of an M3 kit), the mic slots, and the charging case,
   * earphones and remote when they are online. Then the hardware report (untested products) and
   * About. Firmware is never installed from here; destructive actions are absent on untested products.
   */
  import { RefreshCw } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { micNames } from '../overview/family/names.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import type { MicUnit, UnitId } from '../../lib/protocol/app'
  import UntestedPlate from '../shell/UntestedPlate.svelte'
  import UnitPanel from './UnitPanel.svelte'
  import AboutCard from './AboutCard.svelte'
  import HardwareReport from './HardwareReport.svelte'
  import { serialText, versionText } from './identity'
  import { balancedColumns } from '../settings/controls'

  const live = $derived(session.live)
  const writeOnly = $derived(session.writeOnly)
  const ready = $derived(session.phase === 'ready')
  const product = $derived(session.product)

  /** "camera RX, 4CH" from "LARK M3 (camera RX, 4CH)": what tells this model apart. */
  const variant = $derived.by(() => {
    const m = /\(([^)]+)\)\s*$/.exec(session.modelLabel)
    return m ? m[1] : null
  })
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
  /** USB vendor:product, for USB products (the charging case and Bluetooth links have none). */
  const usbId = $derived(
    product && product.idKind !== 'app' && session.transportKind !== 'web-bluetooth'
      ? `${product.vendorId.toString(16).padStart(4, '0')}:${product.productId.toString(16).padStart(4, '0')}`
      : null,
  )

  type Status = 'connected' | 'online' | 'offline' | 'unknown'
  interface Row {
    key: UnitId
    name: string
    sub: string | null
    plate: string
    plateTitle: string
    status: Status
    battery: number | null | undefined
    charging: boolean
    serial: string | null
    version: string | null
  }

  const KIND: Record<string, string> = { 'camera-rx': 'Camera receiver', 'phone-rx': 'Phone receiver' }
  const ROLE: Record<string, string> = { primary: 'Primary', secondary: 'Secondary' }
  const RECEIVERS = ['rx', 'rx2', 'rx3', 'rx4'] as const
  const MICS = ['tx1', 'tx2', 'tx3', 'tx4'] as const
  const OTHERS: { id: UnitId; name: string; plate: string; plateTitle: string }[] = [
    { id: 'box', name: 'Charging case', plate: 'CASE', plateTitle: 'Charging case' },
    { id: 'earL', name: 'Earphone L', plate: 'L', plateTitle: 'Left earphone' },
    { id: 'earR', name: 'Earphone R', plate: 'R', plateTitle: 'Right earphone' },
    { id: 'remote', name: 'Remote', plate: 'RC', plateTitle: 'Remote control' },
  ]

  /** The name the Overview shows (micNames: Mic 1 / 2 share the browser-wide names), with the default under a custom one. */
  function micName(id: UnitId, u?: MicUnit): { name: string; sub: string | null } {
    const name = micNames.name(id, u)
    const fallback = micNames.defaultName(id, u)
    return { name, sub: name !== fallback ? fallback : null }
  }

  function row(u: MicUnit, base: Omit<Row, 'status' | 'battery' | 'charging' | 'serial' | 'version'>, connected = false): Row {
    const online = connected || u.online
    return {
      ...base,
      status: writeOnly ? 'unknown' : connected ? 'connected' : online ? 'online' : 'offline',
      // A battery row only where the unit reports one (phone receivers don't).
      battery: live && online && u.battery !== undefined ? u.battery : undefined,
      charging: !!u.charging,
      serial: serialText(u.serial, online),
      version: versionText(u.version, online),
    }
  }

  const rows = $derived.by((): Row[] => {
    const units = session.micState?.units
    if (!units) return []
    const out: Row[] = []
    // Receivers: this one, and the other receivers of a multi-receiver kit that are on.
    const rxs = RECEIVERS.map((id) => units[id]).filter((u, i): u is MicUnit => !!u && (i === 0 || u.online))
    const multi = rxs.length > 1
    for (const u of rxs) {
      const n = /(\d+)\s*$/.exec(u.label ?? '')?.[1]
      const sub = [multi && u.role ? ROLE[u.role] : null, u.kind ? KIND[u.kind] : null].filter(Boolean).join(' · ')
      out.push(
        row(
          u,
          { key: u.id, name: multi && n ? `Receiver ${n}` : 'Receiver', sub: sub || null, plate: 'RX', plateTitle: 'Receiver' },
          u.id === 'rx',
        ),
      )
    }
    // Mics: every slot the product shows (2 or 4), then any other mic that is on.
    const slots = new Set<UnitId>(session.micSlots)
    for (const id of MICS) {
      const u = units[id]
      if (!u || !(slots.has(id) || u.online)) continue
      const { name, sub } = micName(id, u)
      out.push(row(u, { key: id, name, sub, plate: id.toUpperCase(), plateTitle: `Transmitter ${id.slice(2)}` }))
    }
    // Accessories while they are on.
    for (const o of OTHERS) {
      const u = units[o.id]
      if (!u || !u.online) continue
      out.push(row(u, { key: o.id, name: o.name, sub: null, plate: o.plate, plateTitle: o.plateTitle }))
    }
    return out
  })

  /** Balanced rows of unit modules wide enough for a masked serial number (7 → 3 + 3 + 1, 5 → 3 + 2). */
  let unitsWidth = $state(0)
  const unitColumns = $derived(
    unitsWidth > 0
      ? `repeat(${balancedColumns(rows.length, unitsWidth, 320)}, minmax(0, 1fr))`
      : 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
  )

  // The official Device Information screen re-reads identity on entry.
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
    const mic = session.mic
    if (mic && session.live && session.phase === 'ready' && refreshedFor !== mic) {
      refreshedFor = mic
      void refresh()
    }
  })
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
        <dd>
          <span class="mono model-name">{session.displayName || '–'}</span>
          {#if variant}<span class="variant">{variant}</span>{/if}
          {#if session.untested}<UntestedPlate />{/if}
        </dd>
      </div>
      <div class="spec-item">
        <dt>Connection</dt>
        <dd>{connection ?? '–'}</dd>
      </div>
      {#if usbId}
        <div class="spec-item">
          <dt>USB ID</dt>
          <dd class="mono">{usbId}</dd>
        </div>
      {/if}
    </dl>

    <div class="units" bind:clientWidth={unitsWidth}>
      <Modules columns={unitColumns}>
        {#each rows as u (u.key)}
          <UnitPanel
            channel={u.key === 'rx' ? 'rx' : 'tx1'}
            identity={false}
            plate={u.plate}
            plateTitle={u.plateTitle}
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
      <span class="k">Firmware updates</span><span>Hollyland app</span>
    </p>
  </Panel>

  {#if session.untested}
    <HardwareReport />
  {/if}

  <AboutCard />
</div>

<style>
  .device {
    display: grid;
    min-width: 0;
  }
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
  @media (min-width: 600px) {
    .spec,
    .firmware {
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
  }
  @media (max-width: 599px) {
    .units {
      --module-pad: 0px;
    }
  }
</style>
