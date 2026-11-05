<script lang="ts">
  /** Disclaimer, supported receivers and where the page works. Labels and values; details in tooltips. */
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import type { LampState } from '../../lib/ui/types'
  import { DISCLAIMER } from '../shell/link.svelte'

  const PLATFORMS: { name: string; lamp: LampState; status: string; tip: string }[] = [
    {
      name: 'Chrome or Edge on Linux, ChromeOS',
      lamp: 'on',
      status: 'Full control',
      tip: 'Linux needs a udev rule for the receiver',
    },
    {
      name: 'Chrome or Edge on macOS',
      lamp: 'hollow',
      status: 'Status unavailable',
      tip: 'Settings apply; status can’t be read. The local bridge gives full control (pauses USB audio).',
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
</script>

<Panel title="About">
  <div class="mods">
    <Modules columns="repeat(auto-fit, minmax(min(100%, 300px), 1fr))">
      <Module title="Hollyland Web UI">
        <dl class="facts">
          <div class="fact">
            <dt>Receivers</dt>
            <dd>LARK A2, A2S, M2, M2S</dd>
          </div>
          <div class="fact">
            <dt>Protocol notes</dt>
            <dd><code>docs/PROTOCOL.md</code></dd>
          </div>
        </dl>
        <!-- Where the status line along the bottom doesn't print it (phones, < 1200 px). -->
        <p class="disclaimer">{DISCLAIMER}</p>
      </Module>
      <Module title="Where it works">
        <ul class="platforms">
          {#each PLATFORMS as p (p.name)}
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
