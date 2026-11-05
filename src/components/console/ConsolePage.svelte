<script lang="ts">
  import { Pause, Play, Trash2, Download, Send } from '@lucide/svelte'
  import type { TrafficEntry } from '../../lib/state/traffic.svelte'
  import { traffic } from '../../lib/state/traffic.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import Banner from '../../lib/ui/Banner.svelte'

  interface Props {
    /** Sends a raw frame. Resolves with an error message, or null on success. */
    sendRaw?: (bytes: Uint8Array) => Promise<string | null>
    connected: boolean
  }
  let { sendRaw, connected }: Props = $props()

  let dir: 'all' | 'out' | 'in' = $state('all')
  let hideHeartbeat = $state(true)
  let filter = $state('')
  let rawHex = $state('')
  let rawError: string | null = $state(null)
  let selected: TrafficEntry | null = $state(null)

  const rows = $derived.by(() => {
    const f = filter.trim().toLowerCase()
    return traffic.entries
      .filter((e) => dir === 'all' || e.dir === dir)
      .filter((e) => !hideHeartbeat || !e.heartbeat)
      .filter((e) => !f || e.hex.includes(f) || (e.decoded ?? '').toLowerCase().includes(f))
      .slice(-500)
      .reverse()
  })

  const fmtTime = (t: number) => {
    const d = new Date(t)
    return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }

  function parseHex(s: string): Uint8Array | null {
    const clean = s.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
    if (!clean.length || clean.length % 2) return null
    return Uint8Array.from(clean.match(/../g)!.map((h) => parseInt(h, 16)))
  }

  async function send() {
    rawError = null
    const bytes = parseHex(rawHex)
    if (!bytes) {
      rawError = 'Enter an even number of hex digits, for example "AA DD 10 40 00 00".'
      return
    }
    if (!sendRaw) return
    rawError = await sendRaw(bytes)
  }

  function exportJsonl() {
    const lines = traffic.entries.map((e) =>
      JSON.stringify({ t: new Date(e.t).toISOString(), dir: e.dir, hex: e.hex, decoded: e.decoded, status: e.status, manual: e.manual }),
    )
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'application/x-ndjson' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mic-console-traffic-${Date.now()}.jsonl`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
</script>

<div class="page">
  <div class="intro">
    <h1>Console</h1>
    <p>Raw HID traffic between this page and the receiver. Useful for debugging and protocol research.</p>
  </div>

  <Card>
    <div class="toolbar">
      <span class="capture" class:paused={traffic.paused}>
        <span class="dot" aria-hidden="true"></span>
        {traffic.paused ? 'Paused' : 'Capturing'} · <span class="readout">{traffic.total}</span> frames
      </span>
      <div class="spacer"></div>
      <Button size="sm" variant="ghost" onclick={() => (traffic.paused = !traffic.paused)}>
        {#snippet icon()}{#if traffic.paused}<Play size={16} />{:else}<Pause size={16} />{/if}{/snippet}
        {traffic.paused ? 'Resume' : 'Pause'}
      </Button>
      <Button size="sm" variant="ghost" onclick={() => traffic.clear()}>
        {#snippet icon()}<Trash2 size={16} />{/snippet}
        Clear
      </Button>
      <Button size="sm" variant="ghost" onclick={exportJsonl}>
        {#snippet icon()}<Download size={16} />{/snippet}
        Export
      </Button>
    </div>
    <div class="filters">
      <SegmentedControl
        size="sm"
        label="Direction"
        options={[
          { value: 'all', label: 'All' },
          { value: 'out', label: 'Out' },
          { value: 'in', label: 'In' },
        ]}
        value={dir}
        onchange={(v) => (dir = v)}
      />
      <label class="toggle">
        <Switch checked={hideHeartbeat} label="Hide heartbeat" onchange={(v) => (hideHeartbeat = v)} />
        <span>Hide heartbeat</span>
      </label>
      <input class="filter" type="search" placeholder="Filter hex or text" bind:value={filter} aria-label="Filter frames" />
    </div>

    <!-- The scrollable log must be reachable and scrollable from the keyboard. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="table-wrap" tabindex="0" role="region" aria-label="Frame log">
      <table>
        <thead>
          <tr><th class="time">Time</th><th>Dir</th><th>Bytes</th><th>Decoded</th></tr>
        </thead>
        <tbody>
          {#each rows as e (e.id)}
            <!-- Mouse: the whole row toggles the detail; keyboard: the button in the Dir cell. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <tr
              class={e.status}
              class:selected={selected?.id === e.id}
              onclick={() => (selected = selected?.id === e.id ? null : e)}
            >
              <td class="mono time">{fmtTime(e.t)}</td>
              <td class="dir {e.dir}">
                <button
                  type="button"
                  class="row-btn"
                  aria-expanded={selected?.id === e.id}
                  aria-controls="frame-detail"
                  aria-label="{e.dir === 'out' ? 'Sent' : 'Received'} frame at {fmtTime(e.t)}{e.manual ? ', manual' : ''}: show detail"
                  onclick={(ev) => {
                    ev.stopPropagation()
                    selected = selected?.id === e.id ? null : e
                  }}>{e.dir.toUpperCase()}{e.manual ? '*' : ''}</button
                >
              </td>
              <td class="mono hex">{e.hexShort}</td>
              <td class="decoded">{e.decoded ?? ''}{e.status === 'timeout' ? ' · TIMEOUT' : e.status === 'error' ? ' · ERROR' : ''}</td>
            </tr>
          {:else}
            <tr><td colspan="4" class="empty">No frames yet.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    {#if selected}
      <div class="detail" id="frame-detail">
        <div class="overline">Frame detail</div>
        <div class="bytes mono">
          {#each selected.bytes as b, i (i)}
            <span title="offset {i}">{b.toString(16).padStart(2, '0')}</span>
          {/each}
        </div>
        {#if selected.decoded}<p>{selected.decoded}</p>{/if}
      </div>
    {/if}
  </Card>

  <Card title="Raw send" overline="Developer">
    {#if !prefs.allowRawWrites}
      <Banner tone="warning" title="Raw writes are off">
        Raw frames can change device settings, remove pairings or reset the device. Turn this on only if you know the
        protocol.
      </Banner>
    {/if}
    <label class="toggle allow">
      <Switch checked={prefs.allowRawWrites} label="Allow raw writes" onchange={(v) => prefs.setAllowRawWrites(v)} />
      <span>Allow raw writes</span>
    </label>
    <div class="raw">
      <input
        class="mono"
        placeholder="AA DD 10 40 00 00"
        bind:value={rawHex}
        disabled={!prefs.allowRawWrites || !connected}
        aria-label="Raw frame hex"
        onkeydown={(e) => e.key === 'Enter' && send()}
      />
      <Button variant="primary" disabled={!prefs.allowRawWrites || !connected} onclick={send}>
        {#snippet icon()}<Send size={16} />{/snippet}
        Send
      </Button>
    </div>
    <p class="hint">
      Frames are padded to 64 bytes. The first byte is the frame header (normally <code>AA</code>). Every manual send
      is tagged with * in the log.
    </p>
    {#if rawError}<p class="err" role="alert">{rawError}</p>{/if}
  </Card>
</div>

<style>
  .page {
    display: grid;
    gap: var(--space-5);
  }
  .intro h1 {
    font-size: var(--text-2xl);
  }
  .intro p {
    color: var(--color-text-muted);
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .capture {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .capture .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-danger);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .capture.paused .dot {
    animation: none;
    background: var(--color-text-subtle);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  .filters {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    flex-wrap: wrap;
    margin: var(--space-3) 0;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .filter {
    flex: 1;
    min-width: 180px;
    min-height: var(--control-h-sm);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-control);
    background: var(--color-surface-3);
  }
  .table-wrap {
    max-height: 52vh;
    overflow: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--color-surface-2);
    text-align: left;
    font-weight: var(--weight-semibold);
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
    box-shadow: inset 3px 0 0 transparent;
  }
  tr {
    cursor: pointer;
  }
  tr:hover td {
    background: var(--color-surface-3);
  }
  tr.selected td {
    background: var(--color-accent-soft);
  }
  tr.error td:first-child,
  tr.timeout td:first-child {
    box-shadow: inset 3px 0 0 var(--color-danger);
  }
  .time {
    white-space: nowrap;
    color: var(--color-text-subtle);
  }
  .dir {
    font-weight: var(--weight-semibold);
    font-size: var(--text-xs);
  }
  .row-btn {
    margin: -4px -6px;
    padding: 4px 6px;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .dir.out {
    color: var(--color-accent);
  }
  .dir.in {
    color: var(--color-success);
  }
  .hex {
    white-space: nowrap;
    color: var(--color-text);
  }
  .decoded {
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }
  .empty {
    text-align: center;
    color: var(--color-text-subtle);
    padding: var(--space-6);
  }
  .detail {
    margin-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }
  .bytes {
    display: grid;
    grid-template-columns: repeat(16, minmax(0, 1fr));
    gap: 2px 6px;
    font-size: var(--text-sm);
    max-width: 640px;
  }
  .bytes span:nth-child(-n + 6) {
    color: var(--color-accent);
  }
  .allow {
    margin: var(--space-3) 0;
  }
  .raw {
    display: flex;
    gap: var(--space-2);
  }
  .raw input {
    flex: 1;
    min-width: 0;
    min-height: var(--control-h-md);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-control);
    background: var(--color-surface-3);
  }
  .hint {
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
    margin-top: var(--space-2);
  }
  .err {
    color: var(--color-danger);
    font-size: var(--text-sm);
  }
  @media (max-width: 767px) {
    .hex {
      max-width: 40vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .time {
      display: none;
    }
  }
</style>
