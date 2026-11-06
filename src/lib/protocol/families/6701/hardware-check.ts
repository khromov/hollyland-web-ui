/**
 * First-contact checklist for a LARK MAX 2 (docs/FAMILIES.md §5.7 row 6701, max2-6701.md §9 open questions).
 * Read-only steps first; the one reversible write (Lock Mic and back) last. Nothing here touches pairing, firmware
 * or the restart-causing settings.
 */
import type { HardwareCheckResult, HardwareCheckStep, MicDevice } from '../../core/types'
import { WebBluetoothTransport } from '../../transports/web-bluetooth'
import { MAX2_CONTROL } from './controls'
import type { Max2Heartbeat } from './status'

async function guarded(f: () => Promise<HardwareCheckResult>): Promise<HardwareCheckResult> {
  try {
    return await f()
  } catch (e) {
    return { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

const isBle = (d: MicDevice) => d.transport instanceof WebBluetoothTransport

export const MAX2_HARDWARE_CHECK: readonly HardwareCheckStep[] = [
  {
    id: 'ble-services', title: 'BLE advertising and GATT', kind: 'descriptor',
    detail: 'Is 0xFEE7 in the advertised UUID list or only in service data (max2-6701.md §9 #3)? Record the GATT inventory, ' +
      'the FEC1 properties (write without response + notify on one characteristic) and the notification sizes.',
    run: (device) =>
      guarded(async () => {
        if (!(device.transport instanceof WebBluetoothTransport)) return { ok: false, summary: 'not connected through Web Bluetooth' }
        const t = device.transport
        const d = t.diagnostics()
        return { ok: true, summary: `link ${t.link.service}/${t.link.write}; write ${t.writeMode ?? '?'} in ${t.writeChunkSize}-byte pieces`, data: d }
      }),
  },
  {
    id: 'ble-pushes', title: 'Pushed items', kind: 'observe',
    detail: 'Item type (0 notify?) and cadence of the BOX pushes 0x6000 / 0x6001 / 0x6002 after connect (max2-6701.md §9 #4). ' +
      'Android 3.1.0 decodes them but its screen never shows them; batteries come from 0x600A there.',
  },
  {
    id: 'device-info', title: 'Device info 0x600A [1]', kind: 'read',
    detail: 'RX version (gate 3.0.0.50 for 4 Mic & 1 RX, RX pairing, wireless monitoring), SN, battery; 52-byte payload.',
    run: (device) =>
      guarded(async () => {
        await device.refresh('identity')
        const u = device.state.units
        if (!u.rx.version) return { ok: false, summary: 'no RX version decoded' }
        return { ok: true, summary: `RX ${u.rx.version} (SN ${u.rx.serial ?? '?'}); BOX ${u.box?.version ?? '–'}`, data: u }
      }),
  },
  {
    id: 'heartbeat', title: 'Status 0x600B', kind: 'read',
    detail: 'USB: reply length (33 or 49 B payload), whether it fits one input report, whether broadcast target 0 works ' +
      '(max2-6701.md §9 #2, #5). BLE: does the BOX forward 0x600B to target 2 as on iOS (I -[HLBleDeviceController sendHeartInfo])?',
    run: (device) =>
      guarded(async () => {
        await device.refresh('status')
        const hb = device.state.raw as Max2Heartbeat | undefined
        if (!hb) return { ok: false, summary: `no heartbeat decoded${isBle(device) ? ' (the BOX may not forward it: Android never polls over BLE)' : ''}` }
        return { ok: true, summary: `${hb.length}-byte payload${hb.extended ? '' : ' (no wireless / mic 3-4 / 4-mic bytes)'}`, data: hb }
      }),
  },
  {
    id: 'usb-descriptor', title: 'USB descriptor', kind: 'descriptor',
    detail: 'Report ids and sizes of 0x0402 / 0x0403 (`ioreg -l -w0 -r -c IOHIDDevice` or WebHID device.collections): does macOS ' +
      'deliver replies that start with 0xBB? Frames are written unpadded at 23..75 bytes (max2-6701.md §2.1, §9 #1).',
  },
  {
    id: 'mic-lock', title: 'Lock Mic 0x6005 and back', kind: 'write-reversible',
    detail: 'Toggle "Lock Mic" (no restart, no pairing change), confirm the ack (type 2, payload[0] 0) and heartbeat byte 10, restore it.',
    run: (device) =>
      guarded(async () => {
        const before = device.state.values[MAX2_CONTROL.MIC_LOCK]
        if (typeof before !== 'boolean') return { ok: false, summary: 'Lock Mic state unknown; run the status step first' }
        const r1 = await device.set(MAX2_CONTROL.MIC_LOCK, !before)
        const r2 = await device.set(MAX2_CONTROL.MIC_LOCK, before)
        return { ok: r1.ok && r2.ok, summary: `set ${!before}: ack ${r1.code}; restore ${before}: ack ${r2.code}`, data: { r1, r2 } }
      }),
  },
]
