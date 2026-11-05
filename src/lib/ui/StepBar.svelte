<script lang="ts">
  /** Same API as before the redesign; renders the detent Fader with its value printed beside it. */
  import type { Confidence } from './types'
  import Fader from './Fader.svelte'

  interface Props {
    steps: number
    value: number | null
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    format?: (i: number) => string
    onchange?: (index: number) => void
  }

  let { steps, value, label, disabled = false, pending = false, confidence, format, onchange }: Props = $props()
</script>

<Fader {steps} {value} {label} {disabled} {pending} {confidence} {format} {onchange} showValue />
