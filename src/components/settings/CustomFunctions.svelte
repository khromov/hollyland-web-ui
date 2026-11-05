<script lang="ts">
  /**
   * LARK M2S "Custom Functions" (features.md §16.1; Android CustomFunctionActivity).
   * Up to two functions can be assigned to hardware buttons. Each assignment is a slot write
   * [slot, function, keyOperation, tx1Color, tx2Color] (cmd 0x37), sent as soon as a click type
   * is chosen, as in the official app.
   */
  import { session } from '../../lib/state/session.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { toasts } from '../../lib/ui/toast.svelte'
  import Card from '../../lib/ui/Card.svelte'
  import Switch from '../../lib/ui/Switch.svelte'
  import SegmentedControl from '../../lib/ui/SegmentedControl.svelte'
  import Banner from '../../lib/ui/Banner.svelte'
  import Button from '../../lib/ui/Button.svelte'
  import ChannelBadge from '../device/ChannelBadge.svelte'
  import BoolControl from '../overview/BoolControl.svelte'
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

  const NOT_CONNECTED = 'Mic1 and Mic2 are not connected; the current function cannot be configured.'
  const UP_TO_TWO = 'Supports up to two customizable buttons.'

  type Fn = FunctionDef & { buttons: ButtonId[] }

  const fns = $derived(functionsFor(session.isCameraVariant))
  const slots = $derived(session.settings.buttons ?? [undefined, undefined])
  const known = $derived(session.settings.buttons !== undefined)
  const colors = $derived(session.settings.buttonColors)
  const live = $derived(session.live)
  const blocked = $derived(live && !(session.units?.tx1.online && session.units?.tx2.online))
  const busy = $derived(session.customButtonsPending || session.phase !== 'ready')

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

  function stateText(f: Fn): string {
    if (slotOf(f.func) === null) return known ? 'Off' : 'Unknown'
    return keyOpLabel(currentKeyOp(f.func)) ?? 'Pending Setup'
  }

  /** Label of the other function already using this button + click, if any. */
  function takenBy(func: number, keyOp: number): string | null {
    for (const s of slots) {
      if (s && s.func !== 0 && s.func !== func && s.keyOp === keyOp) return functionLabel(s.func)
    }
    return null
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
    const ok = await session.setCustomButton(ds, 0, 0)
    writing = null
    if (ok) dropReservation(f.func)
    reportResult(ok)
  }

  async function choose(f: Fn, keyOp: number) {
    if (!guard()) return
    const slot = slotOf(f.func)
    if (!slot || currentKeyOp(f.func) === keyOp) return
    writing = { func: f.func, keyOp }
    const ok = await session.setCustomButton(slot, f.func, keyOp)
    writing = null
    if (ok) dropReservation(f.func)
    reportResult(ok)
  }

  async function clearForeign(slot: 1 | 2) {
    if (!guard()) return
    reportResult(await session.setCustomButton(slot, 0, 0))
  }

  // ---- Mic Recognition light colours (TX 1 and TX 2 always get opposite colours) ----
  const TXS = [1, 2] as const
  const identifyOn = $derived(slotOf(FUNC_IDENTIFY) !== null)
  const colorOptions = LIGHT_COLORS.map((c) => ({ value: c.value as number, label: c.label }))
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
    reportResult(await session.setCustomButton(slot, func, keyOp, next))
  }
</script>

<Card title="Custom Functions" overline="Receiver buttons">
  <p class="lead">
    Give the receiver and mic buttons an extra job. Up to two functions can be assigned at a time. A choice is sent to
    the receiver right away.
  </p>

  {#if blocked}
    <div class="notice"><Banner tone="warning">{NOT_CONNECTED}</Banner></div>
  {:else if !known}
    <div class="notice">
      <Banner tone="info">
        {session.writeOnly
          ? "This system can't read the current assignments, so each function shows as unknown. Choices you send from this browser are remembered here."
          : "The receiver hasn't reported the current assignments yet, so each function shows as unknown."}
      </Banner>
    </div>
  {/if}

  <ul class="fns" aria-busy={busy || undefined}>
    {#each fns as f (f.func)}
      {@const on = slotOf(f.func) !== null}
      {@const current = currentKeyOp(f.func)}
      <li class="fn" class:on>
        <div class="fn-head">
          <div class="fn-text">
            <div class="fn-label" id="fn-{f.func}">{f.label}</div>
            <div class="fn-desc">{f.description}</div>
            <div class="fn-state" class:assigned={on && current !== 0}>{stateText(f)}</div>
          </div>
          {#if known || on}
            <Switch
              checked={on}
              label={f.label}
              disabled={busy || blocked}
              pending={writing?.func === f.func && writing.keyOp === 0}
              onchange={(v) => toggle(f, v)}
            />
          {:else}
            <!-- Unknown assignment: an Off | On pair with nothing selected, never a fake "Off". -->
            <BoolControl value={undefined} label={f.label} onchange={(v) => toggle(f, v)} />
          {/if}
        </div>

        {#if on}
          <fieldset class="triggers" disabled={busy || blocked} aria-labelledby="fn-{f.func}">
            {#each f.buttons as bid (bid)}
              {@const b = BUTTONS[bid]}
              <div class="button-group" role="group" aria-labelledby="btn-{f.func}-{bid}">
                <div class="button-name" id="btn-{f.func}-{bid}">{b.label}</div>
                <div class="clicks">
                  {#each b.clicks as c (c.keyOp)}
                    {@const other = current === c.keyOp ? null : takenBy(f.func, c.keyOp)}
                    {@const isWriting = writing?.func === f.func && writing.keyOp === c.keyOp}
                    <label class="click" class:selected={current === c.keyOp} class:taken={!!other}>
                      <input
                        type="radio"
                        name="trigger-{f.func}"
                        value={c.keyOp}
                        checked={current === c.keyOp}
                        disabled={!!other}
                        aria-describedby={other ? `taken-${f.func}-${c.keyOp}` : undefined}
                        onchange={() => choose(f, c.keyOp)}
                      />
                      <span class="dot" aria-hidden="true"></span>
                      <span class="click-text">
                        <span class="click-label">{CLICK_LABEL[c.click]}</span>
                        {#if other}
                          <span class="taken-by" id="taken-{f.func}-{c.keyOp}">Used by {other}</span>
                        {/if}
                      </span>
                      {#if isWriting}<span class="spinner" aria-hidden="true"></span>{/if}
                    </label>
                  {/each}
                </div>
              </div>
            {/each}
          </fieldset>
        {/if}
      </li>
    {/each}
  </ul>

  {#each foreign as x (x.slot)}
    <div class="foreign">
      <span>
        Slot {x.slot}: {functionLabel(x.func)}{keyOpLabel(x.keyOp) ? `, ${keyOpLabel(x.keyOp)}` : ''} (not offered for this
        receiver)
      </span>
      <Button size="sm" variant="ghost" disabled={busy || blocked} onclick={() => clearForeign(x.slot)}>Clear</Button>
    </div>
  {/each}

  {#if identifyOn}
    <div class="colors">
      <h3>Mic Recognition</h3>
      <p class="fn-desc">Light colour for each mic. The two mics always use different colours.</p>
      {#each TXS as tx (tx)}
        {@const value = tx === 1 ? known1 : known2}
        <div class="color-row">
          <div class="color-name">
            <ChannelBadge channel={tx === 1 ? 'tx1' : 'tx2'} />
            <span>TX {tx}</span>
            {#if prefs.micNames[tx - 1]?.trim()}<span class="sub">{prefs.micLabel(tx === 1 ? 0 : 1)}</span>{/if}
          </div>
          <div class="color-seg">
            <SegmentedControl
              options={colorOptions}
              {value}
              label="TX {tx} light colour"
              size="sm"
              disabled={busy || blocked}
              onchange={(v) => pickColor(tx, v)}
            />
          </div>
        </div>
      {/each}
      {#if known1 === null}
        <p class="fn-desc">The current colours aren't known yet. Choosing one sets both mics.</p>
      {/if}
    </div>
  {/if}
</Card>

<style>
  .lead {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    max-width: 62ch;
  }
  .notice {
    margin-top: var(--space-3);
  }
  .fns {
    list-style: none;
    margin: var(--space-3) 0 0;
    padding: 0;
  }
  .fn {
    padding: var(--space-3) 0;
  }
  .fn + .fn {
    border-top: 1px solid var(--color-border);
  }
  .fn-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .fn-text {
    min-width: 0;
  }
  .fn-label {
    font-weight: var(--weight-medium);
  }
  .fn-desc {
    color: var(--color-text-muted);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
  .fn-state {
    margin-top: 2px;
    font-size: var(--text-sm);
    color: var(--color-text-subtle);
  }
  .fn-state.assigned {
    color: var(--color-text);
  }
  .on .fn-state:not(.assigned) {
    color: var(--color-warning);
  }
  .triggers {
    margin: var(--space-3) 0 0;
    padding: var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .triggers:disabled {
    opacity: 0.6;
  }
  .button-name {
    font-size: var(--text-xs);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--color-text-subtle);
    margin-bottom: 6px;
  }
  .clicks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr));
    gap: var(--space-2);
  }
  .click {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--hit-min);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease-standard);
  }
  .click:hover:not(.taken) {
    border-color: var(--color-text-muted);
  }
  .click.selected {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent) inset;
  }
  .click.taken {
    cursor: not-allowed;
    border-style: dashed;
    border-color: var(--color-border-strong);
    color: var(--color-text-subtle);
  }
  .click:has(input:focus-visible) {
    outline: var(--focus-width) solid var(--color-focus);
    outline-offset: var(--focus-offset);
  }
  .click input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
    margin: 0;
  }
  .dot {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--color-border-control);
    display: grid;
    place-items: center;
  }
  .selected .dot {
    border-color: var(--color-accent);
  }
  .selected .dot::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-accent);
  }
  .click-text {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .click-label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .taken-by {
    font-size: var(--text-xs);
    color: var(--color-text-subtle);
  }
  .spinner {
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--color-accent);
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .foreign {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-top: 1px solid var(--color-border);
    font-size: var(--text-sm);
    color: var(--color-text-muted);
  }
  .colors {
    margin-top: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-border);
    display: grid;
    gap: var(--space-2);
  }
  h3 {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    letter-spacing: 0;
  }
  .color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding: var(--space-1) 0;
  }
  .color-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--weight-medium);
  }
  .color-name .sub {
    color: var(--color-text-subtle);
    font-weight: var(--weight-regular);
    font-size: var(--text-sm);
  }
  .color-seg {
    width: 184px;
  }
</style>
