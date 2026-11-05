<script lang="ts">
  /**
   * Continuous fader (0–100 %) in the look of the detent fader: recessed slot, ink fill, mixer cap.
   * A native range input sits over the drawing, so keyboard, pointer and assistive tech get the
   * platform slider (arrows step 1 %, PageUp/PageDown 10 %, Home/End to the ends).
   * Local to the Audio page: the shared Fader is for a few numbered stops ("3 of 6").
   */
  interface Props {
    /** 0..1 */
    value: number
    label: string
    disabled?: boolean
    onchange?: (v: number) => void
  }
  let { value, label, disabled = false, onchange }: Props = $props()

  const pct = $derived(Math.round(Math.max(0, Math.min(1, value)) * 100))
  const MARKS = [0, 25, 50, 75, 100]
</script>

<div class="fader" class:flat={disabled}>
  <span class="slot" aria-hidden="true"></span>
  <span class="fill" aria-hidden="true" style="width: calc((100% - 32px) * {pct / 100})"></span>
  {#each MARKS as m (m)}
    <span class="det" class:cur={pct === m} aria-hidden="true" style="left: calc(16px + (100% - 32px) * {m / 100})"
      ><b>{m}</b></span
    >
  {/each}
  <input
    type="range"
    min="0"
    max="100"
    step="1"
    value={pct}
    aria-label={label}
    aria-valuetext={pct === 0 ? 'Off' : `${pct} percent`}
    {disabled}
    oninput={(e) => onchange?.(Number(e.currentTarget.value) / 100)}
  />
  <span class="cap" aria-hidden="true" style="left: calc(16px + (100% - 32px) * {pct / 100})"></span>
</div>

<style>
  .fader {
    position: relative;
    width: 100%;
    height: 66px;
  }
  .slot,
  .fill {
    position: absolute;
    top: 24px;
    height: 6px;
    border-radius: 3px;
  }
  .slot {
    left: 16px;
    right: 16px;
    background: var(--chassis-2);
    box-shadow:
      inset 0 1px 2px rgb(0 0 0 / 0.35),
      0 0 0 1px color-mix(in srgb, var(--key-edge) 60%, transparent);
  }
  .fill {
    left: 16px;
    background: var(--ink);
  }
  .det {
    position: absolute;
    top: 0;
    height: 100%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
  }
  .det::before {
    content: '';
    width: 1px;
    height: 8px;
    margin-top: 8px;
    background: var(--ink-3);
  }
  .det b {
    position: absolute;
    bottom: 2px;
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    color: var(--ink-3);
  }
  .det.cur b {
    color: var(--ink);
    font-weight: 750;
  }
  .cap {
    position: absolute;
    top: 9px;
    width: 22px;
    height: 36px;
    transform: translateX(-50%);
    border-radius: var(--r-cap);
    background: var(--key);
    border: 1.5px solid var(--ink);
    box-shadow:
      0 2px 0 var(--key-shadow),
      inset 0 1px 0 var(--key-hi);
    pointer-events: none;
  }
  .cap::after {
    content: '';
    position: absolute;
    left: 3px;
    right: 3px;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    background: var(--ink);
  }
  /* The native slider spans the drawing; its thumb lines up with the cap (16 px insets). */
  input {
    position: absolute;
    inset: 0 0 18px;
    width: 100%;
    height: auto;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 32px;
    height: 44px;
  }
  input::-moz-range-thumb {
    width: 32px;
    height: 44px;
    border: 0;
  }
  input:focus-visible + .cap {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .flat input {
    cursor: not-allowed;
  }
  .flat .fill {
    background: var(--ink-3);
  }
  .flat .cap {
    border-color: var(--ink-3);
    box-shadow: none;
    background: var(--chassis-2);
  }
  .flat .cap::after {
    background: var(--ink-3);
  }
</style>
