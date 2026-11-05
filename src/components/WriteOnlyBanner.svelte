<script lang="ts">
  /**
   * The send-only band under the header (write-only link: the OS drops the receiver's replies).
   * A dark window with "→ SEND-ONLY LINK", never a yellow banner (yellow is Mic 2). It says what
   * still works, shows the confidence marks the controls use, and offers the local bridge with its
   * cost: full control, but the receiver's USB audio pauses while the bridge runs. The bridge
   * doesn't run on Windows, so it isn't offered there.
   * On wide screens it is two short lines (legend + sentence, the marks) beside the keys, so the
   * receiver strip stays on screen on a laptop.
   */
  import { ArrowRight } from '@lucide/svelte'
  import Key from '../lib/ui/Key.svelte'
  import Band from './shell/Band.svelte'
  import { session } from '../lib/state/session.svelte'
  import { bridgeStartHelp } from '../lib/protocol'
  import { PLATFORM_NAME, platform } from './shell/link.svelte'
  import { sentClock } from './overview/sent.svelte'
  import { sentTimes } from './settings/sent.svelte'

  function forget() {
    session.forgetSent()
    sentClock.clear()
    sentTimes.clear()
  }

  interface Props {
    /** Connect through the local bridge (App's connectBridge). */
    onbridge?: () => void
  }
  let { onbridge }: Props = $props()

  const startHelp = bridgeStartHelp()
  const os = platform === 'other' ? 'This system' : PLATFORM_NAME[platform]
  const pausesAudio = platform !== 'linux' && platform !== 'chromeos'
  /** The bridge needs libusb with root (macOS, Linux); Windows can't run it (docs/BRIDGE.md). */
  const bridgeRuns = platform !== 'windows'
  let open = $state(false)
  const uid = Math.random().toString(36).slice(2, 8)
  const moreId = `wo-more-${uid}`
  const costId = `wo-cost-${uid}`
</script>

{#snippet details()}
  <div class="details" id={moreId}>
    {#if bridgeRuns}
      <p>
        Full live control works in Chrome on Linux and ChromeOS. Here, run the local bridge{startHelp.where
          ? ` ${startHelp.where}`
          : ' in a terminal'}. It asks for your computer password; wait until it prints “captured”.
      </p>
      <code class="cmd">{startHelp.command}</code>
      {#if startHelp.fromClone}<p>From a clone of the project: <code>{startHelp.fromClone}</code></p>{/if}
      <p>
        {pausesAudio
          ? 'While the bridge runs, the receiver’s USB audio pauses: no live levels or recording until you stop it with Ctrl+C.'
          : 'On Linux the bridge only takes the control link, so USB audio keeps working.'}
      </p>
    {:else}
      <p>The local bridge doesn’t run on Windows. Chrome on Linux or ChromeOS gives full control.</p>
    {/if}
    <p class="forget">
      <span>This browser remembers what it last sent to each receiver model.</span>
      <Key variant="quiet" size="sm" onclick={forget}>Forget sent values</Key>
    </p>
  </div>
{/snippet}

<Band
  legend="Send-only link"
  lead="{os} drops the receiver’s replies: changes still reach {session.displayName ||
    'it'}, but battery, mute and settings can’t be read back."
  more={open ? details : undefined}
>
  {#snippet mark()}<ArrowRight size={18} strokeWidth={1.75} />{/snippet}
  <p class="marks">
    <span class="m"><span class="mc-swatch mc-swatch--sent" aria-hidden="true"></span>Last sent, not confirmed</span>
    <span class="m"><span class="mc-swatch mc-swatch--unknown" aria-hidden="true"></span>Not read</span>
    {#if onbridge && bridgeRuns && pausesAudio}
      <span class="cost" id={costId}>The local bridge gives full control, but USB audio pauses while it runs.</span>
    {/if}
  </p>
  {#snippet actions()}
    {#if onbridge && bridgeRuns}
      <Key variant="light" aria-describedby={pausesAudio ? costId : undefined} onclick={onbridge}>Connect through local bridge</Key>
    {/if}
    <Key variant="quiet" aria-expanded={open} aria-controls={moreId} onclick={() => (open = !open)}>{open ? 'Less' : 'Why?'}</Key>
  {/snippet}
</Band>

<style>
  .marks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--w-ink);
  }
  .m {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .cost {
    color: #c9c8c3;
  }
  .details {
    display: grid;
    justify-items: start;
    gap: 8px;
  }
  .cmd {
    padding: 6px 10px;
    border-radius: var(--r-cap);
    background: #232327;
    color: var(--w-ink);
    font-size: 13px;
    word-break: break-all;
  }
  .forget {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
  }
</style>
