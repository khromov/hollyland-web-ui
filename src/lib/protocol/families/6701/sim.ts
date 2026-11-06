/**
 * LARK MAX 2 simulator for both links (FAMILIES.md §3.8 row 6701 "simulator must model"):
 *  - USB RX (1026 / 1027): answers the 3 s heartbeat poll 0x600B (33- or 49-byte payload), 0x600A per unit, "get all"
 *    (one composite frame), GETs and SETs; one frame per reply, start/end items and XOR as the requests.
 *  - BLE charging case (101): the same replies through the BOX (source = the addressed unit: 2 RX, 5 BOX, 3/4/10/11
 *    TX); pushes 0x6000 (BOX battery), 0x6001 (RX battery), 0x6002 (TX1/TX2 online + battery) as type 0 items once the
 *    host talks to it and on `pushStatus()`; every notification is cut into MTU − 3 byte pieces (default MTU 23 → 20 B,
 *    `params.mtu`), so a 75-byte 0x600A reply arrives in 4 notifications; 0x600B is forwarded to the RX unless
 *    `params.forwardHeartbeat === false` (Android never sends it over BLE; iOS polls it, max2-6701.md §4.2).
 *
 * The reply bytes the real units send are partly unknown [?]: source byte, item types of acks / data / pushes, push
 * cadence (max2-6701.md §3.3 "constructed replies", §9 #4). The defaults follow the research doc.
 *
 * SimOptions: `rxVersion` (default 3.0.0.52, past the 3.0.0.50 gate), `online` (units online at start: default RX,
 * BOX, TX1, TX2), `profile: '4mic'` (4 Mic & 1 RX mode, TX3/TX4 online), faults. `params`:
 *   heartbeatLength 33 | 49, mtu, camera (BOX: RX kind), tc, tcMode, wireless, earphones (0..3 earConnectStatus),
 *   paired, recording, forwardHeartbeat, pushes (BLE, default true), pushIntervalMs, silent (ids never answered: firmware
 *   without a command).
 */
import type { DeviceSimulator, SimFaults, SimOptions, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_ID, type MomaItemInput } from '../../moma/codec'
import { momaProfileFor, type MomaProfile } from '../../moma/profiles'
import { applyMomaFaults, encodeMomaReply, momaAck, momaData, momaNotify, MomaRequestReader } from '../../moma/sim'
import { MAX2_BLE_TARGET, MAX2_CMD, MAX2_VERSION_UNIT_OF, type Max2VersionUnit } from './commands'
import { isMax2Box, max2LinkOf, type Max2Link } from './controls'
import { encodeMax2Heartbeat, encodeMax2Version, MAX2_HEARTBEAT_BASE_LENGTH, MAX2_HEARTBEAT_FULL_LENGTH } from './status'

export interface Max2SimUnit {
  online: boolean
  battery: number
  charging: boolean
  version: string
  serial: string
  hardwareVersion: string
}

export interface Max2SimMic extends Max2SimUnit {
  /** 0..40 = −20..+20 dB. */
  gain: number
  remainRecordTime: number
}

export interface Max2SimRequest {
  target: number
  items: { cmd: number; type: number; payload: Uint8Array }[]
}

const TX_TARGETS: Readonly<Record<number, number>> = { [MAX2_BLE_TARGET.tx1]: 0, [MAX2_BLE_TARGET.tx2]: 1, [MAX2_BLE_TARGET.tx3]: 2, [MAX2_BLE_TARGET.tx4]: 3 }

const unit = (version: string, serial: string, battery: number, online = true): Max2SimUnit => ({
  online, battery, charging: false, version, serial, hardwareVersion: 'H1.0',
})

export class Max2Simulator implements DeviceSimulator {
  readonly info: { vendorId: number; productId: number; productName: string }
  readonly capabilities = { receive: 'yes' as const, link: 'mock' as const }
  faults: SimFaults
  readonly link: Max2Link
  readonly profile: MomaProfile
  /** BLE ATT MTU: notifications carry at most mtu − 3 bytes. */
  mtu: number
  heartbeatLength: number
  forwardHeartbeat: boolean
  pushes: boolean

  rx: Max2SimUnit & { isCamera: boolean }
  box: Max2SimUnit
  mics: Max2SimMic[]
  speaker = false
  /** 0 = 32-bit float, 1 = 24-bit. */
  sampleDepth = 1
  micLock = false
  ncOn = true
  ncDepth = 10
  gainType = 1
  gainLevel = 1
  channel = 0
  recording = false
  tcEnabled = false
  tcMode = 0
  fps = 2
  timing = 1
  tcTime = { hour: 1, min: 2, sec: 3, frame: 4 }
  resetTiming = false
  txIdentify = false
  fourMic = false
  wireless = false
  earPaired = false
  earMonitor = 0
  earVolume = 20
  earConnect = 0
  earL = { battery: 70, charging: false }
  earR = { battery: 65, charging: false }
  uacMode = 0
  recordNoise = 0
  /** Last 0x6009 payload. */
  systemTime: number[] | null = null
  /** Phone Speaker / Wireless Monitoring writes (the real RX restarts on each). */
  restarts = 0
  /** NC writes per target (BLE fan-out). */
  readonly noiseTargets: number[] = []
  /** Every request frame decoded. */
  readonly requests: Max2SimRequest[] = []
  pushCount = 0

  private readonly reader: MomaRequestReader
  private inject: ((p: Uint8Array) => void) | null = null
  private contacted = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly pushIntervalMs: number
  private readonly silent: ReadonlySet<number>

  constructor(product: ProductInfo, o: SimOptions = {}) {
    if (product.idKind === 'app' && !isMax2Box(product)) throw new Error(`${product.name} has no MAX 2 control link to simulate`)
    this.link = max2LinkOf(product)
    this.profile = momaProfileFor('6701', product.productId, this.link)
    this.reader = new MomaRequestReader(this.profile)
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: `${product.label ?? product.name} (simulated)` }
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    const p = o.params ?? {}
    this.mtu = typeof p.mtu === 'number' ? p.mtu : 23
    this.heartbeatLength = p.heartbeatLength === MAX2_HEARTBEAT_BASE_LENGTH ? MAX2_HEARTBEAT_BASE_LENGTH : MAX2_HEARTBEAT_FULL_LENGTH
    this.forwardHeartbeat = p.forwardHeartbeat !== false
    this.pushes = this.link === 'ble' && p.pushes !== false
    this.pushIntervalMs = typeof p.pushIntervalMs === 'number' ? p.pushIntervalMs : 0
    this.silent = new Set(Array.isArray(p.silent) ? (p.silent as number[]) : [])
    this.rx = { ...unit(o.rxVersion ?? '3.0.0.52', 'H2MRX0000000001', product.productId === 1026 ? 0 : 88), isCamera: product.productId === 1027 || p.camera === true }
    this.box = unit('1.0.0.8', 'H2MBOX000000001', 76)
    this.mics = [0, 1, 2, 3].map((i) => ({ ...unit('3.0.0.21', `H2MTX00000000${i + 1}`, [80, 55, 64, 47][i]), gain: 20, remainRecordTime: 0 }))
    this.fourMic = o.profile === '4mic'
    const online: readonly UnitId[] = o.online ?? ['rx', 'box', 'tx1', 'tx2', ...(this.fourMic ? (['tx3', 'tx4'] as const) : [])]
    this.mics.forEach((m, i) => (m.online = online.includes(`tx${i + 1}` as UnitId)))
    // Through BLE the BOX is the peer itself.
    this.box.online = this.link === 'ble' || online.includes('box')
    if (typeof p.tc === 'boolean') this.tcEnabled = p.tc
    if (typeof p.tcMode === 'number') this.tcMode = p.tcMode
    if (typeof p.wireless === 'boolean') this.wireless = p.wireless
    if (typeof p.earphones === 'number') this.earConnect = p.earphones
    if (typeof p.paired === 'boolean') this.earPaired = p.paired
    else this.earPaired = this.earConnect !== 0
    if (typeof p.recording === 'boolean') this.recording = p.recording
  }

  // ------------------------------------------------------------------------------------- pushes

  attach(inject: (p: Uint8Array) => void): () => void {
    this.inject = inject
    if (this.pushes && this.pushIntervalMs > 0) this.timer = setInterval(() => this.pushStatus(), this.pushIntervalMs)
    return () => {
      this.inject = null
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }

  /** The BOX's status pushes, one single-item frame each (A parseNotifyResult single-item branches) [?] type 0. */
  pushFrames(): Uint8Array[] {
    if (!this.pushes) return []
    const m = this.mics
    const src = { source: MOMA_ID.BOX }
    this.pushCount++
    return [
      encodeMomaReply(this.profile, [momaNotify(MAX2_CMD.BOX_BATTERY, [this.box.battery])], src),
      encodeMomaReply(this.profile, [momaNotify(MAX2_CMD.RX_BATTERY, [this.rx.battery])], src),
      encodeMomaReply(this.profile, [momaNotify(MAX2_CMD.MIC_BATTERY, [m[0].online ? 1 : 0, m[0].battery, m[1].online ? 1 : 0, m[1].battery])], src),
    ]
  }

  /** Inject the pushes now (tests: a TX goes offline, a battery changes). */
  pushStatus(): void {
    if (!this.inject) return
    for (const p of this.deliver(this.pushFrames())) this.inject(p)
  }

  // -------------------------------------------------------------------------------------- replies

  respond(packet: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = []
    for (const f of this.reader.push(packet)) {
      this.requests.push({ target: f.target, items: f.items })
      const first = !this.contacted
      this.contacted = true
      const items = f.items.flatMap((it) => this.handle(it.cmd, it.payload, f.target))
      if (items.length) out.push(encodeMomaReply(this.profile, items, { source: this.sourceFor(f.target) }))
      if (first) out.push(...this.pushFrames())
    }
    return this.deliver(out)
  }

  private deliver(packets: Uint8Array[]): Uint8Array[] {
    const chunk = this.faults.chunkSize ?? (this.link === 'ble' ? Math.max(1, this.mtu - 3) : undefined)
    return applyMomaFaults(packets, { ...this.faults, chunkSize: chunk })
  }

  /** Reply source byte [?]: the RX's own id over USB, the addressed unit through the BOX ("get all" over USB: 0 → RX). */
  private sourceFor(target: number): number {
    if (this.link === 'usb') return this.profile.target
    return target
  }

  private version(u: Max2VersionUnit, unitByte: number): MomaItemInput[] {
    const s = u === 'rx' ? this.rx : u === 'box' ? this.box : this.mics[Number(u.slice(2)) - 1]
    const online = u === 'rx' ? true : s.online
    const p = online
      ? encodeMax2Version({ unitByte, online, serial: s.serial, version: s.version, battery: s.battery, hardwareVersion: s.hardwareVersion, charging: s.charging })
      : encodeMax2Version({ unitByte, online: false, serial: '', version: '', battery: 0, hardwareVersion: '', charging: false })
    return [momaData(MAX2_CMD.DEVICE_VERSION, p)]
  }

  heartbeatPayload(): Uint8Array {
    const m = this.mics
    return encodeMax2Heartbeat({
      length: this.heartbeatLength,
      rxBattery: this.rx.battery, boxBattery: this.box.battery,
      mics: m.map((x) => ({ battery: x.battery, charging: x.charging, online: x.online, gain: x.gain, remainRecordTime: x.remainRecordTime })),
      speaker: this.speaker, sampleDepth: this.sampleDepth, micLock: this.micLock, noiseOn: this.ncOn, noiseDepth: this.ncDepth,
      gainType: this.gainType, gainLevel: this.gainLevel, channelMode: this.channel, isCamera: this.rx.isCamera, recording: this.recording,
      tcMode: this.tcMode, inputFps: this.fps, timingMode: this.timing, earL: this.earL, earR: this.earR, earConnect: this.earConnect,
      txIdentify: this.txIdentify, tcEnabled: this.tcEnabled, resetTiming: this.resetTiming,
      extended: this.heartbeatLength > MAX2_HEARTBEAT_BASE_LENGTH
        ? { wireless: this.wireless ? 1 : 0, tcTime: { min: this.tcTime.min, sec: this.tcTime.sec, frame: this.tcTime.frame }, fourMic: this.fourMic, earMonitor: this.earMonitor }
        : undefined,
    })
  }

  private gainPayload(): number[] {
    const g = this.mics.slice(0, this.fourMic ? 4 : 2).map((m) => m.gain)
    return [this.gainType, this.gainLevel, ...g]
  }

  private handle(cmd: number, p: Uint8Array, target: number): MomaItemInput[] {
    const ble = this.link === 'ble'
    if (this.silent.has(cmd)) return []
    // Through the BOX, frames to a TX target reach that mic (only the NC fan-out uses them).
    if (ble && target in TX_TARGETS) {
      const mic = this.mics[TX_TARGETS[target]]
      if (!mic.online) return []
      if (cmd !== MAX2_CMD.NOISE_LEVEL) return []
      if (!p.length) return [momaData(cmd, [this.ncOn ? 1 : 0, this.ncDepth])]
      this.noiseTargets.push(target)
      return [momaAck(cmd)]
    }
    const get = p.length === 0 && cmd !== MAX2_CMD.MOBILE_RX_PAIR
    const b0 = p[0] ?? 0
    const ack = (apply: () => void): MomaItemInput[] => {
      apply()
      return [momaAck(cmd)]
    }
    switch (cmd) {
      case MAX2_CMD.HEART_INFO:
        if (ble && !this.forwardHeartbeat) return []
        return [momaData(cmd, this.heartbeatPayload())]
      case MAX2_CMD.DEVICE_VERSION: {
        const u = MAX2_VERSION_UNIT_OF[b0]
        return u ? this.version(u, b0) : []
      }
      case MAX2_CMD.RX_OUTSWITCH:
        return get ? [momaData(cmd, [this.speaker ? 1 : 0])] : ack(() => ((this.speaker = b0 === 1), this.restarts++))
      case MAX2_CMD.RX_SAMPLING:
        return get ? [momaData(cmd, [this.sampleDepth])] : ack(() => (this.sampleDepth = b0))
      case MAX2_CMD.MIC_LOCK:
        return get ? [momaData(cmd, [this.micLock ? 1 : 0])] : ack(() => (this.micLock = b0 === 1))
      case MAX2_CMD.NOISE_LEVEL:
        if (get) return [momaData(cmd, [this.ncOn ? 1 : 0, this.ncDepth])]
        this.noiseTargets.push(target)
        return ack(() => ((this.ncOn = b0 === 1), (this.ncDepth = p[1] ?? this.ncDepth)))
      case MAX2_CMD.VOICE_GAIN:
        if (get) return [momaData(cmd, this.gainPayload())]
        return ack(() => {
          this.gainType = b0
          this.gainLevel = p[1] ?? this.gainLevel
          for (let i = 2; i < p.length && i < 6; i++) this.mics[i - 2].gain = p[i]
        })
      case MAX2_CMD.VOCAL_TRACT:
        return get ? [momaData(cmd, [this.channel])] : ack(() => (this.channel = b0))
      case MAX2_CMD.SYSTEM_TIME:
        return ack(() => (this.systemTime = Array.from(p)))
      case MAX2_CMD.TC_MODE:
        return get ? [momaData(cmd, [this.tcMode])] : ack(() => (this.tcMode = b0))
      case MAX2_CMD.INPUT_FPS:
        return get ? [momaData(cmd, [this.fps])] : ack(() => (this.fps = b0))
      case MAX2_CMD.TIMING_MODE:
        return get ? [momaData(cmd, [this.timing])] : ack(() => (this.timing = b0))
      case MAX2_CMD.TX_IDENTIFY:
        return get ? [momaData(cmd, [this.txIdentify ? 1 : 0])] : ack(() => (this.txIdentify = b0 === 1))
      case MAX2_CMD.START_ZERO_TIMING:
        return [momaData(cmd, [this.tcTime.hour, this.tcTime.min, this.tcTime.sec, this.tcTime.frame])]
      case MAX2_CMD.TC_SWITCH:
        return get ? [momaData(cmd, [this.tcEnabled ? 1 : 0])] : ack(() => (this.tcEnabled = b0 === 1))
      case MAX2_CMD.SWITCH_MIC_QUANTITY:
        return get ? [momaData(cmd, [this.fourMic ? 1 : 0])] : ack(() => (this.fourMic = b0 === 1))
      case MAX2_CMD.EARPHONE_PAIR:
        return get ? [momaData(cmd, [this.earPaired ? 1 : 0])] : ack(() => (this.earPaired = b0 === 0))
      case MAX2_CMD.EARPHONE_MONITOR:
        return get ? [momaData(cmd, [this.earMonitor])] : ack(() => (this.earMonitor = b0))
      case MAX2_CMD.EARPHONE_VOLUME:
        return get ? [momaData(cmd, [this.earVolume])] : ack(() => (this.earVolume = b0))
      case MAX2_CMD.WIRELESS_STATUS:
        return get ? [momaData(cmd, [this.wireless ? 1 : 0])] : ack(() => ((this.wireless = b0 === 1), this.restarts++))
      case MAX2_CMD.RECORD_NOISE_STATUS:
        return get ? [momaData(cmd, [this.recordNoise])] : ack(() => (this.recordNoise = b0))
      case MAX2_CMD.MOBILE_RX_PAIR:
        return [momaAck(cmd)]
      case MAX2_CMD.UAC_OUT_MODE_SET:
        return ack(() => (this.uacMode = b0))
      case MAX2_CMD.UAC_OUT_MODE_GET:
        return [momaData(cmd, [this.uacMode])]
      default:
        // Unknown, push-only, destructive and OTA ids: no reply (the library never sends the latter).
        return []
    }
  }
}
