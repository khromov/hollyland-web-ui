<script lang="ts">
  /** Per-browser preferences: mic names, theme, developer mode, remembered write-only values. */
  import { session } from '../../lib/state/session.svelte'
  import { prefs, type ThemePref } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import { sentTimes } from './sent.svelte'
  import { sentClock } from '../overview/sent.svelte'

  const MICS = [0, 1] as const
  const THEMES: { value: ThemePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  function forget() {
    session.forgetSent()
    sentTimes.clear()
    sentClock.clear()
    toasts.info(`Forgot the values remembered for ${session.displayName || 'this model'}.`, { timeout: 3000 })
  }
</script>

<Panel title="This browser" description="App preferences. Saved only in this browser; nothing here is sent to the receiver.">
  <div class="mods">
    <Modules min="250px">
      <Module title="Mic names" description="Shown in this app instead of “Mic 1” and “Mic 2”.">
        <div class="fields">
          {#each MICS as i (i)}
            <label class="field">
              <Lamp color={i === 0 ? 'mic1' : 'mic2'} />
              <Tag title="Transmitter {i + 1}">TX{i + 1}</Tag>
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
      </Module>

      <Module title="Theme" description="System follows this device’s setting.">
        <KeyGroup options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />
      </Module>

      <Module title="Developer mode" description="Adds the Console tab with the raw USB traffic.">
        {#snippet head()}
          <SlideSwitch checked={prefs.developer} label="Developer mode" onchange={(v) => prefs.setDeveloper(v)} />
        {/snippet}
      </Module>

      {#if session.writeOnly}
        <Module
          title="Forget remembered values"
          description="This system can't read the receiver, so this browser remembers what it last sent to a {session.displayName ||
            'receiver of this model'}. Receivers of the same model share these values. Forgetting sets every control back to Not read."
        >
          <div class="forget"><Key size="sm" onclick={forget}>Forget</Key></div>
        </Module>
      {/if}
    </Modules>
  </div>
</Panel>

<style>
  .mods {
    min-width: 0;
  }
  .fields {
    display: grid;
    gap: 8px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  input {
    flex: 1;
    min-width: 0;
    height: var(--hit);
    padding: 0 12px;
    border-radius: var(--r-key);
    border: 1px solid var(--key-edge);
    background: var(--key);
    box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.12);
    font-size: var(--t-body);
    color: var(--ink);
  }
  input::placeholder {
    color: var(--ink-3);
  }
  input:hover {
    background: var(--key-hover);
  }
  input:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 3px;
  }
  .forget {
    display: flex;
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
