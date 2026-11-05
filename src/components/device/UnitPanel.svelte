<script lang="ts">
  /** One unit (RX, Mic 1, Mic 2) inside "Device Information": SN and Firmware Version. */
  import KeyValue from '../../lib/ui/KeyValue.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import Battery from '../../lib/ui/Battery.svelte'
  import ChannelBadge from './ChannelBadge.svelte'
  import { maskSerial } from './identity'

  interface Props {
    channel: 'rx' | 'tx1' | 'tx2'
    title: string
    overline: string
    status: 'connected' | 'offline' | 'unknown'
    /** Battery percent to show (camera RX / online TX), or undefined to hide the row. */
    battery?: number | null
    charging?: boolean
    serial: string | null
    version: string | null
    revealSerial: boolean
  }
  let { channel, title, overline, status, battery, charging = false, serial, version, revealSerial }: Props = $props()

  const headingId = `unit-${Math.random().toString(36).slice(2)}`
  const shownSerial = $derived(serial ? (revealSerial ? serial : maskSerial(serial)) : null)
</script>

<section class="unit {channel}" class:offline={status === 'offline'} aria-labelledby={headingId}>
  <header>
    <ChannelBadge {channel} />
    <div class="titles">
      <div class="overline">{overline}</div>
      <h3 id={headingId}>{title}</h3>
    </div>
    {#if status === 'connected'}
      <Chip tone="success">Connected</Chip>
    {:else if status === 'offline'}
      <Chip>Offline</Chip>
    {:else}
      <Chip>Unknown</Chip>
    {/if}
  </header>
  <dl>
    <KeyValue label="SN" value={shownSerial} mono copyable={revealSerial} />
    <KeyValue label="Firmware Version" value={version} mono />
    {#if battery !== undefined}
      <div class="kv">
        <dt>Battery</dt>
        <dd><Battery percent={battery} {charging} label="{title} battery" /></dd>
      </div>
    {/if}
  </dl>
</section>

<style>
  .unit {
    position: relative;
    padding: var(--space-3) var(--space-4) var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    overflow: hidden;
    transition: opacity var(--dur-fast);
  }
  .unit::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 3px;
    background: var(--channel-color);
  }
  .rx {
    --channel-color: var(--color-rx);
  }
  .tx1 {
    --channel-color: var(--color-tx1);
  }
  .tx2 {
    --channel-color: var(--color-tx2);
  }
  /* Offline mics are dimmed like the official cards, but only the decoration (stripe, badge):
     the text keeps its contrast and the "Offline" chip carries the state. */
  .offline {
    background: color-mix(in oklab, var(--color-surface-2) 60%, var(--color-bg));
  }
  .offline::before {
    opacity: 0.35;
  }
  .offline :global(.badge) {
    opacity: 0.45;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-1);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    font-size: var(--text-md);
    line-height: var(--leading-md);
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dl {
    margin: 0;
  }
  .kv {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    min-height: 36px;
    border-top: 1px solid var(--color-border);
  }
  dt {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  dd {
    margin: 0;
  }
</style>
