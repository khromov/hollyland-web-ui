<script lang="ts">
  /**
   * A command or config line in a dark display window, with a Copy key. Long text wraps instead of
   * scrolling, so nothing is hidden at the right edge. It wraps only at spaces: each word is an
   * atomic inline block, so `--allow-origin` or a URL never splits at a hyphen or dot. A single word
   * wider than the window still breaks inside, rather than overflowing. Under 400 px the Copy key
   * moves below the text to leave it the full width.
   */
  import { Check, Copy } from '@lucide/svelte'
  import DisplayWindow from '../../lib/ui/DisplayWindow.svelte'
  import Key from '../../lib/ui/Key.svelte'

  interface Props {
    text: string
    /** Accessible name of the copy key, e.g. "Copy the bridge command". */
    copyLabel?: string
  }
  let { text, copyLabel = 'Copy' }: Props = $props()

  const words = $derived(text.split(' '))

  let copied = $state(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      /* no clipboard access: the text can still be selected */
    }
  }
</script>

<div class="code-window">
  <DisplayWindow code pad="sm">
    <code class="text"
      >{#each words as word, i}{i > 0 ? ' ' : ''}<span class="word">{word}</span>{/each}</code
    >
    <Key variant="quiet" size="sm" class="copy" aria-label={copied ? 'Copied' : copyLabel} onclick={copy}>
      {#snippet icon()}{#if copied}<Check />{:else}<Copy />{/if}{/snippet}
      {copied ? 'Copied' : 'Copy'}
    </Key>
  </DisplayWindow>
</div>

<style>
  .code-window {
    width: 100%;
    min-width: 0;
    container-type: inline-size;
  }
  .code-window > :global(.mc-window) {
    align-items: flex-start;
  }
  .text {
    flex: 1;
    min-width: 0;
    padding: 6px 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--w-ink);
    white-space: pre-wrap;
  }
  .word {
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .code-window :global(.copy) {
    flex: none;
    margin-right: -6px;
    text-decoration: none;
  }
  /* Narrow (phones): the Copy key moves under the text, so a URL keeps the full width. */
  @container (max-width: 399px) {
    .code-window > :global(.mc-window) {
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
    }
    .code-window :global(.copy) {
      align-self: flex-end;
    }
  }
</style>
