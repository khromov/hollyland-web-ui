import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINUX_UDEV_FILE, LINUX_UDEV_RULES, RECEIVER_VENDOR_IDS, linuxAccessHint, linuxReceiverNodes } from '../lib/linux-usb.mjs'

// A fake /sys/bus/usb/devices and /dev/bus/usb: one Lark M2 receiver on bus 3, device 15.
let root
let sys
let dev

function addDevice(name, attrs) {
  const dir = join(sys, name)
  mkdirSync(dir, { recursive: true })
  for (const [k, v] of Object.entries(attrs)) writeFileSync(join(dir, k), `${v}\n`)
}

function addNode(bus, num, mode) {
  const dir = join(dev, bus)
  mkdirSync(dir, { recursive: true })
  const node = join(dir, num)
  writeFileSync(node, '')
  chmodSync(node, mode)
  return node
}

/** Root may write anything, so the read-only cases only mean something for other users. */
const asRoot = process.getuid?.() === 0

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hollyland-linux-usb-'))
  sys = join(root, 'sys')
  dev = join(root, 'dev')
  mkdirSync(sys)
  addDevice('3-4', { idVendor: '3547', idProduct: '0007', busnum: '3', devnum: '15' })
  addDevice('3-4:1.0', { bInterfaceClass: '03' }) // an interface: skipped
  addDevice('1-2', { idVendor: '046d', idProduct: 'c52b', busnum: '1', devnum: '2' }) // not a receiver
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('linuxReceiverNodes', () => {
  it('finds the receiver and its device node', () => {
    const node = addNode('003', '015', 0o600)
    expect(linuxReceiverNodes(sys, dev)).toEqual([{ node, vendorId: '3547', productId: '0007', writable: true }])
  })

  it('finds EAGLESHERO (4417) receivers too', () => {
    addNode('003', '015', 0o600)
    addDevice('2-1', { idVendor: '4417', idProduct: '0020', busnum: '2', devnum: '4' })
    const node = addNode('002', '004', 0o600)
    expect(linuxReceiverNodes(sys, dev)).toContainEqual({ node, vendorId: '4417', productId: '0020', writable: true })
  })

  it('no receiver plugged in, or no /sys at all', () => {
    rmSync(join(sys, '3-4'), { recursive: true })
    expect(linuxReceiverNodes(sys, dev)).toEqual([])
    expect(linuxReceiverNodes(join(root, 'missing'), dev)).toEqual([])
  })

  it.skipIf(asRoot)('not writable without the udev rule, or no device node', () => {
    addNode('003', '015', 0o400)
    expect(linuxReceiverNodes(sys, dev)[0].writable).toBe(false)
    rmSync(dev, { recursive: true, force: true })
    expect(linuxReceiverNodes(sys, dev)[0].writable).toBe(false)
  })
})

describe('linuxAccessHint', () => {
  const SUDO = 'npx hollyland-web-ui --sudo'

  it('nothing to say when every receiver can be opened', () => {
    addNode('003', '015', 0o600)
    expect(linuxAccessHint(linuxReceiverNodes(sys, dev), SUDO)).toEqual([])
  })

  it('nothing to say when no receiver is plugged in yet (the bridge waits and explains)', () => {
    rmSync(join(sys, '3-4'), { recursive: true })
    expect(linuxAccessHint(linuxReceiverNodes(sys, dev), SUDO)).toEqual([])
  })

  it.skipIf(asRoot)('names the blocked node, prints the rules and the --sudo way out', () => {
    addNode('003', '015', 0o600)
    addDevice('2-1', { idVendor: '4417', idProduct: '0020', busnum: '2', devnum: '4' })
    const blocked = addNode('002', '004', 0o400)
    const hint = linuxAccessHint(linuxReceiverNodes(sys, dev), SUDO).join('\n')
    expect(hint).toContain(blocked)
    expect(hint).not.toContain(join(dev, '003', '015'))
    expect(hint).toContain(LINUX_UDEV_FILE)
    for (const r of LINUX_UDEV_RULES) expect(hint).toContain(r)
    expect(hint).toContain(SUDO)
  })
})

describe('LINUX_UDEV_RULES', () => {
  it('covers WebHID (hidraw) and the bridge (usb device node) for every receiver vendor', () => {
    expect(LINUX_UDEV_RULES).toHaveLength(2)
    expect(LINUX_UDEV_RULES[0]).toContain('SUBSYSTEM=="hidraw"')
    expect(LINUX_UDEV_RULES[1]).toContain('SUBSYSTEM=="usb"')
    for (const r of LINUX_UDEV_RULES) {
      expect(r).toContain('TAG+="uaccess"')
      expect(r).toContain(`idVendor}=="${RECEIVER_VENDOR_IDS.join('|')}"`)
    }
  })
})

describe('copies of the udev rules', () => {
  // The rules are repeated where they are shown to people; keep every copy in step with the constant.
  const repo = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8')
  it.each(['README.md', 'docs/BRIDGE.md', 'src/components/ConnectScreen.svelte'])('%s has both rules', (p) => {
    const text = repo(p).replaceAll('\\n', '\n')
    for (const r of LINUX_UDEV_RULES) expect(text).toContain(r)
  })
  it('scripts/bridge.ts names the usb rule', () => {
    expect(repo('scripts/bridge.ts')).toContain(LINUX_UDEV_RULES[1])
  })
})
