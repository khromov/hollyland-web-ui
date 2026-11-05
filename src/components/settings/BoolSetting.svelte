<script lang="ts">
  /**
   * One receiver feature setting as a faceplate module: title and the control at the head (or a
   * key row in the body for a two-way choice such as "15min | Never"). It never invents a state:
   *  - read back (live):            slide switch, ON / OFF in the track
   *  - sent, not confirmed:         "Off | On" send pair with the last value marked (hatch)
   *  - unknown (never read / sent): "Off | On" with nothing marked (dashed)
   *  - disabled:                    flat control + the reason in a few words
   * What the setting does is the title's tooltip; how much is known about the value ("Last sent
   * 17:42 · not confirmed", "Unknown") is the control's own tooltip. Neither is printed.
   */
  import Module from '../../lib/ui/Module.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import { setFieldContext, uid } from '../../lib/ui/field'

  interface Props {
    title: string
    /** What the setting does: the title's tooltip, never visible text. */
    hint?: string
    value: boolean | undefined
    /** Replies are dropped by the OS: a known value is what this browser sent last. */
    writeOnly?: boolean
    pending?: boolean
    disabled?: boolean
    disabledReason?: string | null
    /** A two-way choice instead of a switch, e.g. { on: '15min', off: 'Never' } (shown in that order). */
    choice?: { on: string; off: string } | null
    /** When this page sent the value (write-only tooltip). */
    sentAt?: number | null
    onchange: (value: boolean) => void
  }

  let {
    title,
    hint,
    value,
    writeOnly = false,
    pending = false,
    disabled = false,
    disabledReason = null,
    choice = null,
    sentAt = null,
    onchange,
  }: Props = $props()

  const reasonId = uid('set-reason')
  const unknown = $derived(value === undefined)
  const sent = $derived(writeOnly && !unknown)
  setFieldContext({
    get describedBy() {
      return disabledReason ? reasonId : undefined
    },
    get blocked() {
      return false
    },
  })

  const choiceOptions = $derived(
    choice
      ? [
          { value: 'on' as const, label: choice.on },
          { value: 'off' as const, label: choice.off },
        ]
      : [],
  )
  let target: 'on' | 'off' | null = $state(null)
</script>

<Module {title} description={hint} head={choice ? undefined : headControl} foot={disabledReason ? reason : undefined}>
  {#if choice}
    <div class="choice">
      <KeyGroup
        options={choiceOptions}
        value={unknown ? null : value ? 'on' : 'off'}
        label={title}
        size="sm"
        confidence={unknown ? 'unknown' : sent ? 'sent' : 'solid'}
        {sentAt}
        disabled={disabled || pending}
        pendingValue={pending ? target : null}
        onchange={(v) => {
          target = v
          onchange(v === 'on')
        }}
      />
    </div>
  {/if}
</Module>

{#snippet reason()}
  <ConfidenceNote kind="disabled" id={reasonId} text={disabledReason ?? ''} />
{/snippet}

{#snippet headControl()}
  {#if unknown || writeOnly}
    <SendPair value={unknown ? null : !!value} label={title} {sentAt} {pending} disabled={disabled || !!disabledReason} {onchange} />
  {:else}
    <SlideSwitch checked={!!value} label={title} {pending} disabled={disabled || !!disabledReason} onchange={(v) => onchange(v)} />
  {/if}
{/snippet}

<style>
  .choice {
    max-width: 260px;
  }
</style>
