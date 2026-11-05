<script lang="ts">
  /** Channel identity tag ("TX1", "TX2", "RX"). The text is always present, so identity never relies on colour. */
  interface Props {
    channel: 'tx1' | 'tx2' | 'rx'
  }
  let { channel }: Props = $props()
  const text = $derived(channel.toUpperCase())
</script>

<span class="badge {channel}">{text}</span>

<style>
  .badge {
    display: inline-grid;
    place-items: center;
    min-width: 34px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    font-size: var(--text-2xs);
    line-height: 1;
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    flex: none;
  }
  .tx1 {
    background: var(--color-tx1);
    color: var(--color-on-tx1);
  }
  .tx2 {
    background: var(--color-tx2);
    color: var(--color-on-tx2);
  }
  .rx {
    background: var(--color-rx);
    color: var(--color-on-rx);
  }
</style>
