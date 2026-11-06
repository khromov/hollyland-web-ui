<script lang="ts">
  /**
   * A Settings section for a non-legacy product: a faceplate panel of control modules divided by
   * hairlines. Controls the product doesn't have, and controls this firmware replaced by another
   * one ('firmware-too-new'), are left out. Per-unit controls (MELO P1 LEDs) become one module with
   * a sub-module per unit. When every module is blocked for the same reason (secondary receiver,
   * no mic connected), the reason is said once for the section instead of under each module.
   */
  import type { Snippet } from 'svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import type { ControlSpec, UnitId } from '../../lib/protocol'
  import { session } from '../../lib/state/session.svelte'
  import { micNames } from '../overview/family/names.svelte'
  import ControlModule from './ControlModule.svelte'
  import { sectionColumns, unitName } from './controls'
  import type { Item } from './placement'

  interface Props {
    title: string
    items: readonly Item[]
    /** More modules after the controls (inside the same strip). */
    extra?: Snippet
    /** How many modules `extra` adds (for the column layout). */
    extraCount?: number
    /** Always draw the section, even with no control (when `extra` has content). */
    keep?: boolean
  }
  let { title, items, extra, extraCount = 0, keep = false }: Props = $props()

  const shown = $derived(
    items
      .map((item) => ({ item, spec: session.control(item.id) }))
      .filter((x): x is { item: Item; spec: ControlSpec } => !!x.spec && session.availability(x.item.id)?.reason !== 'firmware-too-new'),
  )
  const count = $derived(shown.length + extraCount)
  /**
   * A reason that blocks several modules (secondary receiver, no mic connected) is said once for the
   * section; the flat controls show which ones it blocks.
   */
  const common = $derived.by(() => {
    const counts = new Map<string, number>()
    for (const x of shown) {
      const t = x.spec.perUnit ? null : session.blockText(x.spec.id)
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    let best: string | null = null
    for (const [t, n] of counts) if (n >= 2 && (!best || n > counts.get(best)!)) best = t
    return best
  })

  /** Balanced rows (6 → 3 + 3, 9 → 5 + 4); one or two modules keep a third of the row each. */
  let width = $state(0)
  const columns = $derived(sectionColumns(count, width))

  /** Units of a per-unit control the kit has. */
  function unitsOf(spec: ControlSpec): UnitId[] {
    const units = session.micState?.units
    return (spec.perUnit ?? []).filter((u) => u === 'rx' || !!units?.[u])
  }
  function nameOf(u: UnitId): string {
    if (/^tx\d$/.test(u)) return micNames.name(u, session.micState?.units[u])
    return unitName(u)
  }
</script>

{#if count > 0 || keep}
  <Panel {title} description={common ?? undefined}>
    <div class="mods" bind:clientWidth={width}>
      <Modules {columns}>
        {#each shown as { item, spec } (item.id)}
          {#if spec.perUnit}
            <Module title={item.title ?? spec.label}>
              <div class="units">
                {#each unitsOf(spec) as u (u)}
                  <ControlModule {spec} {item} unit={u} nested title={nameOf(u)} />
                {/each}
              </div>
            </Module>
          {:else}
            <ControlModule {spec} {item} quiet={!!common && session.blockText(spec.id) === common} />
          {/if}
        {/each}
        {@render extra?.()}
      </Modules>
    </div>
  </Panel>
{/if}

<style>
  .mods {
    min-width: 0;
  }
  .units {
    display: grid;
    gap: 14px;
  }
  /* Phones: modules stack as full-width rows aligned with the section heading. */
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
