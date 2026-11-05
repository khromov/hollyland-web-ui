#!/usr/bin/env node
// `npm run bridge [-- options]`: starts scripts/bridge.ts as root.
//
// The bridge must run as root, but `sudo npm …` / `sudo node …` fail for nvm users
// ("sudo: node: command not found") because sudo resets PATH. This launcher re-runs the
// bridge under sudo with the absolute path of the node binary that runs npm right now
// (process.execPath) and tsx's loader, with the terminal inherited so sudo can ask for the
// password and Ctrl+C reaches the bridge. See docs/BRIDGE.md.
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const script = join(dirname(fileURLToPath(import.meta.url)), 'bridge.ts')

let tsxLoader
try {
  tsxLoader = import.meta.resolve('tsx')
} catch {
  console.error('tsx is not installed. Run "npm install" in the project folder first.')
  process.exit(1)
}

if (process.platform === 'win32') {
  console.error(
    'The bridge does not run on Windows: Windows cannot detach its HID driver from the receiver.\n' +
      'Use Chrome on Linux or ChromeOS for full read/write, or macOS with this bridge. See docs/BRIDGE.md.',
  )
  process.exit(1)
}

const nodeArgs = ['--import', tsxLoader, script, ...args]
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const helpOnly = args.includes('--help') || args.includes('-h')
const direct = isRoot || helpOnly

if (!direct) {
  console.log('The bridge needs root to take the receiver from the operating system; sudo may ask for your password.')
}

const child = direct
  ? spawn(process.execPath, nodeArgs, { stdio: 'inherit' })
  : spawn('sudo', ['--', process.execPath, ...nodeArgs], { stdio: 'inherit' })

// Ctrl+C already reaches the bridge through the terminal; stay alive until it has handed the
// receiver back. Forward signals that only this process would receive.
process.on('SIGINT', () => {})
for (const sig of ['SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    try {
      child.kill(sig)
    } catch {
      /* already gone */
    }
  })
}

child.on('error', (e) => {
  console.error(`Could not start ${direct ? process.execPath : 'sudo'}: ${e.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1))
})
