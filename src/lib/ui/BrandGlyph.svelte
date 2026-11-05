<script lang="ts">
  /** The wordmark's 26 px "window" glyph: a purple and a yellow bar in a dark window. */
  interface Props {
    size?: number
  }
  let { size = 26 }: Props = $props()
</script>

<span class="glyph" style="--g: {size}px" aria-hidden="true"><i></i><i></i></span>

<style>
  .glyph {
    display: inline-flex;
    align-items: flex-end;
    justify-content: center;
    gap: calc(var(--g) * 0.115);
    flex: none;
    width: var(--g);
    height: var(--g);
    padding: calc(var(--g) * 0.23) 0;
    border-radius: 5px;
    background: var(--window);
    box-shadow:
      inset 0 1px 2px rgb(0 0 0 / 0.7),
      0 0 0 1px var(--window-edge);
  }
  i {
    display: block;
    width: calc(var(--g) * 0.155);
    border-radius: 1px;
  }
  i:first-child {
    height: calc(var(--g) * 0.46);
    background: var(--mic1);
  }
  i:last-child {
    height: calc(var(--g) * 0.31);
    background: var(--mic2);
  }
</style>
