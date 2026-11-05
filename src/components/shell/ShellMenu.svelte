<script lang="ts">
  /**
   * The header's ≡ menu on phones and narrow windows (below 960 px), where Disconnect and the
   * theme key don't fit beside the tabs. A disclosure over a popover panel: light dismiss and Esc
   * close it, focus moves in when it opens and back to the key when it closes.
   */
  import { Menu, X } from '@lucide/svelte'
  import Key from '../../lib/ui/Key.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import { prefs, type ThemePref } from '../../lib/state/prefs.svelte'
  import { session } from '../../lib/state/session.svelte'
  import { link } from './link.svelte'

  interface Props {
    ondisconnect?: () => void
  }
  let { ondisconnect }: Props = $props()

  const THEMES: { value: ThemePref; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  let open = $state(false)
  let panel: HTMLDivElement
  let trigger: HTMLButtonElement | undefined = $state()
  const panelId = `shell-menu-${Math.random().toString(36).slice(2, 8)}`

  function toggle() {
    if (open) panel.hidePopover()
    else panel.showPopover()
  }

  function ontoggle(e: Event) {
    const next = (e as ToggleEvent).newState === 'open'
    open = next
    if (next) queueMicrotask(() => panel.querySelector<HTMLElement>('button:not([disabled])')?.focus())
    else if (panel.contains(document.activeElement)) trigger?.focus()
  }

  function disconnect() {
    panel.hidePopover()
    ondisconnect?.()
  }
</script>

<button
  bind:this={trigger}
  type="button"
  class="mc-key mc-key--quiet mc-key--icon menu-key"
  aria-label="Menu"
  aria-expanded={open}
  aria-controls={panelId}
  onclick={toggle}
>
  {#if open}<X size={20} strokeWidth={1.8} />{:else}<Menu size={20} strokeWidth={1.8} />{/if}
</button>

<div bind:this={panel} id={panelId} class="panel" popover="auto" {ontoggle} role="group" aria-label="Menu">
  {#if link.connected}
    <div class="row device">
      <Lamp color={link.lamp.color} state={link.lamp.state} blink={link.lamp.blink} label={link.mode ? undefined : link.lampLabel} />
      <span class="name mono">{session.displayName}</span>
      {#if link.mode}<span class="mode">{link.mode}</span>{/if}
    </div>
    {#if ondisconnect}
      <div class="row">
        <Key block onclick={disconnect}>Disconnect</Key>
      </div>
    {/if}
  {/if}
  <div class="row">
    <span class="label">Theme</span>
    <KeyGroup options={THEMES} value={prefs.theme} label="Theme" size="sm" onchange={(t) => prefs.setTheme(t)} />
  </div>
  <div class="row split" title="Adds the Console tab (raw USB traffic)">
    <span class="label">Developer mode</span>
    <SlideSwitch checked={prefs.developer} label="Developer mode" onchange={(v) => prefs.setDeveloper(v)} />
  </div>
</div>

<style>
  .menu-key {
    flex: none;
  }
  .panel {
    position: fixed;
    inset: auto;
    top: calc(var(--shell-header-h, var(--header-h)) + env(safe-area-inset-top) - 1px);
    right: 0;
    left: auto;
    margin: 0;
    width: min(340px, 100vw);
    max-height: calc(100dvh - var(--header-h));
    overflow: auto;
    padding: 4px 0 8px;
    border: 0;
    border-left: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    border-top: 1px solid var(--rule);
    background: var(--chassis);
    color: var(--ink);
    box-shadow: 0 2px 0 var(--key-shadow);
  }
  .panel::backdrop {
    background: transparent;
  }
  .row {
    display: grid;
    gap: 8px;
    padding: 12px var(--gutter);
    border-bottom: 1px solid var(--rule-soft);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .device {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .name {
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  .mode {
    font-size: 13px;
    color: var(--ink-2);
  }
  .label {
    font-size: 14px;
    font-weight: 600;
  }
  .split {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }
  @media (max-width: 599px) {
    .panel {
      width: 100vw;
      border-left: 0;
    }
  }
</style>
