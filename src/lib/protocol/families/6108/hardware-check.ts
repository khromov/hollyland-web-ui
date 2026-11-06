/**
 * First-contact checklist for a LARK A1 (docs/FAMILIES.md §5.7 row 6108, a1-6108.md §7 "first hardware session",
 * §8 open questions). Read-only steps first; the one reversible write last: the indicator LED (0x21) and back,
 * which also records which set-ack reading the firmware follows (Android body[0] == 0, iOS != 0xFF).
 */
import { CONTROL } from '../../core/controls'
import type { HardwareCheckResult, HardwareCheckStep, MicDevice, SetResult } from '../../core/types'
import { WebHidFeatureTransport } from '../../transports/webhid-feature'
import { A1_END_MARKER, A1_HEADER_SIZE, A1_OTA_REPORT_ID, A1_REPORT_ID, A1_REPORT_SIZE } from './codec'
import { isA1FourMicFirmware, type A1Heartbeat } from './status'

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')

function featureTransport(device: MicDevice): WebHidFeatureTransport | null {
  return device.transport instanceof WebHidFeatureTransport ? device.transport : null
}

const notFeature: HardwareCheckResult = { ok: false, summary: 'not connected through WebHidFeatureTransport' }

async function guarded(f: () => Promise<HardwareCheckResult>): Promise<HardwareCheckResult> {
  try {
    return await f()
  } catch (e) {
    return { ok: false, summary: `${(e as Error).name}: ${(e as Error).message}` }
  }
}

export const A1_HARDWARE_CHECK: readonly HardwareCheckStep[] = [
  {
    id: 'feature-reports', title: 'Feature reports', kind: 'descriptor',
    detail: 'List the declared feature reports: is report 5 = 63 data bytes and report 6 = 159 (a1-6108.md §8 #1)? ' +
      'If report 5 is not declared, Chrome on macOS / Windows may refuse GET_REPORT.',
    run: async (device) => {
      const t = featureTransport(device)
      if (!t) return notFeature
      const reports = t.declaredFeatureReports()
      const r5 = reports.find((r) => r.reportId === A1_REPORT_ID)
      const r6 = reports.find((r) => r.reportId === A1_OTA_REPORT_ID)
      return {
        ok: r5?.bytes === A1_REPORT_SIZE - 1,
        summary: `report 5: ${r5 ? `${r5.bytes} B` : 'not declared'}; report 6: ${r6 ? `${r6.bytes} B` : 'not declared'}`,
        data: { reports, collections: t.device.collections },
      }
    },
  },
  {
    id: 'heartbeat', title: 'Heartbeat 0x1F', kind: 'read',
    detail: 'Body length (17 / 22 / 23) and whether the layout matches the mics that are on (a1-6108.md §8 #5).',
    run: (device) =>
      guarded(async () => {
        await device.refresh('status')
        const hb = device.state.raw as A1Heartbeat | undefined
        if (!hb) return { ok: false, summary: 'no heartbeat decoded' }
        return { ok: true, summary: `${hb.length}-byte body, layout ${hb.layout}`, data: hb }
      }),
  },
  {
    id: 'version', title: 'Version 0x0D [00]', kind: 'read',
    detail: 'RX version; second part 1 = 4 Mic & 1 RX firmware; >= 1.0.1.3 enables per-mic mute (a1-6108.md §1).',
    run: (device) =>
      guarded(async () => {
        await device.refresh('identity')
        const v = device.state.units.rx.version
        if (!v) return { ok: false, summary: 'no RX version decoded' }
        const four = isA1FourMicFirmware(v)
        return { ok: true, summary: `RX ${v} (${four === undefined ? 'mode unknown' : four ? '4 Mic & 1 RX' : '2 Mic & 1 RX'})`, data: device.state.units }
      }),
  },
  {
    id: 'reply-bytes', title: 'Reply bytes 1–3 and the end marker', kind: 'observe',
    detail: 'Record reply bytes 1–3 (expected ?? BB DD) and whether 0xEF follows the payload (a1-6108.md §8 #2).',
    run: async (device) => {
      const r = featureTransport(device)?.lastReport
      if (!r) return { ok: false, summary: 'no GET_REPORT result yet (run the heartbeat step first)' }
      const len = (r[5] << 8) | r[6]
      const ef = r[A1_HEADER_SIZE + len] === A1_END_MARKER
      return { ok: r[2] === 0xbb && r[3] === 0xdd, summary: `bytes 0–6: ${hex(r.subarray(0, 7))}; EF after payload: ${ef ? 'yes' : 'no'}`, data: hex(r) }
    },
  },
  {
    id: 'report-id-byte', title: 'GET_REPORT layout', kind: 'observe',
    detail: 'Does receiveFeatureReport(5) include the report-id byte on this OS (a1-6108.md §8 #3)?',
    run: async (device) => {
      const t = featureTransport(device)
      if (!t) return notFeature
      const l = t.lastReplyLayout
      if (!l) return { ok: false, summary: 'no GET_REPORT result yet' }
      return { ok: true, summary: `${l.byteLength} bytes, ${l.includedReportId ? 'with' : 'without'} the id byte; stale GETs so far: ${t.stats.staleGets}`, data: { ...l, stats: t.stats } }
    },
  },
  {
    id: 'led', title: 'LED 0x21 and back', kind: 'write-reversible',
    detail: 'Toggle the indicator LED (0x21 [0 on / 1 off]), confirm body[11] in the next heartbeat, restore it. ' +
      'Record the ack byte: Android reads body[0] == 0 as success, iOS anything but 0xFF (status.ts parseA1Ack). ' +
      'If the ack byte is not 0 but the heartbeat shows the change, the firmware follows the iOS reading.',
    run: (device) => guarded(() => ledRoundTrip(device)),
  },
]

/** iOS's reading of a set-ack byte (I -[HL6108DeviceInfoSync handleEvent:] @0x1002040e8: `cmp x0, #0xff; cset ne`). */
const iosOk = (r: SetResult) => r.code !== null && r.code !== 0xff

/** The 'led' step: flip the LED, read the heartbeat, flip it back, read again. */
async function ledRoundTrip(device: MicDevice): Promise<HardwareCheckResult> {
  if (typeof device.state.values[CONTROL.LED] !== 'boolean') await device.refresh('status')
  const before = device.state.values[CONTROL.LED]
  if (typeof before !== 'boolean') return { ok: false, summary: 'LED state unknown: no heartbeat decoded' }
  const onOff = (b: boolean) => (b ? 'on' : 'off')
  const flip = await device.set(CONTROL.LED, !before)
  await device.refresh('status')
  const seen = device.state.values[CONTROL.LED]
  const back = await device.set(CONTROL.LED, before)
  await device.refresh('status')
  const restored = device.state.values[CONTROL.LED] === before
  const changed = seen === !before
  const reading = flip.ok ? 'Android and iOS agree' : changed && iosOk(flip) ? 'the firmware follows the iOS reading' : 'the write was refused'
  return {
    ok: flip.ok && changed && back.ok && restored,
    summary:
      `LED ${onOff(before)} → ${onOff(!before)}: ack byte ${flip.code ?? 'none'} (Android ${flip.ok ? 'success' : 'failure'}, ` +
      `iOS ${iosOk(flip) ? 'success' : 'failure'}; ${reading}); heartbeat body[11] ${changed ? 'confirmed' : 'did not change'}; ` +
      `restored: ${restored ? 'yes' : 'no'} (ack byte ${back.code ?? 'none'})`,
    data: { before, flip, seen, back, restored },
  }
}
