<script lang="ts">
  /**
   * An LED in a dark bezel. Purple and yellow only ever appear like this (or inside a window),
   * which is how a 1.22:1 yellow stays legible on the light panel.
   * - on: lens lit in the LED colour (no specular dot)
   * - off: lens at an 18 % tint
   * - hollow: an empty ring, the value isn't known / not read
   */
  import type { LampColor, LampState } from './types'

  interface Props {
    color?: LampColor
    state?: LampState
    size?: 'sm' | 'md' | 'lg'
    /** Accessible name; without it the lamp is decorative (say the state in text next to it). */
    label?: string
    /** Blink while on (e.g. restarting). Never blinks under reduced motion. */
    blink?: boolean
  }
  let { color = 'live', state = 'on', size = 'md', label, blink = false }: Props = $props()
</script>

<span
  class="lamp {size} {state} c-{color}"
  class:blink
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
></span>

<style>
  .lamp {
    --lamp: var(--live);
    --d: 14px;
    --lens: 8px;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--d);
    height: var(--d);
    border-radius: 50%;
    background: var(--bezel);
    vertical-align: middle;
  }
  .lamp::before {
    content: '';
    width: var(--lens);
    height: var(--lens);
    border-radius: 50%;
    background: color-mix(in srgb, var(--lamp) 18%, var(--lamp-off));
  }
  .sm {
    --d: 12px;
    --lens: 6px;
  }
  .lg {
    --d: 20px;
    --lens: 12px;
  }
  .on::before {
    background: var(--lamp);
  }
  .hollow::before {
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--lamp-hollow);
  }
  .c-mic1 {
    --lamp: var(--mic1);
  }
  .c-mic2 {
    --lamp: var(--mic2);
  }
  .c-rec {
    --lamp: var(--hot);
  }
  .c-neutral {
    --lamp: #e9e8e3;
  }
  .blink.on::before {
    animation: blink 1s steps(2, jump-none) infinite;
  }
  @keyframes blink {
    50% {
      background: color-mix(in srgb, var(--lamp) 18%, var(--lamp-off));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .blink.on::before {
      animation: none;
    }
  }
</style>
