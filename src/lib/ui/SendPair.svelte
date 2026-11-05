<script lang="ts">
  /**
   * Write-only (or not reported) on/off: "Off | On" send keys, 44 px tall like every key. The key
   * last sent from this browser carries the sent mark (outline over a hatch); with nothing sent
   * yet both are dashed (unknown). Both keys stay live, because sending either value is always
   * possible blind.
   * Use it only for settings that are absolute commands. Toggle-only commands (A2 noise
   * cancellation on/off) can't be sent blind: disable them with a reason instead.
   */
  import KeyGroup from './KeyGroup.svelte'

  interface Props {
    /** Last value sent from this browser, or null when nothing was sent. */
    value: boolean | null
    label: string
    disabled?: boolean
    pending?: boolean
    /** When `value` was sent, for the tooltip. */
    sentAt?: number | Date | null
    legends?: { on: string; off: string }
    onchange?: (value: boolean) => void
  }

  let { value, label, disabled = false, pending = false, sentAt = null, legends = { on: 'On', off: 'Off' }, onchange }: Props =
    $props()

  let target: 'on' | 'off' | null = $state(null)
  const options = $derived([
    { value: 'off' as const, label: legends.off },
    { value: 'on' as const, label: legends.on },
  ])
</script>

<div class="pair">
  <KeyGroup
    {options}
    value={value === null ? null : value ? 'on' : 'off'}
    {label}
    {disabled}
    confidence={value === null ? 'unknown' : 'sent'}
    {sentAt}
    pendingValue={pending ? target : null}
    onchange={(v) => {
      target = v
      onchange?.(v === 'on')
    }}
  />
</div>

<style>
  .pair {
    flex: none;
    max-width: 100%;
  }
  .pair :global(.mc-key) {
    min-width: 46px;
  }
</style>
