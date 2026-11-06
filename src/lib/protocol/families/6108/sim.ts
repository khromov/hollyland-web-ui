/**
 * Wire-level LARK A1 simulator (docs/FAMILIES.md §3.8 row 6108, §5.3): answers every Feature-5 request frame with a
 * 64-byte GET_REPORT reply `05 03 BB DD cmd len16 body EF 00…` and keeps the settings the setters change.
 *
 * A model, not a capture: reply bytes 1–3 and the trailing EF are inferred (a1-6108.md §3.2, §8 #2); the firmware's
 * reaction to unusual input is unknown. What it models:
 *  - SET → reply pairing, set ack body[0] == 0 (OK) / 1 (refused value) (A ProSet* setStatus = data[0] == 0)
 *  - heartbeat bodies of 17 (2-mic), 22 (older 4-mic, no signal mode) or 23 bytes (a1-6108.md §4.2)
 *  - 2 Mic & 1 RX and 4 Mic & 1 RX firmware (RX version x.1.x.x, A HLDevice6302Activity.onResGetVersion)
 *  - per-unit identity: 0x0D / 0x12 / 0x31 answer only for online units [I]
 *  - faults: dropReplies, duplicateReplies, chunkSize, staleFeatureReply (the previous reply first, then the new one,
 *    which is what a slow firmware's GET_REPORT register looks like through fakeFeatureDeviceFor)
 * Disruptive, destructive and OTA commands are recorded in `dangerous` and never answered, so tests can assert that
 * none was sent.
 *
 * Profiles (SimOptions.profile): '2mic' (default: RX 1.0.1.3, 17-byte heartbeat), '2mic-android' (23-byte heartbeat
 * with TX3/TX4 offline, the layout Android assumes), '4mic' (RX 1.1.1.3, 23 bytes), '4mic-old' (RX 1.1.0.9, 22 bytes).
 * Params (SimOptions.params), all [I] models of what a firmware might do:
 *  - heartbeatLength (6..23) overrides the body length
 *  - ackOk / ackFail: the set-ack bytes (default 0 / 1, Android's DeviceConnectVariable.CmdSetResult). `ackOk: 1`
 *    models a firmware that follows the iOS reading (any byte but 0xFF is success, a1-6108.md §3.2)
 *  - muted: mics (tx1..tx4) that start muted
 * Firmware model [I]: a heartbeat without the signal-mode byte (any length but 17 or 23) is a firmware without
 * "Mode setting", so 0x3F and 0x40 get no reply; 0x16 for a mic slot the firmware mode lacks (TX3/TX4 on 2 Mic & 1 RX)
 * is refused.
 */
import { chunkBytes, padBytes } from '../../core/bytes'
import type { DeviceSimulator, SimFaults, SimOptions, UnitId } from '../../core/types'
import type { TransportCapabilities, TransportDeviceInfo } from '../../transport'
import { A1_END_MARKER, A1_HEADER_SIZE, A1_REPORT_ID, A1_REPORT_SIZE, parseA1Request } from './codec'
import { A1_COMMANDS, A1Cmd, A1_TX_UNITS, a1UnitOfByte } from './commands'

/** Reply byte 1 used by the simulator. The real value is unknown (a1-6108.md §8 #2); 0x03 mirrors the request. */
export const A1_SIM_REPLY_BYTE1 = 0x03

/** Build a reply report: `05 03 BB DD cmd len16 body EF`, zero padded to 64 bytes [I]. */
export function encodeA1SimReply(cmd: number, body: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(A1_REPORT_SIZE)
  out[0] = A1_REPORT_ID
  out[1] = A1_SIM_REPLY_BYTE1
  out[2] = 0xbb
  out[3] = 0xdd
  out[4] = cmd
  out[5] = (body.length >> 8) & 0xff
  out[6] = body.length & 0xff
  out.set(body, A1_HEADER_SIZE)
  out[A1_HEADER_SIZE + body.length] = A1_END_MARKER
  return out
}

export interface A1SimMic {
  online: boolean
  battery: number
  muted: boolean
  version: number[]
  serial: string
  mac: number[]
}

export type A1SimProfile = '2mic' | '2mic-android' | '4mic' | '4mic-old'

const PROFILES: Record<A1SimProfile, { rxVersion: string; heartbeatLength: number; mics: number }> = {
  '2mic': { rxVersion: '1.0.1.3', heartbeatLength: 17, mics: 2 },
  '2mic-android': { rxVersion: '1.0.1.3', heartbeatLength: 23, mics: 2 },
  '4mic': { rxVersion: '1.1.1.3', heartbeatLength: 23, mics: 4 },
  '4mic-old': { rxVersion: '1.1.0.9', heartbeatLength: 22, mics: 4 },
}

function isProfile(p: string | undefined): p is A1SimProfile {
  return !!p && p in PROFILES
}

export class A1Simulator implements DeviceSimulator {
  readonly info: TransportDeviceInfo = { vendorId: 0x3547, productId: 1031, productName: 'LARK A1 (simulated)' }
  readonly capabilities: TransportCapabilities = { receive: 'yes', link: 'mock' }
  faults: SimFaults
  readonly profile: A1SimProfile
  heartbeatLength: number
  rxVersion: number[]
  rxSerial = 'A1RX0000001'
  rxMac = [0x50, 0xc0, 0xf0, 0x10, 0x20, 0x30]
  mics: A1SimMic[]
  noiseOn = true
  /** 0 Weak, 1 Medium, 2 Strong. */
  noiseLevel = 2
  volume = 3
  channelMode = 1
  /** 0 = 15 min, 1 = Never. */
  shutdownTime = 0
  /** Wire value: 0 = on. */
  light = 0
  eq = 2
  reverbOn = true
  reverbLevel = 1
  micRecognition = true
  signalMode = 0
  performance = false
  modeFailReason = 0
  /** Mic slots of the firmware mode (2 Mic & 1 RX or 4 Mic & 1 RX). */
  readonly micSlots: number
  /** Set-ack byte for an accepted value (params.ackOk, default 0). */
  ackOk: number
  /** Set-ack byte for a refused value (params.ackFail, default 1). */
  ackFail: number
  /** Every request frame received. */
  readonly received: Uint8Array[] = []
  /** Disruptive / destructive / OTA frames received (never answered). */
  readonly dangerous: Uint8Array[] = []
  private lastReply: Uint8Array | null = null

  constructor(o: SimOptions = {}) {
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize, staleFeatureReply: o.staleFeatureReply }
    this.profile = isProfile(o.profile) ? o.profile : '2mic'
    const p = PROFILES[this.profile]
    this.micSlots = p.mics
    const len = o.params?.heartbeatLength
    this.heartbeatLength = typeof len === 'number' && Number.isInteger(len) && len >= 6 && len <= 23 ? len : p.heartbeatLength
    this.rxVersion = (o.rxVersion ?? p.rxVersion).split('.').map((x) => parseInt(x, 10) || 0)
    const byte = (x: unknown, d: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xff ? x : d)
    this.ackOk = byte(o.params?.ackOk, 0)
    this.ackFail = byte(o.params?.ackFail, 1)
    const muted = Array.isArray(o.params?.muted) ? (o.params.muted as unknown[]) : []
    const online: readonly UnitId[] = o.online ?? ['rx', ...A1_TX_UNITS.slice(0, p.mics)]
    this.mics = A1_TX_UNITS.map((u, i) => ({
      online: i < p.mics && online.includes(u),
      battery: [85, 60, 72, 40][i],
      muted: muted.includes(u),
      version: [1, p.mics === 4 ? 1 : 0, 0, 7],
      serial: `A1TX000000${i + 1}`,
      mac: [0x50, 0xc0, 0xf0, 0x11 + i, 0x22, 0x33],
    }))
  }

  /** Whether this firmware has "Mode setting": its heartbeat carries the signal-mode byte (17 or 23 bytes) [I]. */
  get supportsSignalMode(): boolean {
    return this.heartbeatLength === 17 || this.heartbeatLength === 23
  }

  /** The heartbeat body the device would send now (a1-6108.md §4.2). */
  heartbeatBody(): number[] {
    const [m1, m2, m3, m4] = this.mics
    const b = (x: boolean) => (x ? 1 : 0)
    const head = [
      b(m1.online), b(m2.online), m1.battery, m2.battery, b(m1.muted), b(m2.muted),
      b(this.noiseOn), this.noiseLevel, this.volume, this.channelMode, this.shutdownTime, this.light, this.eq,
      b(this.reverbOn), this.reverbLevel, b(this.micRecognition),
    ]
    const tx34 = [b(m3.online), b(m4.online), m3.battery, m4.battery, b(m3.muted), b(m4.muted)]
    const n = this.heartbeatLength
    if (n <= 16) return head.slice(0, n)
    if (n === 17) return [...head, this.signalMode]
    if (n === 23) return [...head, this.signalMode, ...tx34]
    return [...head, ...tx34].slice(0, n) // 18..22: no signal-mode byte (iOS branch for LEN != 23)
  }

  respond(packet: Uint8Array): Uint8Array[] {
    this.received.push(packet.slice())
    const req = parseA1Request(packet)
    if (!req) return []
    const safety = A1_COMMANDS[req.cmd]?.safety
    if (req.report !== A1_REPORT_ID || safety === 'disruptive' || safety === 'destructive' || safety === 'ota') {
      this.dangerous.push(packet.slice())
      return []
    }
    const body = this.handle(req.cmd, req.payload)
    if (!body || this.faults.dropReplies) return []
    const reply = encodeA1SimReply(req.cmd, body)
    let out = [reply]
    if (this.faults.staleFeatureReply && this.lastReply) out = [this.lastReply, reply]
    this.lastReply = reply
    if (this.faults.duplicateReplies) out = out.flatMap((r) => [r, r.slice()])
    const n = this.faults.chunkSize
    return n ? out.flatMap((r) => chunkBytes(r, n)) : out
  }

  private mic(index: number): A1SimMic | undefined {
    return index >= 0 && index < 4 ? this.mics[index] : undefined
  }

  /** Reply body for a request, or null for no reply. */
  private handle(cmd: number, p: Uint8Array): number[] | null {
    const ok = [this.ackOk]
    const refused = [this.ackFail]
    const valid = (v: number | undefined, max: number, min = 0) => v !== undefined && v >= min && v <= max
    switch (cmd) {
      case A1Cmd.GET_HEART_INFO:
        return this.heartbeatBody()
      case A1Cmd.GET_DEVICE_VERSION:
      case A1Cmd.GET_DEVICE_SN: {
        if (p.length < 1) return null
        const unit = a1UnitOfByte(p[0])
        const m = unit === 'rx' ? undefined : this.mic(p[0] - 1)
        if (unit !== 'rx' && !m?.online) return null
        if (cmd === A1Cmd.GET_DEVICE_VERSION) return [p[0], ...(m ? m.version : this.rxVersion)]
        return [p[0], ...Array.from(m ? m.serial : this.rxSerial, (c) => c.charCodeAt(0))]
      }
      case A1Cmd.GET_DEVICE_MAC_RX:
        return [...this.rxMac]
      case A1Cmd.GET_DEVICE_MAC_TX: {
        const m = this.mic(p[0] ?? -1)
        if (!m?.online) return null
        return [p[0], ...m.mac]
      }
      case A1Cmd.SET_NOISE:
        if (!valid(p[0], 1) || !valid(p[1], 2)) return refused
        this.noiseOn = p[0] === 1
        this.noiseLevel = p[1]
        return ok
      case A1Cmd.GET_NOISE:
        return [this.noiseOn ? 1 : 0, this.noiseLevel]
      case A1Cmd.SET_VOICE_LEVEL:
        if (!valid(p[0], 5)) return refused
        this.volume = p[0]
        return ok
      case A1Cmd.GET_VOICE_LEVEL:
        return [this.volume]
      case A1Cmd.SET_VOICE_MODE:
        if (!valid(p[0], 1)) return refused
        this.channelMode = p[0]
        return ok
      case A1Cmd.GET_VOICE_MODE:
        return [this.channelMode]
      case A1Cmd.SET_EQ:
        if (!valid(p[0], 3, 1)) return refused
        this.eq = p[0]
        return ok
      case A1Cmd.GET_EQ:
        return [this.eq]
      case A1Cmd.SET_REVERB:
        if (!valid(p[0], 1) || !valid(p[1], 2)) return refused
        this.reverbOn = p[0] === 1
        this.reverbLevel = p[1]
        return ok
      case A1Cmd.GET_REVERB:
        return [this.reverbOn ? 1 : 0, this.reverbLevel]
      case A1Cmd.SET_TX_MUTE: {
        const m = (p[0] ?? -1) < this.micSlots ? this.mic(p[0] ?? -1) : undefined
        if (!m || !valid(p[1], 1)) return refused
        m.muted = p[1] === 1
        return ok
      }
      case A1Cmd.SET_LIGHT:
        if (!valid(p[0], 1)) return refused
        this.light = p[0]
        return ok
      case A1Cmd.SET_TX_IDENTIFY:
        if (!valid(p[0], 1)) return refused
        this.micRecognition = p[0] === 1
        return ok
      case A1Cmd.SET_SHUTDOWN_TIME:
        if (!valid(p[0], 1)) return refused
        this.shutdownTime = p[0]
        return ok
      case A1Cmd.SET_SIGNAL_MODE:
        if (!this.supportsSignalMode) return null
        if (!valid(p[0], 1)) return refused
        this.signalMode = p[0]
        return ok
      case A1Cmd.GET_SIGNAL_MODE:
        return this.supportsSignalMode ? [this.signalMode] : null
      case A1Cmd.GET_MODE_FAIL_REASON:
        return [this.modeFailReason]
      case A1Cmd.SET_PERFORMANCE_MODE:
        if (!valid(p[0], 1)) return refused
        this.performance = p[0] === 1
        return ok
      case A1Cmd.GET_PERFORMANCE_MODE:
        return [this.performance ? 1 : 0]
      default:
        // 0x22 / 0x24 / 0x26 / 0x28 (constants only) and unknown ids: no reply.
        return null
    }
  }
}

/** Pad helper for tests that build replies by hand (a reply report is always 64 bytes on the feature link). */
export function padA1Report(bytes: ArrayLike<number>): Uint8Array {
  return padBytes(bytes, A1_REPORT_SIZE)
}
