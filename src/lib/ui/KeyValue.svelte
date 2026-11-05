<script lang="ts">
  /**
   * A spec-sheet row: label column on the left, value on the right of it, hairline between rows.
   * `mono` for hardware IDs and measured values (firmware, serials, USB IDs).
   * `masked`: shows only the last 4 characters ("•••• •••• 7F3A") until revealed.
   */
  import { Check, Copy, Eye, EyeOff } from '@lucide/svelte'

  interface Props {
    label: string
    value: string | null | undefined
    mono?: boolean
    copyable?: boolean
    masked?: boolean
  }
  let { label, value, mono = false, copyable = false, masked = false }: Props = $props()
  let copied = $state(false)
  let revealed = $state(false)

  const shown = $derived(
    !value ? null : masked && !revealed ? `•••• •••• ${value.slice(-4)}` : value,
  )

  async function copy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      copied = true
      setTimeout(() => (copied = false), 1200)
    } catch {
      /* clipboard unavailable */
    }
  }
</script>

<div class="kv">
  <dt>{label}</dt>
  <dd class:mono>
    {#if shown}
      <span class="value">{shown}</span>
    {:else}
      <span class="mc-dash" aria-label="Unknown" title="Unknown">–</span>
    {/if}
    {#if masked && value}
      <button
        type="button"
        class="mini"
        aria-pressed={revealed}
        aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        onclick={() => (revealed = !revealed)}
      >
        {#if revealed}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
      </button>
    {/if}
    {#if copyable && value && (!masked || revealed)}
      <button type="button" class="mini" onclick={copy} aria-label="Copy {label}">
        {#if copied}<Check size={15} />{:else}<Copy size={15} />{/if}
      </button>
    {/if}
  </dd>
</div>

<style>
  .kv {
    display: grid;
    grid-template-columns: minmax(96px, 40%) minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    min-height: 44px;
    padding: 6px 0;
  }
  .kv + :global(.kv) {
    border-top: 1px solid var(--rule-soft);
  }
  dt {
    font-size: 13px;
    color: var(--ink-2);
  }
  dd {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    min-width: 0;
    font-size: 14px;
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    font-size: 13px;
  }
  .mini {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--r-key);
    background: transparent;
    color: var(--ink-2);
  }
  .mini::after {
    content: '';
    position: absolute;
    inset: -6px;
  }
  .mini:hover {
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    color: var(--ink);
  }
</style>
