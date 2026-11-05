<script lang="ts">
  /**
   * LARK M2S "Custom Functions" (features.md §16.1; Android CustomFunctionActivity).
   * Up to two functions can be assigned to hardware buttons. Each assignment is a slot write
   * [slot, function, keyOperation, tx1Color, tx2Color] (cmd 0x37), sent as soon as a click type
   * is chosen, as in the official app. One module per function: its switch at the head, the
   * buttons it can go on as key rows (one key per click type) when it is on. Labels, values and
   * controls only: what a function does is its title's tooltip; how much is known about an
   * assignment is the control's own tooltip ("Last sent 17:42 · not confirmed", "Unknown").
   */
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import KeyGroup from '../../lib/ui/KeyGroup.svelte'
  import SlideSwitch from '../../lib/ui/SlideSwitch.svelte'
  import SendPair from '../../lib/ui/SendPair.svelte'
  import ConfidenceNote from '../../lib/ui/ConfidenceNote.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import Tag from '../../lib/ui/Tag.svelte'
  import Key from '../../lib/ui/Key.svelte'
  import type { Confidence, KeyOption } from '../../lib/ui/types'
  import {
    BUTTONS,
    CLICK_LABEL,
    FUNC_IDENTIFY,
    LIGHT_COLORS,
    functionLabel,
    functionsFor,
    keyOpLabel,
    type FunctionDef,
    type ButtonId,
  } from './customButtons'
  import { reportResult } from './feedback'
  import { sentTimes } from './sent.svelte'

  const NOT_CONNECTED = 'Connect both mics first'
  const UP_TO_TWO = 'Up to two functions'

  type Fn = FunctionDef & { buttons: ButtonId[] }

  const fns = $derived(functionsFor(session.isCameraVariant))
  const slots = $derived(session.settings.buttons ?? [undefined, undefined])
  const known = $derived(session.settings.buttons !== undefined)
  const colors = $derived(session.settings.buttonColors)
  const live = $derived(session.live)
  const writeOnly = $derived(session.writeOnly)
  const blocked = $derived(live && !(session.units?.tx1.online && session.units?.tx2.online))
  const busy = $derived(session.customButtonsPending || session.phase !== 'ready')
  const confidence: Confidence = $derived(writeOnly ? 'sent' : 'solid')

  /** Functions switched on here but not assigned to a button yet: function -> reserved slot. */
  let reserved: Record<number, 1 | 2> = $state({})
  /** The write in flight, to place the spinner. */
  let writing: { func: number; keyOp: number } | null = $state(null)

  function deviceSlotOf(func: number): 1 | 2 | null {
    if (slots[0]?.func === func) return 1
    if (slots[1]?.func === func) return 2
    return null
  }

  // Reservations stay valid only while their slot is still free on the receiver.
  const activeReserved = $derived.by(() => {
    const out: Record<number, 1 | 2> = {}
    for (const [k, slot] of Object.entries(reserved)) {
      const func = Number(k)
      if (deviceSlotOf(func) !== null) continue
      if ((slots[slot - 1]?.func ?? 0) !== 0) continue
      out[func] = slot
    }
    return out
  })

  function slotOf(func: number): 1 | 2 | null {
    return deviceSlotOf(func) ?? activeReserved[func] ?? null
  }

  const usedSlots = $derived(
    ([1, 2] as const).filter((i) => (slots[i - 1]?.func ?? 0) !== 0 || Object.values(activeReserved).includes(i)),
  )

  /** Slots holding a function this receiver variant doesn't list (so it can still be cleared). */
  const foreign = $derived(
    ([1, 2] as const).flatMap((i) => {
      const s = slots[i - 1]
      return s && s.func !== 0 && !fns.some((f) => f.func === s.func) ? [{ slot: i, func: s.func, keyOp: s.keyOp }] : []
    }),
  )

  function currentKeyOp(func: number): number {
    const ds = deviceSlotOf(func)
    return ds ? (slots[ds - 1]?.keyOp ?? 0) : 0
  }

  /** Label of the other function already using this button + click, if any. */
  function takenBy(func: number, keyOp: number): string | null {
    for (const s of slots) {
      if (s && s.func !== 0 && s.func !== func && s.keyOp === keyOp) return functionLabel(s.func)
    }
    return null
  }

  function clickOptions(f: Fn, bid: ButtonId): KeyOption<number>[] {
    const current = currentKeyOp(f.func)
    return BUTTONS[bid].clicks.map((c) => {
      const other = current === c.keyOp ? null : takenBy(f.func, c.keyOp)
      return {
        value: c.keyOp,
        label: CLICK_LABEL[c.click],
        disabled: !!other,
        hint: other ? `Used by ${other}` : undefined,
      }
    })
  }

  /** True when the key operation is one of the keys shown for this function. */
  function shownKeyOp(f: Fn, keyOp: number): boolean {
    return f.buttons.some((bid) => BUTTONS[bid].clicks.some((c) => c.keyOp === keyOp))
  }

  function guard(): boolean {
    if (blocked) {
      toasts.warning(NOT_CONNECTED)
      return false
    }
    return true
  }

  function dropReservation(func: number) {
    const next = { ...reserved }
    delete next[func]
    reserved = next
  }

  async function toggle(f: Fn, on: boolean) {
    if (!guard()) return
    if (on) {
      if (slotOf(f.func) !== null) return
      const free = ([1, 2] as const).find((i) => !usedSlots.includes(i))
      if (!free) {
        toasts.info(UP_TO_TWO)
        return
      }
      reserved = { ...reserved, [f.func]: free }
      return
    }
    const ds = deviceSlotOf(f.func)
    if (ds === null) {
      dropReservation(f.func)
      return
    }
    writing = { func: f.func, keyOp: 0 }
    sentTimes.mark('buttons')
    const ok = await session.setCustomButton(ds, 0, 0)
    writing = null
    if (ok) dropReservation(f.func)
    reportResult(ok)
  }

  async function choose(f: Fn, keyOp: number) {
    if (!guard()) return
    const slot = slotOf(f.func)
    if (!slot || (currentKeyOp(f.func) === keyOp && !writeOnly)) return
    writing = { func: f.func, keyOp }
    sentTimes.mark('buttons')
    const ok = await session.setCustomButton(slot, f.func, keyOp)
    writing = null
    if (ok) dropReservation(f.func)
    reportResult(ok)
  }

  async function clearForeign(slot: 1 | 2) {
    if (!guard()) return
    sentTimes.mark('buttons')
    reportResult(await session.setCustomButton(slot, 0, 0))
  }

  // ---- Mic Recognition light colours (TX 1 and TX 2 always get opposite colours) ----
  const TXS = [1, 2] as const
  const identifyOn = $derived(slotOf(FUNC_IDENTIFY) !== null)
  const colorOptions: KeyOption<number>[] = LIGHT_COLORS.map((c) => ({ value: c.value as number, label: c.label }))
  const known1 = $derived(colors && colors.tx1 > 0 ? colors.tx1 : null)
  const known2 = $derived(colors && colors.tx2 > 0 ? colors.tx2 : null)

  async function pickColor(tx: 1 | 2, color: number) {
    if (!guard()) return
    const slot = slotOf(FUNC_IDENTIFY)
    if (!slot) return
    const other = color === 1 ? 2 : 1
    const next = tx === 1 ? { tx1: color, tx2: other } : { tx1: other, tx2: color }
    // The library only writes whole slots, so the colours ride on the Mic Recognition slot.
    const ds = deviceSlotOf(FUNC_IDENTIFY)
    const func = ds ? FUNC_IDENTIFY : 0
    const keyOp = ds ? currentKeyOp(FUNC_IDENTIFY) : 0
    sentTimes.mark('buttons')
    reportResult(await session.setCustomButton(slot, func, keyOp, next))
  }

  /** When an assignment was sent from this browser (write-only tooltip). */
  const sentAt = $derived(writeOnly ? (sentTimes.at.buttons ?? null) : null)
</script>

<Panel title="Custom Functions">
  <!-- The block reason sits with the title (rail on desktop), so the module heads keep the rail's baseline. -->
  {#snippet meta()}
    {#if blocked}<ConfidenceNote kind="disabled" text={NOT_CONNECTED} />{/if}
  {/snippet}

  <div class="mods" aria-busy={busy || undefined}>
    <Modules min="280px">
      {#each fns as f (f.func)}
        {@const on = slotOf(f.func) !== null}
        {@const current = currentKeyOp(f.func)}
        {@const sent = writeOnly && known && !(on && deviceSlotOf(f.func) === null)}
        <Module title={f.label} description={f.description}>
          {#snippet head()}
            {#if known || on}
              <SlideSwitch
                checked={on}
                label={f.label}
                disabled={busy || blocked}
                pending={writing?.func === f.func && writing.keyOp === 0}
                confidence={sent ? 'sent' : 'solid'}
                {sentAt}
                onchange={(v) => toggle(f, v)}
              />
            {:else}
              <!-- Unknown assignment: an Off | On pair with nothing marked, never a fake "Off". -->
              <SendPair value={null} label={f.label} disabled={busy || blocked} onchange={(v) => toggle(f, v)} />
            {/if}
          {/snippet}

          {#if on}
            <div class="triggers">
              {#each f.buttons as bid (bid)}
                <div class="trigger">
                  <span class="trigger-name">{BUTTONS[bid].label}</span>
                  <KeyGroup
                    options={clickOptions(f, bid)}
                    value={BUTTONS[bid].clicks.some((c) => c.keyOp === current) ? current : null}
                    label="{f.label}: {BUTTONS[bid].label}"
                    size="sm"
                    {confidence}
                    {sentAt}
                    disabled={busy || blocked}
                    pendingValue={writing?.func === f.func ? writing.keyOp : null}
                    onchange={(v) => choose(f, v)}
                  />
                </div>
              {/each}
            </div>
          {/if}

          {#snippet foot()}
            {#if on && current === 0}
              <p class="state pending"><span class="mc-swatch mc-swatch--unknown" aria-hidden="true"></span>Pending Setup</p>
            {:else if on && !shownKeyOp(f, current)}
              <!-- Assigned to a button this receiver variant doesn't list (e.g. set from the other RX). -->
              <p class="state">Assigned to {keyOpLabel(current) ?? 'another button'}</p>
            {/if}
          {/snippet}
        </Module>
      {/each}

      {#if identifyOn}
        <Module title="Light colours" description="The two mics always use different colours">
          <div class="colors" style="--mic1: #9d6bff; --mic2: #ffcc1a">
            {#each TXS as tx (tx)}
              {@const value = tx === 1 ? known1 : known2}
              <div class="color-row">
                <span class="color-name">
                  <Tag title="Transmitter {tx}">TX{tx}</Tag>
                  {#if prefs.micNames[tx - 1]?.trim()}<span class="sub">{prefs.micLabel(tx === 1 ? 0 : 1)}</span>{/if}
                </span>
                <KeyGroup
                  options={colorOptions}
                  {value}
                  label="TX {tx} light colour"
                  size="sm"
                  confidence={value === null ? 'unknown' : confidence}
                  {sentAt}
                  disabled={busy || blocked}
                  onchange={(v) => pickColor(tx, v)}
                >
                  {#snippet item(o)}
                    <span class="color-key"><Lamp color={o.value === 1 ? 'mic1' : 'mic2'} size="sm" />{o.label}</span>
                  {/snippet}
                </KeyGroup>
              </div>
            {/each}
          </div>
        </Module>
      {/if}
    </Modules>
  </div>

  {#each foreign as x (x.slot)}
    <div class="foreign">
      <span title="Not offered for this receiver">
        Slot <span class="mono">{x.slot}</span>: {functionLabel(x.func)}{keyOpLabel(x.keyOp) ? `, ${keyOpLabel(x.keyOp)}` : ''}
      </span>
      <Key size="sm" variant="quiet" disabled={busy || blocked} onclick={() => clearForeign(x.slot)}>Clear</Key>
    </div>
  {/each}
</Panel>

<style>
  .mods {
    min-width: 0;
  }
  .triggers {
    display: grid;
    gap: 12px;
    padding-top: 4px;
  }
  .trigger {
    display: grid;
    gap: 6px;
    min-width: 0;
    max-width: 380px;
  }
  .trigger-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--ink-2);
  }
  .state {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-2);
  }
  .state.pending {
    color: var(--ink);
    font-weight: 600;
  }
  .state .mc-swatch {
    margin-top: 1px;
  }
  .colors {
    display: grid;
    gap: 10px;
  }
  .color-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 220px);
    align-items: center;
    gap: 12px;
  }
  .color-name {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .color-name .sub {
    font-size: 13px;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .color-key {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .foreign {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--rule);
    font-size: 13px;
    color: var(--ink-2);
  }
  @media (min-width: 1280px) {
    .foreign {
      padding-inline: var(--module-pad);
    }
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
