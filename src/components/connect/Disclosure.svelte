<script lang="ts">
  /**
   * A collapsible section on the faceplate: a native <details> with a 44 px summary row (title
   * left, chevron right) between hairline rules. Keyboard and screen-reader behaviour come from
   * the element itself; `open` is bindable so a page can open it (e.g. while the bridge connects).
   * Stack several inside an element with `mc-rule-top` to close the top edge.
   */
  import type { Snippet } from 'svelte'
  import { ChevronDown } from '@lucide/svelte'

  interface Props {
    title: string
    open?: boolean
    children: Snippet
  }
  let { title, open = $bindable(false), children }: Props = $props()
</script>

<details class="disclosure" bind:open>
  <summary>
    <span class="title">{title}</span>
    <span class="chev" aria-hidden="true"><ChevronDown size={18} strokeWidth={2} /></span>
  </summary>
  <div class="body">
    {@render children()}
  </div>
</details>

<style>
  .disclosure {
    border-bottom: 1px solid var(--rule);
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--hit);
    padding: 12px 0;
    list-style: none;
    cursor: pointer;
    color: var(--ink);
    font-size: 15px;
    font-weight: 620;
    line-height: 1.35;
    -webkit-tap-highlight-color: transparent;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary::marker {
    content: '';
  }
  summary:hover .title {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  /* The chevron sits in a small key-sized plate so the row reads as something to press. */
  .chev {
    display: grid;
    place-items: center;
    flex: none;
    width: 28px;
    height: 28px;
    border: 1px solid var(--rule);
    border-radius: var(--r-key);
    color: var(--ink-2);
    transition:
      transform var(--dur-fast) var(--ease),
      border-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  summary:hover .chev {
    border-color: var(--key-edge);
    color: var(--ink);
  }
  details[open] > summary .chev {
    transform: rotate(180deg);
  }
  .body {
    display: grid;
    justify-items: start;
    gap: 14px;
    padding: 2px 0 24px;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink-2);
  }
  .body > :global(*) {
    max-width: 100%;
  }
</style>
