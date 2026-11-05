<script lang="ts">
  /** Disclaimer, protocol notes and the platform support summary. */
  import { session } from '../../lib/state/session.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import KeyValue from '../../lib/ui/KeyValue.svelte'

  const transport = $derived(
    session.transportKind === 'webhid'
      ? 'WebHID'
      : session.transportKind === 'mock'
        ? 'Simulator (development)'
        : session.transportKind === 'bridge'
          ? 'Local bridge'
          : (session.transportKind ?? null),
  )
  const mode = $derived(session.live ? 'Live (read and write)' : session.writeOnly ? 'Write-only' : null)
  const usbId = $derived(
    session.product
      ? `${session.product.vendorId.toString(16).padStart(4, '0')}:${session.product.productId.toString(16).padStart(4, '0')}`
      : null,
  )

  const PLATFORMS: { name: string; tone: 'success' | 'warning' | 'neutral'; status: string; note: string }[] = [
    {
      name: 'Chrome or Edge on Linux and ChromeOS',
      tone: 'success',
      status: 'Live',
      note: 'Reads and writes everything. Linux needs a udev rule for the receiver.',
    },
    {
      name: 'Chrome or Edge on macOS and Windows',
      tone: 'warning',
      status: 'Write-only',
      note: "The OS drops the receiver's replies: settings can be sent, but nothing can be read.",
    },
    {
      name: 'macOS with the local bridge',
      tone: 'success',
      status: 'Live',
      note: "Optional helper that talks to the receiver over USB directly. The receiver's USB audio pauses while it runs.",
    },
    {
      name: 'Safari, Firefox, Chrome on Android',
      tone: 'neutral',
      status: 'Not supported',
      note: 'No WebHID. The Audio page still works for levels and recording.',
    },
  ]
</script>

<Card title="About" overline="Mic Console">
  <p class="text">
    Mic Console is an independent, unofficial project. It is not made, endorsed or supported by Hollyland. Product
    names are used only to say which receivers it works with.
  </p>
  <p class="text">
    The USB protocol was documented from the official apps and checked on a real LARK A2. The notes are in
    <code>docs/PROTOCOL.md</code> in the project's source repository.
  </p>

  <dl class="conn">
    <KeyValue label="Connection" value={transport} />
    <KeyValue label="Mode" value={mode} />
    <KeyValue label="USB ID" value={usbId} mono />
  </dl>

  <h3>Where it works</h3>
  <ul class="platforms">
    {#each PLATFORMS as p (p.name)}
      <li>
        <div class="p-head">
          <span class="p-name">{p.name}</span>
          <Chip tone={p.tone}>{p.status}</Chip>
        </div>
        <div class="p-note">{p.note}</div>
      </li>
    {/each}
  </ul>
</Card>

<style>
  .text {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .text + .text {
    margin-top: var(--space-2);
  }
  code {
    padding: 1px 6px;
    border-radius: var(--radius-xs);
    background: var(--color-surface-3);
    color: var(--color-text);
  }
  .conn {
    margin: var(--space-3) 0 0;
  }
  h3 {
    margin-top: var(--space-4);
    font-size: var(--text-md);
    letter-spacing: 0;
  }
  .platforms {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
  }
  .platforms li {
    padding: var(--space-2) 0;
  }
  .platforms li + li {
    border-top: 1px solid var(--color-border);
  }
  .p-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .p-name {
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .p-note {
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-subtle);
    margin-top: 2px;
  }
</style>
