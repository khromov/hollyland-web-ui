/**
 * First-contact checklist for a MELO P1 receiver (docs/FAMILIES.md §5.7 row 6201; melo-6201.md §10). Read-only
 * steps first; then two reversible writes: the VU subscription (started and stopped again) and one LED brightness
 * step and back. Each `run` records what the diagnostic report needs.
 */
import type { HardwareCheckResult, HardwareCheckStep, MicDevice, MicTrafficEntry } from '../../core/types'
import { controlKey } from '../../core/controls'
import type { MomaMessage } from '../../moma/spec'
import { WebBluetoothTransport } from '../../transports/web-bluetooth'
import { MELO_CMD } from './commands'
import { MELO_CONTROL } from './controls'
import { MeloDevice } from './device'
import type { MeloHeartbeat, MeloLevels } from './status'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function guarded(f: () => Promise<HardwareCheckResult>): Promise<HardwareCheckResult> {
  try {
    return await f()
  } catch (e) {
    return { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

/** Run `f` and collect the decoded replies of command `cmd` that arrived meanwhile. */
async function capture(device: MicDevice, cmd: number, f: () => Promise<void>): Promise<MomaMessage[]> {
  const got: MomaMessage[] = []
  const off = device.onTraffic((e: MicTrafficEntry) => {
    const m = e.message as MomaMessage | undefined
    if (e.direction === 'rx' && m && typeof m === 'object' && 'cmd' in m && m.cmd === cmd) got.push(m)
  })
  try {
    await f()
  } finally {
    off()
  }
  return got
}

export const MELO_HARDWARE_CHECK: readonly HardwareCheckStep[] = [
  {
    id: 'ble-advertising', title: 'BLE advertising and GATT', kind: 'descriptor',
    detail: 'Advertised name; service data 0xBBBB (04 01 or 04 02 + SN); is FFE0 in getPrimaryServices(); FFE1 properties ' +
      '(write and / or write without response); FFE2 notify (melo-6201.md §1.2, §10 #2).',
    run: (device) =>
      guarded(async () => {
        const t = device.transport
        if (!(t instanceof WebBluetoothTransport)) return { ok: false, summary: 'not connected over Web Bluetooth' }
        const d = t.diagnostics()
        return { ok: true, summary: `${t.device.name ?? '(no name)'}: write ${d.writeMode ?? '?'} (link asks ${d.linkWriteMode ?? '?'})`, data: d }
      }),
  },
  {
    id: 'device-info', title: 'Device info 0x600A [0]', kind: 'read',
    detail: 'Sound-card master firmware (byte-reversed in bytes 12–15): >= 4.0.0.1 selects the V2 structures, >= 3.0.7.9 per-mic gain.',
    run: (device) =>
      guarded(async () => {
        await device.refresh('identity')
        const v = device.state.units.rx.version
        if (!v) return { ok: false, summary: 'no RX version decoded (reply shorter than 20 bytes?)' }
        const structure = device instanceof MeloDevice ? device.structure : null
        return { ok: true, summary: `RX ${v}, ${structure ?? '?'} structures, serial ${device.state.units.rx.serial ?? '?'}`, data: device.state.units }
      }),
  },
  {
    id: 'heartbeat', title: 'Status 0x600B', kind: 'read',
    detail: 'Payload length (31); reply header bytes (source, target, item type); does the reply carry XOR (melo-6201.md §10 #3)?',
    run: (device) =>
      guarded(async () => {
        const replies = await capture(device, MELO_CMD.HEARTBEAT, () => device.refresh('status'))
        const hb = device.state.raw as MeloHeartbeat | undefined
        const m = replies.at(-1)
        if (!m) return { ok: false, summary: 'no heartbeat reply' }
        const f = m.frame
        return {
          ok: hb?.length === 31,
          summary: `${m.payload.length}-byte payload; header src ${f.source} tgt ${f.target} ctl 0x${f.control.toString(16)} type ${m.type}; ` +
            `XOR ${f.checksum.present ? (f.checksum.ok ? 'present, valid' : 'present, WRONG') : 'absent'}`,
          data: { heartbeat: hb, raw: Array.from(f.raw) },
        }
      }),
  },
  {
    id: 'notification-sizes', title: 'Notification fragmentation', kind: 'observe',
    detail: 'Sizes of FFE2 notifications (whole frames or MTU − 3 pieces?) and whether the first long write fell back to 20-byte pieces.',
    run: async (device) => {
      const t = device.transport
      if (!(t instanceof WebBluetoothTransport)) return { ok: false, summary: 'not connected over Web Bluetooth' }
      const d = t.diagnostics()
      const n = d.notificationBytes
      return {
        ok: true,
        summary: `write chunk ${d.writeChunkSize} B${d.fellBackToMinChunk ? ' (fell back to 20-byte pieces)' : ''}; ` +
          `${d.notifications} notifications${n ? `, ${n.min}–${n.max} B` : ''}`,
        data: d,
      }
    },
  },
  {
    id: 'vu', title: 'VU push 0x6048 → 0x11EB', kind: 'write-reversible',
    detail: 'Subscribe for 2 s (0x11E0 inputs + outputs, 0x6048 [01 EB 11 64 00]), count the pushes and their item type, then 0x6049.',
    run: (device) =>
      guarded(async () => {
        if (!(device instanceof MeloDevice)) return { ok: false, summary: 'not a MELO P1 device' }
        const got: MeloLevels[] = []
        const off = device.onLevels((l) => got.push(l))
        const pushes = await capture(device, MELO_CMD.VU_ALL_GET, async () => {
          await device.startLevels()
          await sleep(2000)
          await device.stopLevels()
        }).finally(off)
        return {
          ok: got.length > 0,
          summary: `${got.length} level pushes in 2 s (item type ${pushes[0]?.type ?? '?'})`,
          data: { first: got[0], last: got.at(-1) },
        }
      }),
  },
  {
    id: 'led', title: 'LED 0x2000 and back', kind: 'write-reversible',
    detail: 'Change the mixer LED brightness one step, confirm it with 0x3004, restore it; record the ack byte.',
    run: (device) =>
      guarded(async () => {
        await device.refresh('settings')
        const id = MELO_CONTROL.LED_BRIGHTNESS
        const before = device.state.values[controlKey(id, 'rx')]
        if (typeof before !== 'number') return { ok: false, summary: 'mixer LED brightness not read (0x3004)' }
        const wasOn = device.state.values[controlKey(MELO_CONTROL.LED, 'rx')]
        const next = before === 2 ? 1 : before + 1
        const r = await device.set(id, next, { unit: 'rx' })
        await device.refresh('settings')
        const seen = device.state.values[controlKey(id, 'rx')]
        await device.set(id, before, { unit: 'rx' })
        if (wasOn === false) await device.set(MELO_CONTROL.LED, false, { unit: 'rx' })
        return { ok: r.ok && seen === next, summary: `brightness ${before} → ${next} (read back ${String(seen)}), ack code ${r.code}; restored`, data: r }
      }),
  },
]
