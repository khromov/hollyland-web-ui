<script lang="ts">
  /**
   * The value printed at a module head, e.g. "6/6" (mono 24, "/6" in ink-3).
   * confidence 'sent': a hatched swatch in front (last sent, not confirmed; said in the tooltip);
   * 'unknown' or value null: "–".
   */
  import type { Confidence } from './types'
  import { confidenceNote } from './confidence'

  interface Props {
    value: number | string | null
    total?: number | string
    confidence?: Confidence
    /** When a 'sent' value was sent (ms epoch or Date), for the tooltip. */
    sentAt?: number | Date | null
    /** Accessible text; defaults to "6 of 6". */
    label?: string
  }
  let { value, total, confidence = 'solid', sentAt = null, label }: Props = $props()
  const unknown = $derived(value === null || confidence === 'unknown')
  const note = $derived(unknown ? 'Unknown' : confidenceNote(confidence, sentAt))
  const aria = $derived(
    label ?? (unknown ? 'Unknown' : `${value}${total !== undefined ? ` of ${total}` : ''}${note ? `, ${note}` : ''}`),
  )
</script>

<span class="vh" class:sent={confidence === 'sent' && !unknown} class:unknown role="img" aria-label={aria} title={note}>
  {#if confidence === 'sent' && !unknown}<span class="mc-swatch mc-swatch--sent" aria-hidden="true"></span>{/if}
  <span class="v" aria-hidden="true">{unknown ? '–' : value}</span>{#if total !== undefined}<small aria-hidden="true">/{total}</small>{/if}
</span>

<style>
  .vh {
    display: inline-flex;
    align-items: baseline;
    gap: 0;
    font: 500 var(--t-value) / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  small {
    font-size: 14px;
    color: var(--ink-3);
    letter-spacing: 0;
  }
  .mc-swatch {
    align-self: center;
    margin-right: 8px;
  }
  .sent .v {
    color: var(--ink-2);
  }
  .unknown .v {
    color: var(--ink-3);
    letter-spacing: 0;
  }
</style>
