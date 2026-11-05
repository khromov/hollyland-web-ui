<script lang="ts">
  /**
   * A faceplate section, divided from the next by a full-width hairline rule (no box).
   * - rail (default): at ≥ 1280 px the title and a one-line explanation sit in a 168 px label
   *   column on the left, like a spec sheet; below that they become an inline heading row.
   * - rail={false}: always an inline heading row (title left, `aside` right).
   * - fill: the body absorbs the free height (e.g. the Transmitters row with the meters).
   */
  import type { Snippet } from 'svelte'
  import { uid } from './field'

  interface Props {
    title: string
    description?: string
    rail?: boolean
    /** Right side of the inline heading, e.g. "Applies to both mics". */
    aside?: Snippet
    /** Extra rail content under the description. */
    meta?: Snippet
    fill?: boolean
    /** Hide the visible heading (it stays for assistive tech). */
    hideTitle?: boolean
    level?: 2 | 3
    class?: string
    children: Snippet
  }

  let {
    title,
    description,
    rail = true,
    aside,
    meta,
    fill = false,
    hideTitle = false,
    level = 2,
    class: klass = '',
    children,
  }: Props = $props()
  const headingId = uid('panel')
</script>

<section class="panel {klass}" class:rail class:fill aria-labelledby={headingId}>
  <div class="head" class:visually-hidden={hideTitle}>
    <svelte:element this={`h${level}`} id={headingId} class="title">{title}</svelte:element>
    {#if description}<p class="desc">{description}</p>{/if}
    {#if meta}<div class="meta">{@render meta()}</div>{/if}
    {#if aside}<div class="aside">{@render aside()}</div>{/if}
  </div>
  <div class="body">{@render children()}</div>
</section>

<style>
  .panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-height: 0;
    border-bottom: 1px solid var(--rule);
  }
  .panel:last-child {
    border-bottom: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 16px;
    row-gap: 4px;
    padding: 20px 0 12px;
  }
  .title {
    font-size: var(--t-section-sm);
    font-weight: 680;
    font-stretch: var(--head-stretch);
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .desc {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .aside {
    margin-left: auto;
    font-size: 13px;
    color: var(--ink-2);
  }
  .meta {
    font-size: 12px;
    color: var(--ink-3);
  }
  .body {
    min-width: 0;
    min-height: 0;
  }
  .fill {
    grid-template-rows: auto minmax(0, 1fr);
  }

  @media (min-width: 600px) {
    .title {
      font-size: var(--t-section);
    }
  }
  @media (min-width: 1280px) {
    .rail {
      grid-template-columns: var(--rail-w) minmax(0, 1fr);
    }
    .rail.fill {
      grid-template-rows: minmax(0, 1fr);
    }
    .rail .head {
      flex-direction: column;
      flex-wrap: nowrap;
      align-items: stretch;
      gap: 6px;
      padding: 24px 20px 24px 0;
    }
    .rail .aside {
      margin-left: 0;
    }
    .rail .body {
      border-left: 1px solid var(--rule);
    }
  }
</style>
