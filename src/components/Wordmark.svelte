<script lang="ts">
  /**
   * "▮▮ Hollyland Web UI  Unofficial": the 26 px window glyph (a purple and a yellow bar), the name in
   * expanded Archivo, and the "Unofficial" note. Links home.
   * - compact: name only (no "Unofficial"), e.g. in a crowded header
   * - glyphOnly: the glyph alone (the name stays as the link's accessible name)
   */
  import BrandGlyph from '../lib/ui/BrandGlyph.svelte'

  interface Props {
    compact?: boolean
    glyphOnly?: boolean
    size?: 'md' | 'sm'
  }
  let { compact = false, glyphOnly = false, size = 'md' }: Props = $props()
</script>

<a class="wordmark {size}" href="#/overview" aria-label="Hollyland Web UI, unofficial. Home">
  <BrandGlyph size={size === 'sm' ? 24 : 26} />
  {#if !glyphOnly}
    <span class="name">Hollyland Web UI</span>
    {#if !compact}<span class="tag">Unofficial</span>{/if}
  {/if}
</a>

<style>
  .wordmark {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 10px;
    min-height: var(--hit);
    color: var(--ink);
    text-decoration: none;
    white-space: nowrap;
  }
  .wordmark:hover .name {
    text-decoration: none;
  }
  .name {
    font-size: 16px;
    font-weight: 720;
    font-stretch: var(--wordmark-stretch);
    letter-spacing: -0.01em;
    line-height: 1;
  }
  .sm .name {
    font-size: 15px;
  }
  .tag {
    margin-left: 2px;
    padding-top: 1px;
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
