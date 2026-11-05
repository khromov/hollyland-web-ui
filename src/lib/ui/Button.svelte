<script lang="ts">
  /**
   * Action key (momentary). Same API as before the redesign; it renders the Instrument key.
   *   primary        ink key (paper on Graphite): the one main action on a screen
   *   secondary      raised key face (default)
   *   ghost          quiet key, no face
   *   danger         red key (confirming a destructive action)
   *   danger-outline red outline key (opening a destructive action, e.g. Factory Reset)
   *   light          paper key for use inside a dark window (notices)
   * Sizes: sm 36 px (44 on touch), md 44 px, lg 52 px, icon 44×44.
   */
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Key from './Key.svelte'

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'light'
    size?: 'sm' | 'md' | 'lg' | 'icon'
    loading?: boolean
    block?: boolean
    icon?: Snippet
    children?: Snippet
  }

  let { variant = 'secondary', size = 'md', children, icon, ...rest }: Props = $props()

  const keyVariant = $derived(
    variant === 'secondary' ? 'default' : variant === 'ghost' ? 'quiet' : variant,
  )
</script>

<Key {...rest} variant={keyVariant} {size} {icon} class="btn {rest.class ?? ''}">
  {#if children}{@render children()}{/if}
</Key>
