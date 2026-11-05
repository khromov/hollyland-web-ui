<script lang="ts">
  /** A unit's link state as a lamp plus a word: Online (lit), Offline (dark); unknown is a hollow lamp and "–". */
  import Lamp from '../../lib/ui/Lamp.svelte'

  interface Props {
    status: 'connected' | 'online' | 'offline' | 'unknown'
  }
  let { status }: Props = $props()
  const word = $derived(
    status === 'connected' ? 'Connected' : status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : null,
  )
</script>

<span class="st" title={word ? undefined : 'Unknown'}>
  <Lamp size="sm" state={status === 'unknown' ? 'hollow' : status === 'offline' ? 'off' : 'on'} />
  {#if word}{word}{:else}<span class="mc-dash" aria-hidden="true">–</span><span class="visually-hidden">Status unknown</span>{/if}
</span>

<style>
  .st {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
    white-space: nowrap;
  }
</style>
