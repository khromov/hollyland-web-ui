<script lang="ts">
  import { Mic, Square, Circle, Download, Trash2, Headphones, Play } from '@lucide/svelte'
  import { audio } from '../../lib/state/audio.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { VOICE_PRESETS } from '../../lib/audio/voicefx'
  import Card from '../../lib/ui/Card.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import LevelMeter from '../../lib/ui/LevelMeter.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import AudioStartCard from './AudioStartCard.svelte'

  interface Props {
    /** Channel mode reported by the receiver: 0 mono, 1 stereo, 2 safety track, null unknown. */
    channelMode?: number | null
  }
  let { channelMode = null }: Props = $props()

  const running = $derived(audio.state === 'running')
  const channelLabels = $derived(
    channelMode === 0
      ? ['Left (mono mix)', 'Right (mono mix)']
      : channelMode === 2
        ? ['Left (mix)', 'Right (safety, -6 dB)']
        : [`${prefs.micLabel(0)} (left)`, `${prefs.micLabel(1)} (right)`],
  )

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  const fmtSize = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`)

  const presetOptions = [{ id: null as string | null, name: 'Off', description: 'No processing' }, ...VOICE_PRESETS]
</script>

<div class="page">
  <div class="intro">
    <h1>Audio</h1>
    <p>
      Listen to, meter and record the receiver's USB audio in the browser. Voice effects run locally on this
      computer. They don't change anything on the device.
    </p>
  </div>

  {#if !audio.supported}
    <Banner tone="warning" title="Audio capture isn't available">This browser can't capture audio inputs.</Banner>
  {:else if !running}
    <AudioStartCard />
  {:else}
    <div class="grid">
      <Card title="Input" overline="Levels">
        {#snippet header()}
          <Button size="sm" variant="ghost" onclick={() => audio.stop()}>Stop</Button>
        {/snippet}
        <div class="source">
          <Mic size={16} aria-hidden="true" />
          <span class="mono">{audio.deviceLabel || 'Audio input'}</span>
          <span class="muted">{audio.channelCount === 1 ? 'mono' : 'stereo'} · 48 kHz</span>
        </div>
        {#if !audio.isHollyland}
          <Banner tone="warning">This doesn't look like the receiver's audio input. Pick it below.</Banner>
        {/if}
        <div class="meters">
          {#each [0, 1] as c (c)}
            <div class="meter-row">
              <span class="ch-label">{channelLabels[c]}</span>
              <LevelMeter read={() => audio.readChannel(c)} label={channelLabels[c]} segments={36} />
            </div>
          {/each}
        </div>
        {#if audio.inputs.length > 1}
          <label class="select-row">
            <span>Input device</span>
            <select value={audio.selectedInput} onchange={(e) => audio.selectInput(e.currentTarget.value)}>
              {#each audio.inputs as d (d.deviceId)}
                <option value={d.deviceId}>{d.label || 'Unnamed input'}</option>
              {/each}
            </select>
          </label>
        {/if}
      </Card>

      <Card title="Voice effects" overline="Browser DSP">
        <p class="hint">
          Profiles from the HollyAudio voice editor, run through a port of the app's own DSP that gives the same output
          sample for sample. They apply to monitoring and to "processed" recordings and add 4.7 ms of delay.
        </p>
        {#if audio.fxError}
          <Banner tone="warning" title="Voice effects are unavailable">
            {audio.fxError} Levels, monitoring and raw recording still work.
          </Banner>
        {/if}
        <SettingRow label="Same profile for both mics">
          {#snippet control()}
            <Switch checked={audio.fxLinked} label="Same profile for both mics" onchange={(v) => (audio.fxLinked = v)} />
          {/snippet}
        </SettingRow>
        <div class="fx-cols" class:linked={audio.fxLinked}>
          {#each audio.fxLinked ? [0] : [0, 1] as c (c)}
            <fieldset class="fx-list">
              <legend>{audio.fxLinked ? 'Both mics' : prefs.micLabel(c as 0 | 1)}</legend>
              {#each presetOptions as p (p.id ?? 'off')}
                <label class="fx-option" class:selected={audio.fx[c] === p.id}>
                  <input
                    type="radio"
                    name="fx-{c}"
                    checked={audio.fx[c] === p.id}
                    onchange={() => audio.setFx(c as 0 | 1, p.id)}
                  />
                  <span class="fx-name">{p.name}</span>
                  <span class="fx-desc">{p.description}</span>
                </label>
              {/each}
            </fieldset>
          {/each}
        </div>
      </Card>

      <Card title="Monitor" overline="Listen">
        <SettingRow label="Monitor volume" description="Plays the processed signal on this computer's output. Use headphones to avoid feedback." stacked>
          {#snippet control()}
            <div class="slider-row">
              <Headphones size={18} aria-hidden="true" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={audio.monitor}
                aria-label="Monitor volume"
                oninput={(e) => audio.setMonitor(+e.currentTarget.value)}
              />
              <span class="readout">{Math.round(audio.monitor * 100)}%</span>
            </div>
          {/snippet}
        </SettingRow>
      </Card>

      <Card title="Recorder" overline="WAV">
        <SettingRow label="Source" stacked>
          {#snippet control()}
            <SegmentedControl
              label="Recording source"
              options={[
                { value: 'raw', label: 'Raw input' },
                { value: 'fx', label: 'With effects' },
              ]}
              value={audio.recordOptions.processed ? 'fx' : 'raw'}
              disabled={audio.recording}
              onchange={(v) => (audio.recordOptions = { ...audio.recordOptions, processed: v === 'fx' })}
            />
          {/snippet}
        </SettingRow>
        <SettingRow label="Files" stacked>
          {#snippet control()}
            <SegmentedControl
              label="File layout"
              options={[
                { value: 'stereo', label: 'One stereo file' },
                { value: 'split', label: 'One file per mic' },
              ]}
              value={audio.recordOptions.split ? 'split' : 'stereo'}
              disabled={audio.recording}
              onchange={(v) => (audio.recordOptions = { ...audio.recordOptions, split: v === 'split' })}
            />
          {/snippet}
        </SettingRow>
        <SettingRow label="Bit depth">
          {#snippet control()}
            <SegmentedControl
              label="Bit depth"
              size="sm"
              options={[
                { value: 16, label: '16-bit' },
                { value: 24, label: '24-bit' },
                { value: 32, label: '32f' },
              ]}
              value={audio.recordOptions.bitDepth}
              disabled={audio.recording}
              onchange={(v) => (audio.recordOptions = { ...audio.recordOptions, bitDepth: v })}
            />
          {/snippet}
        </SettingRow>
        <div class="rec-bar">
          {#if audio.recording}
            <Button variant="danger" size="lg" onclick={() => audio.stopRecording()}>
              {#snippet icon()}<Square size={18} />{/snippet}
              Stop
            </Button>
            <span class="rec-time readout"><span class="rec-dot" aria-hidden="true"></span>{fmtTime(audio.recordSeconds)}</span>
          {:else}
            <Button variant="primary" size="lg" onclick={() => audio.startRecording()}>
              {#snippet icon()}<Circle size={18} />{/snippet}
              Record
            </Button>
          {/if}
        </div>
        {#if audio.takes.length}
          <ul class="takes">
            {#each audio.takes as t (t.id)}
              <li>
                <div class="take-head">
                  <span class="readout">{t.createdAt.toLocaleTimeString()}</span>
                  <span class="muted">{fmtTime(t.files[0]?.durationSec ?? 0)} · {t.options.processed ? 'with effects' : 'raw'}</span>
                  <button type="button" class="icon-btn" aria-label="Delete take" onclick={() => audio.deleteTake(t.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
                {#each t.files as f (f.url)}
                  <div class="file">
                    <Play size={14} aria-hidden="true" />
                    <audio controls src={f.url} preload="none"></audio>
                    <a class="dl" href={f.url} download={f.name}><Download size={14} /> {f.name} <span class="muted">{fmtSize(f.blob.size)}</span></a>
                  </div>
                {/each}
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    </div>
  {/if}
</div>

<style>
  .page {
    display: grid;
    gap: var(--space-5);
  }
  .intro h1 {
    font-size: var(--text-2xl);
    line-height: var(--leading-2xl);
  }
  .intro p {
    color: var(--color-text-muted);
    max-width: 70ch;
    margin-top: var(--space-1);
  }
  .grid {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    align-items: start;
  }
  .source {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
    color: var(--color-text-muted);
  }
  .source .mono {
    color: var(--color-text);
  }
  .muted {
    color: var(--color-text-subtle);
    font-size: var(--text-sm);
  }
  .meters {
    display: grid;
    gap: var(--space-4);
    margin: var(--space-3) 0;
  }
  .ch-label {
    display: block;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    margin-bottom: 4px;
  }
  .select-row {
    display: grid;
    gap: 6px;
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  select {
    min-height: var(--control-h-md);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-control);
    background: var(--color-surface-3);
  }
  .hint {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
  }
  .fx-cols {
    display: grid;
    gap: var(--space-3);
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
  .fx-list {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 6px;
  }
  legend {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--color-text-subtle);
    margin-bottom: 6px;
  }
  .fx-option {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    cursor: pointer;
  }
  .fx-option:hover {
    border-color: var(--color-border-strong);
  }
  .fx-option.selected {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }
  .fx-option input {
    grid-row: span 2;
    accent-color: var(--color-accent);
    margin-top: 3px;
  }
  .fx-name {
    font-weight: var(--weight-medium);
  }
  .fx-desc {
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .slider-row input {
    flex: 1;
    accent-color: var(--color-accent);
  }
  .rec-bar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-3);
  }
  .rec-time {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-xl);
    font-weight: var(--weight-medium);
  }
  .rec-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-danger);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.2;
    }
  }
  .takes {
    list-style: none;
    padding: 0;
    margin: var(--space-4) 0 0;
    display: grid;
    gap: var(--space-3);
  }
  .takes li {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
    display: grid;
    gap: var(--space-2);
  }
  .take-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .take-head .icon-btn {
    margin-left: auto;
  }
  .file {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: center;
    gap: 6px var(--space-2);
  }
  .file :global(svg) {
    color: var(--color-text-subtle);
  }
  .file audio {
    width: 100%;
    height: 36px;
  }
  .dl {
    grid-column: 2;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-sm);
    word-break: break-all;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-subtle);
  }
  .icon-btn:hover {
    background: var(--color-surface-3);
    color: var(--color-danger);
  }
</style>
