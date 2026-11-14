<script lang="ts">
  /**
   * Status strip under the header. Rendered by App only while the current connection can't read
   * replies (macOS, Linux and Windows HID drop them; docs/PROTOCOL.md §2.4), so it never appears
   * through the bridge.
   *
   * One thin line ("Status unavailable on macOS" + "Why?"); the bridge and "Forget remembered
   * values" live in the expandable details, so the strip costs ~36 px on every screen size. On the
   * first connection of an untested model it also carries that notice ("Untested model · …", with
   * its own dismiss key), so the page never stacks two strips.
   */
  import { ChevronDown, Info, X } from '@lucide/svelte'
  import Key from '../lib/ui/Key.svelte'
  import { bridgeStartHelp, webHidLinkOf } from '../lib/protocol/app'
  import { session } from '../lib/state/session.svelte'
  import { PLATFORM_NAME, platform, type Platform } from './shell/link.svelte'
  import { FORGET_LABEL, FORGET_TIP, forgetRemembered } from './settings/sent.svelte'

  interface Props {
    /** Connect through the local bridge (App's connectBridge). */
    onbridge?: () => void
  }
  let { onbridge }: Props = $props()

  const startHelp = bridgeStartHelp()
  const status = platform === 'other' ? 'Status unavailable' : `Status unavailable on ${PLATFORM_NAME[platform]}`
  /** First connection of an untested model: its notice shares this strip (one strip at most). */
  const untested = $derived(session.untestedNotice)
  const message = $derived(untested ? `Untested model · ${status}` : status)
  const pausesAudio = platform !== 'linux' && platform !== 'chromeos'
  const NO_BRIDGE: readonly Platform[] = ['windows', 'chromeos', 'android', 'ios']
  /**
   * The bridge is a Node program using libusb (root on macOS, the udev rules on Linux); it doesn't
   * run on Windows, ChromeOS or phones (docs/BRIDGE.md). It captures products with an
   * interrupt-report USB link only (not the A1's feature reports).
   */
  const bridgeRuns = $derived(
    !NO_BRIDGE.includes(platform) && !!session.product && !!webHidLinkOf(session.product),
  )
  let open = $state(false)
  const detailsId = `wo-details-${Math.random().toString(36).slice(2, 8)}`
</script>

<div class="mc-window strip" role="status">
  <div class="line">
    <Info class="arrow" size={15} strokeWidth={2} aria-hidden="true" />
    <span class="msg"
      >{#if untested}<span class="wide">{message}</span><span class="narrow">Untested · Status unavailable</span>{:else}{message}{/if}</span
    >
    <button type="button" class="why" aria-expanded={open} aria-controls={detailsId} onclick={() => (open = !open)}>
      {open ? 'Less' : 'Why?'}
      <ChevronDown size={14} strokeWidth={2} aria-hidden="true" class={open ? 'flip' : ''} />
    </button>
    {#if untested}
      <button type="button" class="dismiss" aria-label="Dismiss untested-model notice" title="Dismiss" onclick={() => session.dismissUntestedNotice()}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    {/if}
  </div>

  {#if open}
    <div class="details" id={detailsId}>
      {#if untested}<p>Untested model. Risky actions are hidden.</p>{/if}
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
  .dismiss {
    position: relative;
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 28px;
    border: 0;
    border-radius: var(--r-cap);
    background: transparent;
    color: var(--w-ink);
  }
  .dismiss::after {
    content: '';
    position: absolute;
    inset: -8px -2px;
  }
  .dismiss:hover {
    background: color-mix(in srgb, var(--w-ink) 10%, transparent);
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
  .narrow {
    display: none;
  }
  @media (max-width: 599px) {
    .details {
      padding-left: 14px;
    }
    .wide {
      display: none;
    }
    .narrow {
      display: inline;
    }
  }
</style>
