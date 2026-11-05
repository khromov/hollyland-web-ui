<script lang="ts">
  /**
   * A dark recessed display window (notices, code, the recorder timeline). Content inside takes
   * the Graphite palette; keys placed inside become graphite keys, `variant="light"` paper keys.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLDivElement> {
    pad?: 'none' | 'sm' | 'md'
    /** Monospace content, e.g. a terminal command. */
    code?: boolean
    children: Snippet
  }
  let { pad = 'md', code = false, children, class: klass = '', ...rest }: Props = $props()
</script>

<div {...rest} class="mc-window dw pad-{pad} {klass}" class:code>
  {@render children()}
</div>

<style>
  .dw {
    min-width: 0;
  }
  .pad-sm {
    padding: 10px 12px;
  }
  .pad-md {
    padding: 14px 16px;
  }
  .code {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    font: 500 13px/1.3 var(--f-mono);
    font-stretch: var(--mono-stretch);
    overflow-x: auto;
  }
</style>
