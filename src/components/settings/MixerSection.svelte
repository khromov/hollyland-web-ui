<script lang="ts">
  /**
   * MELO P1 mixer: one channel strip per track (Mic 1, Mic 2, instrument, background music) and per
   * output (2.4 GHz monitor, wired monitor, USB): the level the receiver pushes (no microphone
   * permission needed), the fader and a mute key. Levels stream only while this is on screen
   * (session.useLevels). Rendered by the Mixer page (src/components/mixer/MixerPage.svelte).
   */
  import { onMount } from 'svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import MeterWindow from '../../lib/ui/MeterWindow.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import { DB_FLOOR } from '../../lib/audio/levels'
  import { controlKey, melo, type ControlSpec, type UnitId } from '../../lib/protocol'
  import { session } from '../../lib/state/session.svelte'
  import { micNames } from '../overview/family/names.svelte'
  import RangeSlider from './RangeSlider.svelte'
  import ControlModule from './ControlModule.svelte'
  import { formatRaw } from './controls'
  import { reportResult } from './feedback'

  const C = melo.MELO_CONTROL

  type Level = (l: melo.MeloLevels) => number | undefined
  interface Strip {
    key: string
    name: string
    volume: string
    mute: string
    unit?: UnitId
    level: Level
  }

  const lr = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : Math.max(a ?? DB_FLOOR, b ?? DB_FLOOR))
  const INPUTS: Strip[] = [
    { key: 'tx1', name: '', volume: C.MIC_VOLUME, mute: C.MIC_MUTE, unit: 'tx1', level: (l) => l.inputs?.mic1 },
    { key: 'tx2', name: '', volume: C.MIC_VOLUME, mute: C.MIC_MUTE, unit: 'tx2', level: (l) => l.inputs?.mic2 },
    { key: 'inst', name: 'Instrument', volume: C.INSTRUMENT_VOLUME, mute: C.INSTRUMENT_MUTE, level: (l) => l.inputs?.instrument },
    { key: 'bgm', name: 'Backing track', volume: C.BGM_VOLUME, mute: C.BGM_MUTE, level: (l) => lr(l.inputs?.bgmL, l.inputs?.bgmR) },
  ]
  const OUTPUTS: Strip[] = [
    { key: 'wireless', name: 'Wireless monitoring', volume: C.WIRELESS_OUT_VOLUME, mute: C.WIRELESS_OUT_MUTE, level: (l) => lr(l.outputs?.wirelessL, l.outputs?.wirelessR) },
    { key: 'wired', name: 'Wired monitoring', volume: C.WIRED_OUT_VOLUME, mute: C.WIRED_OUT_MUTE, level: (l) => lr(l.outputs?.wiredL, l.outputs?.wiredR) },
    { key: 'usb', name: 'USB', volume: C.USB_OUT_VOLUME, mute: C.USB_OUT_MUTE, level: (l) => lr(l.outputs?.usbL, l.outputs?.usbR) },
  ]

  const nameOf = (s: Strip) => (s.unit ? micNames.name(s.unit, session.micState?.units[s.unit]) : s.name)
  const has = (s: Strip) => !!session.control(s.volume) && (!s.unit || !!session.micState?.units[s.unit])
  const inputs = $derived(INPUTS.filter(has))
  /** "Scenario" (chat / singing / instrument): how the receiver mixes the tracks. */
  const scenario = $derived(session.control(C.WORK_MODE))
  const outputs = $derived(OUTPUTS.filter(has))

  // Device-pushed levels while the mixer is on screen.
  onMount(() => session.useLevels())
  const streaming = $derived(session.hasDeviceLevels && session.levelsActive && session.live)

  const ready = $derived(session.phase === 'ready')

  async function write(spec: ControlSpec, value: number | boolean, unit?: UnitId) {
    reportResult(await session.setControl(spec.id, value, { unit }))
  }
</script>

{#snippet strip(s: Strip)}
  {@const vol = session.control(s.volume)!}
  {@const mute = session.control(s.mute)}
  {@const v = session.value(s.volume, s.unit)}
  {@const m = mute ? session.value(s.mute, s.unit) : undefined}
  {@const muteConf = mute ? session.confidence(s.mute, s.unit) : 'unknown'}
  {@const block = session.blockText(s.volume, s.unit)}
  {@const muteBlock = mute ? session.blockText(s.mute, s.unit) : null}
  {@const name = nameOf(s)}
  {@const r = vol.range!}
  <Module title={name}>
    {#snippet head()}
      <span class="head">
        <span class="val" title={session.confidence(s.volume, s.unit) === 'sent' ? 'Last sent · not confirmed' : undefined}
          >{typeof v === 'number' ? formatRaw(vol, v, false) : '–'}</span
        >
        {#if mute}
          <Key
            size="sm"
            selected={m === true}
            confidence={muteConf}
            disabled={!ready || !!muteBlock}
            loading={session.isPending(s.mute, s.unit)}
            aria-label="Mute {name}"
            onclick={() => write(mute, m !== true, s.unit)}>Mute</Key
          >
        {/if}
      </span>
    {/snippet}
    <MeterWindow
      variant="compact"
      label={name}
      muted={m === true}
      state={streaming ? 'live' : 'nodevice'}
      message={streaming ? undefined : 'No levels'}
      read={() => {
        const l = session.levels
        const db = l ? s.level(l) : undefined
        return db === undefined ? null : { rmsDb: db, peakDb: db }
      }}
    />
    <RangeSlider
      min={r.min}
      max={r.max}
      step={r.step || 1}
      value={typeof v === 'number' ? v : null}
      label="{name} level"
      disabled={!ready || !!block}
      pending={session.isPending(s.volume, s.unit)}
      confidence={session.confidence(s.volume, s.unit)}
      sentAt={session.sentAt[controlKey(s.volume, s.unit)] ?? null}
      marks={[r.min, r.max]}
      format={(x) => formatRaw(vol, x, false)}
      onchange={(x) => write(vol, x, s.unit)}
    />
    {#if block}<ConfidenceNote kind="disabled" text={block} />{/if}
  </Module>
{/snippet}

{#if inputs.length || scenario}
  <Panel title="Mixer">
    {#if scenario}
      <div class="mods scenario">
        <Modules columns="minmax(0, 1fr)">
          <ControlModule spec={scenario} />
        </Modules>
      </div>
    {/if}
    <div class="mods">
      <Modules columns="repeat(auto-fit, minmax(min(100%, 240px), 1fr))">
        {#each inputs as s (s.key)}{@render strip(s)}{/each}
      </Modules>
    </div>
  </Panel>
{/if}
{#if outputs.length}
  <Panel title="Outputs">
    <div class="mods">
      <Modules columns="repeat(auto-fit, minmax(min(100%, 240px), 1fr))">
        {#each outputs as s (s.key)}{@render strip(s)}{/each}
      </Modules>
    </div>
  </Panel>
{/if}

<style>
  .mods {
    min-width: 0;
  }
  .scenario {
    border-bottom: 1px solid var(--rule);
  }
  .scenario :global(.keys) {
    max-width: 480px;
  }
  .head {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .val {
    min-width: 2ch;
    text-align: right;
    font: 500 20px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
