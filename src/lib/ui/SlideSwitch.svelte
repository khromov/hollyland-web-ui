<script lang="ts">
  /**
   * A slide switch: 62×30 track, 22 px knob with grip lines, and the legend (ON / OFF) printed
   * inside the track opposite the knob, so state never depends on colour. role="switch".
   * - checked null: unknown. Dashed track, no knob, "– –". It is a readout, not operable;
   *   for a write-only setting that can be sent blind use SendPair ("Off | On") instead.
   * - confidence 'sent': the position is what this browser last sent (outline + hatch).
   * - disabled or blocked: flat track.
   * The target is 44 px tall; the visual track is 30 px.
   */
  import type { Confidence } from './types'
  import { getFieldContext } from './field'

  interface Props {
    checked: boolean | null
    label: string
    disabled?: boolean
    pending?: boolean
    confidence?: Confidence
    /** Printed legends; keep them to three characters. */
    legends?: { on: string; off: string }
    id?: string
    onchange?: (checked: boolean) => void
  }

  let {
    checked,
    label,
    disabled = false,
    pending = false,
    confidence = 'solid',
    legends = { on: 'ON', off: 'OFF' },
    id,
    onchange,
  }: Props = $props()

  const field = getFieldContext()
  const unknown = $derived(checked === null || confidence === 'unknown')
  const blocked = $derived(field?.blocked ?? false)
</script>

<button
  {id}
  type="button"
  role="switch"
  class="switch"
  class:on={checked === true && !unknown}
  class:sent={confidence === 'sent' && !unknown}
  class:unknown
  class:flat={disabled || blocked}
  aria-checked={checked === true}
  aria-label={unknown ? `${label}, not read` : label}
  aria-busy={pending || undefined}
  aria-describedby={field?.describedBy}
  aria-disabled={blocked || unknown || undefined}
  {disabled}
  onclick={() => {
    if (unknown || blocked) return
    onchange?.(!checked)
  }}
>
  <span class="track" aria-hidden="true">
    {#if unknown}
      <span class="tx">– –</span>
    {:else}
      <span class="tx">{checked ? legends.on : legends.off}</span>
      <span class="knob">{#if pending}<span class="mc-spinner"></span>{/if}</span>
    {/if}
  </span>
</button>

<style>
  .switch {
    display: inline-flex;
    align-items: center;
    flex: none;
    min-height: var(--hit);
    padding: 0;
    border: 0;
    background: none;
    -webkit-tap-highlight-color: transparent;
  }
  .switch:focus-visible {
    outline: none;
  }
  .switch:focus-visible .track {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .track {
    position: relative;
    display: block;
    width: 62px;
    height: 30px;
    border-radius: var(--r-key);
    background: var(--chassis-2);
    border: 1px solid var(--key-edge);
    box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.18);
    transition: background-color var(--dur-fast) var(--ease);
  }
  .tx {
    position: absolute;
    top: 50%;
    right: 7px;
    transform: translateY(-50%);
    font: 650 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    letter-spacing: 0.02em;
    color: var(--ink-2);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-cap);
    background: var(--key);
    border: 1px solid var(--key-edge);
    box-shadow: 0 1px 1px rgb(0 0 0 / 0.22);
    transition: left var(--dur-fast) var(--ease);
  }
  .knob::before {
    content: '';
    position: absolute;
    inset: 6px 7px;
    background: repeating-linear-gradient(90deg, var(--key-edge) 0 1px, transparent 1px 3px);
  }
  .knob .mc-spinner {
    position: relative;
    z-index: 1;
    width: 12px;
    height: 12px;
    background: var(--key);
    color: var(--ink);
  }

  .on .track {
    background: var(--sel);
    border-color: var(--sel);
  }
  .on .tx {
    right: auto;
    left: 8px;
    color: var(--sel-ink);
  }
  .on .knob {
    left: 35px;
    border-color: var(--sel);
  }

  /* Sent, not confirmed: the track keeps the panel colour, outlined in ink over a hatch. */
  .sent .track,
  .sent.on .track {
    border: 2px solid var(--ink);
    background: var(--hatch), var(--chassis-2);
    box-shadow: none;
  }
  .sent .tx,
  .sent.on .tx {
    color: var(--ink);
  }
  .sent .knob {
    top: 2px;
    left: 2px;
  }
  .sent.on .knob {
    left: 34px;
    border-color: var(--ink);
  }

  /* Unknown: dashed, no knob, "– –". */
  .unknown {
    cursor: default;
  }
  .unknown .track {
    border: 1.5px dashed var(--ink-3);
    background: transparent;
    box-shadow: none;
  }
  .unknown .tx {
    left: 0;
    right: 0;
    text-align: center;
    color: var(--ink-3);
    letter-spacing: 0.08em;
  }

  /* Disabled / blocked: flat. */
  .flat .track {
    background: var(--chassis-2);
    border: 1px solid var(--rule);
    box-shadow: none;
  }
  .flat .tx,
  .flat.on .tx {
    color: var(--ink-3);
  }
  .flat .knob,
  .flat.on .knob {
    background: var(--chassis-2);
    border-color: var(--rule);
    box-shadow: none;
  }
  .flat .knob::before {
    background: repeating-linear-gradient(90deg, var(--rule) 0 1px, transparent 1px 3px);
  }
  .flat.on .track {
    background: color-mix(in srgb, var(--ink) 18%, var(--chassis-2));
  }
</style>
