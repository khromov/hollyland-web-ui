import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINUX_UDEV_RULES, linuxBridgeWithoutRoot, linuxReceiverNodes } from '../lib/linux-usb.mjs'

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

  it('no receiver plugged in, or no /sys at all', () => {
    rmSync(join(sys, '3-4'), { recursive: true })
    expect(linuxReceiverNodes(sys, dev)).toEqual([])
    expect(linuxReceiverNodes(join(root, 'missing'), dev)).toEqual([])
  })
})

describe('linuxBridgeWithoutRoot', () => {
  it('true when every receiver node is writable', () => {
    addNode('003', '015', 0o600)
    expect(linuxBridgeWithoutRoot(sys, dev)).toBe(true)
  })

  it('false when the node is not writable (no udev rule) or missing', () => {
    // Root may write anything, so the read-only case only means something for other users.
    if (process.getuid?.() !== 0) {
      addNode('003', '015', 0o400)
      expect(linuxBridgeWithoutRoot(sys, dev)).toBe(false)
    }
    rmSync(dev, { recursive: true, force: true })
    expect(linuxBridgeWithoutRoot(sys, dev)).toBe(false)
  })

  it('false when no receiver is plugged in', () => {
    rmSync(join(sys, '3-4'), { recursive: true })
    expect(linuxBridgeWithoutRoot(sys, dev)).toBe(false)
  })
})

describe('LINUX_UDEV_RULES', () => {
  it('covers WebHID (hidraw) and the bridge (usb device node)', () => {
    expect(LINUX_UDEV_RULES).toHaveLength(2)
    expect(LINUX_UDEV_RULES[0]).toContain('SUBSYSTEM=="hidraw"')
    expect(LINUX_UDEV_RULES[1]).toContain('SUBSYSTEM=="usb"')
    for (const r of LINUX_UDEV_RULES) expect(r).toContain('TAG+="uaccess"')
  })
})
