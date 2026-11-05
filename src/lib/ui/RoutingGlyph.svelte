<script lang="ts">
  /**
   * A tiny window showing what lands on L and R in each channel mode:
   * Mono = both mics on both sides, Stereo = Mic 1 left / Mic 2 right,
   * SafeTr = the mix left and a −6 dB copy (shorter bars) right.
   */
  import type { RoutingMode } from './types'

  interface Props {
    mode: RoutingMode
  }
  let { mode }: Props = $props()

  // Per side: list of [mic, short]
  const MAP: Record<RoutingMode, [1 | 2, boolean][][]> = {
    mono: [
      [
        [1, false],
        [2, false],
      ],
      [
        [1, false],
        [2, false],
      ],
    ],
    stereo: [
      [
        [1, false],
        [1, false],
      ],
      [
        [2, false],
        [2, false],
      ],
    ],
    safetr: [
      [
        [1, false],
        [2, false],
      ],
      [
        [1, true],
        [2, true],
      ],
    ],
  }
</script>

<span class="glyph" aria-hidden="true">
  {#each ['L', 'R'] as side, i (side)}
    <span class="row">
      <span class="side">{side}</span>
      <span class="bars">
        {#each MAP[mode][i] as [mic, short], j (j)}
          <i class="m{mic}" class:short></i>
        {/each}
      </span>
    </span>
  {/each}
</span>

<style>
  .glyph {
    display: grid;
    gap: 3px;
    width: 56px;
    height: 28px;
    padding: 4px 6px;
    border-radius: 3px;
    background: var(--window);
    box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.7);
  }
  .row {
    display: grid;
    grid-template-columns: 8px 1fr;
    align-items: center;
    gap: 3px;
  }
  .side {
    font: 500 8px/1 var(--f-mono);
    color: #8a8a90;
  }
  .bars {
    display: flex;
    gap: 1px;
    height: 6px;
  }
  i {
    display: block;
    width: 16px;
    height: 100%;
    border-radius: 1px;
  }
  i.short {
    width: 9px;
  }
  .m1 {
    background: var(--mic1);
  }
  .m2 {
    background: var(--mic2);
  }
</style>
