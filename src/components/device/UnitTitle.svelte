<script lang="ts">
  /**
   * Head of a unit (RX, Mic 1, Mic 2): the channel LED, the name and the hardware plate
   * (TX1 / TX2 / RX), with a status word on the right. Purple and yellow appear only in the LED;
   * the name and plate carry the identity in words.
   */
  import type { Snippet } from 'svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import type { LampState } from '../../lib/ui/types'

  interface Props {
    channel: 'rx' | 'tx1' | 'tx2'
    name: string
    /** Second line, e.g. "Mic 1" under a custom name. */
    sub?: string | null
    /** The LED: lit while the unit is online, dark when offline. */
    led?: LampState
    id?: string
    level?: 3 | 4
    status?: Snippet
    /** Hardware plate instead of the channel's (TX3, CASE …), with its expansion. */
    plate?: string
    plateTitle?: string
    /** Draw the mic's identity LED (purple / yellow): only where the product's LEDs have those colours. */
    identity?: boolean
  }
  let {
    channel,
    name,
    sub = null,
    led = 'on',
    id,
    level = 3,
    status,
    plate: plateText,
    plateTitle: plateTitleText,
    identity = true,
  }: Props = $props()
  const plate = $derived(plateText ?? (channel === 'rx' ? 'RX' : channel === 'tx1' ? 'TX1' : 'TX2'))
  const plateTitle = $derived(
    plateTitleText ?? (channel === 'rx' ? 'Receiver' : channel === 'tx1' ? 'Transmitter 1' : 'Transmitter 2'),
  )
</script>

<div class="head">
  {#if identity && channel !== 'rx'}
    <Lamp color={channel === 'tx1' ? 'mic1' : 'mic2'} state={led} size="lg" />
  {/if}
  <div class="names">
    <svelte:element this={`h${level}`} {id} class="name">{name}</svelte:element>
    {#if sub}<span class="sub">{sub}</span>{/if}
  </div>
  <Tag title={plateTitle}>{plate}</Tag>
  {#if status}<div class="status">{@render status()}</div>{/if}
</div>

<style>
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    min-height: var(--hit);
    min-width: 0;
  }
  .names {
    display: grid;
    min-width: 0;
  }
  .name {
    font-size: 20px;
    font-weight: 660;
    font-stretch: var(--head-stretch);
    line-height: 1.15;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--ink-3);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
    font-size: 13px;
    color: var(--ink-2);
  }
</style>
