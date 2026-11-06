import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Rolldown } from 'vite'

/**
 * Public path the app is served from. Default "/" (local dev, `npx` package, any host at a
 * domain root). The GitHub Pages workflow builds with BASE_PATH=/hollyland-web-ui/ because the
 * project site lives at https://khromov.github.io/hollyland-web-ui/. Every asset URL (JS, CSS,
 * fonts, favicon, the voice-FX AudioWorklet module) is emitted under it; routing uses the URL
 * hash, so no server rewrites are needed.
 */
function basePath(raw: string | undefined): string {
  const p = (raw ?? '').trim()
  if (!p || p === '/') return '/'
  if (p === '.' || p === './') return './'
  return `/${p.replace(/^\/+|\/+$/g, '')}/`
}

/**
 * Chunk file names. The protocol drivers load with import() when a product of their family is opened
 * (src/lib/protocol/core/loader.ts): `family-<code>-<hash>.js`, `family-legacy` for the four `AA DD`
 * families; `moma-<hash>.js` is the codec the M3, MAX 2 and MELO P1 drivers share. The registry rows
 * the page and the drivers share are `products-<hash>.js`. Anything else keeps Vite's `[name]-[hash].js`.
 */
function chunkFileNames(chunk: Rolldown.PreRenderedChunk): string {
  const family = /[\\/]protocol[\\/]families[\\/]([^\\/]+)[\\/]runtime\.ts$/.exec(chunk.facadeModuleId ?? '')
  if (family) return `assets/family-${family[1]}-[hash].js`
  if (chunk.moduleIds.some((id) => /[\\/]protocol[\\/]models\.ts$/.test(id))) return 'assets/products-[hash].js'
  if (chunk.moduleIds.some((id) => /[\\/]protocol[\\/]moma[\\/]/.test(id))) return 'assets/moma-[hash].js'
  return 'assets/[name]-[hash].js'
}

// https://vite.dev/config/
export default defineConfig({
  base: basePath(process.env.BASE_PATH),
  plugins: [svelte()],
  build: {
    rolldownOptions: {
      output: { chunkFileNames },
    },
  },
})
