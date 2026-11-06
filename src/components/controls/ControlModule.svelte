<script lang="ts">
  /**
   * One faceplate module drawn from a ModuleDef (controls.ts buildModules): the title, an on/off
   * switch at the head (NC, reverb, LED) or the value of a detent fader ("4/6"), the body
   * controls, and the block reasons in a few words, printed only while blocked.
   *  - A body control blocked because the head switch is off shows nothing chosen; the reason
   *    stays with assistive tech and the toast (the switch above already says OFF).
   *  - A reason said once above the whole strip (`shared`) is not repeated here.
   * Put modules in <Modules> for the hairline-divided strip.
   */
  import Module from '../../lib/ui/Module.svelte'
  import { uid } from '../../lib/ui/field'
  import { confidenceNote } from '../../lib/ui/confidence'
  import Note from '../overview/Note.svelte'
  import ControlInput from './ControlInput.svelte'
  import { displayNumber, formatNumber, isBipolar, isDetent, stopCount, subLabel, type ModuleDef } from './controls'
  import { shown, viewOf } from './write'

  interface Props {
    def: ModuleDef
    /** A reason printed once for the whole strip: modules it blocks point at it instead of repeating it. */
    shared?: { text: string; id: string } | null
    class?: string
  }
  let { def, shared = null, class: klass = '' }: Props = $props()

  const head = $derived(def.head)
  const headView = $derived(head ? viewOf(head) : null)
  /** The head switch reads OFF: what it enables is blocked by it, not by something to explain. */
  const headOff = $derived(!!head && headView?.value === false)
  const body = $derived(def.body.filter((s) => shown(s)))

  const noteIds = new Map<string, string>()
  function noteId(text: string): string {
    let id = noteIds.get(text)
    if (!id) {
      id = uid('mod-reason')
      noteIds.set(text, id)
    }
    return id
  }

  const rows = $derived(
    body.map((spec) => {
      const v = viewOf(spec)
      const quiet = headOff && !!v.reason
      return { spec, reason: v.reason, quiet }
    }),
  )
  /** Reasons printed in this module (in order, once each). */
  const printed = $derived.by(() => {
    const out: string[] = []
    const add = (t: string | null | undefined) => {
      if (t && t !== shared?.text && !out.includes(t)) out.push(t)
    }
    add(headView?.reason)
    for (const r of rows) if (!r.quiet) add(r.reason)
    return out
  })
  /** Reasons said only to assistive tech (and the toast). */
  const quietReasons = $derived(
    [...new Set(rows.filter((r) => r.quiet && r.reason && !printed.includes(r.reason)).map((r) => r.reason!))],
  )
  const reasonIdOf = (t: string | null) => (!t ? undefined : t === shared?.text ? shared.id : noteId(t))

  /** Labels over body controls only when there are several and they differ. */
  const subs = $derived.by(() => {
    if (body.length < 2) return body.map(() => null)
    const labels = body.map((s) => subLabel(s.label, def.title))
    const unique = new Set(labels).size === labels.length && !labels.some((l) => l.toLowerCase() === def.title.toLowerCase())
    return unique ? labels : body.map(() => null)
  })

  /** A single detent fader prints its value at the head ("4/6"), like the RX volume. */
  const lone = $derived(!head && body.length === 1 && isDetent(body[0]) ? body[0] : null)
  const loneView = $derived(lone ? viewOf(lone) : null)
  const loneValue = $derived(lone && typeof loneView?.value === 'number' ? displayNumber(lone, loneView.value) : null)
  const loneTotal = $derived(lone ? displayNumber(lone, lone.range!.max) : undefined)

  /** A single slider prints its value at the head too ("+4 dB"). */
  const loneRange = $derived(
    !head && body.length === 1 && (body[0].kind === 'range' || (body[0].kind === 'steps' && !isDetent(body[0]))) ? body[0] : null,
  )
  const rangeView = $derived(loneRange ? viewOf(loneRange) : null)
  const rangeUnknown = $derived(!rangeView || typeof rangeView.value !== 'number' || rangeView.confidence === 'unknown')
  const rangeText = $derived(
    loneRange && !rangeUnknown ? formatNumber(displayNumber(loneRange, rangeView!.value as number), isBipolar(loneRange)) : '–',
  )
  const rangeNote = $derived(rangeUnknown ? 'Unknown' : confidenceNote(rangeView!.confidence, rangeView!.sentAt))

  const isFader = (k: string) => k === 'range' || k === 'steps'

  /**
   * The receiver's firmware is too old for everything in this module: the title and the reason
   * only, like the tested products' gated features (no control that could never be used here).
   */
  const gated = $derived.by(() => {
    const all = [head, ...body].filter((s): s is NonNullable<typeof s> => !!s)
    const views = all.map((s) => viewOf(s))
    return views.length > 0 && views.every((v) => v.reasonCode === 'firmware-too-old') ? views[0].reason : null
  })
</script>

{#if gated}
  <Module title={def.title} description={def.description} class={klass}>
    <Note>{gated}</Note>
  </Module>
{:else}
<Module
  title={def.title}
  description={def.description}
  value={lone ? loneValue : undefined}
  total={lone ? (loneTotal ?? stopCount(lone)) : undefined}
  confidence={loneView?.confidence ?? 'solid'}
  sentAt={loneView?.sentAt ?? null}
  head={head ? headCtl : loneRange ? rangeHead : undefined}
  class={klass}
>
  {#each rows as r, i (r.spec.id)}
    {#if isFader(r.spec.kind) && !isDetent(r.spec)}
      <ControlInput
        spec={r.spec}
        hideValue={r.quiet}
        reasonId={reasonIdOf(r.reason)}
        caption={subs[i] ?? undefined}
        faderValue={!loneRange}
      />
    {:else if subs[i]}
      <div class="row">
        <span class="sub">{subs[i]}</span>
        <ControlInput spec={r.spec} hideValue={r.quiet} reasonId={reasonIdOf(r.reason)} />
      </div>
    {:else}
      <ControlInput spec={r.spec} hideValue={r.quiet} reasonId={reasonIdOf(r.reason)} />
    {/if}
  {/each}
  {#each printed as t (t)}
    <Note id={noteId(t)}>{t}</Note>
  {/each}
  {#each quietReasons as t (t)}
    <span class="visually-hidden" id={noteId(t)}>{t}</span>
  {/each}
</Module>
{/if}

{#snippet rangeHead()}
  {#if loneRange}
    <span class="hv" class:sent={rangeView?.confidence === 'sent' && !rangeUnknown} class:unknown={rangeUnknown} title={rangeNote}>
      {#if rangeView?.confidence === 'sent' && !rangeUnknown}<span class="mc-swatch mc-swatch--sent" aria-hidden="true"></span>{/if}
      <span class="v">{rangeText}</span>{#if loneRange.range?.unit && !rangeUnknown}<small>{loneRange.range.unit}</small>{/if}
    </span>
  {/if}
{/snippet}

{#snippet headCtl()}
  {#if head}
    <ControlInput spec={head} label={def.title} reasonId={reasonIdOf(headView?.reason ?? null)} inline />
  {/if}
{/snippet}

<style>
  .row {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .row + .row {
    margin-top: 4px;
  }
  .sub {
    font-size: 12px;
    line-height: 1.3;
    color: var(--ink-2);
  }
  /* A slider's value at the head, like ValueHead ("+4 dB"). */
  .hv {
    display: inline-flex;
    align-items: baseline;
    font: 500 var(--t-value) / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .hv small {
    margin-left: 4px;
    font-size: 14px;
    color: var(--ink-3);
    letter-spacing: 0;
  }
  .hv .mc-swatch {
    align-self: center;
    margin-right: 8px;
  }
  .hv.sent .v {
    color: var(--ink-2);
  }
  .hv.unknown .v {
    color: var(--ink-3);
  }
</style>
