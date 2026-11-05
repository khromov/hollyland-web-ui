<script lang="ts">
  /**
   * The words that go with a confidence mark:
   * - sent: "Last sent 17:42 · not confirmed"
   * - unknown: "Unknown"
   * - disabled: the reason the control can't be used ("Turn on the light first")
   * Only `disabled` is printed. `sent` and `unknown` are shown by the control's own hatch or dash,
   * so their words are kept for assistive tech only (point aria-describedby at `id`) and as a
   * tooltip on the control (see confidenceNote()).
   * Pass `text` to replace the default wording. Times are measured values, so they are mono.
   */
  import { sentTime } from './confidence'

  interface Props {
    kind: 'sent' | 'unknown' | 'disabled'
    /** When the value was sent (ms epoch or Date); used by kind="sent". */
    at?: number | Date | null
    text?: string
    id?: string
  }
  let { kind, at = null, text, id }: Props = $props()

  const time = $derived(sentTime(at))
</script>

{#if kind === 'disabled'}
  <p class="note" {id}>{text}</p>
{:else}
  <span class="visually-hidden" {id}>
    {#if text}
      {text}
    {:else if kind === 'sent'}
      Last sent{#if time}&nbsp;{time}{/if} · not confirmed
    {:else}
      Unknown
    {/if}
  </span>
{/if}

<style>
  .note {
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-3);
  }
</style>
