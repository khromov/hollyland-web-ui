<script lang="ts">
  /**
   * Developer console: the raw HID traffic between this page and the receiver, shown in a dark
   * display window like a hardware readout (time, direction, bytes in mono, decoded text), and a
   * gated raw-frame sender.
   */
  import { Pause, Trash2, Download, Send } from '@lucide/svelte'
  import type { TrafficEntry } from '../../lib/state/traffic.svelte'
  import { traffic } from '../../lib/state/traffic.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'

  interface Props {
    /** Sends a raw frame. Resolves with an error message, or null on success. */
    sendRaw?: (bytes: Uint8Array) => Promise<string | null>
    connected: boolean
  }
  let { sendRaw, connected }: Props = $props()

  type Dir = 'all' | 'out' | 'in'
  const DIRS: { value: Dir; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'out', label: 'Sent' },
    { value: 'in', label: 'Received' },
  ]

  let dir: Dir = $state('all')
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

  /** The selected frame as hex-dump lines of 16 bytes: offset, bytes. */
  const dump = $derived.by(() => {
    const frame: TrafficEntry | null = selected
    if (!frame) return []
    return Array.from({ length: Math.ceil(frame.bytes.length / 16) }, (_, row) => ({
      offset: (row * 16).toString(16).padStart(2, '0'),
      bytes: Array.from(frame.bytes.subarray(row * 16, row * 16 + 16), (b, i) => ({
        i: row * 16 + i,
        hex: b.toString(16).padStart(2, '0'),
      })),
    }))
  })

  function parseHex(s: string): Uint8Array | null {
    const clean = s.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '')
    if (!clean.length || clean.length % 2) return null
    return Uint8Array.from(clean.match(/../g)!.map((h) => parseInt(h, 16)))
  }

  const canSend = $derived(prefs.allowRawWrites && connected)
  const sendBlock = $derived(
    !connected ? 'No receiver connected' : !prefs.allowRawWrites ? 'Turn on raw writes first' : null,
  )

  async function send() {
    if (!canSend) return
    rawError = null
    const bytes = parseHex(rawHex)
    if (!bytes) {
      rawError = 'Enter whole hex bytes, e.g. AA DD 10'
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
    a.download = `hollyland-web-ui-traffic-${Date.now()}.jsonl`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const RAW_WARNING = 'Raw frames can change settings, remove pairings or reset the receiver.'
  const RAW_HINT = 'Hex bytes, padded to 64. The header is normally AA. Manual sends are marked * in the log.'

  function toggleRow(e: TrafficEntry) {
    selected = selected?.id === e.id ? null : e
  }
</script>

<div class="console">
  <h1 class="visually-hidden">Console</h1>

  <Panel title="Traffic">
    {#snippet aside()}
      <!-- Not a live region: the frame count changes with every heartbeat. -->
      <span class="capture">
        <Lamp size="sm" state={traffic.paused ? 'off' : 'on'} />
        <span>{traffic.paused ? 'Paused' : 'Capturing'}</span>
        <span class="count"><span class="mono">{traffic.total.toLocaleString('en-US')}</span> frames</span>
      </span>
    {/snippet}

    <div class="body">
      <div class="toolbar">
        <div class="dir">
          <KeyGroup options={DIRS} value={dir} label="Direction" size="sm" onchange={(v) => (dir = v)} />
        </div>
        <label class="hb">
          <SlideSwitch checked={hideHeartbeat} label="Hide heartbeat" onchange={(v) => (hideHeartbeat = v)} />
          <span>Hide heartbeat</span>
        </label>
        <input class="filter" type="search" placeholder="Filter hex or text" bind:value={filter} aria-label="Filter frames" />
        <div class="actions">
          <Key size="sm" selected={traffic.paused} onclick={() => (traffic.paused = !traffic.paused)}>
            {#snippet icon()}<Pause />{/snippet}
            Pause
          </Key>
          <Key size="sm" variant="quiet" onclick={() => traffic.clear()}>
            {#snippet icon()}<Trash2 />{/snippet}
            Clear
          </Key>
          <Key size="sm" variant="quiet" onclick={exportJsonl}>
            {#snippet icon()}<Download />{/snippet}
            Export
          </Key>
        </div>
      </div>

      <!-- The scrollable log must be reachable and scrollable from the keyboard. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div class="mc-window log" tabindex="0" role="region" aria-label="Frame log">
        <table>
          <thead>
            <tr><th class="c-time">Time</th><th class="c-dir">Dir</th><th>Bytes</th><th class="c-dec">Decoded</th></tr>
          </thead>
          <tbody>
            {#each rows as e (e.id)}
              <!-- Mouse: the whole row toggles the detail; keyboard: the button in the Dir cell. -->
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
              <tr class={e.status} class:selected={selected?.id === e.id} onclick={() => toggleRow(e)}>
                <td class="mono c-time">{fmtTime(e.t)}</td>
                <td class="c-dir">
                  <button
                    type="button"
                    class="row-btn {e.dir}"
                    aria-expanded={selected?.id === e.id}
                    aria-controls="frame-detail"
                    aria-label="{e.dir === 'out' ? 'Sent' : 'Received'} frame at {fmtTime(e.t)}{e.manual ? ', manual' : ''}: show detail"
                    onclick={(ev) => {
                      ev.stopPropagation()
                      toggleRow(e)
                    }}
                    ><span class="arrow" aria-hidden="true">{e.dir === 'out' ? '→' : '←'}</span>{e.dir}{e.manual ? '*' : ''}</button
                  >
                </td>
                <td class="mono hex">{e.hexShort}</td>
                <td class="c-dec">
                  {#if e.status !== 'ok'}<span class="bad"><Lamp size="sm" color="rec" />{e.status === 'timeout' ? 'Timeout' : 'Error'}</span>{/if}
                  {e.decoded ?? ''}
                </td>
              </tr>
            {:else}
              <tr class="empty-row"><td colspan="4" class="empty">{traffic.entries.length ? 'No matching frames' : 'No frames'}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if selected}
        <div class="mc-window detail" id="frame-detail">
          <div class="detail-head">
            <span class="detail-title">{selected.dir === 'out' ? 'Sent' : 'Received'} · <span class="mono">{fmtTime(selected.t)}</span> · <span class="mono">{selected.bytes.length}</span> bytes</span>
            <button type="button" class="mc-key mc-key--quiet mc-key--sm" onclick={() => (selected = null)}>Close</button>
          </div>
          <div class="dump mono" role="table" aria-label="Frame bytes">
            {#each dump as line (line.offset)}
              <div class="dump-row" role="row">
                <span class="off" role="rowheader">{line.offset}</span>
                <span class="cells" role="cell">
                  {#each line.bytes as b (b.i)}<span class:hdr={b.i < 6} title="offset {b.i}">{b.hex}</span>{/each}
                </span>
              </div>
            {/each}
          </div>
          {#if selected.decoded}<p class="decoded">{selected.decoded}</p>{/if}
        </div>
      {/if}
    </div>
  </Panel>

  <Panel title="Raw send">
    <div class="body raw-body">
      <label class="allow" title={RAW_WARNING}>
        <SlideSwitch checked={prefs.allowRawWrites} label="Allow raw writes" onchange={(v) => prefs.setAllowRawWrites(v)} />
        <span>Allow raw writes</span>
      </label>
      <span class="visually-hidden" id="raw-warning">{RAW_WARNING}</span>
      <div class="raw">
        <input
          class="hex-in"
          placeholder="AA DD 10 40 00 00"
          bind:value={rawHex}
          disabled={!canSend}
          aria-label="Raw frame hex"
          aria-describedby={sendBlock ? 'raw-block' : 'raw-hint'}
          title={RAW_HINT}
          onkeydown={(e) => e.key === 'Enter' && send()}
        />
        <Key variant="primary" disabled={!canSend} onclick={send}>
          {#snippet icon()}<Send />{/snippet}
          Send
        </Key>
      </div>
      {#if sendBlock}
        <ConfidenceNote kind="disabled" id="raw-block" text={sendBlock} />
      {/if}
      <span class="visually-hidden" id="raw-hint">{RAW_HINT}</span>
      {#if rawError}<p class="err" role="alert">{rawError}</p>{/if}
    </div>
  </Panel>
</div>

<style>
  .console {
    display: grid;
    min-width: 0;
  }
  .body {
    display: grid;
    /* minmax(0, …): a long hex line or banner never widens the page (no sideways scroll at 320 px). */
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    min-width: 0;
    padding: 4px 0 24px;
  }
  .capture {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .count {
    color: var(--ink-3);
  }
  .count .mono {
    color: var(--ink);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }
  .dir {
    width: 260px;
    max-width: 100%;
  }
  .hb,
  .allow {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--ink);
  }
  .filter,
  .hex-in {
    height: 36px;
    padding: 0 12px;
    border-radius: var(--r-key);
    border: 1px solid var(--key-edge);
    background: var(--key);
    box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.12);
    color: var(--ink);
    font-size: 14px;
  }
  .filter {
    flex: 1 1 200px;
    min-width: 0;
  }
  .filter::placeholder,
  .hex-in::placeholder {
    color: var(--ink-3);
  }
  .filter:focus-visible,
  .hex-in:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .actions {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  /* ---- Log window ---- */
  .log {
    max-height: 56vh;
    overflow: auto;
    overscroll-behavior: contain;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 10px 12px 8px;
    background: var(--window);
    border-bottom: 1px solid var(--w-rule);
    text-align: left;
    font-size: 12px;
    font-weight: 500;
    color: var(--w-ink-2);
  }
  td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--w-rule);
    vertical-align: top;
    color: var(--w-ink);
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover td {
    background: rgb(255 255 255 / 0.04);
  }
  tr.selected td {
    background: rgb(255 255 255 / 0.1);
  }
  tr.selected td:first-child {
    box-shadow: inset 2px 0 0 var(--w-ink);
  }
  .empty-row {
    cursor: default;
  }
  .c-time {
    white-space: nowrap;
    width: 1%;
    color: var(--w-ink-2);
  }
  .c-dir {
    width: 1%;
    white-space: nowrap;
  }
  .row-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: -3px -6px;
    padding: 3px 6px;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--w-ink);
    font-size: 12px;
    font-weight: 600;
  }
  .row-btn.in {
    color: var(--live);
  }
  /* Touch: a 44 px target for each row (the rows grow to fit it). */
  @media (pointer: coarse) {
    .row-btn {
      min-height: 44px;
      min-width: 44px;
      margin-block: 0;
    }
  }
  .arrow {
    font-family: var(--f-mono);
  }
  .hex {
    width: 1%;
    white-space: nowrap;
    font-size: 12px;
    padding-right: 28px;
  }
  .c-dec {
    color: #c9c8c3;
    overflow-wrap: break-word;
  }
  .bad {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
    color: #ff8a82;
    font-weight: 600;
  }
  .empty {
    padding: 40px 12px;
    text-align: center;
    color: var(--w-ink-2);
  }

  /* ---- Frame detail: a hex dump ---- */
  .detail {
    display: grid;
    gap: 10px;
    padding: 10px 14px 14px;
  }
  .detail-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .detail-title {
    font-size: 13px;
    color: var(--w-ink);
  }
  .dump {
    display: grid;
    gap: 4px;
    font-size: 13px;
    overflow-x: auto;
  }
  .dump-row {
    display: flex;
    gap: 16px;
  }
  .off {
    flex: none;
    width: 2ch;
    color: var(--w-ink-2);
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(16, 2ch);
    column-gap: 1.1ch;
    color: var(--w-ink-2);
  }
  .cells .hdr {
    color: var(--w-ink);
    font-weight: 600;
  }
  .decoded {
    font-size: 13px;
    color: #c9c8c3;
  }

  /* ---- Raw send ---- */
  .raw-body {
    max-width: 760px;
  }
  .raw {
    display: flex;
    gap: 8px;
  }
  .hex-in {
    flex: 1;
    min-width: 0;
    height: var(--hit);
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
  }
  .hex-in:disabled {
    background: var(--chassis-2);
    border-color: var(--rule);
    box-shadow: none;
    color: var(--ink-3);
  }
  .err {
    font-size: 13px;
    color: var(--rec-ink);
  }

  @media (min-width: 1280px) {
    .body {
      padding: 24px 0 28px var(--module-pad);
    }
  }
  /* Narrow: each frame is two lines (direction and bytes, then the decoded text). */
  @media (max-width: 767px) {
    thead {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    tbody tr:not(.empty-row) {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: 12px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--w-rule);
    }
    tbody tr:not(.empty-row) td {
      padding: 0;
      border: 0;
      width: auto;
    }
    tbody tr:not(.empty-row) .c-time {
      display: none;
    }
    tbody tr:not(.empty-row) .hex {
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0;
    }
    tbody tr:not(.empty-row) .c-dec {
      grid-column: 1 / -1;
      margin-top: 2px;
    }
    tr.selected {
      background: rgb(255 255 255 / 0.1);
      box-shadow: inset 2px 0 0 var(--w-ink);
    }
    tr.selected td,
    tr.selected td:first-child {
      background: none;
      box-shadow: none;
    }
    .actions {
      margin-left: 0;
    }
  }
</style>
