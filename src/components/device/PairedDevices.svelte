<script lang="ts">
  /**
   * "Paired Devices" (features.md §7). As in the official app, "paired" means the mic is online
   * right now. Remove Pairing sends cmd 0x3F [1|2] after the official confirmation.
   */
  import { Unlink } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import ChannelBadge from './ChannelBadge.svelte'

  const live = $derived(session.live)
  const writeOnly = $derived(session.writeOnly)
  const canRemove = $derived(!!session.caps?.removePairing)
  const ready = $derived(session.phase === 'ready')

  const rows = $derived(
    ([1, 2] as const).map((n) => {
      const unit = n === 1 ? session.units?.tx1 : session.units?.tx2
      const custom = !!prefs.micNames[n - 1]?.trim()
      return {
        n,
        channel: (n === 1 ? 'tx1' : 'tx2') as 'tx1' | 'tx2',
        name: prefs.micLabel(n === 1 ? 0 : 1),
        sub: custom ? `Mic ${n}` : null,
        online: !!unit?.online,
      }
    }),
  )

  let confirmFor: 1 | 2 | null = $state(null)
  let busy = $state(false)
  const confirmName = $derived(confirmFor ? prefs.micLabel(confirmFor === 1 ? 0 : 1) : '')

  async function remove() {
    if (!confirmFor) return
    busy = true
    try {
      await session.removePairing(confirmFor)
    } finally {
      busy = false
      confirmFor = null
    }
  }
</script>

<Card title="Paired Devices" overline="Mics">
  <ul class="rows">
    {#each rows as r (r.n)}
      <li class="row">
        <ChannelBadge channel={r.channel} />
        <div class="name">
          <div class="primary">{r.name}</div>
          {#if r.sub}<div class="sub">{r.sub}</div>{/if}
        </div>
        <div class="action">
          {#if writeOnly}
            <Chip>Status unknown</Chip>
            {#if canRemove}
              <Button size="sm" variant="danger-outline" disabled={!ready} onclick={() => (confirmFor = r.n)}>
                {#snippet icon()}<Unlink />{/snippet}
                Remove Pairing
              </Button>
            {/if}
          {:else if live && r.online}
            {#if canRemove}
              <Button size="sm" variant="danger-outline" disabled={!ready} onclick={() => (confirmFor = r.n)}>
                {#snippet icon()}<Unlink />{/snippet}
                Remove Pairing
              </Button>
            {:else}
              <Chip tone="success">Paired</Chip>
            {/if}
          {:else}
            <span class="not-paired">Not paired</span>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <p class="note">
    {#if writeOnly}
      This system can't read whether a mic is paired, and can't confirm a removal.
    {:else}
      A mic that is switched off or out of range also shows as "Not paired". That's how the receiver reports it.
    {/if}
  </p>

  <details class="help">
    <summary>How to pair a mic</summary>
    <div class="help-body">
      <p>Pairing is done on the hardware. Neither this page nor the official app can start it.</p>
      <ol>
        <li>Charge the receiver and the mic, and keep them close together.</li>
        <li>Follow the pairing steps in your kit's manual to put both into pairing mode.</li>
        {#if live}
          <li>When the mic is linked, its row here shows {canRemove ? '"Remove Pairing" again' : '"Paired"'}.</li>
        {:else}
          <li>
            This page can't see the link on this system. To check it, speak into the mic and watch the levels on the
            <a href="#/audio">Audio</a> page.
          </li>
        {/if}
      </ol>
    </div>
  </details>
</Card>

<Dialog
  open={confirmFor !== null}
  title="Remove Pairing: {confirmName}"
  tone="danger"
  blocking={busy}
  onclose={() => (confirmFor = null)}
>
  {#snippet icon()}<Unlink size={22} />{/snippet}
  <p>This device will need to be paired again after deletion. Are you sure you want to delete it?</p>
  {#if writeOnly}
    <p class="dlg-note">This system can't confirm the result.</p>
  {/if}
  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <Button variant="secondary" autofocus disabled={busy} onclick={() => (confirmFor = null)}>Cancel</Button>
    <Button variant="danger" loading={busy} onclick={remove}>Confirm</Button>
  {/snippet}
</Dialog>

<style>
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    min-height: 56px;
    padding: var(--space-2) 0;
  }
  .row + .row {
    border-top: 1px solid var(--color-border);
  }
  .name {
    flex: 1 1 96px;
    min-width: 0;
  }
  .primary {
    font-weight: var(--weight-medium);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  .action {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: flex-end;
    margin-left: auto;
  }
  .not-paired {
    color: var(--color-text-subtle);
    font-size: var(--text-sm);
  }
  .note {
    margin-top: var(--space-2);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-subtle);
  }
  .help {
    margin-top: var(--space-3);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-2);
  }
  summary {
    display: flex;
    align-items: center;
    min-height: var(--hit-min);
    cursor: pointer;
    font-weight: var(--weight-medium);
    color: var(--color-accent);
  }
  .help-body {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    display: grid;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
  }
  ol {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: var(--space-1);
  }
  .dlg-note {
    margin-top: var(--space-3);
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
</style>
