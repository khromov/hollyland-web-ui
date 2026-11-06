/**
 * "Copy hardware report" (docs/FAMILIES.md §4.3, §5.7): a plain-text snapshot a user can paste
 * into an issue when a product misbehaves or has never been tested. It holds the product and its
 * support record, firmware versions, the transport (HID collections, feature-report stats or GATT
 * diagnostics), whether replies arrive, the decoded values, every blocked control with its reason,
 * the last writes and their acks, the driver's first-contact checklist with any results, and the
 * last N traffic frames. No serial numbers are hidden: the user reads it before sharing.
 */
import {
  WebBluetoothTransport,
  WebHidFeatureTransport,
  displayName,
  familyCodeOf,
  reportByteLength,
  toHex,
  type ControlSpec,
  type HardwareCheckResult,
  type HardwareCheckStep,
  type MicState,
  type ProductInfo,
  type SupportInfo,
  type Transport,
} from '../protocol'
import type { TrafficEntry } from './traffic.svelte'

/** One write sent from this page (kept for the report: the ack code shows which ack reading the firmware follows). */
export interface WriteRecord {
  at: number
  id: string
  unit?: string
  value: unknown
  ok: boolean
  confirmed?: boolean
  code?: number | null
  error?: string
}

export type CheckOutcome = HardwareCheckResult | { ok: false; summary: string; skipped: true }

export interface HardwareReportInput {
  now: number
  userAgent: string
  page: string
  product: ProductInfo
  support: SupportInfo
  linkKind: string | null
  transport: Transport | null
  state: MicState | null
  controls: readonly ControlSpec[]
  writes: readonly WriteRecord[]
  checks: readonly HardwareCheckStep[]
  checkResults: Readonly<Record<string, CheckOutcome>>
  traffic: readonly TrafficEntry[]
  /** Traffic frames to include (default 50). */
  trafficLimit?: number
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0')
const hex2 = (n: number) => `0x${n.toString(16).padStart(2, '0')}`

function json(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x: unknown) => (x instanceof Uint8Array ? toHex(x) : typeof x === 'bigint' ? String(x) : x))
  } catch {
    return String(v)
  }
}

function time(ms: number): string {
  const d = new Date(ms)
  return `${d.toISOString().slice(11, 23)}`
}

function describeCollections(cols: readonly HIDCollectionInfo[] | undefined, depth = 1): string[] {
  const out: string[] = []
  const pad = '  '.repeat(depth)
  const reports = (label: string, rs: readonly HIDReportInfo[] | undefined) =>
    rs?.length ? `${label} ${rs.map((r) => `${hex2(r.reportId ?? 0)}:${reportByteLength(r)}B`).join(',')}` : ''
  for (const c of cols ?? []) {
    const parts = [
      `usagePage 0x${hex4(c.usagePage ?? 0)} usage 0x${hex4(c.usage ?? 0)}`,
      reports('in', c.inputReports),
      reports('out', c.outputReports),
      reports('feature', c.featureReports),
    ].filter(Boolean)
    out.push(`${pad}- ${parts.join(' · ')}`)
    out.push(...describeCollections(c.children, depth + 1))
  }
  return out
}

function transportLines(kind: string | null, t: Transport | null): string[] {
  if (!t) return ['Transport: none']
  const caps = t.capabilities
  const info = t.info
  const lines = [
    `Transport: ${kind ?? t.kind} (${t.kind}) · link ${caps.link ?? '?'} · receive ${caps.receive} · maxWrite ${caps.maxWrite ?? '?'}`,
    info ? `Device: ${info.productName ?? '?'} · ${hex4(info.vendorId)}:${hex4(info.productId)}${info.id ? ` · ${info.id}` : ''}` : 'Device: ?',
  ]
  const hid = (t as Transport & { device?: { collections?: readonly HIDCollectionInfo[] } }).device
  if (t instanceof WebBluetoothTransport) {
    lines.push(`GATT: ${json(t.diagnostics())}`)
  } else if (hid && Array.isArray(hid.collections)) {
    lines.push('HID collections:', ...describeCollections(hid.collections))
  }
  if (t instanceof WebHidFeatureTransport) {
    lines.push(
      `Feature reports: declared data size ${t.declaredDataSize ?? 'not declared'} · stats ${json(t.stats)} · last reply layout ${json(t.lastReplyLayout)}`,
      `Last feature report: ${t.lastReport ? toHex(t.lastReport) : '-'}`,
    )
  }
  return lines
}

function replyLine(s: MicState | null, kind: string | null): string {
  if (!s) return 'Replies: not connected'
  const rx = s.rx === 'available' ? 'received' : s.rx === 'unavailable' ? 'NOT received (write-only)' : 'unknown'
  const expectReplies = kind === 'webhid-feature' || kind === 'web-bluetooth' || kind === 'bridge'
  const finding = s.rx === 'unavailable' && expectReplies ? ' · unexpected for this link' : ''
  return `Replies: ${rx}${finding} · missed polls ${s.missedHeartbeats} · last status ${s.lastStatusAt ? new Date(s.lastStatusAt).toISOString() : '-'}`
}

function unitLines(s: MicState | null): string[] {
  if (!s) return []
  return Object.values(s.units).flatMap((u) => {
    if (!u) return []
    const f = [
      u.online ? 'online' : 'offline',
      u.version && `fw ${u.version}`,
      u.serial && `sn ${u.serial}`,
      u.battery !== undefined && `battery ${u.battery}%`,
      u.charging && 'charging',
      u.muted !== undefined && (u.muted ? 'muted' : 'unmuted'),
      u.role,
      u.kind,
      u.label && `label ${u.label}`,
    ].filter(Boolean)
    return [`  - ${u.id}: ${f.join(' · ')}`]
  })
}

function valueLines(s: MicState | null, controls: readonly ControlSpec[]): string[] {
  if (!s) return []
  const label = (key: string) => controls.find((c) => c.id === key.split(':')[0])?.label
  return Object.entries(s.values).map(([k, v]) => `  - ${k}${label(k) ? ` (${label(k)})` : ''} = ${json(v)}`)
}

function blockedLines(s: MicState | null): string[] {
  if (!s) return []
  return Object.entries(s.availability).flatMap(([k, a]) =>
    a && !a.ok ? [`  - ${k}: ${a.reason ?? 'unavailable'}${a.message ? ` (${a.message})` : ''}`] : [],
  )
}

function checkLines(checks: readonly HardwareCheckStep[], results: HardwareReportInput['checkResults']): string[] {
  return checks.map((c) => {
    const r = results[c.id]
    const res = !r ? (c.run ? 'not run' : 'manual') : 'skipped' in r ? `skipped: ${r.summary}` : `${r.ok ? 'ok' : 'FAILED'}: ${r.summary}`
    return `  - [${c.kind}] ${c.title}: ${res}\n      ${c.detail}`
  })
}

function trafficLines(entries: readonly TrafficEntry[], limit: number): string[] {
  return entries.slice(-limit).map((e) => {
    const dir = e.dir === 'out' ? '→' : '←'
    const status = e.status === 'ok' ? '' : ` [${e.status}]`
    return `  ${time(e.t)} ${dir} ${e.hexShort || '(no bytes)'}${e.decoded ? `  ${e.decoded}` : ''}${status}`
  })
}

export function buildHardwareReport(i: HardwareReportInput): string {
  const p = i.product
  const s = i.support
  const limit = i.trafficLimit ?? 50
  const fw = i.state ? Object.values(i.state.units).filter((u) => u?.version).map((u) => `${u!.id.toUpperCase()} ${u!.version}`) : []
  const lines = [
    'Hollyland Web UI hardware report',
    `Generated: ${new Date(i.now).toISOString()}`,
    `Page: ${i.page}`,
    `Browser: ${i.userAgent}`,
    '',
    `Product: ${displayName(p)} (${p.name}) · ${p.idKind === 'app' ? `app id ${p.productId}` : `USB ${hex4(p.vendorId)}:${hex4(p.productId)}`}` +
      ` · family ${familyCodeOf(p) ?? '?'} · code ${p.code}${p.vendorIdConfirmed === false ? ' · VID unconfirmed' : ''}`,
    `Support: ${s.level} · hardware ${s.hardware} · confidence ${s.confidence}${s.note ? ` (${s.note})` : ''} · ${s.research}`,
    `Tested on: ${s.testedOn?.length ? s.testedOn.join('; ') : '-'}`,
    `Firmware: ${fw.length ? fw.join(' · ') : 'not read'}`,
    '',
    ...transportLines(i.linkKind, i.transport),
    replyLine(i.state, i.linkKind),
    '',
    'Units:',
    ...unitLines(i.state),
    '',
    'Values:',
    ...valueLines(i.state, i.controls),
    '',
    'Blocked controls:',
    ...blockedLines(i.state),
    '',
    `Controls offered: ${i.controls.map((c) => `${c.id}${c.safety === 'write' ? '' : ` [${c.safety}]`}${c.confidence === 'high' ? '' : ` (${c.confidence})`}`).join(', ') || '-'}`,
    '',
    'Writes from this page:',
    ...i.writes.map(
      (w) =>
        `  - ${time(w.at)} ${w.id}${w.unit ? `:${w.unit}` : ''} = ${json(w.value)} → ` +
        (w.error ? `error: ${w.error}` : `${w.ok ? 'ok' : 'rejected'}${w.confirmed ? '' : ' (not confirmed)'} · ack code ${w.code ?? '-'}`),
    ),
    '',
    'Hardware check:',
    ...checkLines(i.checks, i.checkResults),
    '',
    `Traffic (last ${limit} of ${i.traffic.length}):`,
    ...trafficLines(i.traffic, limit),
  ]
  return lines.join('\n')
}
