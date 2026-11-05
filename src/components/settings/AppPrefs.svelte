<script lang="ts">
  /** Per-browser preferences: mic names, theme, developer mode, remembered write-only values. */
  import { session } from '../../lib/state/session.svelte'
  import { prefs, type ThemePref } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import SettingRow from '../../lib/ui/SettingRow.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import ChannelBadge from '../device/ChannelBadge.svelte'

  interface Props {
    narrow?: boolean
  }
  let { narrow = false }: Props = $props()

  const MICS = [0, 1] as const
  const THEMES: { value: ThemePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ]

  function forget() {
    session.forgetSent()
    toasts.info(`Forgot the values remembered for ${session.displayName || 'this model'}.`, { timeout: 3000 })
  }
</script>

<Card title="App preferences" overline="This browser">
  <p class="lead">Saved only in this browser. Nothing here is sent to the receiver.</p>

  <div class="names" role="group" aria-labelledby="mic-names-label">
    <div class="label" id="mic-names-label">Mic names</div>
    <div class="desc">Shown in this app instead of "Mic 1" and "Mic 2".</div>
    <div class="fields">
      {#each MICS as i (i)}
        <label class="field">
          <ChannelBadge channel={i === 0 ? 'tx1' : 'tx2'} />
          <span class="visually-hidden">Name for Mic {i + 1}</span>
          <input
            type="text"
            maxlength="32"
            autocomplete="off"
            spellcheck="false"
            placeholder="Mic {i + 1}"
            value={prefs.micNames[i]}
            oninput={(e) => prefs.setMicName(i, e.currentTarget.value)}
          />
        </label>
      {/each}
    </div>
  </div>

  <SettingRow label="Theme" stacked={narrow}>
    {#snippet control()}
      <div class="theme" class:full={narrow}>
        <SegmentedControl options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />
      </div>
    {/snippet}
  </SettingRow>

  <SettingRow label="Developer mode" description="Adds the Console tab with the raw USB traffic.">
    {#snippet control()}
      <Switch checked={prefs.developer} label="Developer mode" onchange={(v) => prefs.setDeveloper(v)} />
    {/snippet}
  </SettingRow>

  {#if session.writeOnly}
    <SettingRow
      label="Forget remembered values"
      description="This system can't read the receiver, so this browser remembers what it last sent to a {session.displayName ||
        'receiver of this model'}. The browser can't tell two receivers of the same model apart, so they share these values. Forgetting sets every control back to Unknown."
      stacked={narrow}
    >
      {#snippet control()}
        <Button size="sm" variant="secondary" onclick={forget}>Forget</Button>
      {/snippet}
    </SettingRow>
  {/if}
</Card>

<style>
  .lead {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .names {
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .label {
    font-weight: var(--weight-medium);
  }
  .desc {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    margin-top: 2px;
  }
  .fields {
    display: grid;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: var(--hit-min);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-control);
    background: var(--color-surface-3);
  }
  input::placeholder {
    color: var(--color-text-subtle);
  }
  input:focus-visible {
    outline: var(--focus-width) solid var(--color-focus);
    outline-offset: 0;
    border-color: var(--color-focus);
  }
  .theme {
    width: 228px;
  }
  .theme.full {
    width: 100%;
  }
  @media (pointer: coarse) {
    .label {
      font-size: var(--text-lg);
    }
    .desc {
      font-size: var(--text-md);
    }
  }
</style>
