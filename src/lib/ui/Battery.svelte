<script lang="ts">
  /**
   * Same API as before the redesign; renders BatteryCells. A percent of 0 or null is shown as
   * not readable (the receiver reports 0 when it doesn't know).
   */
  import BatteryCells from './BatteryCells.svelte'

  interface Props {
    percent: number | null
    charging?: boolean
    showText?: boolean
    size?: 'sm' | 'md'
    label?: string
  }

  let { percent, charging = false, showText = true, size = 'md', label = 'Battery' }: Props = $props()
</script>

<BatteryCells
  percent={percent !== null && percent > 0 ? percent : null}
  {charging}
  {showText}
  {label}
  chargingText={size !== 'sm'}
  unknownText={size === 'sm' ? '' : 'Not readable'}
/>
