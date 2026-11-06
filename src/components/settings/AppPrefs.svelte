<script lang="ts">
  /** Per-browser preferences: mic names, theme, developer mode, remembered write-only values. Labels and controls only. */
  import { session } from '../../lib/state/session.svelte'
  import { prefs, type ThemePref } from '../../lib/state/prefs.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import { FORGET_LABEL, FORGET_TIP, forgetRemembered } from './sent.svelte'
  import { micNames } from '../overview/family/names.svelte'
  import type { UnitId } from '../../lib/protocol'

  /** One field per mic the Overview draws (2 or 4); Mic 1 and Mic 2 are the browser-wide names. */
  const mics = $derived<UnitId[]>(session.micSlots.length ? session.micSlots : ['tx1', 'tx2'])
  /** The identity lamps of the tested receivers (the A2 mics' LED colours); other models have none. */
  const lamps = $derived(session.isLegacy)
  const THEMES: { value: ThemePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]
</script>

<Panel title="This browser">
  <div class="mods">
    <Modules min="250px">
      <Module title="Mic names" description="Shown in this app only">
        <div class="fields">
          {#each mics as unit, i (unit)}
            {@const u = session.micState?.units[unit]}
            {@const fallback = micNames.defaultName(unit, u)}
            <label class="field">
              {#if lamps && i < 2}<Lamp color={i === 0 ? 'mic1' : 'mic2'} />{/if}
              <Tag title="Transmitter {i + 1}">TX{i + 1}</Tag>
              <span class="visually-hidden">Name for {fallback}</span>
              <input
                type="text"
                maxlength="32"
                autocomplete="off"
                spellcheck="false"
                placeholder={fallback}
                value={micNames.raw(unit)}
                oninput={(e) => micNames.set(unit, e.currentTarget.value, { asTyped: true })}
              />
            </label>
          {/each}
        </div>
      </Module>

      <Module title="Theme">
        <KeyGroup options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />
      </Module>

      <Module title="Developer mode" description="Adds the Console tab">
        {#snippet head()}
          <SlideSwitch checked={prefs.developer} label="Developer mode" onchange={(v) => prefs.setDeveloper(v)} />
        {/snippet}
      </Module>

      {#if session.writeOnly}
        <Module title="Remembered values">
          {#snippet head()}
            <Key size="sm" aria-label={FORGET_LABEL} title={FORGET_TIP} onclick={forgetRemembered}>Forget</Key>
          {/snippet}
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
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
