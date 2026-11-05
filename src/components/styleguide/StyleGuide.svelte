<script lang="ts">
  /**
   * Dev-only style guide (#/styleguide): every Instrument primitive in every state.
   * Theme: the keys at the top (or ?theme=light|dark in the URL) switch the whole page.
   */
  import { onMount } from 'svelte'
  import { Pencil, Power, RotateCcw } from '@lucide/svelte'
  import { prefs, type ThemePref } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import type { KeyOption, MeterState } from '../../lib/ui/types'
  import { usbChannelMeters } from '../../lib/ui/meters'
  import Banner from '../../lib/ui/Banner.svelte'
  import Battery from '../../lib/ui/Battery.svelte'
  import BatteryCells from '../../lib/ui/BatteryCells.svelte'
  import BrandGlyph from '../../lib/ui/BrandGlyph.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Chip from '../../lib/ui/Chip.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import DisplayWindow from '../../lib/ui/DisplayWindow.svelte'
  import Fader from '../../lib/ui/Fader.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import KeyValue from '../../lib/ui/KeyValue.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import LevelMeter from '../../lib/ui/LevelMeter.svelte'
  import MeterWindow from '../../lib/ui/MeterWindow.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import StatusLine from '../../lib/ui/StatusLine.svelte'
  import StepBar from '../../lib/ui/StepBar.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import ValueHead from '../../lib/ui/ValueHead.svelte'
  import WriteOnlyBanner from '../WriteOnlyBanner.svelte'
  import Blocked from './Blocked.svelte'
  import { simSignal } from './sim'

  const THEMES: KeyOption<ThemePref>[] = [
    { value: 'light', label: 'Aluminium' },
    { value: 'dark', label: 'Graphite' },
    { value: 'system', label: 'System' },
  ]

  onMount(() => {
    const t = new URLSearchParams(location.search).get('theme')
    if (t === 'light' || t === 'dark' || t === 'system') prefs.setTheme(t)
  })

  // ---- live demo state ----
  let nc: 'weak' | 'medium' | 'strong' = $state('medium')
  let ncOff: 'off' | 'weak' | 'medium' | 'strong' = $state('off')
  let vol = $state(5)
  let mode: 'mono' | 'stereo' | 'safetr' = $state('stereo')
  let led = $state(true)
  let recog = $state(true)
  let belcanto = $state(false)
  let sentPair: boolean | null = $state(true)
  let dialogOpen = $state(false)
  let dangerOpen = $state(false)
  let meterState: MeterState = $state('idle')
  const sentAt = new Date(2026, 10, 5, 17, 42).getTime()

  const NC: KeyOption<'weak' | 'medium' | 'strong'>[] = [
    { value: 'weak', label: 'Weak' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
  ]
  const NC_OFF: KeyOption<'off' | 'weak' | 'medium' | 'strong'>[] = [
    { value: 'off', label: 'Off' },
    { value: 'weak', label: 'Weak' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
  ]
  const NC_WO: KeyOption<'off' | 'weak' | 'medium' | 'strong'>[] = [
    { value: 'off', label: 'Off', disabled: true },
    { value: 'weak', label: 'Weak' },
    { value: 'medium', label: 'Medium' },
    { value: 'strong', label: 'Strong' },
  ]
  const MODES: KeyOption<'mono' | 'stereo' | 'safetr'>[] = [
    { value: 'mono', label: 'Mono', glyph: 'mono' },
    { value: 'stereo', label: 'Stereo', glyph: 'stereo' },
    { value: 'safetr', label: 'SafeTr', glyph: 'safetr' },
  ]
  const TONES: KeyOption<string>[] = [
    { value: 'bright', label: 'Bright' },
    { value: 'low', label: 'Low' },
    { value: 'balance', label: 'Balance' },
  ]
  const PRESETS: [string, number[]][] = [
    ['Clean Voice', [20, 14, 12, 12, 12, 12, 12, 12, 13]],
    ['Vocal Boost', [18, 14, 12, 12, 11, 8, 7, 9, 11]],
    ['Warm & Solid', [14, 9, 8, 10, 12, 12, 13, 14, 15]],
    ['Warm & Resonant', [12, 8, 9, 8, 11, 12, 13, 13, 14]],
    ['Bright Youthful', [17, 14, 13, 12, 11, 9, 7, 6, 6]],
    ['Mellow & Full-bodied', [10, 8, 9, 11, 12, 13, 14, 15, 16]],
    ['Bright & Energetic', [19, 15, 12, 12, 10, 8, 7, 6, 7]],
    ['Rich & Full', [11, 8, 9, 11, 12, 11, 9, 8, 9]],
  ]
  const PRESET_OPTS: KeyOption<number>[] = PRESETS.map(([label], i) => ({ value: i, label }))
  let preset = $state(2)
  const curve = (pts: number[]) => pts.map((y, j) => `${j ? 'L' : 'M'}${j * 8} ${y}`).join(' ')

  const sig1 = simSignal(7, -19)
  const sig2 = simSignal(21, -28)
  const sig3 = simSignal(5, -9, { clipEvery: 4000 })
  const sigN = simSignal(11, -24)
  const STATES: MeterState[] = ['idle', 'starting', 'denied', 'paused', 'nodevice', 'error']

  const tokens = [
    ['--chassis', 'Faceplate'],
    ['--chassis-2', 'Recessed track, flat disabled face'],
    ['--key', 'Key face'],
    ['--key-edge', 'Key and switch outlines (3:1)'],
    ['--rule', 'Hairline divider'],
    ['--rule-soft', 'Soft divider'],
    ['--ink', 'Text, selected key'],
    ['--ink-2', 'Secondary text'],
    ['--ink-3', 'Tertiary, disabled labels'],
    ['--sel-ink', 'Text on a selected key'],
    ['--window', 'Display window'],
    ['--w-ink-2', 'Legend inside a window'],
    ['--mic1-ink', 'Mic 1 as text on the panel'],
    ['--mic2-ink', 'Mic 2 as text on the panel'],
    ['--live', 'Link lamp'],
    ['--rec', 'Record, clip, destructive'],
  ]
</script>

<div class="sg">
  <header class="top">
    <div class="brand">
      <BrandGlyph />
      <span class="wordmark">Hollyland Web UI</span>
      <span class="sub">Instrument · style guide</span>
    </div>
    <div class="theme">
      <KeyGroup options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />
    </div>
  </header>

  <main class="main">
    <!-- ───────────── Tokens ───────────── -->
    <Panel title="Colour" description="Ink on aluminium. Purple and yellow are LEDs: they only sit in a window or a bezel.">
      <div class="pad">
        <div class="swatches">
          {#each tokens as [name, use] (name)}
            <div class="sw">
              <span class="chip-c" style="background: var({name})"></span>
              <span class="mono name">{name}</span>
              <span class="use">{use}</span>
            </div>
          {/each}
        </div>
        <div class="leds">
          <DisplayWindow pad="sm">
            <div class="ledrow">
              <span class="led-demo"><Lamp color="mic1" size="lg" /> <span style="color: var(--mic1-w)">Mic 1 · −18.4</span></span>
              <span class="led-demo"><Lamp color="mic2" size="lg" /> <span style="color: var(--mic2-w)">Mic 2 · −27.6</span></span>
              <span class="led-demo"><Lamp color="rec" size="lg" /> <span style="color: var(--hot)">Clip · top 6 dB</span></span>
            </div>
          </DisplayWindow>
          <p class="hint">On the panel: <Lamp color="mic1" /> Mic 1 · <Lamp color="mic2" /> Mic 2 · <Lamp color="live" /> link · <Lamp color="rec" /> record. Never bare purple or yellow on Aluminium.</p>
        </div>
      </div>
    </Panel>

    <Panel title="Type" description="Archivo for language, Martian Mono only for measured values and hardware IDs.">
      <div class="pad type">
        <div class="ty"><span class="k">Meter readout · Mono 40 / 22</span><span class="readout-demo mono">−18<small>.4</small></span></div>
        <div class="ty"><span class="k">Timecode · Mono 44 / 24</span><span class="tc mono">01:42<small>.18</small></span></div>
        <div class="ty"><span class="k">Page title · Archivo 30 · 680 · wdth 108</span><span class="t-page">Connect the receiver</span></div>
        <div class="ty"><span class="k">Channel name · 26 · 660 · wdth 108</span><span class="t-channel">Mic 1</span></div>
        <div class="ty"><span class="k">Section · 15 · 680 · wdth 108</span><span class="t-section">Receiver</span></div>
        <div class="ty"><span class="k">Control title · 15 · 660</span><span class="t-control">Noise cancellation</span></div>
        <div class="ty"><span class="k">Body · 14 / 13</span><span class="t-body">Status unavailable on macOS</span></div>
        <div class="ty"><span class="k">Footnote · 12 · ink-3</span><span class="t-foot">Turn on the light first</span></div>
        <div class="ty"><span class="k">Value at module head · Mono 24</span><ValueHead value={6} total={6} /></div>
        <div class="ty"><span class="k">Legend · Mono 12</span><span class="mc-legend">3.0.2.008 · 48 kHz · TX1</span></div>
        <div class="ty"><span class="k">Lamp legends (the only uppercase)</span><span class="mc-lamp-legend">Clip · Rec</span></div>
      </div>
    </Panel>

    <!-- ───────────── Confidence ───────────── -->
    <Panel title="Confidence" description="One look per meaning: read back, sent, unknown, disabled. Focus stands off the edge.">
      <div class="pad">
        <div class="conf">
          <div class="conf-col">
            <span class="k">Solid · read back</span>
            <Key selected>Medium</Key>
            <SlideSwitch checked={true} label="Solid switch" />
            <BatteryCells percent={91} label="Solid" />
            <span class="row-i"><Lamp color="live" /> Online</span>
          </div>
          <div class="conf-col">
            <span class="k">Sent · not confirmed</span>
            <Key selected confidence="sent">Stereo</Key>
            <SlideSwitch checked={true} confidence="sent" label="Sent switch" />
            <ValueHead value={5} total={6} confidence="sent" />
            <ConfidenceNote kind="sent" at={sentAt} />
          </div>
          <div class="conf-col">
            <span class="k">Unknown · never read or sent</span>
            <Key confidence="unknown">– –</Key>
            <SlideSwitch checked={null} label="Unknown switch" />
            <BatteryCells percent={null} label="Unknown" />
            <ConfidenceNote kind="unknown" />
          </div>
          <div class="conf-col">
            <span class="k">Disabled · with a reason</span>
            <Key disabled>Bright</Key>
            <SlideSwitch checked={false} disabled label="Disabled switch" />
            <Key disabled selected>Balance</Key>
            <ConfidenceNote kind="disabled" text="Turn on Bel canto first" />
          </div>
          <div class="conf-col">
            <span class="k">Keyboard focus</span>
            <Key class="sg-focus">Weak</Key>
            <Key selected class="sg-focus">Medium</Key>
            <Key selected confidence="sent" class="sg-focus">Stereo</Key>
            <p class="hint">2 px ring, 3 px gap. Tab through this page to see the real one.</p>
          </div>
        </div>
      </div>
    </Panel>

    <!-- ───────────── Keys ───────────── -->
    <Panel title="Keys" description="Raised at rest, sink when pressed or selected. 44 px minimum.">
      <div class="pad grid-2">
        <div class="stack">
          <span class="k">Variants</span>
          <div class="wrap">
            <Key>Default</Key>
            <Key variant="primary">Connect receiver</Key>
            <Key variant="quiet">Disconnect</Key>
            <Key variant="danger-outline">Factory reset</Key>
            <Key variant="danger">Confirm reset</Key>
          </div>
          <span class="k">Sizes</span>
          <div class="wrap">
            <Key size="sm">Small 36</Key>
            <Key>Medium 44</Key>
            <Key size="lg" variant="primary">Large 52</Key>
            <Key size="icon" aria-label="Rename Mic 1">{#snippet icon()}<Pencil />{/snippet}</Key>
            <Key size="tall" style="width: 96px">{#snippet icon()}<Power />{/snippet}Tall</Key>
          </div>
        </div>
        <div class="stack">
          <span class="k">States</span>
          <div class="wrap">
            <Key selected={false}>Latching off</Key>
            <Key selected>Latching on</Key>
            <Key loading>Applying</Key>
            <Key disabled>Disabled</Key>
            <Key variant="primary" disabled>Primary disabled</Key>
          </div>
          <span class="k">Blocked (focusable, reason in place)</span>
          <Blocked reason="Needs a mic online.">
            <div class="wrap"><Key>Weak</Key><Key>Medium</Key></div>
          </Blocked>
          <span class="k">Inside a window</span>
          <DisplayWindow pad="sm">
            <div class="wrap">
              <Key variant="light">Connect through local bridge</Key>
              <Key variant="quiet">Why?</Key>
              <Key>Graphite key</Key>
              <Key selected>Selected</Key>
            </div>
          </DisplayWindow>
        </div>
      </div>
    </Panel>

    <Panel title="Key groups" description="Separate keys, 6 px apart. role=radiogroup, arrow keys move and choose.">
      <div class="pad grid-2">
        <div class="stack">
          <span class="k">Noise cancellation levels · solid</span>
          <KeyGroup options={NC} value={nc} label="Noise cancellation level" onchange={(v) => (nc = v)} />
          <span class="k">With Off as a key</span>
          <KeyGroup options={NC_OFF} value={ncOff} label="Noise cancellation" onchange={(v) => (ncOff = v)} />
          <span class="k">Sent, not confirmed</span>
          <KeyGroup options={NC} value="strong" confidence="sent" label="Noise cancellation level, sent" />
          <ConfidenceNote kind="sent" at={sentAt} />
          <span class="k">Unknown (nothing chosen, still sendable)</span>
          <KeyGroup options={NC} value={null} label="Noise cancellation level, unknown" />
          <ConfidenceNote kind="unknown" />
          <span class="k">Status unavailable: Off can't be sent (tooltip says so)</span>
          <KeyGroup options={NC_WO} value="medium" confidence="sent" {sentAt} label="Noise cancellation, sent" />
          <span class="k">Disabled with reason</span>
          <KeyGroup options={TONES} value="balance" disabled label="Bel canto tone" />
          <ConfidenceNote kind="disabled" text="Turn on Bel canto first" />
        </div>
        <div class="stack">
          <span class="k">Channel mode · tall keys with routing glyphs</span>
          <KeyGroup options={MODES} value={mode} label="Channel mode" onchange={(v) => (mode = v)} />
          <span class="k">Channel mode · sent</span>
          <KeyGroup options={MODES} value="stereo" confidence="sent" label="Channel mode, sent" />
          <span class="k">Channel mode · pending</span>
          <KeyGroup options={MODES} value="mono" pendingValue="mono" label="Channel mode, applying" />
          <span class="k">Preset bank · 4 × 2, custom key content</span>
          <KeyGroup options={PRESET_OPTS} value={preset} columns={4} label="Voice effect" onchange={(v) => (preset = v)}>
            {#snippet item(o, on)}
              <span class="preset">
                <span class="pname">{o.label}</span>
                <svg width="64" height="24" viewBox="-2 3 68 18" aria-hidden="true">
                  <path class="flat" d="M0 12H64" />
                  <path class="curve" class:on d={curve(PRESETS[o.value][1])} />
                </svg>
              </span>
            {/snippet}
          </KeyGroup>
        </div>
      </div>
    </Panel>

    <!-- ───────────── Switches ───────────── -->
    <Panel title="Switches" description="ON / OFF printed in the track. Settings that can't be read back become Off | On pairs.">
      <div class="pad grid-2">
        <div class="stack">
          <span class="k">Slide switch</span>
          <div class="wrap center">
            <SlideSwitch checked={led} label="Indicator light" onchange={(v) => (led = v)} />
            <SlideSwitch checked={belcanto} label="Bel canto" onchange={(v) => (belcanto = v)} />
            <SlideSwitch checked={true} pending label="Pending" />
            <SlideSwitch checked={true} confidence="sent" label="Sent on" />
            <SlideSwitch checked={false} confidence="sent" label="Sent off" />
            <SlideSwitch checked={null} label="Unknown" />
            <SlideSwitch checked={true} disabled label="Disabled on" />
            <SlideSwitch checked={false} disabled label="Disabled off" />
          </div>
          <span class="k">Blocked</span>
          <Blocked reason="Turn on the light first">
            <SlideSwitch checked={false} label="Mic recognition" />
          </Blocked>
        </div>
        <div class="stack">
          <span class="k">Send pair · last sent On</span>
          <SendPair value={sentPair} label="Indicator light" onchange={(v) => (sentPair = v)} />
          <ConfidenceNote kind="sent" at={sentAt} />
          <span class="k">Send pair · nothing sent yet</span>
          <SendPair value={null} label="Bel canto" />
          <ConfidenceNote kind="unknown" />
          <span class="k">Send pair · disabled</span>
          <SendPair value={false} disabled label="Mic recognition" />
          <ConfidenceNote kind="disabled" text="Turn on the light first" />
        </div>
      </div>
    </Panel>

    <!-- ───────────── Fader ───────────── -->
    <Panel title="Fader" description="Receiver volume: six numbered stops, arrows / Home / End, −/+ on touch.">
      <div class="pad grid-2">
        <div class="stack">
          <div class="fhead"><span class="t-control">Receiver volume</span><ValueHead value={vol + 1} total={6} /></div>
          <Fader steps={6} value={vol} label="Receiver volume" onchange={(v) => (vol = v)} />
          <span class="k">With −/+ flanks (always on touch)</span>
          <Fader steps={6} value={vol} label="Receiver volume, flanks" flanks="always" onchange={(v) => (vol = v)} />
          <span class="k">Focus on the cap</span>
          <div class="sg-fader-focus"><Fader steps={6} value={2} label="Focus demo" /></div>
        </div>
        <div class="stack">
          <div class="fhead"><span class="t-control">Sent, not confirmed</span><ValueHead value={5} total={6} confidence="sent" /></div>
          <Fader steps={6} value={4} confidence="sent" label="Receiver volume, sent" flanks="always" />
          <ConfidenceNote kind="sent" at={sentAt} />
          <div class="fhead"><span class="t-control">Unknown</span><ValueHead value={null} total={6} /></div>
          <Fader steps={6} value={null} label="Receiver volume, unknown" />
          <ConfidenceNote kind="unknown" />
          <div class="fhead"><span class="t-control">Disabled</span><ValueHead value={3} total={6} /></div>
          <Fader steps={6} value={2} disabled label="Receiver volume, disabled" />
        </div>
      </div>
    </Panel>

    <!-- ───────────── Meters ───────────── -->
    <Panel title="Meter window" description="Segmented bar, peak hold 1.5 s, red-tinted top 6 dB, history on its own time axis.">
      <div class="pad stack">
        <div class="meters-2">
          <div class="mcol">
            <div class="ch-head"><Lamp color="mic1" size="lg" /><span class="t-channel">Mic 1</span><Tag>TX1</Tag><span class="push"><Lamp size="sm" /> Online</span></div>
            <div class="mh"><MeterWindow read={sig1} label="Mic 1" tone="mic1" history={10} /></div>
          </div>
          <div class="mcol">
            <div class="ch-head"><Lamp color="mic2" size="lg" /><span class="t-channel">Mic 2</span><Tag>TX2</Tag><span class="push"><Lamp size="sm" /> Online</span></div>
            <div class="mh"><MeterWindow read={sig2} label="Mic 2" tone="mic2" history={10} /></div>
          </div>
        </div>
        <span class="k">Clipping (CLIP lamp latches; click it to reset) · neutral tone, no history</span>
        <div class="meters-2">
          <MeterWindow read={sig3} label="Mix · L" tone="neutral" />
          <div class="narrow-demo"><MeterWindow read={sig1} label="Mic 1" tone="mic1" history={10} /></div>
        </div>
        <span class="k">States: the window always says why it is empty</span>
        <KeyGroup
          options={STATES.map((s) => ({ value: s, label: s }))}
          value={meterState}
          label="Meter state"
          size="sm"
          columns={3}
          onchange={(v) => (meterState = v)}
        />
        <div class="meters-2">
          <MeterWindow read={sig1} label="Mic 1" tone="mic1" history={10} state={meterState} onstart={() => (meterState = 'starting')} />
          <div class="narrow-demo">
            <MeterWindow read={sig2} label="Mic 2" tone="mic2" history={10} state={meterState} onstart={() => (meterState = 'starting')} />
          </div>
        </div>
        <div class="states">
          {#each STATES as s (s)}
            <MeterWindow read={sigN} label="L" variant="compact" state={s} onstart={() => {}} message={s === 'error' ? 'The audio input disappeared.' : undefined} />
          {/each}
        </div>
        <span class="k">Strip variant (Audio page): rows stacked in one window, labels follow channel mode</span>
        <DisplayWindow pad="none">
          {#each usbChannelMeters(1) as m, i (m.side)}
            <div class="strip-row" class:ruled={i > 0}>
              <MeterWindow read={i ? sig2 : sig1} label={m.label} tone={m.tone} variant="strip" bare sub="{m.side === 'L' ? 'Left' : 'Right'} · TX{i + 1}" />
            </div>
          {/each}
        </DisplayWindow>
        <div class="labels">
          {#each [[0, 'Mono'], [1, 'Stereo'], [2, 'SafeTr'], [null, 'Unknown']] as [md, name] (name)}
            <div class="lab">
              <span class="k">{name}</span>
              {#each usbChannelMeters(md as number | null) as m (m.side)}
                <MeterWindow read={m.side === 'L' ? sig1 : sig2} label={m.label} tone={m.tone} variant="compact" />
              {/each}
            </div>
          {/each}
        </div>
      </div>
    </Panel>

    <!-- ───────────── Small parts ───────────── -->
    <Panel title="Lamps, plates, battery" description="LEDs sit in a dark bezel. No specular dots.">
      <div class="pad grid-2">
        <div class="stack">
          <span class="k">Lamp · on / off / hollow · sm 12 / md 14 / lg 20</span>
          <div class="wrap center">
            {#each ['mic1', 'mic2', 'live', 'rec', 'neutral'] as c (c)}
              <span class="lampset">
                <Lamp color={c as 'mic1'} size="lg" />
                <Lamp color={c as 'mic1'} />
                <Lamp color={c as 'mic1'} size="sm" />
                <Lamp color={c as 'mic1'} state="off" />
                <span class="mono k">{c}</span>
              </span>
            {/each}
            <span class="lampset"><Lamp state="hollow" size="lg" /><Lamp state="hollow" /><Lamp state="hollow" size="sm" /><span class="mono k">hollow</span></span>
            <span class="lampset"><Lamp blink /><span class="k">blink (not under reduced motion)</span></span>
          </div>
          <span class="k">Plates and status words</span>
          <div class="wrap center">
            <Tag>TX1</Tag><Tag>TX2</Tag><Tag>RX</Tag>
            <Chip tone="success">Connected</Chip>
            <Chip>Offline</Chip>
            <Chip unknown>Unknown</Chip>
            <Chip tone="danger">Lost</Chip>
            <Chip tone="warning">Unavailable</Chip>
          </div>
          <span class="k">Mute is a word, read-only (role=status)</span>
          <div class="wrap center">
            <span class="mute" role="status"><Lamp color="rec" state="off" /> Unmuted</span>
            <span class="mute" role="status"><Lamp color="rec" /> Muted</span>
            <span class="mute" role="status" title="Unknown"><Lamp state="hollow" /> <span class="mc-dash">–</span></span>
          </div>
        </div>
        <div class="stack">
          <span class="k">Battery cells</span>
          <BatteryCells percent={91} label="Mic 1 battery" />
          <BatteryCells percent={92} charging label="Mic 2 battery" />
          <BatteryCells percent={8} label="Low battery" />
          <BatteryCells percent={null} label="Mic 1 battery" />
          <span class="k">Legacy Battery (sm)</span>
          <Battery percent={45} size="sm" />
          <span class="k">Brand</span>
          <div class="wrap center"><BrandGlyph /><span class="wordmark">Hollyland Web UI</span><span class="sub">Unofficial</span></div>
        </div>
      </div>
    </Panel>

    <!-- ───────────── Layout ───────────── -->
    <Panel title="Receiver" description="Modules divided by hairlines: label, value and control only.">
      <Modules columns="repeat(auto-fit, minmax(min(100%, 230px), 1fr))">
        <Module title="Noise cancellation" description="The button on either mic toggles this">
          {#snippet head()}<SlideSwitch checked={true} label="Noise cancellation" />{/snippet}
          <KeyGroup options={NC} value={nc} label="Noise cancellation level" onchange={(v) => (nc = v)} />
        </Module>
        <Module title="Receiver volume" value={vol + 1} total={6}>
          <Fader steps={6} value={vol} label="Receiver volume" onchange={(v) => (vol = v)} />
        </Module>
        <Module title="Channel mode">
          <KeyGroup options={MODES} value={mode} label="Channel mode" onchange={(v) => (mode = v)} />
        </Module>
        <Module title="Bel canto">
          {#snippet head()}<SlideSwitch checked={belcanto} label="Bel canto" onchange={(v) => (belcanto = v)} />{/snippet}
          <KeyGroup options={TONES} value="balance" disabled={!belcanto} label="Bel canto tone" />
        </Module>
        <Module title="Indicator light">
          {#snippet head()}<SlideSwitch checked={led} label="Indicator light" onchange={(v) => (led = v)} />{/snippet}
          <Module title="Mic recognition" description="Lights each mic in its own colour" nested pad="none">
            {#snippet head()}<SlideSwitch checked={led && recog} disabled={!led} label="Mic recognition" onchange={(v) => (recog = v)} />{/snippet}
            {#if !led}
              <ConfidenceNote kind="disabled" text="Turn on the light first" />
            {:else if recog}
              <div class="ledpair">
                <span><Lamp color="mic1" size="sm" /> Mic 1 Purple</span>
                <span><Lamp color="mic2" size="sm" /> Mic 2 Yellow</span>
              </div>
            {/if}
          </Module>
        </Module>
      </Modules>
    </Panel>

    <Panel title="Status unavailable" description="Replies can't be read: one thin strip, and each control shows what was last sent (hatched) or nothing (dashed). The words are in the controls' tooltips." rail={false}>
      <div class="pad-b">
        <WriteOnlyBanner />
      </div>
      <Modules columns="repeat(auto-fit, minmax(min(100%, 230px), 1fr))">
        <Module title="Noise cancellation" description="Can't be switched off here">
          <KeyGroup options={NC_WO} value="medium" confidence="sent" {sentAt} label="Noise cancellation level" />
        </Module>
        <Module title="Receiver volume" value={5} total={6} confidence="sent" {sentAt}>
          <Fader steps={6} value={4} confidence="sent" {sentAt} label="Receiver volume" />
        </Module>
        <Module title="Channel mode">
          <KeyGroup options={MODES} value="stereo" confidence="sent" {sentAt} label="Channel mode" />
        </Module>
        <Module title="Bel canto">
          {#snippet head()}<SendPair value={null} label="Bel canto" />{/snippet}
        </Module>
        <Module title="Indicator light">
          {#snippet head()}<SendPair value={true} {sentAt} label="Indicator light" />{/snippet}
          <Module title="Mic recognition" nested pad="none">
            {#snippet head()}<SendPair value={null} label="Mic recognition" />{/snippet}
          </Module>
        </Module>
      </Modules>
    </Panel>

    <Panel title="Status line" description="Words in Archivo, values and IDs in mono.">
      <div class="pad stack">
        <span class="k">Desktop line</span>
        <div class="frame">
          <StatusLine
            items={[
              { lamp: { color: 'live' }, label: 'Connected' },
              { label: 'Last reply', value: '0.4 s ago' },
              { label: 'Firmware', value: 'RX 3.0.2.008 · TX1 3.0.2.008 · TX2 3.0.2.008' },
            ]}
            end="Unofficial · not affiliated with Hollyland"
          />
        </div>
        <span class="k">Status unavailable (hollow lamp; the strip under the header says why)</span>
        <div class="frame">
          <StatusLine items={[{ lamp: { state: 'hollow' }, label: 'Connected' }]} end="Unofficial · not affiliated with Hollyland" />
        </div>
        <span class="k">Connection lost (the band says it; the line keeps the last reply)</span>
        <div class="frame">
          <StatusLine items={[{ lamp: { color: 'rec' }, label: 'Last reply', value: '4.2 s ago' }]} end="Unofficial · not affiliated with Hollyland" />
        </div>
        <span class="k">Phone band (live connections only)</span>
        <div class="frame">
          <StatusLine variant="band" items={[{ label: 'Last reply', value: '0.4 s' }]} end="RX 3.0.2.008" />
        </div>
      </div>
    </Panel>

    <Panel title="Notices" description="Dark windows with a lamp. Never a yellow banner: yellow means Mic 2.">
      <div class="pad stack">
        <Banner tone="danger" title="Connection lost">
          Plug the receiver back in.
          {#snippet actions()}<Button variant="light" size="sm">Reconnect</Button>{/snippet}
        </Banner>
        <Banner tone="warning" title="Needs https:// or localhost" />
        <Banner tone="danger" title="Bridge not reachable">Start the bridge, then retry.</Banner>
        <Banner tone="info">Pick the receiver's audio input</Banner>
        <span class="k">Dialogs and toasts</span>
        <div class="wrap">
          <Button onclick={() => (dialogOpen = true)}>Open dialog</Button>
          <Button variant="danger-outline" onclick={() => (dangerOpen = true)}>Factory reset…</Button>
          <Button variant="ghost" onclick={() => toasts.success('Noise cancellation set to Medium')}>Toast: success</Button>
          <Button variant="ghost" onclick={() => toasts.error("The receiver didn't confirm the change.", { action: { label: 'Retry', run: () => {} } })}
            >Toast: error</Button
          >
          <Button variant="ghost" onclick={() => toasts.warning('Needs a mic online.')}>Toast: warning</Button>
          <Button variant="ghost" onclick={() => toasts.info('Recording saved to Take 3.')}>Toast: info</Button>
        </div>
      </div>
    </Panel>

    <Panel title="Rows and spec sheet" description="List rows: title and description left, control right, rules between.">
      <div class="pad grid-2">
        <div>
          <SettingRow label="Smart battery life">
            {#snippet control()}<Switch checked={true} label="Smart battery life" />{/snippet}
          </SettingRow>
          <SettingRow label="Mic auto power-off">
            {#snippet control()}<Switch checked={false} label="Mic auto power-off" />{/snippet}
          </SettingRow>
          <SettingRow label="Mic recognition" disabledReason="Turn on the light first">
            {#snippet control()}<Switch checked={false} disabled label="Mic recognition" />{/snippet}
          </SettingRow>
          <SettingRow label="Theme" stacked>
            {#snippet control()}<SegmentedControl options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />{/snippet}
          </SettingRow>
          <SettingRow label="Custom Functions" error="The receiver didn't confirm the change.">
            {#snippet control()}<Button size="sm">Retry</Button>{/snippet}
          </SettingRow>
        </div>
        <dl>
          <KeyValue label="RX firmware" value="3.0.2.008" mono />
          <KeyValue label="Mic 1 firmware" value="3.0.2.008" mono />
          <KeyValue label="Serial" value="A2RX93001F7F3A" mono masked copyable />
          <KeyValue label="USB ID" value="3547:0411" mono copyable />
          <KeyValue label="Mic 2 firmware" value={null} mono />
          <KeyValue label="Connection" value="USB" />
        </dl>
      </div>
    </Panel>

    <Panel title="Compatibility" description="The previous primitives keep their props and render the new look.">
      <div class="pad grid-2">
        <div class="stack">
          <div class="wrap">
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="danger-outline">Danger outline</Button>
            <Button size="sm" loading>Loading</Button>
          </div>
          <SegmentedControl options={NC} value="weak" label="SegmentedControl" />
          <SegmentedControl options={NC} value={null} size="sm" label="SegmentedControl, unset" />
          <div class="wrap center"><Switch checked={true} label="Switch" /><Switch checked={false} label="Switch off" /></div>
          <StepBar steps={6} value={3} label="StepBar" />
          <LevelMeter read={sig2} label="LevelMeter" />
          <LevelMeter read={sig2} label="LevelMeter inactive" inactive muted />
        </div>
        <div class="stack">
          <Card title="Card" overline="a section, not a box">
            <p class="t-body">Cards render as faceplate sections under a hairline rule.</p>
          </Card>
          <Card title="Mic 1" channel="tx1">
            {#snippet header()}<Chip tone="success">Connected</Chip>{/snippet}
            <p class="t-body">Channel identity is the LED in front of the title.</p>
          </Card>
          <Card title="Mic 2" channel="tx2" dimmed>
            {#snippet header()}<Chip>Offline</Chip>{/snippet}
            <p class="t-body">Dimmed: the LED goes dark, text keeps contrast.</p>
          </Card>
        </div>
      </div>
    </Panel>
  </main>

  <StatusLine items={[{ lamp: { color: 'live' }, label: 'Style guide' }, { label: 'build', value: 'dev' }]} end="Independent project · not affiliated with Hollyland" />
</div>

<Dialog open={dialogOpen} title="Restart the receiver?" onclose={() => (dialogOpen = false)}>
  <p>Changing External speaker restarts the receiver. The page reconnects by itself in about 10 seconds.</p>
  {#snippet actions()}
    <Button onclick={() => (dialogOpen = false)}>Cancel</Button>
    <Button variant="primary" onclick={() => (dialogOpen = false)}>Restart and apply</Button>
  {/snippet}
</Dialog>
<Dialog open={dangerOpen} title="Factory Reset" tone="danger" onclose={() => (dangerOpen = false)}>
  <p>Resets the receiver and both mics to factory settings. Pairing is kept.</p>
  {#snippet actions()}
    <Button onclick={() => (dangerOpen = false)}>Cancel</Button>
    <Button variant="danger" onclick={() => (dangerOpen = false)}>{#snippet icon()}<RotateCcw />{/snippet}Confirm</Button>
  {/snippet}
</Dialog>

<style>
  .sg {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--chassis);
    color: var(--ink);
  }
  .top {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 24px;
    min-height: var(--header-h);
    padding: 8px var(--gutter);
    border-bottom: 1px solid var(--rule);
    background: var(--chassis);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .wordmark {
    font-size: 16px;
    font-weight: 720;
    font-stretch: var(--wordmark-stretch);
    letter-spacing: -0.01em;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .theme {
    width: min(100%, 340px);
  }
  .main {
    flex: 1;
    padding: 0 var(--gutter) 24px;
  }
  .pad {
    padding: 4px 0 24px;
    min-width: 0;
  }
  .pad-b {
    padding: 0 0 16px;
  }
  @media (min-width: 1280px) {
    .pad {
      padding: 24px 0 28px 28px;
    }
    .main :global(.rail .body) > :global(.modules) {
      margin-left: 0;
    }
  }
  .k {
    font-size: 12px;
    color: var(--ink-3);
  }
  .hint {
    font-size: 12px;
    color: var(--ink-3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .stack {
    display: grid;
    gap: 10px;
    align-content: start;
    min-width: 0;
  }
  .grid-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 28px 40px;
  }
  .wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .wrap.center {
    align-items: center;
    gap: 12px 16px;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    gap: 12px 20px;
  }
  .sw {
    display: grid;
    grid-template-columns: 36px 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    align-items: center;
  }
  .chip-c {
    grid-row: 1 / 3;
    width: 36px;
    height: 36px;
    border-radius: var(--r-plate);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .sw .name {
    font-size: 12px;
  }
  .sw .use {
    font-size: 12px;
    color: var(--ink-2);
  }
  .leds {
    display: grid;
    gap: 10px;
    margin-top: 20px;
  }
  .ledrow {
    display: flex;
    flex-wrap: wrap;
    gap: 12px 28px;
    font: 500 13px/1 var(--f-mono);
    font-stretch: var(--mono-stretch);
  }
  .led-demo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .type {
    display: grid;
    gap: 14px;
  }
  .ty {
    display: grid;
    grid-template-columns: minmax(0, 240px) minmax(0, 1fr);
    align-items: baseline;
    gap: 6px 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule-soft);
  }
  @media (max-width: 599px) {
    .ty {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .readout-demo {
    font-size: var(--t-readout);
    font-weight: 450;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .readout-demo small {
    font-size: var(--t-readout-dec);
  }
  .tc {
    font-size: var(--t-timecode);
    font-weight: 420;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .tc small {
    font-size: 24px;
    color: var(--ink-3);
  }
  .t-page {
    font-size: var(--t-page);
    font-weight: 680;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .t-channel {
    font-size: var(--t-channel);
    font-weight: 660;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.015em;
    line-height: 1;
  }
  .t-section {
    font-size: var(--t-section);
    font-weight: 680;
    font-stretch: var(--head-stretch);
  }
  .t-control {
    font-size: var(--t-control);
    font-weight: 660;
  }
  .t-body {
    font-size: 14px;
    color: var(--ink-2);
  }
  .t-foot {
    font-size: 12px;
    color: var(--ink-3);
  }
  .conf {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
    gap: 24px;
  }
  .conf-col {
    display: grid;
    gap: 12px;
    align-content: start;
    justify-items: start;
  }
  .row-i {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .main :global(.sg-focus) {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .sg-fader-focus :global(.cap) {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }

  .preset {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 52px;
    text-align: left;
  }
  .pname {
    white-space: normal;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.2;
  }
  .preset svg {
    flex: none;
  }
  .curve {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .flat {
    stroke: currentColor;
    opacity: 0.45;
    stroke-width: 1;
    stroke-dasharray: 2 3;
  }
  @media (max-width: 719px) {
    .preset svg {
      display: none;
    }
  }

  .fhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: var(--hit);
  }

  .meters-2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 24px 28px;
  }
  .mcol {
    display: grid;
    gap: 14px;
  }
  .ch-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--hit);
    font-size: 13px;
    color: var(--ink-2);
  }
  .ch-head .t-channel {
    color: var(--ink);
  }
  .push {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .mh {
    display: grid;
  }
  @media (min-width: 600px) {
    .mh {
      height: 420px;
    }
  }
  .mh :global(.mw) {
    height: 100%;
  }
  .narrow-demo {
    max-width: 358px;
  }
  .states {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 12px;
  }
  .strip-row {
    padding: 0 20px;
  }
  .strip-row.ruled {
    border-top: 1px solid rgb(255 255 255 / 0.08);
  }
  @media (max-width: 599px) {
    .strip-row {
      padding: 0 12px;
    }
  }
  .labels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 16px 20px;
  }
  .lab {
    display: grid;
    gap: 8px;
  }

  .lampset {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .mute {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .ledpair {
    display: grid;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .ledpair span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .frame {
    border: 1px solid var(--rule);
    border-radius: var(--r-win);
    overflow: hidden;
  }
</style>
