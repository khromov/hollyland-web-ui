<script lang="ts">
  /**
   * The faceplate's top strip: wordmark, section tabs, and the link at the right
   * ("● LARK A2  Live · read & write │ Disconnect ☾").
   * - ≥ 960 px: everything inline, as drawn.
   * - 600–959 px: glyph, tabs, lamp + device; Disconnect and theme move into the ≡ menu.
   * - < 600 px: 56 px tall, wordmark, lamp + device and the ≡ menu; the tabs move to the bottom bar.
   */
  import type { HeaderTab } from './shell/types'
  import { session } from '../lib/state/session.svelte'
  import Key from '../lib/ui/Key.svelte'
  import Lamp from '../lib/ui/Lamp.svelte'
  import Wordmark from './Wordmark.svelte'
  import ShellMenu from './shell/ShellMenu.svelte'
  import ThemeKey from './shell/ThemeKey.svelte'
  import { link } from './shell/link.svelte'

  interface Props {
    tabs: HeaderTab[]
    /** Label of the tab for the page on screen. */
    current: string
    ondisconnect?: () => void
  }
  let { tabs, current, ondisconnect }: Props = $props()

  const name = $derived(link.connected ? session.displayName : '')
</script>

<header class="header" class:many={tabs.length > 4}>
  <div class="brand">
    <span class="full"><Wordmark /></span>
    <span class="mid"><Wordmark glyphOnly /></span>
    <span class="small"><Wordmark size="sm" compact /></span>
  </div>

  {#if tabs.length}
    <nav class="tabs" aria-label="Sections">
      {#each tabs as t (t.label)}
        <a href="#/{t.route}" class="tab" class:on={t.label === current} aria-current={t.label === current ? 'page' : undefined}
          >{t.label}</a
        >
      {/each}
    </nav>
  {/if}

  <div class="device">
    <div class="devname">
      <Lamp color={link.lamp.color} state={link.lamp.state} blink={link.lamp.blink} />
      {#if name}<b class="mono">{name}</b>{/if}
      <span class="mode" class:solo={!name}>{link.mode}</span>
    </div>
    <span class="visually-hidden" aria-live="polite" aria-atomic="true">{link.announcement}</span>
    <div class="wide-only">
      {#if link.connected && ondisconnect}
        <span class="vr" aria-hidden="true"></span>
        <Key variant="quiet" onclick={ondisconnect}>Disconnect</Key>
      {/if}
      <ThemeKey />
    </div>
    <div class="narrow-only">
      <ShellMenu {ondisconnect} />
    </div>
  </div>
</header>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: stretch;
    gap: 36px;
    height: calc(var(--header-h) + env(safe-area-inset-top));
    padding: env(safe-area-inset-top) var(--gutter) 0;
    background: var(--chassis);
    border-bottom: 1px solid var(--rule);
  }
  .brand {
    display: flex;
    align-items: center;
    flex: none;
  }
  .mid,
  .small {
    display: none;
  }
  .tabs {
    display: flex;
    gap: 2px;
    min-width: 0;
  }
  .tab {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 14px;
    font-weight: 520;
    color: var(--ink-2);
    text-decoration: none;
    white-space: nowrap;
  }
  .tab:hover {
    color: var(--ink);
  }
  .tab.on {
    color: var(--ink);
    font-weight: 660;
  }
  .tab.on::after {
    content: '';
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: -1px;
    height: 3px;
    background: var(--ink);
  }
  .tab:focus-visible {
    outline-offset: -6px;
  }
  .device {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-left: auto;
    min-width: 0;
  }
  .devname {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    white-space: nowrap;
  }
  .devname b {
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  .mode {
    font-size: 13px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wide-only {
    display: flex;
    align-items: center;
    gap: 6px;
    align-self: stretch;
  }
  .narrow-only {
    display: none;
  }
  .vr {
    width: 1px;
    align-self: stretch;
    margin: 14px 8px 14px 0;
    background: var(--rule);
  }

  /* 960–1279: no "Unofficial" note when the Console tab crowds the row. */
  @media (max-width: 1279px) {
    .header {
      gap: 24px;
    }
    .many .full :global(.tag) {
      display: none;
    }
    .tab {
      padding: 0 12px;
    }
    .tab.on::after {
      left: 12px;
      right: 12px;
    }
  }
  /* Below 1100 px the link words would be cut mid-word ("Live · read & w…"): the lamp and the
     device name stay, and the status line under the page says the rest. */
  @media (max-width: 1099px) {
    .mode:not(.solo) {
      display: none;
    }
  }

  /* 600–959: glyph only, tabs, lamp + device; the rest is in the menu. */
  @media (max-width: 959px) {
    .header {
      gap: 16px;
      padding-right: calc(var(--gutter) - 8px);
    }
    .full {
      display: none;
    }
    .mid {
      display: inline-flex;
    }
    .tab {
      padding: 0 10px;
    }
    .tab.on::after {
      left: 10px;
      right: 10px;
    }
    .device {
      gap: 4px;
    }
    .mode:not(.solo) {
      display: none;
    }
    .wide-only {
      display: none;
    }
    .narrow-only {
      display: flex;
    }
  }
  @media (max-width: 719px) {
    .many .mode {
      display: none;
    }
  }

  /* Phones: the tabs live in the bottom bar. */
  @media (max-width: 599px) {
    .header {
      --header-h: var(--header-h-sm);
      gap: 10px;
      padding-left: var(--gutter);
      padding-right: 6px;
    }
    .mid {
      display: none;
    }
    .small {
      display: inline-flex;
    }
    .tabs {
      display: none;
    }
    .devname {
      gap: 8px;
    }
    .devname b {
      font-size: 12px;
    }
    .mode.solo {
      display: inline;
      font-size: 13px;
    }
  }
  @media (max-width: 359px) {
    .small :global(.name) {
      display: none;
    }
  }
</style>
