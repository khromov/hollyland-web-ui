<script lang="ts">
  /**
   * One unit (RX, Mic 1, Mic 2) of "Device Information" as a module of the spec sheet: SN
   * (masked until revealed) and Firmware Version in mono, plus the battery where it is reported.
   * A value that can't be read shows "–".
   */
  import KeyValue from '../../lib/ui/KeyValue.svelte'
  import BatteryCells from '../../lib/ui/BatteryCells.svelte'
  import UnitTitle from './UnitTitle.svelte'
  import UnitStatus from './UnitStatus.svelte'
  import { uid } from '../../lib/ui/field'

  interface Props {
    channel: 'rx' | 'tx1' | 'tx2'
    name: string
    sub?: string | null
    status: 'connected' | 'online' | 'offline' | 'unknown'
    /** Battery percent (camera RX / online TX), null when not readable, undefined to hide the row. */
    battery?: number | null
    charging?: boolean
    serial: string | null
    version: string | null
  }
  let { channel, name, sub = null, status: unitStatus, battery, charging = false, serial, version }: Props = $props()

  const headingId = uid('unit')
</script>

<section class="unit" aria-labelledby={headingId}>
  <UnitTitle {channel} {name} {sub} id={headingId} led={unitStatus === 'offline' ? 'off' : 'on'}>
    {#snippet status()}<UnitStatus status={unitStatus} />{/snippet}
  </UnitTitle>
  <dl>
    <KeyValue label="SN" value={serial} mono masked copyable />
    <KeyValue label="Firmware Version" value={version} mono />
    {#if battery !== undefined}
      <div class="kv">
        <dt>Battery</dt>
        <dd><BatteryCells percent={battery} {charging} label="{name} battery" /></dd>
      </div>
    {/if}
  </dl>
</section>

<style>
  .unit {
    display: grid;
    align-content: start;
    gap: 6px;
    min-width: 0;
    padding: 18px var(--module-pad) 14px;
  }
  dl {
    margin: 0;
  }
  dl :global(.kv) {
    grid-template-columns: minmax(84px, 38%) minmax(0, 1fr);
  }
  .kv {
    display: grid;
    align-items: center;
    gap: 16px;
    min-height: 44px;
    padding: 6px 0;
    border-top: 1px solid var(--rule-soft);
  }
  dt {
    font-size: 13px;
    color: var(--ink-2);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  @media (max-width: 599px) {
    .unit {
      padding: 12px 0 10px;
    }
  }
</style>
