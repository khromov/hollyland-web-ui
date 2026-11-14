<script lang="ts">
  /**
   * Disclaimer, supported receivers and where the page works for the receiver on screen. Labels and
   * values; details in tooltips. The receivers line comes from the registry (connect/models.ts), the
   * platform rows from the product's links: the tested legacy receivers keep their tested rows, the
   * others say "Untested" per link (USB, Bluetooth).
   */
  import { bleLinkOf, featureLinkOf, webHidLinkOf } from '../../lib/protocol/app'
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import type { LampState } from '../../lib/ui/types'
  import { session } from '../../lib/state/session.svelte'
  import { DISCLAIMER } from '../shell/link.svelte'
  import { connectableModels, modelsLine } from '../connect/models'

  interface PlatformRow {
    name: string
    lamp: LampState
    status: string
    tip: string
  }

  const receivers = modelsLine(connectableModels())

  /** The tested USB receivers (LARK A2 / A2S, Lark M2, LARK M2S, the 6501 group). */
  const LEGACY_ROWS: PlatformRow[] = [
    {
      name: 'Chrome or Edge on Linux, with the local bridge',
      lamp: 'on',
      status: 'Full control',
      tip: 'Tested with a Lark M2. Without the bridge, settings apply but status can’t be read. USB audio keeps working. Needs udev rules for the receiver.',
    },
    {
      name: 'Chrome or Edge on macOS',
      lamp: 'hollow',
      status: 'Status unavailable',
      tip: 'Settings apply; status can’t be read. The local bridge gives full control (pauses USB audio).',
    },
    {
      name: 'Chrome on ChromeOS',
      lamp: 'hollow',
      status: 'Untested',
      tip: 'Expected to be like Linux without the bridge (same kernel HID stack): settings apply, status can’t be read.',
    },
    {
      name: 'Chrome or Edge on Windows',
      lamp: 'hollow',
      status: 'Untested',
      tip: 'Expected to work like macOS. The local bridge doesn’t run on Windows.',
    },
    {
      name: 'Safari, Firefox, Android',
      lamp: 'off',
      status: 'Audio only',
      tip: 'No WebHID: only the Audio page (levels, effects, recording)',
    },
  ]

  const rows = $derived.by((): PlatformRow[] => {
    const p = session.product
    if (!p || session.isLegacy) return LEGACY_ROWS
    const usb = !!webHidLinkOf(p) || !!featureLinkOf(p)
    const ble = !!bleLinkOf(p)
    const out: PlatformRow[] = []
    if (usb) out.push({ name: 'Chrome or Edge, USB', lamp: 'hollow', status: 'Untested', tip: 'Linux needs a udev rule for the receiver' })
    if (ble) out.push({ name: 'Chrome or Edge, Bluetooth', lamp: 'hollow', status: 'Untested', tip: 'Android, ChromeOS, macOS, Windows, Linux' })
    out.push({
      name: ble ? 'Safari, Firefox' : 'Safari, Firefox, Android',
      lamp: 'off',
      status: 'Audio only',
      tip: 'Only the Audio page (levels, effects, recording)',
    })
    return out
  })
  const notes = $derived(session.isLegacy || !session.product ? 'docs/PROTOCOL.md' : 'docs/FAMILIES.md')
</script>

<Panel title="About">
  <div class="mods">
    <Modules columns="repeat(auto-fit, minmax(min(100%, 300px), 1fr))">
      <Module title="Hollyland Web UI">
        <dl class="facts">
          <div class="fact">
            <dt>Receivers</dt>
            <dd>{receivers}</dd>
          </div>
          <div class="fact">
            <dt>Protocol notes</dt>
            <dd><code>{notes}</code></dd>
          </div>
        </dl>
        <!-- Where the status line along the bottom doesn't print it (phones, < 1200 px). -->
        <p class="disclaimer">{DISCLAIMER}</p>
      </Module>
      <Module title="Where it works">
        <ul class="platforms">
          {#each rows as p (p.name)}
            <li title={p.tip}>
              <span class="p-name">{p.name}</span>
              <span class="p-status"><Lamp size="sm" state={p.lamp} />{p.status}</span>
              <span class="visually-hidden">: {p.tip}</span>
            </li>
          {/each}
        </ul>
      </Module>
    </Modules>
  </div>
</Panel>

<style>
  .mods {
    min-width: 0;
  }
  .facts {
    margin: 0;
  }
  .fact {
    display: grid;
    grid-template-columns: minmax(96px, 38%) minmax(0, 1fr);
    align-items: center;
    gap: 16px;
    min-height: 36px;
    padding: 4px 0;
    border-top: 1px solid var(--rule-soft);
  }
  .fact:first-child {
    border-top: 0;
  }
  dt {
    font-size: 13px;
    color: var(--ink-2);
  }
  dd {
    margin: 0;
    min-width: 0;
    font-size: 14px;
  }
  code {
    font-size: 13px;
    color: var(--ink);
  }
  .disclaimer {
    font-size: 12px;
    color: var(--ink-3);
  }
  .platforms {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .platforms li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
    min-height: 36px;
    padding: 4px 0;
  }
  .platforms li + li {
    border-top: 1px solid var(--rule-soft);
  }
  .p-name {
    font-size: 14px;
    font-weight: 600;
  }
  .p-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
    white-space: nowrap;
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
  /* ≥ 1200 px the status line along the bottom carries the disclaimer. */
  @media (min-width: 1200px) {
    .disclaimer {
      display: none;
    }
  }
</style>
