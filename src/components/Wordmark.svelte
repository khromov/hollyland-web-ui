<script lang="ts">
  interface Props {
    /** Logo only on phones (the header also holds the connection status and buttons). */
    compact?: boolean
  }
  let { compact = false }: Props = $props()
</script>

<a class="wordmark" class:compact href="#/overview" aria-label="Mic Console home">
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" class="bg" />
    <rect x="7" y="9" width="3" height="14" rx="1.5" class="tx1" />
    <rect x="12.5" y="5" width="3" height="22" rx="1.5" class="fg" />
    <rect x="18" y="11" width="3" height="10" rx="1.5" class="fg" />
    <rect x="23.5" y="8" width="3" height="16" rx="1.5" class="tx2" />
  </svg>
  <span class="name">Mic Console</span>
  <span class="tag">unofficial</span>
</a>

<style>
  .wordmark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: var(--hit-min);
    color: var(--color-text);
    text-decoration: none;
    white-space: nowrap;
  }
  svg {
    flex: none;
    width: 28px;
    height: 28px;
    max-width: none;
  }
  .bg {
    fill: var(--color-surface-3);
  }
  .fg {
    fill: var(--color-text);
  }
  .tx1 {
    fill: var(--color-tx1);
  }
  .tx2 {
    fill: var(--color-tx2);
  }
  .name {
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
  }
  .tag {
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--color-text-subtle);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full);
    padding: 1px 6px;
  }
  @media (max-width: 1279px) {
    .compact .tag {
      display: none;
    }
  }
  @media (max-width: 559px) {
    .tag {
      display: none;
    }
    .compact .name {
      display: none;
    }
  }
  @media (max-width: 380px) {
    .name {
      display: none;
    }
  }
</style>
