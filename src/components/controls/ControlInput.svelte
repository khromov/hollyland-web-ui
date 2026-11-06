<script lang="ts">
  /**
   * One control drawn from its ControlSpec, wired to the session (value, confidence, pending,
   * block reason, write, confirmation):
   *   switch  SlideSwitch when the value is read back; "Off | On" SendPair when it can't be read
   *           (write-only link) or the receiver didn't report it
   *   choice  KeyGroup; values the official app refuses here are flat, the reason in the tooltip
   *   steps   detent Fader (up to 10 stops), otherwise RangeFader
   *   range   RangeFader with its unit ("+4 dB")
   *   action  a key ("Start Pairing")
   * A blocked control is flat and swallows input (Blockable); the reason is printed by the module
   * (`reasonId`) or under the control. A write that needs a confirmation (restart, reset) opens a
   * one-sentence dialog first.
   */
  import { RotateCcw } from '@lucide/svelte'
  import type { ControlSpec, ControlValue, UnitId } from '../../lib/protocol/app'
  import { session, type ConfirmInfo } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import Fader from '../../lib/ui/Fader.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import { uid } from '../../lib/ui/field'
  import Blockable from '../overview/Blockable.svelte'
  import RangeFader from './RangeFader.svelte'
  import Note from '../overview/Note.svelte'
  import {
    QUIET_OPTION_REASONS,
    actionLabel,
    choiceOptions,
    displayNumber,
    formatValue,
    isDetent,
    keyColumns,
    stopCount,
  } from './controls'
  import { optionBlock, sendControl, viewOf } from './write'

  interface Props {
    spec: ControlSpec
    unit?: UnitId
    /** Accessible name (defaults to the spec's label). */
    label?: string
    /** Keys: show nothing chosen (e.g. NC levels while NC is off: the switch above says it). */
    hideValue?: boolean
    /** id of the element that prints the block reason (the module, or a strip-wide note). */
    reasonId?: string
    /** Print the block reason under the control when no `reasonId` is given. */
    showReason?: boolean
    /** Key size of a choice. */
    keySize?: 'sm' | 'md'
    /** Faders: 'lg' as a module's main control, 'sm' in a compact row. */
    faderSize?: 'lg' | 'sm'
    /** Faders: print the value (otherwise the module head shows it). */
    faderValue?: boolean
    /** Range fader: words left of its value ("Level 1"). */
    caption?: string
    /** Lay the wrapper out inline (a control at a module head or in a stat cell). */
    inline?: boolean
    /** Legends of a switch drawn as send keys ("Off | On" by default). */
    legends?: { on: string; off: string }
  }
  let {
    spec,
    unit,
    label,
    hideValue = false,
    reasonId,
    showReason = false,
    keySize = 'md',
    faderSize = 'lg',
    faderValue = false,
    caption,
    inline = false,
    legends,
  }: Props = $props()

  const name = $derived(label ?? spec.label)
  const view = $derived(viewOf(spec, unit))
  /** Keys show nothing chosen while hidden; a fader keeps its position (flat), never the unknown look. */
  const hide = $derived(hideValue && (spec.kind === 'choice' || spec.kind === 'switch'))
  const value = $derived(hide ? undefined : view.value)
  const confidence = $derived(hide ? 'solid' : view.confidence)
  const writeOnly = $derived(session.writeOnly)

  // ------------------------------------------------------------------ write + confirm
  let ask = $state<{ value: ControlValue; info: ConfirmInfo } | null>(null)
  let target = $state<ControlValue | null>(null)
  const descId = uid('confirm')

  function write(v: ControlValue) {
    const info = session.confirmFor(spec.id, v, unit)
    if (info) {
      ask = { value: v, info }
      return
    }
    target = v
    void sendControl(spec.id, v, { unit })
  }
  function confirm() {
    const a = ask
    ask = null
    if (!a) return
    target = a.value
    void sendControl(spec.id, a.value, { unit, confirm: true })
  }
  const askValue = $derived(ask ? (spec.kind === 'action' ? null : formatValue(spec, ask.value)) : null)

  // ------------------------------------------------------------------ kinds
  const options = $derived(spec.kind === 'choice' ? choiceOptions(spec, (v) => optionBlock(spec, v), view.value) : [])
  /** Values refused because of the current state ("Timecode is on"): said under the keys while it lasts. */
  const optionNotes = $derived.by(() => {
    if (spec.kind !== 'choice' || view.reason) return []
    const out: string[] = []
    for (const o of spec.options ?? []) {
      const b = optionBlock(spec, o.value)
      if (b && !QUIET_OPTION_REASONS.includes(b.code) && !out.includes(b.text)) out.push(b.text)
    }
    return out
  })
  const choiceValue = $derived(typeof value === 'number' ? value : null)
  const columns = $derived(keyColumns(options))

  const range = $derived(spec.range ?? { min: 0, max: 1, step: 1 })
  const detent = $derived(isDetent(spec))
  const steps = $derived(stopCount(spec))
  const stepIndex = $derived(typeof value === 'number' ? Math.round((value - range.min) / range.step) : null)
  const numValue = $derived(typeof value === 'number' ? value : null)
</script>

<Blockable reason={view.reason} {reasonId} {showReason} {inline}>
  {#if spec.kind === 'switch'}
    {#if writeOnly || typeof value !== 'boolean'}
      <SendPair
        value={typeof value === 'boolean' ? value : null}
        label={name}
        {legends}
        sentAt={view.sentAt}
        pending={view.pending}
        onchange={write}
      />
    {:else}
      <SlideSwitch checked={value} label={name} pending={view.pending} {confidence} sentAt={view.sentAt} onchange={write} />
    {/if}
  {:else if spec.kind === 'choice'}
    <KeyGroup
      {options}
      value={choiceValue}
      label={name}
      size={keySize}
      {columns}
      {confidence}
      sentAt={view.sentAt}
      pendingValue={view.pending && typeof target === 'number' ? target : null}
      onchange={write}
    />
    {#each optionNotes as t (t)}<Note>{t}</Note>{/each}
  {:else if (spec.kind === 'steps' && detent)}
    <Fader
      {steps}
      value={stepIndex}
      label={name}
      pending={view.pending}
      {confidence}
      sentAt={view.sentAt}
      showValue={faderValue}
      format={(i) => String(displayNumber(spec, range.min + i * range.step))}
      onchange={(i) => write(range.min + i * range.step)}
    />
  {:else if spec.kind === 'steps' || spec.kind === 'range'}
    <RangeFader
      min={range.min}
      max={range.max}
      step={range.step}
      offset={range.displayOffset ?? 0}
      unit={range.unit ?? ''}
      value={numValue}
      label={name}
      pending={view.pending}
      {confidence}
      sentAt={view.sentAt}
      size={faderSize}
      {caption}
      showValue={faderValue}
      onchange={write}
    />
  {:else if spec.kind === 'action'}
    <div class="action">
      <Button size="sm" loading={view.pending} onclick={() => write(true)}>{actionLabel(spec)}</Button>
    </div>
  {/if}
</Blockable>

{#snippet restartIcon()}<RotateCcw size={20} />{/snippet}

{#if ask}
  <Dialog
    open
    title={ask.info.kind === 'restart' ? 'Restart the receiver?' : ask.info.title}
    icon={ask.info.kind === 'restart' ? restartIcon : undefined}
    onclose={() => (ask = null)}
    describedby={descId}
  >
    {#if askValue !== null}<p>{ask.info.title}: <strong>{askValue}</strong></p>{/if}
    {#if ask.info.kind === 'restart' && audio.recording}
      <p class="warn" id={descId}>A recording is running and may be lost.</p>
    {:else}
      <p id={descId}>{ask.info.text}</p>
    {/if}
    {#snippet actions()}
      <!-- svelte-ignore a11y_autofocus -->
      <Button variant="secondary" autofocus onclick={() => (ask = null)}>Cancel</Button>
      <Button variant="primary" onclick={confirm}>{ask?.info.kind === 'restart' ? 'Restart and apply' : ask?.info.action}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .action {
    display: flex;
  }
  strong {
    color: var(--ink);
    font-weight: 650;
  }
  .warn {
    color: var(--ink);
    font-weight: 600;
  }
</style>
