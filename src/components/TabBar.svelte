<script lang="ts">
  import type { Component } from 'svelte'
  import { router, type Route } from '../lib/state/router.svelte'

  interface Props {
    tabs: { route: Route; label: string; icon: Component<{ size?: number }> }[]
  }
  let { tabs }: Props = $props()
</script>

<nav class="tabbar" aria-label="Sections">
  {#each tabs as t (t.route)}
    {@const Icon = t.icon}
    <a href="#/{t.route}" class:active={router.route === t.route} aria-current={router.route === t.route ? 'page' : undefined}>
      <Icon size={22} />
      <span>{t.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    z-index: var(--z-sticky);
    left: 0;
    right: 0;
    bottom: 0;
    display: none;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    height: calc(var(--tabbar-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: color-mix(in oklab, var(--color-surface-1) 92%, transparent);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--color-border);
  }
  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--color-text-subtle);
    text-decoration: none;
    font-size: var(--text-2xs);
    font-weight: var(--weight-medium);
    -webkit-tap-highlight-color: transparent;
  }
  a.active {
    color: var(--color-accent);
  }
  @media (max-width: 1023px) {
    .tabbar {
      display: grid;
    }
  }
</style>
