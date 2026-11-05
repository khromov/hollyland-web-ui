<script lang="ts">
  /**
   * One module of the faceplate: a title with its value or control at the head (right),
   * an optional one-line description, the control, and a footnote pinned to the bottom.
   * Put modules in <Modules> for the hairline-divided strip.
   * - value / total: prints "6/6" at the head (ValueHead), with `confidence`
   * - head: any control at the head instead (e.g. a SlideSwitch)
   * - nested: a sub-module (rule on its left), e.g. Mic recognition under Indicator light
   */
  import type { Snippet } from 'svelte'
  import type { Confidence } from './types'
  import ValueHead from './ValueHead.svelte'
  import { uid } from './field'

  interface Props {
    title: string
    description?: string
    value?: number | string | null
    total?: number | string
    confidence?: Confidence
    head?: Snippet
    foot?: Snippet
    nested?: boolean
    /** Padding: 'receiver' 20 px, 'channel' 28 px, 'none'. */
    pad?: 'receiver' | 'channel' | 'none'
    level?: 3 | 4
    class?: string
    children?: Snippet
  }

  let {
    title,
    description,
    value,
    total,
    confidence = 'solid',
    head,
    foot,
    nested = false,
    pad = 'receiver',
    level = 3,
    class: klass = '',
    children,
  }: Props = $props()
  const headingId = uid('mod')
</script>

<section class="module pad-{pad} {klass}" class:nested aria-labelledby={headingId}>
  <div class="mod-head">
    <svelte:element this={`h${level}`} id={headingId} class="title">{title}</svelte:element>
    {#if head}
      <div class="head-ctl">{@render head()}</div>
    {:else if value !== undefined}
      <ValueHead {value} {total} {confidence} />
    {/if}
  </div>
  {#if description}<p class="desc">{description}</p>{/if}
  {#if children}<div class="content">{@render children()}</div>{/if}
  {#if foot}<div class="foot">{@render foot()}</div>{/if}
</section>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .pad-receiver {
    padding: 18px var(--module-pad) 20px;
  }
  .pad-channel {
    padding: 20px var(--channel-pad) 22px;
  }
  .pad-none {
    padding: 0;
  }
  .nested {
    margin-left: 6px;
    padding: 0 0 0 16px;
    border-left: 1px solid var(--rule);
    gap: 6px;
  }
  .mod-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: var(--hit);
  }
  .title {
    font-size: var(--t-control);
    font-weight: 660;
    font-stretch: 100%;
    line-height: var(--lh-head);
    letter-spacing: -0.005em;
  }
  .nested .title {
    font-size: 14px;
  }
  .head-ctl {
    display: flex;
    align-items: center;
    flex: none;
  }
  .desc {
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  .content {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .foot {
    margin-top: auto;
    padding-top: 4px;
    font-size: 12px;
    line-height: var(--lh-body);
    color: var(--ink-3);
  }
  .foot :global(b) {
    color: var(--ink-2);
    font-weight: 600;
  }
  @media (max-width: 599px) {
    .title {
      font-size: 16px;
    }
    .pad-receiver {
      padding: 10px var(--gutter) 16px;
    }
    .pad-channel {
      padding: 14px var(--gutter) 16px;
    }
  }
</style>
