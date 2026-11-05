<script lang="ts">
  /** Same API as before the redesign; renders the Instrument slide switch (ON / OFF in the track). */
  import type { Confidence } from './types'
  import SlideSwitch from './SlideSwitch.svelte'

  interface Props {
    checked: boolean | null
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    id?: string
    onchange?: (checked: boolean) => void
  }

  let { checked, label, disabled = false, pending = false, confidence = 'solid', id, onchange }: Props = $props()
</script>

<SlideSwitch {checked} {label} {disabled} {pending} {confidence} {id} {onchange} />
