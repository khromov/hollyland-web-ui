<script lang="ts">
  /**
   * A short line under a control: why it can't be used ("No mic connected", "Turn on the light
   * first"). Only block reasons are printed; how much is known about a value is the control's own
   * hatch / dash and tooltip.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    id?: string
    /** Full wording for the tooltip (and assistive tech) when the line is a shortened one. */
    title?: string
    children: Snippet
  }
  let { id, title, children }: Props = $props()
</script>

<p class="note" {id} {title}>{@render children()}</p>

<style>
  .note {
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
</style>
