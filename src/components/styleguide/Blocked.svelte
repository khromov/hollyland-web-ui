<script lang="ts">
  /** Style-guide helper: renders children as if inside a Blockable with a reason (field context). */
  import type { Snippet } from 'svelte'
  import { setFieldContext, uid } from '../../lib/ui/field'

  interface Props {
    reason: string
    children: Snippet
  }
  let { reason, children }: Props = $props()
  const id = uid('sg-block')
  setFieldContext({
    get describedBy() {
      return id
    },
    get blocked() {
      return true
    },
  })
</script>

<div class="blocked">
  {@render children()}
  <p class="reason" {id}><span class="mc-swatch mc-swatch--disabled" aria-hidden="true"></span>{reason}</p>
</div>

<style>
  .blocked {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  .reason {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .reason .mc-swatch {
    margin-top: 1px;
  }
</style>
