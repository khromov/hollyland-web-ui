<script lang="ts">
  /**
   * A list row: title and description on the left, the control on the right, hairline rules
   * between rows, no boxes. `stacked` puts the control under the text (key rows on phones).
   * `disabledReason` replaces the description with the reason, after a flat "disabled" swatch,
   * and describes the control (aria-describedby through the field context).
   */
  import type { Snippet } from 'svelte'
  import { getFieldContext, setFieldContext, uid } from './field'

  interface Props {
    label: string
    description?: string
    /** Shown instead of the description when the control is temporarily unavailable. */
    disabledReason?: string | null
    /** Put the control below the label (for key rows) instead of to the right. */
    stacked?: boolean
    error?: string | null
    control: Snippet
    children?: Snippet
  }

  let { label, description, disabledReason = null, stacked = false, error = null, control, children }: Props =
    $props()

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
      <div class="desc reason" id={descId}>
        <span class="mc-swatch mc-swatch--disabled" aria-hidden="true"></span><span>{disabledReason}</span>
      </div>
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
    column-gap: 20px;
    row-gap: 10px;
    padding: 14px 0;
    min-width: 0;
  }
  .row + :global(.row) {
    border-top: 1px solid var(--rule);
  }
  .stacked {
    grid-template-columns: minmax(0, 1fr);
  }
  .label {
    font-size: var(--t-control);
    font-weight: 620;
    line-height: var(--lh-head);
  }
  .desc {
    margin-top: 3px;
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .reason {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    color: var(--ink-2);
  }
  .reason .mc-swatch {
    margin-top: 3px;
  }
  .control {
    display: flex;
    justify-content: flex-end;
    min-width: 0;
  }
  .stacked .control {
    display: block;
  }
  .error {
    grid-column: 1 / -1;
    color: var(--rec-ink);
    font-size: 13px;
  }
  .extra {
    grid-column: 1 / -1;
    min-width: 0;
  }
  @media (max-width: 599px) {
    .label {
      font-size: 16px;
    }
  }
</style>
