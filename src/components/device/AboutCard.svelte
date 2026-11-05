<script lang="ts">
  /** Disclaimer, supported receivers and where the page can read and write. */
  import Panel from '../../lib/ui/Panel.svelte'
  import Modules from '../../lib/ui/Modules.svelte'
  import Module from '../../lib/ui/Module.svelte'
  import Lamp from '../../lib/ui/Lamp.svelte'
  import type { LampState } from '../../lib/ui/types'

  const PLATFORMS: { name: string; lamp: LampState; status: string; note: string }[] = [
    {
      name: 'Chrome or Edge on Linux and ChromeOS',
      lamp: 'on',
      status: 'Read and write',
      note: 'Full control. Linux needs a udev rule for the receiver.',
    },
    {
      name: 'Chrome or Edge on macOS',
      lamp: 'hollow',
      status: 'Send only',
      note: "macOS drops the receiver's replies: settings can be sent, nothing can be read. The local bridge gives full control, but pauses the receiver's USB audio while it runs.",
    },
    {
      name: 'Chrome or Edge on Windows',
      lamp: 'hollow',
      status: 'Unverified',
      note: 'Expected to be send only, like macOS. Not tested on hardware yet. The bridge does not run on Windows.',
    },
    {
      name: 'Safari, Firefox, Chrome on Android',
      lamp: 'off',
      status: 'No control',
      note: 'No WebHID. The Audio page still works for levels, effects and recording.',
    },
  ]
</script>

<Panel title="About" description="An independent project. Not made, endorsed or supported by Hollyland.">
  <div class="mods">
    <Modules columns="repeat(auto-fit, minmax(min(100%, 300px), 1fr))">
      <Module title="Mic Console">
        <p class="text">
          Works with the LARK A2, LARK A2S, LARK M2 and LARK M2S. Product names are used only to say which receivers it
          works with.
        </p>
        <p class="text">
          The USB protocol was documented from the official apps and checked on a real LARK A2. The notes are in
          <code>docs/PROTOCOL.md</code> in the project's source repository.
        </p>
      </Module>
      <Module title="Where it works">
        <ul class="platforms">
          {#each PLATFORMS as p (p.name)}
            <li>
              <div class="p-head">
                <span class="p-name">{p.name}</span>
                <span class="p-status"><Lamp size="sm" state={p.lamp} />{p.status}</span>
              </div>
              <p class="p-note">{p.note}</p>
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
  .text {
    max-width: 62ch;
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  code {
    color: var(--ink);
  }
  .platforms {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .platforms li {
    padding: 10px 0;
  }
  .platforms li:first-child {
    padding-top: 0;
  }
  .platforms li + li {
    border-top: 1px solid var(--rule-soft);
  }
  .p-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 12px;
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
  .p-note {
    margin-top: 2px;
    font-size: 13px;
    line-height: var(--lh-body);
    color: var(--ink-2);
  }
  @media (max-width: 599px) {
    .mods {
      --gutter: 0px;
    }
  }
</style>
