/**
 * FamilyDriver records for the legacy `AA DD` families, so the registry treats every family the
 * same way. Devices are LegacyMicDevice (HollylandDevice underneath); simulators wrap mock.ts's
 * SimulatedReceiver. The 6501 group (Lark C1 / C1 2nd gen / M1 2nd gen / Mini) is 'experimental':
 * built from the official apps' code (docs/research/families/legacy-6501.md), not run on hardware.
 */
import { decodeFrame } from '../../codec'
import { COMMANDS, type Family } from '../../commands'
import { HollylandDevice, UnsupportedError } from '../../device'
import { LEGACY_PRODUCTS, displayName, type ProductInfo } from '../../models'
import { MockTransport, SimulatedReceiver } from '../../mock'
import { chunkBytes } from '../../core/bytes'
import type { LegacyFamilyCode } from '../../core/ids'
import type {
  CommandCatalogue, ControlSpec, DeviceSimulator, FamilyDriver, HardwareCheckStep, MicDeviceOptions, MockPreset, SimFaults, SimOptions,
} from '../../core/types'
import type { Transport, TransportCapabilities, TransportDeviceInfo } from '../../transport'
import { LegacyMicDevice } from './adapter'
import { legacyControls } from './controls'

/** COMMANDS (commands.ts) entries of one legacy family as a CommandCatalogue. */
export function legacyCatalogue(code: LegacyFamilyCode): CommandCatalogue {
  const out: Record<number, CommandCatalogue[number]> = {}
  for (const c of Object.values(COMMANDS)) {
    if (!(c.families as readonly string[]).includes(code)) continue
    out[c.id] = {
      name: c.name, safety: c.safety, retrySafe: c.retrySafe, toggle: c.toggle, description: c.description,
      source: [c.android && `A ${c.android}`, c.ios && `I ${c.ios}`].filter(Boolean).join('; ') || 'docs/PROTOCOL.md',
    }
  }
  return out
}

/** "1.0.0.15" → [1, 0, 0, 15, 0, 0] for SimulatedReceiver.rxVersion. */
function versionBytes(v: string): number[] {
  const parts = v.split('.').map((x) => parseInt(x, 10) || 0)
  while (parts.length < 6) parts.push(0)
  return parts.slice(0, 6)
}

/** DeviceSimulator over mock.ts's SimulatedReceiver (6118 / 6301 / 6302 / 6501; the 6501 profile follows the PID). */
export class LegacySimulator implements DeviceSimulator {
  readonly receiver: SimulatedReceiver
  readonly info: TransportDeviceInfo
  readonly capabilities: TransportCapabilities
  faults: SimFaults

  constructor(product: ProductInfo, o: SimOptions = {}) {
    if (!product.family) throw new UnsupportedError(`${displayName(product)} is not supported yet by the legacy simulator`)
    this.receiver = new SimulatedReceiver({ family: product.family as Family, camera: product.variant === 'camera', productId: product.productId })
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    if (o.rxVersion) this.receiver.rxVersion = versionBytes(o.rxVersion)
    if (o.online) {
      this.receiver.tx[0].online = o.online.includes('tx1')
      this.receiver.tx[1].online = o.online.includes('tx2')
    }
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: 'Wireless Microphone (simulated)', serialNumber: 'SIM' }
    this.capabilities = { receive: o.dropReplies ? 'no' : 'yes', link: 'mock', maxWrite: 64 }
  }

  respond(packet: Uint8Array): Uint8Array[] {
    this.receiver.dropReplies = this.faults.dropReplies === true
    this.receiver.duplicateReplies = this.faults.duplicateReplies === true
    const out = this.receiver.respond(packet)
    const n = this.faults.chunkSize
    return n ? out.flatMap((p) => chunkBytes(p, n)) : out
  }
}

const NAMES: Readonly<Record<LegacyFamilyCode, string>> = {
  '6118': 'LARK A2 / A2S',
  '6301': 'Lark M2',
  '6302': 'LARK M2S',
  '6501': 'Lark C1 / C1 (2nd gen) / M1 (2nd gen) / Mini',
}

/** Dev presets (`?mock=`), same ids as the session store's simulator presets. */
const PRESETS: Readonly<Record<LegacyFamilyCode, readonly MockPreset[]>> = {
  '6118': [
    { id: 'a2', label: 'LARK A2 (simulated)', family: '6118', productId: 1041 },
    { id: 'a2s', label: 'LARK A2S camera RX (simulated)', family: '6118', productId: 1042 },
    { id: 'blind', label: 'LARK A2, replies dropped (macOS-like)', family: '6118', productId: 1041, sim: { dropReplies: true } },
  ],
  '6301': [
    { id: 'm2', label: 'Lark M2 (simulated)', family: '6301', productId: 7 },
    { id: 'm2cam', label: 'Lark M2 camera RX (simulated)', family: '6301', productId: 8 },
  ],
  '6302': [
    { id: 'm2s', label: 'LARK M2S (simulated)', family: '6302', productId: 1029 },
    { id: 'm2scam', label: 'LARK M2S camera RX (simulated)', family: '6302', productId: 1030 },
  ],
  '6501': [
    { id: 'c1', label: 'Lark C1 (simulated, untested profile)', family: '6501', productId: 1 },
    { id: 'c1g2', label: 'Lark C1 (2nd gen) (simulated, untested profile)', family: '6501', productId: 11 },
    { id: 'm1g2', label: 'Lark M1 (2nd gen) (simulated, untested profile)', family: '6501', productId: 12 },
    { id: 'mini', label: 'Lark Mini (simulated, untested profile)', family: '6501', productId: 13 },
  ],
}

/** The HollylandDevice under a MicDevice, when it is a LegacyMicDevice. */
function legacyOf(device: unknown): HollylandDevice | null {
  return device instanceof LegacyMicDevice ? device.legacy : device instanceof HollylandDevice ? device : null
}

/** Run one read with the wrapped HollylandDevice and report it (hardware check helper). */
async function legacyRead<T>(device: unknown, read: (d: HollylandDevice) => Promise<T>, summary: (v: T) => string) {
  const d = legacyOf(device)
  if (!d) return { ok: false, summary: 'not a legacy device' }
  try {
    const v = await read(d)
    return { ok: true, summary: summary(v), data: v }
  } catch (e) {
    return { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

/**
 * 6501 extras (legacy-6501.md §9): whether 0x35 gets an answer on receivers without a lock (#4), the
 * 0x16 body (#6), and the volume one step and back (the group has no LED).
 */
function hardwareCheck6501(): HardwareCheckStep[] {
  return [
    {
      id: 'device-info', title: 'Device info 0x16', kind: 'read', detail: 'Body of 0x16 (iOS only). Only "body[0] = 3 = Lark Mini" is known.',
      run: (device) => legacyRead(device, (d) => d.getDeviceInfo(), (v) => `variant ${v.variant}, mini ${v.mini}, ${v.raw.length} bytes`),
    },
    {
      id: 'voice-lock-get', title: 'Volume lock 0x35', kind: 'read',
      detail: 'Android sends 0x35 to every PID at start-up although this group has no lock: does the receiver answer?',
      run: (device) => legacyRead(device, (d) => d.getVoiceLock(), (v) => `answered, locked = ${v}`),
    },
    {
      id: 'nc-volume-get', title: 'NC level 0x11, volume 0x04', kind: 'read',
      detail: 'Lark C1: the only source of both. Compare with heartbeat body[6] / body[7] on the other models.',
      run: (device) =>
        legacyRead(
          device,
          async (d) => ({ noise: await d.getNoiseLevel(), volume: await d.getVolume(), wire: d.state.settings.volumeWire }),
          (v) => `NC ${v.noise.enabled ? `on, level ${v.noise.level}` : 'off'}, volume button ${v.volume + 1}${v.wire === undefined ? '' : ` (wire ${v.wire})`}`,
        ),
    },
    {
      id: 'reversible-write', title: 'Volume one step and back', kind: 'write-reversible',
      detail: 'The group has no LED: change the RX volume by one button and restore it. Refused under a read-only developer profile.',
      run: (device) =>
        legacyRead(
          device,
          async (d) => {
            const before = await d.getVolume()
            if (before < 0) throw new Error('the current volume maps to no button')
            const max = (d.product.capabilities?.volumeSteps ?? 1) - 1
            const next = before < max ? before + 1 : before - 1
            const a = await d.setVolume(next)
            const b = await d.setVolume(before)
            return { before, next, set: a, restore: b }
          },
          (v) => `button ${v.before + 1} → ${v.next + 1} (${v.set.ok ? 'ok' : 'failed'}) → ${v.before + 1} (${v.restore.ok ? 'ok' : 'failed'})`,
        ),
    },
  ]
}

/** First-contact checklist (FAMILIES.md §5.7), legacy row. */
function hardwareCheck(code: LegacyFamilyCode): HardwareCheckStep[] {
  const head: HardwareCheckStep[] = [
    { id: 'descriptor', title: 'HID descriptor', kind: 'descriptor', detail: 'Report ids and sizes of every collection (WebHID device.collections or `npx tsx scripts/probe.ts list`).' },
    {
      id: 'heartbeat', title: 'Heartbeat 0x10', kind: 'read', detail: 'Does the probe get a reply? Record the payload length.',
      run: async (device) => {
        await device.refresh('status')
        const raw = device.state.raw as { payloadLength?: number } | undefined
        return { ok: device.state.lastStatusAt !== null, summary: `heartbeat ${raw?.payloadLength ?? '?'} bytes`, data: raw }
      },
    },
    {
      id: 'identity', title: code === '6118' ? 'Versions 0x41, serials 0x15' : 'Versions 0x03, serials 0x15', kind: 'read',
      detail: 'Version and serial of the RX and every online TX.',
      run: async (device) => {
        await device.refresh('identity')
        const u = device.state.units
        return { ok: !!u.rx.version, summary: `RX ${u.rx.version ?? '?'}, TX1 ${u.tx1?.version ?? '-'}, TX2 ${u.tx2?.version ?? '-'}`, data: u }
      },
    },
  ]
  if (code === '6501') return [...head, ...hardwareCheck6501()]
  return [
    ...head,
    { id: 'device-info', title: 'Device info 0x16', kind: 'read', detail: 'Body of 0x16 (iOS only; Lark Mini reports body[0] = 3).' },
    { id: 'reversible-write', title: 'Volume one step and back', kind: 'write-reversible', detail: 'The group has no LED: change the RX volume by one step and restore it.' },
  ]
}

function refuse(code: LegacyFamilyCode, p: ProductInfo): never {
  throw new UnsupportedError(`${displayName(p)} is recognised but not supported yet (legacy family ${code} is a stub until Phase 1)`)
}

export function legacyDriver(code: LegacyFamilyCode): FamilyDriver {
  const products = LEGACY_PRODUCTS.filter((p) => p.familyCode === code)
  const commands = legacyCatalogue(code)
  const seen = new Set<string>()
  const controls: ControlSpec[] = []
  for (const p of products) for (const c of legacyControls(p)) if (!seen.has(c.id)) (seen.add(c.id), controls.push(c))
  const driven = products.filter((p) => p.family !== null && p.capabilities !== null)
  // 'experimental' when every driven row is (6501: from app code only, FAMILIES.md §0 #6).
  const status: FamilyDriver['status'] = !driven.length
    ? 'stub'
    : driven.every((p) => p.support?.level === 'experimental') ? 'experimental' : 'supported'
  return {
    code, name: NAMES[code], status, products, commands, controls, research: products[0]?.support?.research ?? 'docs/PROTOCOL.md',
    createDevice(transport: Transport, product: ProductInfo, o: MicDeviceOptions = {}) {
      if (status === 'stub') refuse(code, product)
      return new LegacyMicDevice(transport, { ...o, product: o.product ?? product })
    },
    createSimulator(product: ProductInfo, o?: SimOptions) {
      if (status === 'stub') refuse(code, product)
      return new LegacySimulator(product, o)
    },
    commandOfFrame(frame: Uint8Array) {
      const f = decodeFrame(frame)
      return f && f.direction === 'request' ? f.cmd : null
    },
    mockPresets: PRESETS[code],
    hardwareCheck: hardwareCheck(code),
  }
}

/** The four legacy drivers. */
export const LEGACY_DRIVERS: Readonly<Record<LegacyFamilyCode, FamilyDriver>> = {
  '6118': /* @__PURE__ */ legacyDriver('6118'),
  '6301': /* @__PURE__ */ legacyDriver('6301'),
  '6302': /* @__PURE__ */ legacyDriver('6302'),
  '6501': /* @__PURE__ */ legacyDriver('6501'),
}

/** MockTransport wired to a legacy simulator (convenience for tests and dev presets). */
export function legacyMockTransport(sim: LegacySimulator, latencyMs = 0): MockTransport {
  return new MockTransport({ info: sim.info, respond: (p) => sim.respond(p), latencyMs, capabilities: sim.capabilities })
}
