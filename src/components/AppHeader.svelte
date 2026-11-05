<script lang="ts">
  import { Moon, Sun, Monitor, Unplug, Bug } from '@lucide/svelte'
  import { router, type Route } from '../lib/state/router.svelte'
  import { prefs } from '../lib/state/prefs.svelte'
  import Wordmark from './Wordmark.svelte'

  interface Props {
    connected: boolean
    deviceName?: string
    statusText: string
    /** Shorter status for phones (e.g. "Write-only"). */
    statusShort?: string
    statusTone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'
    tabs: { route: Route; label: string }[]
    ondisconnect?: () => void
  }
  let { connected, deviceName = '', statusText, statusShort, statusTone, tabs, ondisconnect }: Props = $props()

  const themeIcon = $derived(prefs.theme === 'dark' ? Moon : prefs.theme === 'light' ? Sun : Monitor)
  const nextTheme = $derived(prefs.theme === 'system' ? 'dark' : prefs.theme === 'dark' ? 'light' : 'system')
</script>

<header class="header">
  <div class="inner">
    <Wordmark compact={connected} />
    {#if connected}
      <nav class="tabs" aria-label="Sections">
        {#each tabs as t (t.route)}
          <a
            href="#/{t.route}"
            class:active={router.route === t.route}
            aria-current={router.route === t.route ? 'page' : undefined}>{t.label}</a
          >
        {/each}
      </nav>
    {/if}
    <div class="spacer"></div>
    <div class="status {statusTone}" role="status">
      <span class="dot" aria-hidden="true"></span>
      <span class="status-text">
        {#if deviceName}<span class="dev"><strong>{deviceName}</strong>&nbsp;·&nbsp;</span>{/if}<span
          class="long">{statusText}</span
        ><span class="short">{statusShort ?? statusText}</span>
      </span>
    </div>
    <button
      type="button"
      class="icon-btn"
      aria-pressed={prefs.developer}
      title="Developer mode"
      aria-label="Developer mode"
      onclick={() => prefs.setDeveloper(!prefs.developer)}
    >
      <Bug size={18} />
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Theme: {prefs.theme}"
      aria-label="Theme: {prefs.theme}. Switch to {nextTheme}"
      onclick={() => prefs.setTheme(nextTheme)}
    >
      {#if themeIcon}{@const Icon = themeIcon}<Icon size={18} />{/if}
    </button>
    {#if connected && ondisconnect}
      <button type="button" class="icon-btn" title="Disconnect" aria-label="Disconnect" onclick={ondisconnect}>
        <Unplug size={18} />
      </button>
    {/if}
  </div>
</header>

<style>
  .header {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    background: color-mix(in oklab, var(--color-bg) 82%, transparent);
    backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--color-border);
    padding-top: env(safe-area-inset-top);
  }
  .inner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-h);
    max-width: var(--content-max);
    margin: 0 auto;
    padding: 0 var(--gutter);
  }
  .tabs {
    display: flex;
    flex: none;
    gap: 2px;
    margin-left: var(--space-4);
  }
  .tabs a {
    display: inline-flex;
    align-items: center;
    min-height: var(--hit-min);
    padding: 0 12px;
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    text-decoration: none;
    font-weight: var(--weight-medium);
    font-size: var(--text-sm);
  }
  .tabs a:hover {
    color: var(--color-text);
    background: var(--color-surface-3);
  }
  .tabs a.active {
    color: var(--color-text);
    background: var(--color-surface-3);
  }
  .spacer {
    flex: 1 1 0;
    min-width: 0;
  }
  .status {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    gap: 8px;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
    max-width: 42ch;
  }
  .status-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .short {
    display: none;
  }
  .status strong {
    color: var(--color-text);
    font-weight: var(--weight-semibold);
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-text-subtle);
  }
  .success .dot {
    background: var(--color-success);
    box-shadow: 0 0 0 3px var(--color-success-soft);
  }
  .warning .dot {
    background: var(--color-warning);
  }
  .danger .dot {
    background: var(--color-danger);
  }
  .accent .dot {
    background: var(--color-accent);
  }
  .icon-btn {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    border: 0;
    background: transparent;
    color: var(--color-text-muted);
  }
  .icon-btn:hover {
    background: var(--color-surface-3);
    color: var(--color-text);
  }
  .icon-btn[aria-pressed='true'] {
    color: var(--color-accent);
    background: var(--color-accent-soft);
  }
  /* Section tabs live in the header only where all of them fit; below that the bottom TabBar has them. */
  @media (max-width: 1023px) {
    .tabs {
      display: none;
    }
  }
  /* With tabs in the header, the device name is in the page itself (Receiver card, Device page). */
  @media (min-width: 1024px) and (max-width: 1279px) {
    .dev {
      display: none;
    }
  }
  @media (max-width: 767px) {
    .inner {
      gap: var(--space-1);
    }
    .status {
      padding: 4px 10px;
      font-size: var(--text-xs);
    }
  }
  @media (max-width: 559px) {
    .dev,
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
  }
</style>
