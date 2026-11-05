import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

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

// https://vite.dev/config/
export default defineConfig({
  base: basePath(process.env.BASE_PATH),
  plugins: [svelte()],
})
