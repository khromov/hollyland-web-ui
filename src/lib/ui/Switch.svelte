<script lang="ts">
  import { getFieldContext } from './field'

  interface Props {
    checked: boolean
    label: string
    disabled?: boolean
    pending?: boolean
    id?: string
    onchange?: (checked: boolean) => void
  }

  let { checked, label, disabled = false, pending = false, id, onchange }: Props = $props()
  const field = getFieldContext()
</script>

<button
  {id}
  type="button"
  role="switch"
  class="switch"
  class:on={checked}
  class:pending
  aria-checked={checked}
  aria-label={label}
  aria-busy={pending || undefined}
  aria-describedby={field?.describedBy}
  aria-disabled={field?.blocked || undefined}
  {disabled}
  onclick={() => onchange?.(!checked)}
>
  <span class="thumb" aria-hidden="true">
    {#if pending}<span class="spinner"></span>{/if}
  </span>
</button>

<style>
  .switch {
    position: relative;
    flex: none;
    width: 44px;
    height: 26px;
    padding: 0;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border-control);
    background: var(--color-surface-3);
    transition:
      background-color var(--dur-fast) var(--ease-standard),
      border-color var(--dur-fast) var(--ease-standard);
    -webkit-tap-highlight-color: transparent;
  }
  .switch::before {
    /* enlarge the hit area without changing the visual */
    content: '';
    position: absolute;
    inset: -10px -4px;
  }
  .switch.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .switch:disabled {
    opacity: 0.45;
  }
  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--color-text-muted);
    transition:
      transform var(--dur-fast) var(--ease-standard),
      background-color var(--dur-fast) var(--ease-standard);
  }
  .on .thumb {
    transform: translateX(18px);
    background: var(--color-on-accent);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--color-accent);
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  .on .spinner {
    border-color: var(--color-accent);
    border-right-color: transparent;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
