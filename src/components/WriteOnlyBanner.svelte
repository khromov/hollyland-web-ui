<script lang="ts">
  import Banner from '../lib/ui/Banner.svelte'
  import Button from '../lib/ui/Button.svelte'
  import { session } from '../lib/state/session.svelte'

  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
  const isMac = /mac/i.test(platform)
  const isWin = /win/i.test(platform)
  let open = $state(false)
</script>

<Banner tone="warning" title="Write-only connection">
  {isMac ? 'macOS' : isWin ? 'Windows' : 'This system'} discards the receiver's replies, so this page can send settings but
  can't read battery, mic status or the current values. Controls show what this browser last sent to a {session.displayName ||
    'receiver of this model'}.
  {#if open}
    <div class="more">
      <p>
        Full live control works in Chrome on <strong>Linux</strong> and <strong>ChromeOS</strong>. On a Mac you can run the
        optional local bridge from the project folder (it asks for your password and pauses the receiver's USB audio while
        it runs):
      </p>
      <code>npm run bridge</code>
      <p>Then choose "Connect through local bridge" on this page. See docs/BRIDGE.md.</p>
    </div>
  {/if}
  {#snippet actions()}
    <Button size="sm" variant="ghost" onclick={() => (open = !open)}>{open ? 'Less' : 'Why?'}</Button>
    <Button size="sm" variant="ghost" onclick={() => session.forgetSent()}>Forget remembered values</Button>
  {/snippet}
</Banner>

<style>
  .more {
    margin-top: var(--space-2);
    display: grid;
    gap: var(--space-2);
  }
  code {
    justify-self: start;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    color: var(--color-text);
  }
</style>
