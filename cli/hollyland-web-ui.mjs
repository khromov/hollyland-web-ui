#!/usr/bin/env node
// `npx hollyland-web-ui`: serves the prebuilt Hollyland Web UI on http://127.0.0.1:<port>, starts the
// local USB bridge (macOS by default, under sudo) and opens the page, which then connects through
// the bridge by itself (?bridge=auto). See README.md and docs/BRIDGE.md.
//
// Plain ESM with no dependencies of its own; the bridge (cli/dist/bridge.mjs) is bundled from
// scripts/bridge.ts by `npm run build:cli` and needs the "usb" and "ws" packages at runtime.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { get } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BRIDGE_PORT, HOSTED_ORIGIN, HOSTED_URL, UsageError, helpText, parseOptions } from './lib/options.mjs'
import { createStaticServer } from './lib/static-server.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, 'dist', 'web')
const BRIDGE_SCRIPT = join(HERE, 'dist', 'bridge.mjs')
const HOST = '127.0.0.1'
const OS_NAME = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] ?? process.platform
/** sudo expands %u to the user name. */
const SUDO_PROMPT = 'Password for %u (Hollyland Web UI needs it to start the USB bridge): '

// ------------------------------------------------------------------------------------- output

const useColor = !!process.stdout.isTTY && !('NO_COLOR' in process.env) && process.env.TERM !== 'dumb'
const paint = (open, close) => (s) => (useColor ? `\x1b[${open}m${s}\x1b[${close}m` : String(s))
const bold = paint(1, 22)
const dim = paint(2, 22)
const cyan = paint(36, 39)
const yellow = paint(33, 39)
const green = paint(32, 39)

const say = (text = '') => console.log(text ? `  ${text}`.replace(/\n/g, '\n  ') : '')
const row = (label, text) => say(`${bold(label.padEnd(11))}  ${text}`)
const warn = (text) => say(yellow(text))

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version ?? 'dev'
  } catch {
    return 'dev'
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ------------------------------------------------------------------------------------- bridge

/** What answers on 127.0.0.1:<port>: a Hollyland Web UI bridge, something else, or nothing. */
function probeBridge(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = get({ host: HOST, port, path: '/', agent: false, timeout: timeoutMs }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        if (body.length < 4096) body += chunk
      })
      res.on('end', () => resolve(res.statusCode === 200 && body.startsWith('Hollyland Web UI bridge') ? 'bridge' : 'other'))
      res.on('error', () => resolve('other'))
    })
    req.on('timeout', () => {
      req.destroy()
      resolve('other')
    })
    req.on('error', (e) => resolve(e.code === 'ECONNREFUSED' ? 'free' : 'other'))
  })
}

/** The bridge child process (sudo → node cli/dist/bridge.mjs), when this CLI started one. */
const bridge = {
  child: null,
  running: false,
  ready: false,
  /** Resolves with [code, signal] once the child is gone. */
  exited: null,
  /** A bridge that was already running (started elsewhere): not ours to stop. */
  external: false,
}

/**
 * Start the bridge, or find one that already runs. Resolves true once it listens (the page can
 * connect), false when it can't run; the reason has been printed.
 */
async function setUpBridge(opts, pageOrigin) {
  if (process.platform === 'win32') {
    row('USB bridge', yellow("not available on Windows (Windows can't hand the receiver over to it)"))
    return false
  }
  if (!existsSync(BRIDGE_SCRIPT)) {
    row('USB bridge', yellow('missing (cli/dist/bridge.mjs). In a development checkout run "npm run build:cli" first.'))
    return false
  }
  const found = await probeBridge(opts.bridgePort)
  if (found === 'bridge') {
    row('USB bridge', `already running on port ${opts.bridgePort} (started elsewhere): using it`)
    bridge.external = true
    return true
  }
  if (found === 'other') {
    row('USB bridge', yellow(`port ${opts.bridgePort} is in use by another program. Pick another one with --bridge-port <n>.`))
    return false
  }

  const args = [BRIDGE_SCRIPT, '--embedded', '--port', String(opts.bridgePort)]
  if (pageOrigin) args.push('--allow-origin', pageOrigin)
  // Only --bridge-only (made for the hosted page) lets the hosted origin in; by default the bridge
  // accepts pages on this computer only.
  if (opts.bridgeOnly) args.push('--allow-origin', HOSTED_ORIGIN)
  if (opts.verbose) args.push('--verbose')
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
  const interactive = !!process.stdin.isTTY
  let command = process.execPath
  let commandArgs = args
  if (isRoot) {
    row('USB bridge', 'starting (already running as root)…')
  } else {
    // The absolute path of this Node keeps nvm, fnm and Volta installs working under sudo.
    command = 'sudo'
    commandArgs = [...(interactive ? [] : ['-n']), '-p', SUDO_PROMPT, '--', process.execPath, ...args]
    row('USB bridge', `starting… It needs administrator rights to take the receiver over from ${OS_NAME},`)
    say(`${' '.repeat(13)}so sudo asks for the password you use to log in to this computer.`)
  }
  say()

  let child
  try {
    child = spawn(command, commandArgs, { stdio: 'inherit' })
  } catch (e) {
    explainBridgeFailure({ error: e, usedSudo: !isRoot, interactive, bridgeOnly: opts.bridgeOnly })
    return false
  }
  bridge.child = child
  bridge.running = true
  let spawnError = null
  bridge.exited = new Promise((resolve) => {
    child.once('error', (e) => {
      spawnError = e
      bridge.running = false
      resolve([null, null])
    })
    child.once('exit', (code, signal) => {
      bridge.running = false
      resolve([code, signal])
    })
  })

  while (bridge.running && !stopping) {
    if ((await probeBridge(opts.bridgePort)) === 'bridge') {
      bridge.ready = true
      break
    }
    await Promise.race([sleep(250), bridge.exited])
  }
  if (bridge.ready) {
    void bridge.exited.then(([code, signal]) => {
      if (stopping) return
      say()
      warn(`The USB bridge stopped (${signal ? `signal ${signal}` : `exit code ${code}`}).`)
      if (opts.bridgeOnly) {
        process.exitCode = code || 1
        void shutdown()
      } else {
        warn('The page shows "Connection lost". Run npx hollyland-web-ui again to restart it.')
      }
    })
    return true
  }
  if (!stopping) {
    const [code, signal] = await bridge.exited
    explainBridgeFailure({ error: spawnError, code, signal, usedSudo: !isRoot, interactive, bridgeOnly: opts.bridgeOnly })
  }
  return false
}

function explainBridgeFailure({ error, code, signal, usedSudo, interactive, bridgeOnly }) {
  say()
  if (error?.code === 'ENOENT' && usedSudo) {
    warn("The USB bridge didn't start: sudo isn't installed here (run Hollyland Web UI as root to use the bridge).")
  } else if (error) {
    warn(`The USB bridge didn't start: ${error.message}`)
  } else {
    warn(`The USB bridge didn't start (${signal ? `signal ${signal}` : `exit code ${code}`}; see the message above).`)
    // sudo -n: there was no terminal to ask for the password in.
    if (usedSudo && !interactive) warn('sudo can only ask for your password in a terminal: run npx hollyland-web-ui in a terminal window.')
  }
  if (!bridgeOnly) warn('Hollyland Web UI keeps running without it. Run npx hollyland-web-ui again to retry, or add --no-bridge.')
}

// -------------------------------------------------------------------------------------- web UI

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function openBrowser(url) {
  let command
  let args
  const options = { stdio: 'ignore', detached: true }
  if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    command = 'cmd'
    args = ['/d', '/s', '/c', `start "" "${url}"`]
    Object.assign(options, { windowsVerbatimArguments: true, windowsHide: true })
  } else {
    command = 'xdg-open'
    args = [url]
  }
  const failed = () => warn("Couldn't open a browser. Open the address above yourself.")
  try {
    const child = spawn(command, args, options)
    child.once('error', failed)
    child.once('exit', (code) => {
      if (code) failed()
    })
    child.unref()
  } catch {
    failed()
  }
}

function stopHint() {
  return bridge.external
    ? `Press ${bold('Ctrl+C')} to stop the web UI. The bridge was started elsewhere: stop it there to hand the receiver back.`
    : `Press ${bold('Ctrl+C')} to stop; the receiver is handed back to ${OS_NAME}.`
}

/** The page address the CLI opens: it connects through the bridge by itself when one runs. */
function pageAddress(port, bridgePort, viaBridge) {
  const base = `http://${HOST}:${port}/`
  if (!viaBridge) return base
  return bridgePort === DEFAULT_BRIDGE_PORT ? `${base}?bridge=auto` : `${base}?bridge=${bridgePort}&auto=1`
}

// ------------------------------------------------------------------------------------ shutdown

let stopping = false
let server = null
let firstSignalAt = 0
let stillNoted = false

function onSignal(signal) {
  const now = Date.now()
  if (stopping) {
    // npm (npx) forwards the same Ctrl+C the terminal already delivered: ignore the echo.
    if (now - firstSignalAt < 1500 || stillNoted) return
    stillNoted = true
    if (bridge.running) say('Still waiting for the bridge to hand the receiver back…')
    return
  }
  firstSignalAt = now
  console.log('')
  void shutdown(signal)
}

let shuttingDown = null

/** Stop the bridge (it hands the receiver back), close the web server, exit. Idempotent. */
function shutdown(signal) {
  shuttingDown ??= stop(signal)
  return shuttingDown
}

async function stop(signal) {
  stopping = true
  if (bridge.running && bridge.child) {
    say(bridge.ready ? `Stopping the USB bridge: it hands the receiver back to ${OS_NAME}…` : 'Stopping…')
    // Ctrl+C usually reached the bridge through the terminal already; it ignores the repeat.
    try {
      bridge.child.kill(signal ?? 'SIGINT')
    } catch {
      /* already gone, or not ours to signal */
    }
    const done = await Promise.race([bridge.exited.then(() => true), sleep(10_000).then(() => false)])
    if (!done) warn("The bridge didn't stop in time. If the receiver's audio doesn't come back, unplug and re-plug it.")
  }
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(() => resolve()))
  }
  say(green('Hollyland Web UI stopped.'))
  // Exit even if something still holds the event loop open.
  setTimeout(() => process.exit(), 500).unref()
}

// ---------------------------------------------------------------------------------------- main

async function main() {
  let opts
  try {
    opts = parseOptions(process.argv.slice(2))
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`hollyland-web-ui: ${e.message}\nRun "npx hollyland-web-ui --help" to see the options.`)
      process.exit(2)
    }
    throw e
  }
  const version = readVersion()
  if (opts.help) {
    console.log(helpText(version))
    return
  }
  if (opts.version) {
    console.log(version)
    return
  }

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => onSignal(sig))

  say()
  say(`${bold('Hollyland Web UI')} ${version}  ${dim('unofficial control panel for Hollyland LARK wireless mics')}`)
  say()

  let pageOrigin = null
  if (!opts.bridgeOnly) {
    if (!existsSync(join(WEB_ROOT, 'index.html'))) {
      console.error('The web UI is missing (cli/dist/web). In a development checkout run "npm run build:cli" first.')
      process.exit(1)
    }
    server = createStaticServer({ root: WEB_ROOT, log: (line) => warn(line) })
    try {
      await listen(server, opts.port)
    } catch (e) {
      if (e.code === 'EADDRINUSE') {
        console.error(
          `Port ${opts.port} on ${HOST} is already in use. Is Hollyland Web UI already running in another terminal?\n` +
            'Stop it, or pick another port with --port <n>.',
        )
      } else {
        console.error(`Could not serve the web UI on ${HOST}:${opts.port}: ${e.message}`)
      }
      process.exit(1)
    }
    pageOrigin = `http://${HOST}:${opts.port}`
    server.on('error', (e) => warn(`web UI server error: ${e.message}`))
    row('Web UI', `${cyan(`${pageOrigin}/`)} ${dim('(this computer only)')}`)
  }

  let viaBridge = false
  if (opts.bridge) {
    viaBridge = await setUpBridge(opts, pageOrigin)
    if (stopping) return
  } else if (process.platform === 'darwin') {
    row('USB bridge', `off (--no-bridge): ${OS_NAME} only lets the page send settings, not read them`)
  } else if (process.platform === 'win32') {
    row('USB bridge', 'off: Windows only lets the page send settings, not read them')
  } else {
    row('USB bridge', `off: not needed on ${OS_NAME}, where Chrome reads and writes the receiver (--bridge starts it anyway)`)
  }

  if (opts.bridgeOnly) {
    if (bridge.external) {
      say()
      say('Nothing else to start. Open Hollyland Web UI and press "Connect through local bridge".')
      say(dim(`If the hosted page says "Bridge refused this page", stop that bridge and run this command again.`))
      await shutdown()
      return
    }
    if (!viaBridge) {
      if (!stopping) {
        process.exitCode = 1
        await shutdown()
      }
      return
    }
    say()
    const hosted = opts.bridgePort === DEFAULT_BRIDGE_PORT ? `${HOSTED_URL}?bridge=auto` : `${HOSTED_URL}?bridge=${opts.bridgePort}&auto=1`
    say(`${bold('Ready.')} Open Hollyland Web UI and press "Connect through local bridge", or open`)
    say(`${cyan(hosted)} to connect right away.`)
    say()
    say(`The receiver's USB audio is paused while the bridge runs.`)
    say(stopHint())
    say()
    return
  }

  const url = pageAddress(opts.port, opts.bridgePort, viaBridge)
  say()
  say(`${bold('Ready.')} ${cyan(url)}${opts.open ? dim('  (opening in your browser)') : ''}`)
  say()
  if (viaBridge) {
    say('The page connects through the USB bridge by itself. While the bridge holds the receiver,')
    say('its USB audio is paused: live levels, recording and voice effects come back after you stop.')
    say(stopHint())
  } else {
    say('Use Chrome, Edge or another Chromium browser and press "Connect receiver".')
    if (opts.bridge || process.platform === 'darwin' || process.platform === 'win32') {
      say(`Without the bridge, ${OS_NAME} only lets the page send settings: battery, mic status and`)
      say('current values stay unknown (write-only mode).')
    }
    say(`Press ${bold('Ctrl+C')} to stop.`)
  }
  say()
  if (opts.open) openBrowser(url)
}

// Whatever goes wrong, stop the bridge before exiting: with sudo's use_pty (the default since sudo
// 1.9.14) a bridge left behind keeps holding the receiver after the shell prompt returns, and
// Ctrl+C no longer reaches it.
function crash(e) {
  console.error(e)
  process.exitCode = 1
  // shutdown() waits up to 10 s for the bridge; don't hang if it can't finish.
  setTimeout(() => process.exit(1), 15_000).unref()
  void shutdown('SIGTERM')
}
process.on('uncaughtException', crash)
process.on('unhandledRejection', crash)

main().catch(crash)
