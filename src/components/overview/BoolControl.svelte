<script lang="ts">
  /**
   * On/off control that never invents a state: a switch when the value is known, an
   * "Off | On" pair with nothing selected when it isn't (write-only mode before the first send).
   */
  import Switch from '../../lib/ui/Switch.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'

  interface Props {
    value: boolean | undefined
    label: string
    pending?: boolean
    onchange: (value: boolean) => void
  }
  let { value, label, pending = false, onchange }: Props = $props()

  const OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ]
</script>

{#if value === undefined}
  <div class="unknown">
    <SegmentedControl
      options={OPTIONS}
      value={null}
      {label}
      size="sm"
      onchange={(v) => onchange(v === 'on')}
    />
  </div>
{:else}
  <Switch checked={value} {label} {pending} onchange={(v) => onchange(v)} />
{/if}

<style>
  .unknown {
    width: 116px;
  }
</style>
