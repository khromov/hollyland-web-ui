<script lang="ts">
  /**
   * One-time notice on the first connection of an untested product (docs/FAMILIES.md §4.3):
   * one thin strip under the header (App's band slot), the same window as the "Status unavailable"
   * strip, with Dismiss. Dismissed per product in this browser (`session.dismissUntestedNotice`).
   * On a write-only link the "Status unavailable" strip carries these words instead.
   */
  import { Info, X } from '@lucide/svelte'
  import { session } from '../../lib/state/session.svelte'
</script>

<div class="mc-window strip" role="status">
  <Info class="mark" size={15} strokeWidth={2} aria-hidden="true" />
  <span class="msg">Untested model. Risky actions are hidden.</span>
  <button type="button" class="dismiss" onclick={() => session.dismissUntestedNotice()}>
    <span class="word">Dismiss</span>
    <X class="icon" size={16} strokeWidth={2} aria-hidden="true" />
  </button>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 6px 0 12px;
    background: var(--window);
    color: var(--w-ink);
    border-radius: var(--r-key);
    font-size: 13px;
    line-height: 1.35;
  }
  .strip :global(.mark) {
    flex: none;
  }
  .msg {
    flex: 1;
    min-width: 0;
    padding: 9px 0;
    color: var(--w-ink-2);
  }
  .dismiss {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-cap);
    background: transparent;
    color: var(--w-ink);
    font: inherit;
    font-weight: 600;
  }
  .word {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* 44 px hit area without growing the strip. */
  .dismiss::after {
    content: '';
    position: absolute;
    inset: -8px -2px;
  }
  .dismiss:hover {
    background: color-mix(in srgb, var(--w-ink) 10%, transparent);
  }
  .dismiss :global(.icon) {
    display: none;
  }
  /* Phones: the X alone keeps the sentence on one line. */
  @media (max-width: 599px) {
    .word {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .dismiss {
      width: 36px;
      justify-content: center;
      padding: 0;
    }
    .dismiss :global(.icon) {
      display: block;
    }
  }
</style>
