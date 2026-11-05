<script lang="ts">
  import type { Snippet } from 'svelte'
  import { getFieldContext, setFieldContext, uid } from './field'

  interface Props {
    label: string
    description?: string
    /** Shown instead of the description when the control is temporarily unavailable. */
    disabledReason?: string | null
    /** Put the control below the label (for segmented controls) instead of to the right. */
    stacked?: boolean
    error?: string | null
    control: Snippet
    children?: Snippet
  }

  let { label, description, disabledReason = null, stacked = false, error = null, control, children }: Props =
    $props()

  // The control (and anything in `children`) is described by the visible description or reason.
  const descId = uid('row-desc')
  const parent = getFieldContext()
  setFieldContext({
    get describedBy() {
      return disabledReason || description ? descId : undefined
    },
    get blocked() {
      return parent?.blocked ?? false
    },
  })
</script>

<div class="row" class:stacked class:dimmed={!!disabledReason}>
  <div class="text">
    <div class="label">{label}</div>
    {#if disabledReason}
      <div class="desc reason" id={descId}>{disabledReason}</div>
    {:else if description}
      <div class="desc" id={descId}>{description}</div>
    {/if}
  </div>
  <div class="control">{@render control()}</div>
  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}
  {#if children}
    <div class="extra">{@render children()}</div>
  {/if}
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-4);
    row-gap: var(--space-2);
    padding: var(--space-3) 0;
  }
  .row + :global(.row) {
    border-top: 1px solid var(--color-border);
  }
  .stacked {
    grid-template-columns: minmax(0, 1fr);
  }
  .label {
    font-weight: var(--weight-medium);
  }
  .desc {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    margin-top: 2px;
  }
  .reason {
    color: var(--color-warning);
  }
  .dimmed .label {
    color: var(--color-text-muted);
  }
  .control {
    display: flex;
    justify-content: flex-end;
  }
  .stacked .control {
    display: block;
  }
  .error {
    grid-column: 1 / -1;
    color: var(--color-danger);
    font-size: var(--text-sm);
  }
  .extra {
    grid-column: 1 / -1;
  }
  @media (pointer: coarse) {
    .label {
      font-size: var(--text-lg);
    }
    .desc {
      font-size: var(--text-md);
    }
  }
</style>
