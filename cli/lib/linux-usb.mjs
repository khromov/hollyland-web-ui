// Linux: can this user open the receiver's USB device node without root?
//
// The bridge needs write access to /dev/bus/usb/<bus>/<dev> to detach the kernel's HID driver from
// interface 0 and claim it. Root has that; so does any user once the udev rule in docs/BRIDGE.md
// ("Linux") tags the receiver with `uaccess`. The launchers (`npm run bridge`, `npx hollyland-web-ui`)
// use this to skip sudo when it isn't needed.

import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** USB vendor IDs of the receivers the bridge captures (Hollyland, EAGLESHERO OEM). */
export const RECEIVER_VENDOR_IDS = ['3547', '4417']

/** The udev rules for Linux, one per line: WebHID (hidraw) and the bridge without root (usb). */
export const LINUX_UDEV_RULES = [
  'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3547", MODE="0660", TAG+="uaccess"',
  'SUBSYSTEM=="usb", ATTR{idVendor}=="3547", MODE="0660", TAG+="uaccess"',
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
 * Linux only: true when at least one receiver is plugged in and this user may open every one of
 * them, so the bridge can run without sudo. False when none is plugged in (the bridge would wait
 * for one, and without the udev rule it couldn't open it).
 */
export function linuxBridgeWithoutRoot(sysDir = SYS_USB, devDir = DEV_USB) {
  const nodes = linuxReceiverNodes(sysDir, devDir)
  return nodes.length > 0 && nodes.every((n) => n.writable)
}
