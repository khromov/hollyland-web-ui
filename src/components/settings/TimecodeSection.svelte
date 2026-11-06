<script lang="ts">
  /**
   * LARK MAX 2 Timecode (camera receiver and charging case): the switch with the receiver's
   * timecode, Mode 1–3, frame rate and timing method. Reset (timecode back to 00:00:00:00 and a new
   * recording) is a separate key, offered in Count From Zero only and confirmed first.
   * Rendered by the Timecode page (src/components/timecode/TimecodePage.svelte).
   */
  import { RotateCcw } from '@lucide/svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import Dialog from '../../lib/ui/Dialog.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import { uid } from '../../lib/ui/field'
  import { max2 } from '../../lib/protocol'
  import { session, type ConfirmInfo } from '../../lib/state/session.svelte'
  import ControlModule from './ControlModule.svelte'
  import { sectionColumns } from './controls'
  import { reportResult } from './feedback'

  const C = max2.MAX2_CONTROL
  const resetDescId = uid('tc-reset')

  const enabled = $derived(session.control(C.TC_ENABLED))
  const mode = $derived(session.control(C.TC_MODE))
  const fps = $derived(session.control(C.TC_FPS))
  const timing = $derived(session.control(C.TC_TIMING))
  const count = $derived(+!!enabled + +!!mode + +!!fps + +!!timing)
  let width = $state(0)
  const columns = $derived(sectionColumns(count, width))

  const on = $derived(session.value(C.TC_ENABLED) === true)
  const ready = $derived(session.phase === 'ready')

  /** "01:02:03:04" from [h, m, s, f]; the status poll carries [m, s, f] only (hours unknown). */
  const time = $derived.by(() => {
    const t = session.value(max2.MAX2_STATUS_VALUE.TC_TIME)
    if (!Array.isArray(t) || t.length < 3) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return t.length >= 4 ? { h: p(t[0]), rest: t.slice(1, 4).map(p).join(':') } : { h: null, rest: t.slice(0, 3).map(p).join(':') }
  })

  // ---- Reset: only in Count From Zero (the official Reset row is hidden in Real-time Timing)
  /** After a Reset the receiver counts from zero again (the status may still say Reset). */
  const fromZero = $derived(
    session.value(C.TC_TIMING) === max2.MAX2_TIMING.FROM_ZERO || session.value(C.TC_TIMING) === max2.MAX2_TIMING.RESET,
  )
  const resetBlock = $derived(session.blockText(C.TC_TIMING))
  let ask = $state<ConfirmInfo | null>(null)
  let resetting = $state(false)
  function askReset() {
    const info = session.confirmFor(C.TC_TIMING, max2.MAX2_TIMING.RESET)
    if (info) ask = info
    else void reset(false)
  }
  async function reset(confirmed: boolean) {
    ask = null
    resetting = true
    try {
      reportResult(await session.setControl(C.TC_TIMING, max2.MAX2_TIMING.RESET, { confirm: confirmed }))
    } finally {
      resetting = false
    }
  }
</script>

{#if count > 0}
  <Panel title="Timecode">
    <div class="mods" bind:clientWidth={width}>
      <Modules {columns}>
        {#if enabled}
          <ControlModule spec={enabled} item={{ id: C.TC_ENABLED, title: 'Timecode' }}>
            {#if on && time}
              <p class="tc" title="Timecode">
                {#if time.h}{time.h}{:else}<span class="dim" title="Not reported">--</span>{/if}:{time.rest}
              </p>
            {/if}
          </ControlModule>
        {/if}
        {#if mode}<ControlModule spec={mode} />{/if}
        {#if fps}<ControlModule spec={fps} />{/if}
        {#if timing}
          <ControlModule spec={timing} item={{
              id: C.TC_TIMING,
              hide: [max2.MAX2_TIMING.RESET],
              alias: { [max2.MAX2_TIMING.RESET]: max2.MAX2_TIMING.FROM_ZERO },
            }}>
            {#if fromZero && !resetBlock}
              <div class="reset">
                <Key size="sm" disabled={!ready} loading={resetting} onclick={askReset}>
                  {#snippet icon()}<RotateCcw />{/snippet}
                  Reset
                </Key>
              </div>
            {/if}
          </ControlModule>
        {/if}
      </Modules>
    </div>
  </Panel>
{/if}

<Dialog open={!!ask} title="Reset timecode?" onclose={() => (ask = null)} describedby={resetDescId}>
  <p id={resetDescId}>{ask?.text}</p>
  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <Button variant="secondary" autofocus onclick={() => (ask = null)}>Cancel</Button>
    <Button variant="primary" onclick={() => reset(true)}>Reset</Button>
  {/snippet}
</Dialog>

<style>
  .mods {
    min-width: 0;
  }
  .tc {
    font: 500 var(--t-value) / 1 var(--f-mono);
    font-stretch: var(--mono-stretch);
    font-variant-numeric: tabular-nums slashed-zero;
    letter-spacing: 0.02em;
  }
  .dim {
    color: var(--ink-3);
  }
  .reset {
    display: flex;
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
