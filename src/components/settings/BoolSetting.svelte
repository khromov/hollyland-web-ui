<script lang="ts">
  /**
   * A boolean receiver setting that never invents a state.
   *  - known value: a Switch (or a two-way choice such as "15min | Never")
   *  - unknown value (write-only mode before the first send, or a failed read): an "Off | On"
   *    pair with nothing selected, plus a short "Unknown" note
   * In write-only mode a known value is labelled as "last sent from this browser".
   */
  import { History } from '@lucide/svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import Chip from '../../lib/ui/Chip.svelte'

  interface Props {
    label: string
    description?: string
    value: boolean | undefined
    pending?: boolean
    disabled?: boolean
    disabledReason?: string | null
    /** Replies are dropped by the OS: values are what this browser sent last. */
    writeOnly?: boolean
    /** Render as a two-way choice instead of a switch, e.g. { on: '15min', off: 'Never' }. */
    choice?: { on: string; off: string } | null
    /** Narrow screen: a segmented control goes under the label instead of beside it. */
    narrow?: boolean
    onchange: (value: boolean) => void
  }

  let {
    label,
    description,
    value,
    pending = false,
    disabled = false,
    disabledReason = null,
    writeOnly = false,
    choice = null,
    narrow = false,
    onchange,
  }: Props = $props()

  const segmented = $derived(!!choice || value === undefined)
  const stacked = $derived(narrow && segmented)

  const options = $derived(
    choice
      ? [
          { value: 'on', label: choice.on },
          { value: 'off', label: choice.off },
        ]
      : [
          { value: 'off', label: 'Off' },
          { value: 'on', label: 'On' },
        ],
  )
  const segValue = $derived(value === undefined ? null : value ? 'on' : 'off')
  // The segment being written, so the spinner appears in the chosen option.
  let target: 'on' | 'off' | null = $state(null)
  const pendingValue = $derived(pending ? target : null)

  function pick(v: string) {
    target = v === 'on' ? 'on' : 'off'
    onchange(v === 'on')
  }
</script>

<SettingRow {label} {description} disabledReason={disabledReason} {stacked}>
  {#snippet control()}
    {#if segmented}
      <div class="seg" class:wide={!!choice} class:stacked>
        <SegmentedControl {options} value={segValue} {label} size="sm" disabled={disabled || pending} {pendingValue} onchange={pick} />
      </div>
    {:else}
      <Switch checked={value === true} {label} {pending} {disabled} onchange={(v) => onchange(v)} />
    {/if}
  {/snippet}
  {#if value === undefined}
    <p class="note">
      <Chip>Unknown</Chip>
      <span>
        {writeOnly ? "This system can't read it. Choose a value to send it." : "The receiver didn't report this value."}
      </span>
    </p>
  {:else if writeOnly}
    <p class="note subtle">
      <History size={14} aria-hidden="true" />
      <span>Last sent from this browser</span>
    </p>
  {/if}
</SettingRow>

<style>
  .seg {
    width: 116px;
  }
  .seg.wide {
    width: 168px;
  }
  .seg.stacked {
    width: min(100%, 240px);
  }
  .note {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    color: var(--color-text-muted);
  }
  .note.subtle {
    color: var(--color-text-subtle);
    gap: 6px;
  }
  .note :global(svg) {
    flex: none;
  }
</style>
