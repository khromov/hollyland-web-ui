<script lang="ts">
  /**
   * Phone tab bar (< 600 px): words only, no icons. The current tab is ink with a 4 px bar above
   * its label; a 1.5 px ink rule separates the bar from the page. Sticks to the bottom of the
   * viewport and clears the home indicator (safe area).
   */
  import type { HeaderTab } from './shell/types'

  interface Props {
    tabs: HeaderTab[]
    current: string
  }
  let { tabs, current }: Props = $props()
</script>

<nav class="tabbar" aria-label="Sections" style="--n: {tabs.length}">
  {#each tabs as t (t.label)}
    <a href="#/{t.route}" class:on={t.label === current} aria-current={t.label === current ? 'page' : undefined}>
      <i aria-hidden="true"></i>
      <span>{t.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: sticky;
    bottom: 0;
    z-index: var(--z-sticky);
    display: none;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    padding-bottom: max(env(safe-area-inset-bottom), 0px);
    background: var(--chassis);
    border-top: 1.5px solid var(--ink);
  }
  a {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--tabbar-h);
    padding: 0 2px;
    color: var(--ink-2);
    text-decoration: none;
    font-size: 13px;
    font-weight: 560;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }
  i {
    display: block;
    width: 18px;
    height: 4px;
    border-radius: 1px;
  }
  a.on {
    color: var(--ink);
    font-weight: 700;
  }
  a.on i {
    background: var(--ink);
  }
  a:focus-visible {
    outline-offset: -4px;
  }
  @media (max-width: 599px) {
    .tabbar {
      display: grid;
    }
  }
</style>
