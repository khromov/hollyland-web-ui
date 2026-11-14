// Linux: can this user open the receiver's USB device node without root?
//
// The bridge needs write access to /dev/bus/usb/<bus>/<dev> to detach the kernel's HID driver from
// interface 0 and claim it. Root has that; so does any user once the udev rules in docs/BRIDGE.md
// ("Linux") tag the receiver with `uaccess`. On Linux the launchers (`npm run bridge`,
// `npx hollyland-web-ui`) always start the bridge as the current user and never call sudo on their
// own (only with --sudo); they use this to say up front when the rules are missing.

import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** USB vendor IDs of the receivers the bridge captures (Hollyland, EAGLESHERO OEM). */
export const RECEIVER_VENDOR_IDS = ['3547', '4417']

/**
 * The udev rules for Linux, one per line: WebHID (hidraw) and the bridge without root (usb). The
 * `|` alternation covers both vendor IDs in RECEIVER_VENDOR_IDS.
 */
export const LINUX_UDEV_RULES = [
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3547|4417", MODE="0660", TAG+="uaccess"',
  'SUBSYSTEM=="usb", ATTR{idVendor}=="3547|4417", MODE="0660", TAG+="uaccess"',
]
export const LINUX_UDEV_FILE = '/etc/udev/rules.d/70-hollyland.rules'

const SYS_USB = '/sys/bus/usb/devices'
const DEV_USB = '/dev/bus/usb'

function readAttr(dir, name) {
  try {
    return readFileSync(join(dir, name), 'utf8').trim().toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Device nodes of the receivers plugged in now, with whether this process may open them.
 * @returns {{ node: string, vendorId: string, productId: string, writable: boolean }[]}
 */
export function linuxReceiverNodes(sysDir = SYS_USB, devDir = DEV_USB) {
  let entries
  try {
    entries = readdirSync(sysDir)
  } catch {
    return []
  }
  const out = []
  for (const name of entries) {
    if (name.includes(':')) continue // interfaces, not devices
    const dir = join(sysDir, name)
    const vendorId = readAttr(dir, 'idVendor')
    if (!RECEIVER_VENDOR_IDS.includes(vendorId)) continue
    const bus = Number(readAttr(dir, 'busnum'))
    const dev = Number(readAttr(dir, 'devnum'))
    if (!bus || !dev) continue
    const node = join(devDir, String(bus).padStart(3, '0'), String(dev).padStart(3, '0'))
    let writable = false
    try {
      accessSync(node, constants.R_OK | constants.W_OK)
      writable = true
    } catch {
      writable = false
    }
    out.push({ node, vendorId, productId: readAttr(dir, 'idProduct'), writable })
  }
  return out
}

/**
 * Linux, not root: what to tell the user before the bridge starts as them. Empty when every
 * plugged-in receiver can be opened, or none is plugged in yet (the bridge waits for one and
 * explains LIBUSB_ERROR_ACCESS itself if it can't open it). Otherwise the udev rules to add.
 * @param {{ node: string, writable: boolean }[]} nodes from linuxReceiverNodes()
 * @param {string} sudoHint how to run the bridge under sudo instead, e.g. "npx hollyland-web-ui --sudo"
 * @returns {string[]} lines to print
 */
export function linuxAccessHint(nodes, sudoHint) {
  const blocked = nodes.filter((n) => !n.writable)
  if (blocked.length === 0) return []
  return [
    `You can't open the receiver (${blocked.map((n) => n.node).join(', ')}) without root yet.`,
    `Save these udev rules as ${LINUX_UDEV_FILE}:`,
    ...LINUX_UDEV_RULES.map((r) => `  ${r}`),
    'then run "sudo udevadm control --reload" and re-plug the receiver: the bridge picks it up by itself.',
    `Or stop and run ${sudoHint} instead.`,
  ]
}
