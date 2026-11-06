<script lang="ts">
  /**
   * Hardware report (docs/FAMILIES.md §4.3, §5.7), on the Device page of untested products:
   * the driver's read-only first-contact check (writes are never run from here) and
   * "Copy hardware report", the plain-text snapshot to paste into an issue.
   */
  import { Check, Copy } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Key from '../../lib/ui/Key.svelte'

  const ready = $derived(session.phase === 'ready')
  /** Steps the page can run by itself (descriptor, reads, observations). */
  const runnable = $derived(session.hardwareChecks.filter((s) => !!s.run))

  const checkText = $derived.by(() => {
    if (session.checkRunning) return 'Running…'
    const results = Object.values(session.checkResults)
    if (!results.length) return 'Not run'
    const skipped = results.filter((r) => 'skipped' in r && r.skipped).length
    const passed = results.filter((r) => r.ok).length
    const failed = results.length - passed - skipped
    return [`${passed} passed`, ...(failed ? [`${failed} failed`] : []), ...(skipped ? [`${skipped} skipped`] : [])].join(' · ')
  })

  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | undefined
  async function copy() {
    if (await session.copyHardwareReport()) {
      copied = true
      clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copied = false), 1500)
    } else {
      toasts.error('Couldn’t copy the report.')
    }
  }
</script>

<Panel title="Hardware report">
  <div class="report">
    {#if runnable.length}
      <dl class="spec">
        <div class="spec-item">
          <dt>Check</dt>
          <dd aria-live="polite">{checkText}</dd>
        </div>
      </dl>
    {/if}
    <div class="keys">
      {#if runnable.length}
        <Key loading={session.checkRunning} disabled={!ready} onclick={() => session.runHardwareCheck()}>
          Run check
        </Key>
      {/if}
      <Key disabled={!session.product} onclick={copy}>
        {#snippet icon()}{#if copied}<Check />{:else}<Copy />{/if}{/snippet}
        {copied ? 'Report copied' : 'Copy hardware report'}
      </Key>
    </div>
  </div>
</Panel>

<style>
  .report {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 14px 40px;
    padding: 4px 0 20px;
  }
  /* Same spec strip as Device Information: label above value. */
  .spec {
    display: flex;
    margin: 0;
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
    align-items: center;
    min-height: 28px;
    margin: 0;
    font-size: 14px;
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  @media (min-width: 600px) {
    .report {
      padding-inline: var(--module-pad);
      padding-top: 6px;
    }
  }
  @media (min-width: 1280px) {
    .report {
      padding-top: 22px;
      padding-bottom: 24px;
    }
  }
  @media (max-width: 599px) {
    .keys,
    .keys > :global(*) {
      width: 100%;
    }
  }
</style>
