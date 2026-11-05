<script lang="ts">
  /**
   * The header's theme key: flips between Aluminium (light) and Graphite (dark) from whatever is
   * showing now. "Follow the system" lives in Settings › This browser and in the phone menu.
   */
  import { Moon, Sun } from '@lucide/svelte'
  import Key from '../../lib/ui/Key.svelte'
  import { prefs } from '../../lib/state/prefs.svelte'
  import { theme } from './theme.svelte'
</script>

<Key
  variant="quiet"
  size="icon"
  aria-label={theme.effective === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  title={theme.effective === 'dark' ? 'Light theme' : 'Dark theme'}
  onclick={() => prefs.setTheme(theme.effective === 'dark' ? 'light' : 'dark')}
>
  {#snippet icon()}{#if theme.effective === 'dark'}<Sun strokeWidth={1.8} />{:else}<Moon strokeWidth={1.8} />{/if}{/snippet}
</Key>
