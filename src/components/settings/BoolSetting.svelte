<script lang="ts">
  /**
   * One receiver feature setting as a faceplate module: title, the control at the head (or a
   * key row in the body for a two-way choice such as "15min | Never"), the description, and a
   * footnote saying how much is known about the value. It never invents a state:
   *  - read back (live):            slide switch, ON / OFF in the track
   *  - sent, not confirmed:         "Off | On" send pair with the last value marked (hatch)
   *                                 + "Last sent 17:42 · not confirmed"
   *  - unknown (never read / sent): "Off | On" with nothing marked + "Not read"
   *  - disabled:                    flat control + the reason in words
   */
  import Module from '../../lib/ui/Module.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import { setFieldContext, uid } from '../../lib/ui/field'

  interface Props {
    title: string
    description?: string
    value: boolean | undefined
    /** Replies are dropped by the OS: a known value is what this browser sent last. */
    writeOnly?: boolean
    pending?: boolean
    disabled?: boolean
    disabledReason?: string | null
    /** A two-way choice instead of a switch, e.g. { on: '15min', off: 'Never' } (shown in that order). */
    choice?: { on: string; off: string } | null
    /** A standing footnote, e.g. "Changing it restarts the receiver." */
    note?: string
    /** When this page sent the value (write-only caption). */
    sentAt?: number | null
    onchange: (value: boolean) => void
  }

  let {
    title,
    description,
    value,
    writeOnly = false,
    pending = false,
    disabled = false,
    disabledReason = null,
    choice = null,
    note,
    sentAt = null,
    onchange,
  }: Props = $props()

  const noteId = uid('set-note')
  const unknown = $derived(value === undefined)
  const sent = $derived(writeOnly && !unknown)
  const confidenceText = $derived(unknown || sent || !!disabledReason)
  const hasFoot = $derived(confidenceText || !!note)
  setFieldContext({
    get describedBy() {
      return confidenceText ? noteId : undefined
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

<Module {title} {description} head={choice ? undefined : headControl} foot={hasFoot ? footNotes : undefined}>
  {#if choice}
    <div class="choice">
      <KeyGroup
        options={choiceOptions}
        value={unknown ? null : value ? 'on' : 'off'}
        label={title}
        size="sm"
        confidence={sent ? 'sent' : 'solid'}
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

{#snippet footNotes()}
  {#if disabledReason}
    <ConfidenceNote kind="disabled" id={noteId} text={disabledReason} />
  {:else if sent}
    <ConfidenceNote
      kind="sent"
      id={noteId}
      at={sentAt}
      text={sentAt ? undefined : 'Last sent from this browser · not confirmed'}
    />
  {:else if unknown}
    <ConfidenceNote kind="unknown" id={noteId} text={writeOnly ? 'Not read' : "Not read: the receiver didn't report it"} />
  {/if}
  {#if note}<p class="note">{note}</p>{/if}
{/snippet}

{#snippet headControl()}
  {#if unknown || writeOnly}
    <SendPair value={unknown ? null : !!value} label={title} {pending} disabled={disabled || !!disabledReason} {onchange} />
  {:else}
    <SlideSwitch checked={!!value} label={title} {pending} disabled={disabled || !!disabledReason} onchange={(v) => onchange(v)} />
  {/if}
{/snippet}

<style>
  .choice {
    max-width: 260px;
  }
  .note {
    font-size: 12px;
    line-height: var(--lh-body);
    color: var(--ink-3);
  }
  .note:not(:first-child) {
    margin-top: 6px;
  }
</style>
