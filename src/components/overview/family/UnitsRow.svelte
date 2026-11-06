<script lang="ts">
  /**
   * The kit around the receiver, one cell each, hairline-divided like the receiver strip:
   *  - receivers: the connected one when it reports a battery (camera RX) or a role; on a LARK M3
   *    with several receivers every receiver that is on, with its Primary / Secondary plate
   *  - charging case, earphones (L / R, only while one is connected), remote
   * Status exists only when replies arrive: nothing is drawn on a write-only link.
   */
  import type { MicUnit, UnitId } from '../../../lib/protocol'
  import BatteryCells from '../../../lib/ui/BatteryCells.svelte'
  import Lamp from '../../../lib/ui/Lamp.svelte'
  import Tag from '../../../lib/ui/Tag.svelte'
  import { session } from '../../../lib/state/session.svelte'

  interface Cell {
    key: string
    title: string
    /** Primary / Secondary. */
    plate?: string
    /** The unit this page is connected to (several receivers). */
    connected?: boolean
    batteries: { side?: string; unit: MicUnit }[]
    /** Shown instead of a battery. */
    word?: string
  }

  const units = $derived(session.micState?.units ?? null)
  const product = $derived(session.product)
  /** This page talks to the charging case (MAX 2 over Bluetooth): the case is the connected unit. */
  const viaCase = $derived(product?.deviceKind === 'case')

  const cells = $derived.by((): Cell[] => {
    const u = units
    if (!u || !session.live) return []
    const out: Cell[] = []
    const extraRx = (['rx2', 'rx3', 'rx4'] as UnitId[]).map((id) => u[id]).filter((x): x is MicUnit => !!x?.online)
    const multi = extraRx.length > 0
    const rx = u.rx
    const role = (x: MicUnit) => (x.role === 'primary' ? 'Primary' : x.role === 'secondary' ? 'Secondary' : undefined)
    const hasBattery = (x: MicUnit) => typeof x.battery === 'number' && x.battery > 0
    if (multi || rx.role === 'secondary' || hasBattery(rx)) {
      out.push({
        key: 'rx',
        title: multi || rx.role === 'secondary' ? (rx.label ?? 'RX') : rx.kind === 'camera-rx' ? 'Camera RX' : 'RX',
        plate: multi || rx.role === 'secondary' ? role(rx) : undefined,
        connected: multi && !viaCase,
        batteries: hasBattery(rx) ? [{ unit: rx }] : [],
        word: hasBattery(rx) ? undefined : viaCase ? 'Online' : 'Connected',
      })
    }
    for (const x of extraRx) {
      out.push({
        key: x.id,
        title: x.label ?? x.id.toUpperCase(),
        plate: role(x),
        batteries: hasBattery(x) ? [{ unit: x }] : [],
        word: hasBattery(x) ? undefined : 'Online',
      })
    }
    if (u.box?.online) {
      out.push({
        key: 'box',
        title: 'Charging case',
        batteries: hasBattery(u.box) || u.box.battery === 0 ? [{ unit: u.box }] : [],
        word: hasBattery(u.box) || u.box.battery === 0 ? undefined : 'Online',
      })
    }
    const ears = (['earL', 'earR'] as const).map((id) => u[id]).filter((x): x is MicUnit => !!x)
    if (ears.some((e) => e.online)) {
      out.push({
        key: 'ears',
        title: 'Earphones',
        batteries: ears.map((e) => ({ side: e.id === 'earL' ? 'L' : 'R', unit: e })),
      })
    }
    if (u.remote?.online) {
      out.push({
        key: 'remote',
        title: 'Remote',
        batteries: hasBattery(u.remote) ? [{ unit: u.remote }] : [],
        word: hasBattery(u.remote) ? undefined : 'Online',
      })
    }
    return out
  })
</script>

{#if cells.length}
  <ul class="units" aria-label="Kit">
    {#each cells as c (c.key)}
      <li class="cell">
        <div class="t">
          {#if c.connected}<Lamp color="live" size="sm" label="Connected" />{/if}
          <span class="name">{c.title}</span>
          {#if c.plate}<Tag>{c.plate}</Tag>{/if}
        </div>
        <div class="v">
          {#each c.batteries as b (b.side ?? 'one')}
            <span class="bat">
              {#if b.side}<span class="side">{b.side}</span>{/if}
              {#if b.unit.online}
                <BatteryCells
                  percent={typeof b.unit.battery === 'number' && b.unit.battery > 0 ? b.unit.battery : null}
                  charging={!!b.unit.charging}
                  chargingText={false}
                  label="{c.title}{b.side ? ` ${b.side}` : ''} battery"
                />
              {:else}
                <span class="off">Offline</span>
              {/if}
            </span>
          {/each}
          {#if c.word}<span class="word">{c.word}</span>{/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .units {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: hidden;
    border-bottom: 1px solid var(--rule);
  }
  .cell {
    display: grid;
    align-content: start;
    gap: 6px;
    min-width: 0;
    padding: 12px var(--module-pad) 14px;
    box-shadow:
      -1px 0 0 var(--rule),
      0 -1px 0 var(--rule);
  }
  .t {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    min-width: 0;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 620;
    color: var(--ink);
  }
  .v {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    min-height: 22px;
    font-size: 13px;
  }
  .bat {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .side {
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-2);
  }
  .word,
  .off {
    color: var(--ink-2);
  }
  @media (max-width: 599px) {
    .units {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .cell {
      padding-inline: var(--gutter);
    }
  }
</style>
