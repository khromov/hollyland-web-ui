<script lang="ts">
  /**
   * Voice-effect profiles as a preset bank. Each key carries the profile's EQ curve, computed from
   * the same biquads the DSP runs (toneCurve.ts), against a dashed flat line.
   * - Effect switch: off clears both channels (remembered); picking any profile switches it on.
   * - "Same profile on both channels" (audio.fxLinked); unlinked, two keys choose which channel the
   *   bank edits, and lamps on the keys show which channel uses which profile. "No effect on …"
   *   sets the channel being edited back to the raw sound.
   * Each profile's description is its key's tooltip; nothing is printed under the bank.
   */
  import { audio } from '../../lib/state/audio.svelte'
  import { VOICE_PRESETS, findPreset } from '../../lib/audio/voicefx'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import type { UsbChannelMeter } from '../../lib/ui/meters'
  import type { KeyOption, LampColor } from '../../lib/ui/types'
  import { curvePath } from './toneCurve'

  interface Props {
    channels: [UsbChannelMeter, UsbChannelMeter]
  }
  let { channels }: Props = $props()

  const CW = 72
  const CH = 30

  let target: 0 | 1 = $state(0)
  let width = $state(0)
  const cols = $derived(width > 0 && width < 560 ? 2 : 4)
  const linked = $derived(audio.fxLinked)
  const editing = $derived(linked ? 0 : target)
  const unavailable = $derived(!!audio.fxError)

  const options: KeyOption<string>[] = VOICE_PRESETS.map((p) => ({ value: p.id, label: p.name, hint: p.description }))
  const lampColor = (c: 0 | 1): LampColor => (channels[c].tone === 'neutral' ? 'neutral' : channels[c].tone)

  const current = $derived(findPreset(audio.fx[editing]))
</script>

<div class="fx" bind:clientWidth={width}>
  {#if audio.fxError}
    <Banner tone="warning" title="Voice effects unavailable">{audio.fxError}</Banner>
  {/if}

  <div class="bar">
    <div class="link">
      <SlideSwitch
        checked={linked}
        label="Same profile on both channels"
        disabled={unavailable}
        onchange={(v) => audio.setFxLinked(v)}
      />
      <span class="lbl" aria-hidden="true">Same profile on both channels</span>
    </div>
    {#if !linked}
      <div class="target" role="radiogroup" aria-label="Channel the profiles apply to">
        {#each [0, 1] as const as c (c)}
          {@const on = target === c}
          <button
            type="button"
            role="radio"
            aria-checked={on}
            tabindex={on ? 0 : -1}
            class="mc-key mc-key--sm"
            class:is-selected={on}
            disabled={unavailable}
            onclick={() => (target = c)}
            onkeydown={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                target = target === 0 ? 1 : 0
                ;(e.currentTarget.parentElement?.children[target] as HTMLElement | undefined)?.focus()
              }
            }}
          >
            <Lamp color={lampColor(c)} size="sm" />
            <span>{channels[c].label}</span>
            <span class="what">{findPreset(audio.fx[c])?.name ?? 'Off'}</span>
          </button>
        {/each}
      </div>
    {/if}
    <div class="master" title="Picking a profile also switches it on">
      <span class="lbl" aria-hidden="true">Effect</span>
      <SlideSwitch
        checked={audio.fxEnabled}
        label="Voice effect"
        disabled={unavailable}
        onchange={(v) => audio.setFxEnabled(v)}
      />
    </div>
  </div>

  <div class="bank">
    <KeyGroup
      {options}
      value={audio.fx[editing] ?? null}
      label={linked ? 'Voice profile' : `Voice profile for ${channels[editing].label}`}
      columns={cols}
      disabled={unavailable}
      onchange={(id) => audio.setFx(editing, id)}
    >
      {#snippet item(o, on)}
        {@const g = curvePath(o.value, CW, CH, 16)}
        {@const uses = [0, 1].filter((c) => audio.fx[c] === o.value) as (0 | 1)[]}
        <span class="pk">
          <span class="nm">{o.label}</span>
          {#if !linked && uses.length}
            <span class="uses" aria-hidden="true">
              {#each uses as c (c)}
                <span class="use"><Lamp color={lampColor(c)} size="sm" />{channels[c].side}</span>
              {/each}
            </span>
          {/if}
          {#if !linked && uses.length}
            <span class="visually-hidden">, used on {uses.map((c) => channels[c].label).join(' and ')}</span>
          {/if}
          <svg class="curve" class:on width={CW} height={CH} viewBox="0 0 {CW} {CH}" preserveAspectRatio="none" aria-hidden="true">
            <path class="flat" d="M0 {g.flat}H{CW}" vector-effect="non-scaling-stroke" />
            <path class="line" d={g.d} vector-effect="non-scaling-stroke" />
          </svg>
        </span>
      {/snippet}
    </KeyGroup>
  </div>

  {#if !unavailable && !linked && current}
    <div class="foot">
      <button type="button" class="mc-key mc-key--sm" onclick={() => audio.setFx(editing, null)}
        >No effect on {channels[editing].label}</button
      >
    </div>
  {/if}
</div>

<style>
  .fx {
    display: grid;
    gap: 12px;
    min-width: 0;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 24px;
    min-height: var(--hit);
  }
  .link,
  .master {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }
  .master {
    margin-left: auto;
  }
  .lbl {
    font-size: 14px;
    font-weight: 560;
    color: var(--ink);
  }
  .target {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .target .mc-key {
    gap: 8px;
  }
  .target .what {
    font-weight: 450;
    opacity: 0.8;
  }

  /* Preset keys: name left, curve right, like a hardware preset bank. */
  .bank :global(.mc-key) {
    min-height: 60px;
    padding: 10px 12px 10px 14px;
    justify-content: stretch;
    text-align: left;
    white-space: normal;
  }
  .pk {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'nm curve' 'uses curve';
    align-items: center;
    column-gap: 10px;
    row-gap: 6px;
    width: 100%;
  }
  .nm {
    grid-area: nm;
    font-size: 14px;
    font-weight: 620;
    line-height: 1.2;
  }
  .uses {
    grid-area: uses;
    display: inline-flex;
    gap: 10px;
  }
  .use {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: 500 12px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
  }
  .curve {
    grid-area: curve;
    flex: none;
    overflow: visible;
  }
  .flat {
    stroke: var(--ink-3);
    stroke-width: 1;
    stroke-dasharray: 2 3;
    opacity: 0.8;
  }
  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .curve.on .line {
    stroke: var(--sel-ink);
  }
  .curve.on .flat {
    stroke: var(--sel-ink);
    opacity: 0.5;
  }
  .bank :global(.mc-key:disabled .line) {
    stroke: var(--ink-3);
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
  }
  @media (max-width: 599px) {
    .bar {
      display: grid;
      gap: 6px;
    }
    .master {
      order: -1;
      margin-left: 0;
    }
    .link,
    .master {
      justify-content: space-between;
      min-height: var(--hit);
    }
    .link {
      flex-direction: row-reverse;
    }
    .target {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .pk {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: 'nm' 'curve' 'uses';
      justify-items: start;
    }
    .bank :global(.mc-key) {
      min-height: 84px;
      padding: 10px 12px;
      align-items: flex-start;
    }
    .curve {
      width: 100%;
      height: 26px;
    }
  }
</style>
