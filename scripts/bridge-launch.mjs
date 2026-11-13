#!/usr/bin/env node
// `npm run bridge [-- options]`: starts scripts/bridge.ts as root (on Linux, as you when you may
// open the receiver: see docs/BRIDGE.md "Linux").
//
// The bridge must run as root on macOS, but `sudo npm …` / `sudo node …` fail for nvm users
// ("sudo: node: command not found") because sudo resets PATH. This launcher re-runs the
// bridge under sudo with the absolute path of the node binary that runs npm right now
// (process.execPath) and tsx's loader, with the terminal inherited so sudo can ask for the
// password and Ctrl+C reaches the bridge. See docs/BRIDGE.md.
import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LINUX_UDEV_FILE, linuxBridgeWithoutRoot } from '../cli/lib/linux-usb.mjs'

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
      'Run it on Linux or macOS for full read/write. See docs/BRIDGE.md.',
  )
  process.exit(1)
}

const nodeArgs = ['--import', tsxLoader, script, ...args]
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const helpOnly = args.includes('--help') || args.includes('-h')
// Linux: the udev rule lets this user detach the HID driver from interface 0 without root.
const linuxNoRoot = process.platform === 'linux' && !isRoot && linuxBridgeWithoutRoot()
const direct = isRoot || helpOnly || linuxNoRoot

if (linuxNoRoot) {
  console.log('You may open the receiver (udev rule), so the bridge runs without sudo.')
} else if (!direct) {
  console.log('The bridge needs root to take the receiver from the operating system; sudo may ask for your password.')
  if (process.platform === 'linux') {
    console.log(`To run it without sudo, add the udev rule from docs/BRIDGE.md ("Linux") as ${LINUX_UDEV_FILE} and re-plug the receiver.`)
  }
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
