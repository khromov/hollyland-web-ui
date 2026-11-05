<script lang="ts">
  /**
   * "Paired Devices" (features.md §7). As in the official app, "paired" means the mic is online
   * right now. Remove Pairing sends cmd 0x3F [1|2] after the official confirmation.
   */
  import { Unlink, ChevronDown } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import { uid } from '../../lib/ui/field'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import UnitTitle from './UnitTitle.svelte'
  import UnitStatus from './UnitStatus.svelte'

  const removeDescId = uid('remove-desc')

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

<Panel title="Paired Devices">
  <div class="mods">
    <Modules min="280px">
      {#each rows as r (r.n)}
        {@const paired = live && r.online}
        <div class="mic">
          <UnitTitle channel={r.channel} name={r.name} sub={r.sub} led={writeOnly || paired ? 'on' : 'off'}>
            {#snippet status()}
              {#if writeOnly}
                <UnitStatus status="unknown" />
              {:else}
                <span class="word" class:dim={!paired} title={paired ? undefined : 'Off or out of range'}
                  ><Lamp size="sm" state={paired ? 'on' : 'off'} />{paired ? 'Paired' : 'Not paired'}</span
                >
              {/if}
            {/snippet}
          </UnitTitle>
          {#if canRemove && (writeOnly || paired)}
            <div class="action">
              <Key size="sm" disabled={!ready} onclick={() => (confirmFor = r.n)}>
                {#snippet icon()}<Unlink />{/snippet}
                Remove Pairing
              </Key>
            </div>
          {/if}
        </div>
      {/each}
    </Modules>
  </div>

  <details class="help">
    <summary>
      <span>How to pair a mic</span>
      <ChevronDown size={18} aria-hidden="true" />
    </summary>
    <div class="help-body">
      <ol>
        <li>Keep receiver and mic close</li>
        <li>Put both in pairing mode (see manual)</li>
        {#if live}
          <li>The mic shows “Paired” here</li>
        {:else}
          <li>Check its levels on <a href="#/audio">Audio</a></li>
        {/if}
      </ol>
    </div>
  </details>
</Panel>

<Dialog
  open={confirmFor !== null}
  title="Remove Pairing: {confirmName}"
  tone="danger"
  blocking={busy}
  onclose={() => (confirmFor = null)}
  describedby={removeDescId}
>
  <p id={removeDescId}>The mic will need pairing again.</p>
  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <Button variant="secondary" autofocus disabled={busy} onclick={() => (confirmFor = null)}>Cancel</Button>
    <Button variant="danger" loading={busy} onclick={remove}>Confirm</Button>
  {/snippet}
</Dialog>

<style>
  .mods {
    min-width: 0;
  }
  .mic {
    display: grid;
    align-content: start;
    gap: 10px;
    min-width: 0;
    padding: 18px var(--module-pad) 20px;
  }
  .word {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--ink);
  }
  .word.dim {
    font-weight: 400;
    color: var(--ink-2);
  }
  .action {
    display: flex;
  }
  .help {
    border-top: 1px solid var(--rule);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: var(--hit);
    padding: 4px 0;
    font-size: var(--t-control);
    font-weight: 620;
    cursor: pointer;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary :global(svg) {
    color: var(--ink-2);
    transition: transform var(--dur-fast) var(--ease);
  }
  .help[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  .help-body {
    display: grid;
    gap: 8px;
    max-width: 72ch;
    padding: 0 0 18px;
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  ol {
    margin: 0;
    padding-left: 1.25rem;
    display: grid;
    gap: 4px;
  }
  @media (min-width: 600px) {
    .help {
      padding-inline: var(--module-pad);
    }
  }
  @media (max-width: 599px) {
    .mic {
      padding: 12px 0 16px;
    }
  }
</style>
