<script lang="ts">
  /**
   * LARK MAX 2 Wireless Monitoring (mobile receiver): the switch (the receiver restarts), the
   * monitor earphones' play / pause and volume, pairing, and the earphones' batteries.
   * Rendered by the Monitoring page (src/components/monitoring/MonitoringPage.svelte).
   */
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import BatteryCells from '../../lib/ui/BatteryCells.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import { max2, type ControlSpec, type MicUnit } from '../../lib/protocol'
  import { session } from '../../lib/state/session.svelte'
  import ControlModule from './ControlModule.svelte'
  import { sectionColumns } from './controls'

  const C = max2.MAX2_CONTROL

  const wireless = $derived(session.control(C.WIRELESS))
  const monitor = $derived(session.control(C.OWS_MONITOR))
  const volume = $derived(session.control(C.OWS_VOLUME))
  const pair = $derived(session.control(C.OWS_PAIR))
  const controls = $derived([wireless, monitor, volume, pair].filter((c): c is ControlSpec => !!c))
  const live = $derived(session.live)
  const ears = $derived(
    (['earL', 'earR'] as const)
      .map((id) => session.micState?.units[id])
      .filter((u): u is MicUnit => !!u),
  )
  const showEars = $derived(!!wireless && ears.length > 0)
  const count = $derived(controls.length + (showEars ? 1 : 0))
  let width = $state(0)
  const columns = $derived(sectionColumns(count, width))
  /** Firmware too old (or not read yet): the whole section is unavailable, said once. */
  const gate = $derived.by(() => {
    const a = session.availability(C.WIRELESS)
    return a && (a.reason === 'firmware-too-old' || a.reason === 'version-unknown') ? session.blockText(C.WIRELESS) : null
  })
  /** The rest is blocked until monitoring is on: said once, by the switch's OFF. */
  const wirelessOff = $derived(session.value(C.WIRELESS) === false)
</script>

{#if controls.length > 0}
  <Panel title="Wireless Monitoring">
    {#if gate}
      <p class="empty">{gate}</p>
    {:else}
    <div class="mods" bind:clientWidth={width}>
      <Modules {columns}>
        {#if wireless}<ControlModule spec={wireless} item={{ id: C.WIRELESS, title: 'Monitoring' }} />{/if}
        {#if monitor}
          <ControlModule spec={monitor} item={{ id: C.OWS_MONITOR, title: 'Playback', legends: { on: 'Play', off: 'Pause' } }} quiet={wirelessOff} />
        {/if}
        {#if volume}<ControlModule spec={volume} item={{ id: C.OWS_VOLUME, title: 'Volume' }} quiet={wirelessOff} />{/if}
        {#if pair}<ControlModule spec={pair} item={{ id: C.OWS_PAIR, title: 'Earphone pairing' }} quiet={wirelessOff} />{/if}
        {#if showEars}
          <Module title="Earphones">
            <dl class="ears">
              {#each ears as u (u.id)}
                <div class="ear">
                  <dt>{u.id === 'earL' ? 'Left' : 'Right'}</dt>
                  <dd>
                    {#if !live}
                      <span class="mc-dash" title="Unknown">–</span>
                    {:else if u.online}
                      <BatteryCells percent={u.battery ?? null} charging={!!u.charging} label="{u.id === 'earL' ? 'Left' : 'Right'} earphone battery" />
                    {:else}
                      <span class="off"><Lamp size="sm" state="off" />Not connected</span>
                    {/if}
                  </dd>
                </div>
              {/each}
            </dl>
          </Module>
        {/if}
      </Modules>
    </div>
    {/if}
  </Panel>
{/if}

<style>
  .mods {
    min-width: 0;
  }
  .empty {
    padding: 18px 0 22px;
    font-size: var(--t-body-sm);
    color: var(--ink-2);
  }
  @media (min-width: 1280px) {
    .empty {
      padding: 24px var(--module-pad) 22px;
    }
  }
  .ears {
    margin: 0;
  }
  .ear {
    display: grid;
    grid-template-columns: minmax(64px, 30%) minmax(0, 1fr);
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 4px 0;
  }
  .ear + .ear {
    border-top: 1px solid var(--rule-soft);
  }
  dt {
    font-size: 13px;
    color: var(--ink-2);
  }
  dd {
    margin: 0;
    min-width: 0;
  }
  .off {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
