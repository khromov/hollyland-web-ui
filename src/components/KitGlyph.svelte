<script lang="ts">
  /** Original line drawing of a receiver and two transmitters, linked by dots. */
  interface Props {
    animate?: boolean
    tx1?: boolean
    tx2?: boolean
  }
  let { animate = false, tx1 = true, tx2 = true }: Props = $props()
</script>

<svg class="kit" class:animate viewBox="0 0 240 140" role="img" aria-label="Receiver and two transmitters">
  <!-- receiver: rounded body with a USB-C tab -->
  <g class="rx">
    <rect x="18" y="46" width="52" height="48" rx="12" />
    <rect x="34" y="94" width="20" height="10" rx="3" class="tab" />
    <circle cx="44" cy="62" r="3" class="led" />
    <text x="44" y="82" text-anchor="middle">RX</text>
  </g>
  <!-- link dots -->
  <g class="dots">
    {#each [0, 1, 2, 3, 4, 5] as i (i)}
      <circle cx={88 + i * 14} cy={50 - i * 2.5} r="2.2" style="--d: {i * 0.12}s" class:off={!tx1} />
      <circle cx={88 + i * 14} cy={90 + i * 2.5} r="2.2" style="--d: {i * 0.12 + 0.3}s" class:off={!tx2} />
    {/each}
  </g>
  <!-- transmitters: rounded squares with a 3x3 grille -->
  {#each [{ y: 14, cls: 'tx1', on: tx1, label: 'TX1' }, { y: 84, cls: 'tx2', on: tx2, label: 'TX2' }] as t (t.label)}
    <g class="tx {t.cls}" class:off={!t.on}>
      <rect x="176" y={t.y} width="44" height="44" rx="12" />
      {#each [0, 1, 2] as r (r)}
        {#each [0, 1, 2] as c (c)}
          <circle cx={190 + c * 8} cy={t.y + 14 + r * 8} r="1.8" class="grille" />
        {/each}
      {/each}
    </g>
  {/each}
</svg>

<style>
  .kit {
    width: min(320px, 100%);
    height: auto;
  }
  rect {
    fill: var(--color-surface-3);
    stroke: var(--color-border-control);
    stroke-width: 1.5;
  }
  .tab {
    fill: var(--color-border-strong);
  }
  .led {
    fill: var(--color-success);
  }
  text {
    fill: var(--color-text-muted);
    font: 600 11px var(--font-sans);
    letter-spacing: 0.06em;
  }
  .tx1 rect {
    stroke: var(--color-tx1);
  }
  .tx2 rect {
    stroke: var(--color-tx2);
  }
  .grille {
    fill: var(--color-text-subtle);
  }
  .tx.off {
    opacity: 0.35;
  }
  .dots circle {
    fill: var(--color-text-subtle);
  }
  .dots circle.off {
    opacity: 0.2;
  }
  .animate .dots circle:not(.off) {
    animation: drift 1.8s ease-in-out infinite;
    animation-delay: var(--d);
  }
  @keyframes drift {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 1;
      fill: var(--color-accent);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .animate .dots circle {
      animation: none;
    }
  }
</style>
