/**
 * First-contact checklist for a LARK M3 (docs/FAMILIES.md §5.7 row 6303, m3-6303.md §7.1 "first things to verify",
 * §8 open questions). Read-only steps first, one reversible write (the TX indicator LED and back) last.
 */
import { CONTROL } from '../../core/controls'
import type { HardwareCheckResult, HardwareCheckStep, MicDevice } from '../../core/types'
import { WebHidTransport, inputReportSize, outputReportSize } from '../../webhid'
import { M3_SYSTEM } from './commands'
import { M3Device } from './session'
import { describeM3Heartbeat, M3_INFO, type M3Heartbeat } from './status'

async function guarded(f: () => Promise<HardwareCheckResult>): Promise<HardwareCheckResult> {
  try {
    return await f()
  } catch (e) {
    return { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

const session = (d: MicDevice) => (d instanceof M3Device ? d.session : null)
const hex = (n: number, w = 4) => `0x${n.toString(16).padStart(w, '0')}`

export const M3_HARDWARE_CHECK: readonly HardwareCheckStep[] = [
  {
    id: 'descriptor', title: 'HID descriptor', kind: 'descriptor',
    detail: 'Vendor id (the app never checks it) and report 8: is it declared for input and output, with 63 or 511 data bytes ' +
      '(m3-6303.md §2.3, §7.1 #1–2)? An undeclared or 63-byte input report would truncate replies longer than 64 bytes.',
    run: async (device) => {
      const t = device.transport
      if (!(t instanceof WebHidTransport)) return { ok: false, summary: 'not connected through WebHID (bridge / simulator: record the descriptor with scripts/probe.ts)' }
      const d = t.device
      const input = inputReportSize(d, 8)
      const output = outputReportSize(d, 8)
      return {
        ok: input !== undefined && output !== undefined,
        summary: `VID ${hex(d.vendorId)} PID ${hex(d.productId)}; report 8 input ${input ?? 'not declared'} B, output ${output ?? 'not declared'} B`,
        data: { vendorId: d.vendorId, productId: d.productId, collections: d.collections, capabilities: t.capabilities },
      }
    },
  },
  {
    id: 'heartbeat', title: 'Status 0x6000', kind: 'read',
    detail: 'Body length (30 expected) and the reply envelope: source (1 phone RX / 2 camera RX?), target (6?), item type (3?) ' +
      '(m3-6303.md §3.2, §7.1 #3). Also the meaning of bytes 16 / 17 / 27 (§8).',
    run: (device) =>
      guarded(async () => {
        await device.refresh('status')
        const hb = device.state.raw as M3Heartbeat | undefined
        const env = session(device)?.lastHeartbeat
        if (!hb || !env) return { ok: false, summary: 'no heartbeat decoded' }
        return {
          ok: env.length >= 30,
          summary: `source ${env.source}, target ${env.target}, type ${env.type}; ${describeM3Heartbeat(hb)}; bytes 16/17/27 = ${hb.autoShutdownEnable}/${hb.eqMode}/${hb.micAutoExitSw}`,
          data: { envelope: env, heartbeat: hb },
        }
      }),
  },
  {
    id: 'device-info', title: 'Device info 0x600A', kind: 'read',
    detail: 'Serial, version and MAC of the connected RX and every online unit; what the separator bytes hold (iOS reads a country code, §8).',
    run: (device) =>
      guarded(async () => {
        await device.refresh('identity')
        const rx = device.state.units.rx
        const s = session(device)
        return {
          ok: !!rx.serial || !!rx.version,
          summary: `RX ${rx.label ?? ''} sn ${rx.serial ?? '?'} fw ${rx.version ?? '?'} mac ${rx.mac ?? '?'}${s?.hotShoe ? `; hot shoe sn ${s.hotShoe.serial} fw ${s.hotShoe.version}` : ''}`,
          data: { units: device.state.units, deviceInfo: s?.deviceInfo },
        }
      }),
  },
  {
    id: 'versions', title: 'Firmware versions 0x6012', kind: 'read',
    detail: 'The 45-byte version list of the running system (0 = 4T4R, 1 = 2T2R); "0.0.0.0" for absent units (the app retries after 2 s).',
    run: (device) =>
      guarded(async () => {
        const s = session(device)
        if (!s) return { ok: false, summary: 'not an M3 device' }
        if (!Object.keys(s.firmware).length) await device.refresh('identity')
        const system = device.state.values[M3_INFO.SYSTEM] === M3_SYSTEM.TWO_T_TWO_R ? 1 : 0
        const list = s.firmware[system]
        return {
          ok: !!list?.length,
          summary: list ? list.map((i) => `${i.id}: ${i.version}`).join(', ') : 'no 0x6012 reply',
          data: s.firmware,
        }
      }),
  },
  {
    id: 'short-writes', title: 'Report sizes on write', kind: 'observe',
    detail: 'Frames are 64 bytes (512 when longer, m3-6303.md §3.1). Does the RX answer 64-byte writes when the descriptor declares 511, and vice versa (§7.1 #4)? ' +
      'Also note the PID after switching to or from 4-track (§7.1 #5).',
    run: async (device) => ({
      ok: device.state.rx === 'available',
      summary: `replies ${device.state.rx}; transport maxWrite ${device.transport.capabilities.maxWrite ?? 'unknown'} B`,
      data: device.transport.capabilities,
    }),
  },
  {
    id: 'led', title: 'Indicator light 0x6009 and back', kind: 'write-reversible',
    detail: 'Turn the TX indicator lights off and on again (0x6009, inverted: 1 = off) and confirm each step in heartbeat byte 19. Primary RX only.',
    run: (device) =>
      guarded(async () => {
        await device.refresh('status')
        const before = device.state.values[CONTROL.LED]
        const a = device.state.availability[CONTROL.LED]
        if (typeof before !== 'boolean') return { ok: false, summary: 'LED state unknown' }
        if (a && !a.ok) return { ok: false, summary: `not available: ${a.message ?? a.reason}` }
        const first = await device.set(CONTROL.LED, !before)
        await device.refresh('status')
        const seen = device.state.values[CONTROL.LED]
        const back = await device.set(CONTROL.LED, before)
        await device.refresh('status')
        const restored = device.state.values[CONTROL.LED]
        return {
          ok: first.ok && back.ok && seen === !before && restored === before,
          summary: `ack ${first.code ?? '–'} / ${back.code ?? '–'}; heartbeat showed ${String(seen)} then ${String(restored)} (wanted ${String(!before)} then ${String(before)})`,
        }
      }),
  },
]
