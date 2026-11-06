/**
 * The app's main chunk must not reach driver code statically: the drivers, the Moma codec and the Web Bluetooth /
 * feature-report transports load with import() (core/loader.ts), and simulators never ship. Walks the static
 * imports from src/main.ts (Svelte components and eager import.meta.glob pages included) the way the bundler
 * sees them, so a stray `import … from '…/protocol'` (index.ts imports every driver) fails here, not in a size
 * regression later. Dynamic import() is not followed: that is exactly what may reach the drivers.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../../../', import.meta.url))
const PROTOCOL = resolve(SRC, 'lib/protocol')

/** Protocol modules the main chunk must not contain (paths relative to src/lib/protocol). */
const LAZY_ONLY: readonly RegExp[] = [
  /^families\/[^/]+\/(?!products\.ts$|ids\.ts$)/, // everything of a family but its registry rows and ids
  /^moma\//,
  /^(device|commands|mock)\.ts$/,
  /^core\/(registry|engine|simulate|conformance|stub)\.ts$/,
  /^transports\/(web-bluetooth|webhid-feature|fake-[^/]+)\.ts$/,
  /^index\.ts$/,
  /__tests__\//,
]

function strip(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Specifiers of the static imports and re-exports that survive compilation (type-only ones are erased). */
function staticSpecifiers(file: string): string[] {
  const code = strip(readFileSync(file, 'utf8'))
  const out: string[] = []
  const re = /^\s*(?:import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm
  for (const m of code.matchAll(re)) if (!m[1]) out.push(m[2])
  // import.meta.glob([...], { eager: true }): the matched modules are static imports.
  for (const g of code.matchAll(/import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[\s\S]*?\]|'[^']*'|"[^"]*")\s*,\s*\{[^}]*eager:\s*true/g)) {
    for (const s of g[1].matchAll(/['"]([^'"]+)['"]/g)) out.push(s[1])
  }
  return out
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null // packages
  if (spec.includes('?')) return null // ?worker&url, ?raw: separate assets
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}/index.ts`]) if (existsSync(c) && /\.(ts|js|svelte)$/.test(c)) return c
  return null
}

function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>([entry])
  const queue = [entry]
  while (queue.length) {
    const file = queue.shift()!
    for (const spec of staticSpecifiers(file)) {
      const dep = resolveLocal(file, spec)
      if (dep && !seen.has(dep)) {
        seen.add(dep)
        queue.push(dep)
      }
    }
  }
  return seen
}

describe('app entry (main chunk)', () => {
  const graph = staticGraph(resolve(SRC, 'main.ts'))
  const protocol = [...graph].filter((f) => f.startsWith(PROTOCOL + '/')).map((f) => relative(PROTOCOL, f))

  it('walks the app', () => {
    expect(protocol).toContain('app.ts')
    expect(protocol).toContain('core/loader.ts')
    expect(protocol).toContain('models.ts')
    expect([...graph].some((f) => f.endsWith('/lib/state/session.svelte.ts'))).toBe(true)
    expect([...graph].some((f) => f.endsWith('/components/settings/TimecodeSection.svelte'))).toBe(true)
  })

  it('reaches no driver, simulator, Moma or lazy-transport module statically', () => {
    expect(protocol.filter((f) => LAZY_ONLY.some((r) => r.test(f)))).toEqual([])
  })

  it('imports the protocol library only through protocol/app.ts', () => {
    const direct = [...graph]
      .filter((f) => !f.startsWith(PROTOCOL + '/'))
      .flatMap((f) => staticSpecifiers(f).map((s) => ({ f, dep: resolveLocal(f, s) })))
      .filter(({ dep }) => dep?.startsWith(PROTOCOL + '/') && dep !== resolve(PROTOCOL, 'app.ts'))
      .map(({ f, dep }) => `${relative(SRC, f)} -> ${relative(SRC, dep!)}`)
    expect(direct).toEqual([])
  })
})
