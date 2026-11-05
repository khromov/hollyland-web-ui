<script lang="ts">
  import { Check, Copy } from '@lucide/svelte'

  interface Props {
    label: string
    value: string | null | undefined
    mono?: boolean
    copyable?: boolean
  }
  let { label, value, mono = false, copyable = false }: Props = $props()
  let copied = $state(false)

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
    <span class="value">{value || '--'}</span>
    {#if copyable && value}
      <button type="button" class="copy" onclick={copy} aria-label="Copy {label}">
        {#if copied}<Check size={14} />{:else}<Copy size={14} />{/if}
      </button>
    {/if}
  </dd>
</div>

<style>
  .kv {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-2) 0;
    min-height: 36px;
  }
  .kv + :global(.kv) {
    border-top: 1px solid var(--color-border);
  }
  dt {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  dd {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    min-width: 0;
    text-align: right;
  }
  .value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .copy {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-subtle);
  }
  .copy:hover {
    background: var(--color-surface-3);
    color: var(--color-text);
  }
</style>
