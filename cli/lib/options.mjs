// Command-line options of `npx hollyland-web-ui` (cli/hollyland-web-ui.mjs).

export const DEFAULT_PORT = 47320
export const DEFAULT_BRIDGE_PORT = 47321
/** The hosted build (GitHub Pages). */
export const HOSTED_URL = 'https://khromov.github.io/hollyland-web-ui/'
/** Its origin: the bridge accepts it only with --bridge-only (passed on as --allow-origin). */
export const HOSTED_ORIGIN = new URL(HOSTED_URL).origin
export const REPO_URL = 'https://github.com/khromov/hollyland-web-ui'

export class UsageError extends Error {}

/**
 * Whether the bridge starts when neither --bridge nor --no-bridge is given: on macOS and Linux,
 * where the OS drops the receiver's replies before the browser sees them (docs/PROTOCOL.md §2.4).
 * Windows can't run the bridge.
 */
export function bridgeByDefault(platform = process.platform) {
  return platform === 'darwin' || platform === 'linux'
}

function parsePort(flag, v) {
  if (v === undefined || v === '') throw new UsageError(`${flag} needs a port number`)
  if (!/^\d{1,5}$/.test(v) || Number(v) < 1 || Number(v) > 65535) throw new UsageError(`${flag}: "${v}" is not a port number (1-65535)`)
  return Number(v)
}

/**
 * @param {readonly string[]} argv arguments after the script name
 * @param {string} platform process.platform
 * @returns {{ help: boolean, version: boolean, port: number, bridgePort: number,
 *   bridge: boolean, bridgeExplicit: boolean, bridgeOnly: boolean, open: boolean, verbose: boolean }}
 */
export function parseOptions(argv, platform = process.platform) {
  const o = {
    help: false,
    version: false,
    port: DEFAULT_PORT,
    bridgePort: DEFAULT_BRIDGE_PORT,
    bridge: bridgeByDefault(platform),
    bridgeExplicit: false,
    bridgeOnly: false,
    open: true,
    verbose: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const flag = eq > 0 ? arg.slice(0, eq) : arg
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined
    const value = () => inline ?? argv[++i]
    const noValue = () => {
      if (inline !== undefined) throw new UsageError(`${flag} does not take a value`)
    }
    switch (flag) {
      case '-h':
      case '--help':
        o.help = true
        break
      case '-v':
      case '--version':
        o.version = true
        break
      case '-p':
      case '--port':
        o.port = parsePort(flag, value())
        break
      case '--bridge-port':
        o.bridgePort = parsePort(flag, value())
        break
      case '--bridge':
        noValue()
        o.bridge = true
        o.bridgeExplicit = true
        break
      case '--no-bridge':
        noValue()
        o.bridge = false
        o.bridgeExplicit = true
        break
      case '--bridge-only':
        noValue()
        o.bridgeOnly = true
        break
      case '--open':
        noValue()
        o.open = true
        break
      case '--no-open':
        noValue()
        o.open = false
        break
      case '--verbose':
        noValue()
        o.verbose = true
        break
      default:
        throw new UsageError(arg.startsWith('-') ? `unknown option ${arg}` : `unexpected argument "${arg}"`)
    }
  }
  if (o.bridgeOnly) {
    if (o.bridgeExplicit && !o.bridge) throw new UsageError('--bridge-only and --no-bridge contradict each other')
    o.bridge = true
    o.open = false
  }
  if (!o.bridgeOnly && o.bridge && o.port === o.bridgePort) {
    throw new UsageError(`--port and --bridge-port must differ (both are ${o.port})`)
  }
  return o
}

export function helpText(version) {
  return `Hollyland Web UI ${version}: control Hollyland LARK A2 / A2S / M2 / M2S wireless mics from your browser.
Unofficial; not affiliated with Hollyland.

Usage: npx hollyland-web-ui [options]

Serves the web UI on http://127.0.0.1:${DEFAULT_PORT} (this computer only) and opens it in your
browser. On macOS and Linux it also starts the local USB bridge: the browser can only send
settings there, and the bridge adds live battery, mic status and current values. On macOS it asks
for your password and the receiver's USB audio is paused while it runs. On Linux audio keeps
working, and with the udev rule from docs/BRIDGE.md it needs no password.

Options:
  -p, --port <n>          web UI port (default ${DEFAULT_PORT})
      --bridge-port <n>   USB bridge port (default ${DEFAULT_BRIDGE_PORT})
      --no-bridge         don't start the USB bridge
      --bridge            start the USB bridge (on by default on macOS and Linux)
      --bridge-only       start only the USB bridge, for the hosted page at
                          ${HOSTED_URL}
                          (in this mode the bridge also accepts that page)
      --no-open           don't open the browser (the address is printed)
      --verbose           print every USB packet the bridge relays
  -v, --version           print the version
  -h, --help              show this help

Use Chrome, Edge or another Chromium browser: without the bridge the page talks to the
receiver over WebHID, which Safari and Firefox don't have.
Press Ctrl+C to stop. More: ${REPO_URL}`
}
