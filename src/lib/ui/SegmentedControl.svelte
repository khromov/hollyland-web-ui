<script lang="ts" generics="T extends string | number">
  /**
   * Same API as before the redesign; it renders a KeyGroup (separate keys, not a pill track).
   * New code can use KeyGroup directly for confidence, glyphs, columns and custom key content.
   */
  import type { Confidence, SegmentOption } from './types'
  import KeyGroup from './KeyGroup.svelte'

  interface Props {
    options: SegmentOption<T>[]
    value: T | null
    label: string
    disabled?: boolean
    /** Value currently being written; shows a spinner in that segment. */
    pendingValue?: T | null
    size?: 'sm' | 'md' | 'lg'
    confidence?: Confidence
    onchange?: (value: T) => void
  }

  let { options, value, label, disabled = false, pendingValue = null, size = 'md', confidence = 'solid', onchange }: Props =
    $props()
</script>

<KeyGroup {options} {value} {label} {disabled} {pendingValue} {size} {confidence} {onchange} />
