<script lang="ts">
  /**
   * Status strip under the header. Rendered by App only while the current connection can't read
   * replies (macOS/Windows HID), so it never appears on Linux/ChromeOS or through the bridge.
   *
   * One thin line ("Status unavailable on macOS" + "Why?"); the bridge and "Forget remembered
   * values" live in the expandable details, so the strip costs ~36 px on every screen size.
   */
  import { ChevronDown, Info } from '@lucide/svelte'
  import Key from '../lib/ui/Key.svelte'
  import { bridgeStartHelp } from '../lib/protocol'
  import { PLATFORM_NAME, platform } from './shell/link.svelte'
  import { FORGET_LABEL, FORGET_TIP, forgetRemembered } from './settings/sent.svelte'

  interface Props {
    /** Connect through the local bridge (App's connectBridge). */
    onbridge?: () => void
  }
  let { onbridge }: Props = $props()

  const startHelp = bridgeStartHelp()
  const message = platform === 'other' ? 'Status unavailable' : `Status unavailable on ${PLATFORM_NAME[platform]}`
  const pausesAudio = platform !== 'linux' && platform !== 'chromeos'
  /** The bridge needs libusb with root (macOS, Linux); Windows can't run it (docs/BRIDGE.md). */
  const bridgeRuns = platform !== 'windows'
  let open = $state(false)
  const detailsId = `wo-details-${Math.random().toString(36).slice(2, 8)}`
</script>

<div class="mc-window strip" role="status">
  <div class="line">
    <Info class="arrow" size={15} strokeWidth={2} aria-hidden="true" />
    <span class="msg">{message}</span>
    <button type="button" class="why" aria-expanded={open} aria-controls={detailsId} onclick={() => (open = !open)}>
      {open ? 'Less' : 'Why?'}
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" class={open ? 'flip' : ''} />
    </button>
  </div>

  {#if open}
    <div class="details" id={detailsId}>
      <p>Settings still apply; battery, mute and values can’t be read.</p>
      {#if bridgeRuns}
        <p>Full status: run the local bridge{pausesAudio ? ' (pauses USB audio)' : ''}.</p>
        <code class="cmd">{startHelp.command}</code>
        {#if onbridge}
          <div><Key variant="light" size="sm" onclick={onbridge}>Connect through local bridge</Key></div>
        {/if}
      {/if}
      <div><Key variant="quiet" size="sm" title={FORGET_TIP} onclick={forgetRemembered}>{FORGET_LABEL}</Key></div>
    </div>
  {/if}
</div>

<style>
  .strip {
    background: var(--window);
    color: var(--w-ink);
    border-radius: var(--r-key);
    font-size: 13px;
    line-height: 1.35;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 6px 0 12px;
  }
  .line :global(.arrow) {
    flex: none;
  }
  .msg {
    flex: 1;
    min-width: 0;
    color: var(--w-ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .why {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 28px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--r-cap);
    background: transparent;
    color: var(--w-ink);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* 44 px hit area without growing the strip. */
  .why::after {
    content: '';
    position: absolute;
    inset: -8px -2px;
  }
  .why:hover {
    background: color-mix(in srgb, var(--w-ink) 10%, transparent);
  }
  .why :global(.flip) {
    transform: rotate(180deg);
  }
  .details {
    display: grid;
    justify-items: start;
    gap: 8px;
    padding: 4px 14px 14px 35px;
    color: var(--w-ink-2);
    max-width: 90ch;
  }
  .cmd {
    padding: 6px 10px;
    border-radius: var(--r-cap);
    background: #232327;
    color: var(--w-ink);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  @media (max-width: 599px) {
    .details {
      padding-left: 14px;
    }
  }
</style>
