<script lang="ts">
  /**
   * The caption that goes with a confidence mark, with the matching swatch:
   * - sent: "Last sent 17:42 · not confirmed"
   * - unknown: "Not read"
   * - disabled: the reason the control can't be used ("Switch on to choose a tone")
   * Pass `text` to replace the default wording. Times are measured values, so they are mono.
   */
  interface Props {
    kind: 'sent' | 'unknown' | 'disabled'
    /** When the value was sent (ms epoch or Date); used by kind="sent". */
    at?: number | Date | null
    text?: string
    id?: string
  }
  let { kind, at = null, text, id }: Props = $props()

  const time = $derived(
    at === null || at === undefined
      ? null
      : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
  )
</script>

<p class="note {kind}" {id}>
  <span class="mc-swatch mc-swatch--{kind}" aria-hidden="true"></span>
  <span class="text">
    {#if text}
      {text}
    {:else if kind === 'sent'}
      Last sent{#if time}&nbsp;<span class="mono">{time}</span>{/if} · not confirmed
    {:else if kind === 'unknown'}
      Not read
    {/if}
  </span>
</p>

<style>
  .note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .mc-swatch {
    margin-top: 1px;
  }
  .unknown,
  .disabled {
    color: var(--ink-3);
  }
  .mono {
    font-size: 12px;
    color: var(--ink);
  }
</style>
