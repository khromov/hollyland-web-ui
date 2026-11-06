<script lang="ts">
  /**
   * One control of a non-legacy product (ControlSpec, docs/FAMILIES.md §4.1) as a faceplate module:
   *  - switch  → slide switch at the head ("Off | On" send keys when not read back)
   *  - choice  → key row (a two-value choice can be drawn as a switch: `switchOn`)
   *  - steps   → detent fader (≤ 11 stops) or the range slider; the value at the head
   *  - range   → range slider with the value and unit at the head
   *  - action  → a key at the head
   * Confidence (read back / last sent / unknown) is the control's own look and tooltip. A block
   * reason (a few words) sits in the module's foot only while blocked. Controls that restart the
   * receiver, reset or change mode ask first (session.confirmFor): one sentence, Cancel / confirm.
   * Sub-controls (`nested`) are drawn inside, disabled while the parent switch is off.
   */
  import type { Snippet } from 'svelte'
  import { RotateCcw } from '@lucide/svelte'
  import Self from './ControlModule.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Fader from '../../lib/ui/Fader.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import { uid } from '../../lib/ui/field'
  import { confidenceNote } from '../../lib/ui/confidence'
  import { controlKey, type ControlSpec, type ControlValue, type UnitId } from '../../lib/protocol'
  import { session, type ConfirmInfo } from '../../lib/state/session.svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import RangeSlider from './RangeSlider.svelte'
  import { reportResult } from './feedback'
  import { formatRaw, isSigned, scaleMarks, shownNumber, signedNumber, stopCount, valueWords } from './controls'
  import { HIDDEN_OPTION_REASONS, actionLabel, cleanLabel, optionReason } from '../controls/controls'
  import { reasonText } from '../../lib/state/reasons'
  import type { Item } from './placement'

  interface Props {
    spec: ControlSpec
    item?: Item
    unit?: UnitId
    /** Drawn inside a parent module. */
    nested?: boolean
    /** The parent switch is off: disabled, nothing marked, the reason said to assistive tech only. */
    parentOff?: boolean
    /** The block reason is printed elsewhere (once for the section, or by the parent). */
    quiet?: boolean
    /** Title override (e.g. a unit name in a per-unit list). */
    title?: string
    /** More content under the control (e.g. a readout, a related key). */
    children?: Snippet
    /** Only the control, no module around it (a sub-control under its parent's switch). */
    bare?: boolean
  }
  let { spec, item, unit, nested = false, parentOff = false, quiet = false, title, children, bare = false }: Props = $props()

  const reasonId = uid('ctl-reason')
  const confirmId = uid('ctl-confirm')

  const heading = $derived(title ?? item?.title ?? cleanLabel(spec.label))
  const key = $derived(controlKey(spec.id, unit))
  const ready = $derived(session.phase === 'ready')
  const writeOnly = $derived(session.writeOnly)
  const raw = $derived(session.value(spec.id, unit))
  const confidence = $derived(session.confidence(spec.id, unit))
  const sentAt = $derived(session.sentAt[key] ?? null)
  const pending = $derived(session.isPending(spec.id, unit))
  const block = $derived(session.blockText(spec.id, unit))
  const disabled = $derived(!ready || parentOff || !!block)
  /** The reason is printed in the foot (not when the parent's OFF switch already says it). */
  const showReason = $derived(!!block && !parentOff && !quiet)

  // ---- per kind
  const asSwitch = $derived(spec.kind === 'switch' && !item?.legends)
  const choiceSwitch = $derived(spec.kind === 'choice' && !!item?.switchOn)
  const switchValue = $derived.by((): boolean | undefined => {
    if (spec.kind === 'switch') return typeof raw === 'boolean' ? raw : undefined
    if (choiceSwitch && typeof raw === 'number') return raw === item!.switchOn!.on
    return undefined
  })
  /** On / off of this control when it is a switch (for nested sub-controls). */
  const off = $derived((asSwitch || choiceSwitch) && switchValue === false)
  const numeric = $derived(typeof raw === 'number' ? (item?.alias?.[raw] ?? raw) : null)

  const options = $derived(
    (spec.options ?? [])
      .filter((o) => !item?.hide?.includes(o.value))
      .flatMap((o) => {
        const code = optionReason(session.family, session.product, spec, o.value, session.micState?.values)
        // A value that can never be chosen here is left out, unless it is the current one.
        if (code && HIDDEN_OPTION_REASONS.includes(code) && o.value !== raw) return []
        const why = code ? reasonText({ ok: false, reason: code }) : null
        return [why ? { value: o.value, label: o.label, disabled: true, hint: why } : { value: o.value, label: o.label }]
      }),
  )
  const columns = $derived(
    options.length === 1 ? 2 : options.length > 4 ? (options.length % 3 === 0 ? 3 : Math.min(options.length, 4)) : undefined,
  )

  const stops = $derived(stopCount(spec))
  const detents = $derived(spec.kind === 'steps' && stops > 1 && stops <= 11)
  const slider = $derived((spec.kind === 'steps' && !detents) || spec.kind === 'range')

  const nestedSpecs = $derived(
    (item?.nested ?? []).map((id) => session.control(id)).filter((c): c is ControlSpec => !!c && !hiddenByFirmware(c.id)),
  )
  function hiddenByFirmware(id: string): boolean {
    return session.availability(id, unit)?.reason === 'firmware-too-new'
  }

  // ---- writes
  let target = $state<ControlValue | null>(null)
  let ask = $state<{ info: ConfirmInfo; value: ControlValue } | null>(null)

  function request(v: ControlValue) {
    if (disabled) return
    const info = session.confirmFor(spec.id, v, unit)
    if (info) {
      ask = { info, value: v }
      return
    }
    void send(v, false)
  }
  async function send(v: ControlValue, confirmed: boolean, info?: ConfirmInfo) {
    target = v
    const ok = await session.setControl(spec.id, v, { unit, confirm: confirmed })
    if (ok && info?.kind !== 'restart') reportResult(ok)
  }
  function apply() {
    const a = ask
    ask = null
    if (a) void send(a.value, true, a.info)
  }
  const askTitle = $derived.by(() => {
    if (!ask) return ''
    if (ask.info.kind === 'restart') return 'Restart the receiver?'
    if (spec.kind === 'action') return `${actionLabel(spec)}?`
    return `Change ${heading}?`
  })
  const askAction = $derived(ask ? (ask.info.kind === 'restart' ? 'Restart and apply' : ask.info.action) : '')
  const askValue = $derived(ask && spec.kind !== 'action' ? valueWords(spec, ask.value, item?.legends) : null)

  // ---- printed value (steps / range)
  const shownValue = $derived(
    numeric === null ? null : signedNumber(shownNumber(spec, numeric), isSigned(spec)),
  )
  const unitText = $derived(spec.range?.unit ?? null)
  const valueNote = $derived(numeric === null || confidence === 'unknown' ? 'Unknown' : confidenceNote(confidence, sentAt))
</script>

{#snippet head()}
  {#if spec.kind === 'action'}
    <Key size="sm" {disabled} loading={pending} onclick={() => request(true)}>{actionLabel(spec)}</Key>
  {:else if asSwitch || choiceSwitch}
    {@const onV = choiceSwitch ? item!.switchOn!.on : true}
    {@const offV = choiceSwitch ? item!.switchOn!.off : false}
    {#if (writeOnly || switchValue === undefined) && !parentOff}
      <SendPair
        value={switchValue ?? null}
        label={heading}
        {sentAt}
        {pending}
        {disabled}
        onchange={(v) => request(v ? onV : offV)}
      />
    {:else}
      <SlideSwitch
        checked={parentOff ? null : (switchValue ?? null)}
        label={heading}
        {pending}
        {disabled}
        onchange={(v) => request(v ? onV : offV)}
      />
    {/if}
  {:else if spec.kind === 'steps' || spec.kind === 'range'}
    <span
      class="vh"
      class:sent={confidence === 'sent' && shownValue !== null && !parentOff}
      role="img"
      aria-label={shownValue === null || parentOff ? 'Unknown' : `${shownValue}${unitText ? ` ${unitText}` : ''}${valueNote ? `, ${valueNote}` : ''}`}
      title={valueNote}
    >
      {#if confidence === 'sent' && shownValue !== null && !parentOff}<span class="mc-swatch mc-swatch--sent" aria-hidden="true"></span>{/if}
      <span aria-hidden="true">{shownValue === null || parentOff ? '–' : shownValue}</span>{#if unitText && shownValue !== null && !parentOff}<small
          aria-hidden="true">{unitText}</small
        >{/if}
    </span>
  {/if}
{/snippet}

{#snippet restartIcon()}<RotateCcw size={20} />{/snippet}

{#snippet foot()}
  <ConfidenceNote kind="disabled" id={reasonId} text={block ?? ''} />
{/snippet}

{#snippet control()}
  {#if spec.kind === 'switch' && item?.legends}
    <div class="keys narrow">
      <KeyGroup
        options={[
          { value: 'on' as const, label: item.legends.on },
          { value: 'off' as const, label: item.legends.off },
        ]}
        value={parentOff || switchValue === undefined ? null : switchValue ? 'on' : 'off'}
        label={heading}
        size="sm"
        confidence={parentOff ? 'solid' : confidence}
        {sentAt}
        {disabled}
        pendingValue={pending && typeof target === 'boolean' ? (target ? 'on' : 'off') : null}
        onchange={(v) => request(v === 'on')}
      />
    </div>
  {:else if spec.kind === 'choice' && !choiceSwitch}
    <div class="keys" class:narrow={options.length <= 2}>
      <KeyGroup
        {options}
        value={parentOff ? null : numeric}
        label={heading}
        size="sm"
        {columns}
        confidence={parentOff ? 'solid' : confidence}
        {sentAt}
        {disabled}
        pendingValue={pending && typeof target === 'number' ? target : null}
        onchange={(v) => request(v)}
      />
    </div>
  {:else if detents && spec.range}
    {@const r = spec.range}
    <Fader
      steps={stops}
      value={parentOff || numeric === null ? null : Math.round((numeric - r.min) / (r.step || 1))}
      label={heading}
      {disabled}
      {pending}
      {confidence}
      {sentAt}
      format={(i) => formatRaw(spec, r.min + i * (r.step || 1), false)}
      onchange={(i) => request(r.min + i * (r.step || 1))}
    />
  {:else if slider && spec.range}
    {@const r = spec.range}
    <RangeSlider
      min={r.min}
      max={r.max}
      step={r.step || 1}
      value={parentOff ? null : numeric}
      label={heading}
      {disabled}
      {pending}
      confidence={parentOff ? 'solid' : confidence}
      {sentAt}
      marks={scaleMarks(spec)}
      origin={isSigned(spec) ? -(r.displayOffset ?? 0) : undefined}
      format={(v) => formatRaw(spec, v, false)}
      onchange={(v) => request(v)}
    />
  {/if}
{/snippet}

{#if bare}
  <div class="bare">
    {@render control()}
    {#if showReason}{@render foot()}{/if}
    {#if block && (parentOff || quiet)}<span class="visually-hidden" id={reasonId}>{block}</span>{/if}
  </div>
{:else}
  <Module
    title={heading}
    {nested}
    pad={nested ? 'none' : 'receiver'}
    level={nested ? 4 : 3}
    head={spec.kind === 'choice' && !choiceSwitch ? undefined : spec.kind === 'switch' && item?.legends ? undefined : head}
    foot={showReason ? foot : undefined}
    class="ctl"
  >
    {@render control()}
    {@render children?.()}

    {#each nestedSpecs as child (child.id)}
      <Self spec={child} {unit} bare nested parentOff={off || parentOff} quiet={quiet || (!!block && session.blockText(child.id, unit) === block)} />
    {/each}

    {#if block && (parentOff || quiet)}<span class="visually-hidden" id={reasonId}>{block}</span>{/if}
  </Module>
{/if}

{#if ask}
  <Dialog
    open={!!ask}
    title={askTitle}
    tone={ask.info.kind === 'destructive' ? 'danger' : 'neutral'}
    icon={ask.info.kind === 'restart' ? restartIcon : undefined}
    onclose={() => (ask = null)}
    describedby="{confirmId}-what {confirmId}-effect"
  >
    {#if askValue !== null}
      <p id="{confirmId}-what">{heading}: <strong>{askValue}</strong></p>
    {/if}
    {#if ask.info.kind === 'restart' && audio.recording}
      <p class="dlg-warn" id="{confirmId}-effect">A recording is running and may be lost.</p>
    {:else}
      <p id="{confirmId}-effect">{ask.info.text}</p>
    {/if}
    {#snippet actions()}
      <!-- svelte-ignore a11y_autofocus -->
      <Button variant="secondary" autofocus onclick={() => (ask = null)}>Cancel</Button>
      <Button variant={ask?.info.kind === 'destructive' ? 'danger' : 'primary'} onclick={apply}>{askAction}</Button>
    {/snippet}
  </Dialog>
{/if}

<style>
  /* A switch-only module has no body: no empty row under its head. */
  :global(.ctl > .content:empty) {
    display: none;
  }
  .bare {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .keys {
    min-width: 0;
  }
  .keys.narrow {
    max-width: 260px;
  }
  .vh {
    display: inline-flex;
    align-items: baseline;
    gap: 0;
    font: 500 var(--t-value) / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .vh small {
    margin-left: 4px;
    font-size: 14px;
    color: var(--ink-3);
    letter-spacing: 0;
  }
  .vh .mc-swatch {
    align-self: center;
    margin-right: 8px;
  }
  .dlg-warn {
    color: var(--ink);
    font-weight: 600;
  }
  strong {
    color: var(--ink);
    font-weight: 650;
  }
</style>
