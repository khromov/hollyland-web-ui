/** Drives .dsp-native/bin/cmsis-runner (see native/runner.c). */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const NATIVE_DIR = path.join(REPO, '.dsp-native')
export const RUNNER = path.join(NATIVE_DIR, 'bin/cmsis-runner')

/** float32 value as a decimal string that strtof() maps back to the same float. */
export const num = (x: number): string => {
  const v = Math.fround(x)
  return Object.is(v, -0) ? '-0' : v.toPrecision(9)
}

export interface RunnerResult {
  lines: string[]
  errors: string[]
}

export function runScript(lines: string[], cwd = NATIVE_DIR, libm: 'apple' | 'cr' = 'apple'): Promise<RunnerResult> {
  if (!fs.existsSync(RUNNER)) throw new Error(`${RUNNER} not found; run \`npm run dsp:prepare\` first`)
  return new Promise((resolve, reject) => {
    const child = spawn(RUNNER, ['--libm', libm, 'script'], { cwd, env: { ...process.env, LLVM_PROFILE_FILE: '/dev/null' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => {
      const all = out.split('\n').filter(Boolean)
      const errors = all.filter((l) => l.startsWith('err '))
      for (const l of all) {
        const m = /^ok (\S+) (-?\d+)/.exec(l)
        if (m && m[2] !== '0') errors.push(`${m[1]} returned ${m[2]}`)
      }
      if (code !== 0) errors.push(`runner exited with ${code}: ${err.trim()}`)
      resolve({ lines: all, errors })
    })
    child.stdin.end(lines.join('\n') + '\n')
  })
}

/** Runs async jobs with bounded concurrency, preserving result order. */
export async function pool<T>(jobs: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(jobs.length)
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      results[i] = await jobs[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker))
  return results
}
