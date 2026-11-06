/**
 * MELO P1 receiver simulator (FAMILIES.md §3.8 row 6201: "VU push timer after 0x6048, batch replies, XOR on/off
 * by control byte"). Answers the commands the driver sends with the layouts of status.ts. What the real receiver
 * puts in reply headers is not known [?] (melo-6201.md §3.2, §10 #3); the simulator follows the doc's
 * illustrative replies: source 1 (phone RX), target 6 (app), item type 3 for data, 2 for set acks, 0 for pushes,
 * and the control byte of the request (so an iOS-style request without checksum gets a reply without one).
 *
 * Options (SimOptions):
 *  - rxVersion       RX master firmware (default 4.0.1.2: V2 structures, per-mic gain)
 *  - online          units present (default: rx, tx1, tx2, box, earL, earR, remote)
 *  - dropReplies / duplicateReplies / chunkSize   shared faults (pushes too)
 *  - params.jack           'input' (default, something plugged in) | 'output' | 'empty'
 *  - params.ncOn           NC on at start (default true)
 *  - params.splitBatch     answer a multi-item request with one frame per item (default: one frame with all)
 *  - params.replyControl   force the reply control byte (e.g. 0x00: no XOR even for Android requests)
 *  - params.bgm            BGM source connected (heartbeat byte 12, default true)
 */
import { UnsupportedError } from '../../device-errors'
import { i32 } from '../../core/bytes'
import type { DeviceSimulator, SimFaults, SimOptions, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import type { TransportCapabilities, TransportDeviceInfo } from '../../transport'
import { MOMA_TYPE, type MomaFrame, type MomaItemInput } from '../../moma/codec'
import { MOMA_6201_USB } from '../../moma/profiles'
import { applyMomaFaults, encodeMomaReply, momaAck, momaData, MomaRequestReader } from '../../moma/sim'
import { MELO_CMD, MELO_DEVICE_TYPE } from './commands'
import { MELO_RX_PRODUCT_IDS } from './products'
import {
  encodeMeloAllLevels, encodeMeloBitDepths, encodeMeloDeviceInfo, encodeMeloHeartbeat, encodeMeloI32, encodeMeloLed, encodeMeloStreamIn,
  encodeMeloStreamOut, encodeMeloTxGains, encodeMeloNoiseGate, parseMeloBitDepths, parseMeloNoiseGate, parseMeloStreamIn, parseMeloStreamOut,
  parseMeloTxGains, type MeloInputLevels, type MeloNoiseGate, type MeloOutputLevels, type MeloStreamIn, type MeloStreamOut,
} from './status'

export const MELO_SIM_DEFAULT_RX_VERSION = '4.0.1.2'

const DEFAULT_ONLINE: readonly UnitId[] = ['rx', 'tx1', 'tx2', 'box', 'earL', 'earR', 'remote']

interface SimUnit {
  online: boolean
  battery: number
  charging: boolean
  version: string
  serial: string
}

export interface MeloSubscription {
  cmds: number[]
  intervalMs: number
}

export class MeloSimulator implements DeviceSimulator {
  readonly info: TransportDeviceInfo
  readonly capabilities: TransportCapabilities = { receive: 'yes', link: 'mock' }
  faults: SimFaults
  rxVersion: string
  readonly units: Record<'rx' | 'tx1' | 'tx2' | 'box' | 'earL' | 'earR' | 'remote', SimUnit>
  jack: 'input' | 'output' | 'empty'
  bgm: boolean
  rcLowBattery = false
  ncOn: boolean
  ncLevel = 15
  micGainPreset = 26
  txGains: [number, number] = [26, 23]
  bitDepths = { tx1: 0, tx2: 0, rxMaster: 1, rxSlave: 0 }
  autoSpeaker = false
  workMode = 1
  streamIn: MeloStreamIn = { vol: [12, 10, 12, 8, 6], mute: [0, 0, 0, 0, 0], solo: [0, 0, 0, 0, 0] }
  streamOut: MeloStreamOut = { owsVol: 20, owsMute: 0, conn35OutVol: 20, conn35OutMute: 0, uacUpstreamVol: 24, uacUpstreamMute: 0 }
  leds = [
    { on: true, device: 0, brightness: 2 },
    { on: true, device: 1, brightness: 1 },
    { on: false, device: 2, brightness: 1 },
  ]
  noiseGate: MeloNoiseGate = { paramChange: 0, enable: false, streamType: 2, algoIndex: 0, threshold: -70, attack: 5, release: 50, floor: -90 }
  vuSources = { inputs: false, outputs: false }
  subscription: MeloSubscription | null = null
  /** Disruptive commands received (bit depth, auto speaker): the real RX restarts [V], the simulator only counts. */
  restarts = 0
  splitBatch: boolean
  replyControl: number | undefined
  /** Every request frame decoded. */
  readonly requests: MomaFrame[] = []
  /** Pushes sent so far. */
  pushes = 0
  private readonly reader = new MomaRequestReader(MOMA_6201_USB)
  private inject: ((p: Uint8Array) => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private tick = 0
  /** Control / target byte of the last request (replies and pushes follow it). */
  private lastControl = 0x04

  constructor(product: ProductInfo, o: SimOptions = {}) {
    if (!MELO_RX_PRODUCT_IDS.includes(product.productId) || product.vendorId === 0) {
      throw new UnsupportedError(`the MELO P1 simulator models the receiver (1032 / 1033), not ${product.name}`)
    }
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: `${product.label ?? product.name} (simulated)` }
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    this.rxVersion = o.rxVersion ?? MELO_SIM_DEFAULT_RX_VERSION
    const online = new Set(o.online ?? DEFAULT_ONLINE)
    const unit = (id: UnitId, battery: number, version: string, serial: string): SimUnit => ({ online: online.has(id), battery, charging: false, version, serial })
    this.units = {
      rx: unit('rx', 80, this.rxVersion, 'MP1RX000001'),
      tx1: unit('tx1', 70, '1.0.2.6', 'MP1TX000011'),
      tx2: unit('tx2', 45, '1.0.2.6', 'MP1TX000012'),
      box: unit('box', 90, '1.0.0.9', 'MP1BX000001'),
      earL: unit('earL', 60, '1.1.0.3', 'MP1EP000001'),
      earR: unit('earR', 62, '1.1.0.3', 'MP1EP000002'),
      remote: unit('remote', 100, '1.0.0.4', 'MP1RC000001'),
    }
    this.units.rx.online = true
    this.units.tx2.charging = true
    const p = o.params ?? {}
    this.jack = p.jack === 'output' || p.jack === 'empty' ? p.jack : 'input'
    this.ncOn = p.ncOn !== false
    this.bgm = p.bgm !== false
    this.splitBatch = p.splitBatch === true
    this.replyControl = typeof p.replyControl === 'number' ? p.replyControl : undefined
  }

  // ------------------------------------------------------------------------------ pushes

  attach(inject: (p: Uint8Array) => void): () => void {
    this.inject = inject
    this.syncTimer()
    return () => {
      this.inject = null
      // The link is gone: the device stops pushing (a reconnect subscribes again).
      this.subscription = null
      this.syncTimer()
    }
  }

  /** The 0x11EB payload the next push carries: online sources move, absent ones sit at the floor. */
  levelsNow(): { inputs: MeloInputLevels; outputs: MeloOutputLevels } {
    const t = this.tick
    const wave = (phase: number, base: number) => Math.round(base + 6 * Math.sin((t + phase) / 3))
    const floor = -96
    const inputs: MeloInputLevels = {
      mic1: this.units.tx1.online && !this.streamIn.mute[0] ? wave(0, -24) : floor,
      mic2: this.units.tx2.online && !this.streamIn.mute[1] ? wave(2, -30) : floor,
      instrument: this.jack === 'input' && !this.streamIn.mute[2] ? wave(4, -28) : floor,
      bgmL: this.bgm && !this.streamIn.mute[3] ? wave(6, -20) : floor,
      bgmR: this.bgm && !this.streamIn.mute[3] ? wave(7, -21) : floor,
    }
    const mix = Math.max(inputs.mic1, inputs.mic2, inputs.instrument, inputs.bgmL)
    const out = (muted: number, offset: number) => (muted ? floor : Math.min(0, mix + offset))
    const outputs: MeloOutputLevels = {
      usbL: out(this.streamOut.uacUpstreamMute, 2), usbR: out(this.streamOut.uacUpstreamMute, 1),
      usb2L: floor, usb2R: floor,
      wiredL: this.jack === 'output' ? out(this.streamOut.conn35OutMute, 0) : floor,
      wiredR: this.jack === 'output' ? out(this.streamOut.conn35OutMute, 0) : floor,
      wirelessL: this.units.earL.online ? out(this.streamOut.owsMute, -1) : floor,
      wirelessR: this.units.earR.online ? out(this.streamOut.owsMute, -1) : floor,
    }
    return { inputs, outputs }
  }

  /** Send one push of every subscribed command now (tests; the timer calls it every intervalMs). */
  push(): void {
    const sub = this.subscription
    if (!sub || !this.inject) return
    this.tick++
    const items: MomaItemInput[] = []
    for (const cmd of sub.cmds) {
      const payload = this.dataFor(cmd, new Uint8Array(0))
      // Push item type: 0 (notify) [I]; neither app looks at it (melo-6201.md §3.2).
      if (payload) items.push({ cmd, type: MOMA_TYPE.NOTIFY, payload })
    }
    if (!items.length) return
    const frame = encodeMomaReply(MOMA_6201_USB, items, { source: 1, control: this.replyControl ?? this.lastControl })
    this.pushes++
    for (const p of applyMomaFaults([frame], this.faults)) this.inject?.(p)
  }

  private syncTimer(): void {
    const want = this.inject && this.subscription ? this.subscription.intervalMs : null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (want !== null) {
      this.timer = setInterval(() => this.push(), want)
      ;(this.timer as { unref?: () => void }).unref?.()
    }
  }

  // --------------------------------------------------------------------------- requests

  respond(packet: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = []
    for (const f of this.reader.push(packet)) {
      this.requests.push(f)
      this.lastControl = f.control
      const items = f.items.flatMap((it) => this.handle(it.cmd, it.payload))
      if (!items.length) continue
      const control = this.replyControl ?? f.control
      const groups = this.splitBatch ? items.map((i) => [i]) : [items]
      for (const g of groups) out.push(encodeMomaReply(MOMA_6201_USB, g, { source: 1, control }))
    }
    return applyMomaFaults(out, this.faults)
  }

  heartbeatPayload(): Uint8Array {
    const u = this.units
    const earState = (u.earL.online ? 1 : 0) | (u.earR.online ? 2 : 0)
    return encodeMeloHeartbeat({
      rxPower: u.rx.battery, boxPower: u.box.online ? u.box.battery : 0,
      mic1Power: u.tx1.online ? u.tx1.battery : 0, mic2Power: u.tx2.online ? u.tx2.battery : 0,
      mic1Charge: u.tx1.online && u.tx1.charging, mic2Charge: u.tx2.online && u.tx2.charging,
      mic1Online: u.tx1.online, mic2Online: u.tx2.online,
      mic1SamDepth: this.bitDepths.tx1, mic2SamDepth: this.bitDepths.tx2,
      conn35Online: this.jack !== 'empty', conn35DirOut: this.jack === 'output', owsOnline: this.bgm, rxOutSwitch: this.autoSpeaker,
      rxSamDepth: this.bitDepths.rxMaster, rxMicLock: 0, rxNoiseSwitch: this.ncOn, rxNoiseMode: this.ncLevel,
      rxGainSwitch: false, rxGainMode: 0, rxGainL: 0, rxGainR: 0,
      earLPower: u.earL.online ? u.earL.battery : 0, earLCharge: false, earRPower: u.earR.online ? u.earR.battery : 0, earRCharge: false,
      earConnectState: earState, micTypeRaw: 0, musicStyle2Evt: 0, rcConnState: u.remote.online, rcIsLowVabt: u.remote.online && this.rcLowBattery,
    })
  }

  private unitOfType(type: number): SimUnit | null {
    switch (type) {
      case MELO_DEVICE_TYPE.SOUND_CARD_MASTER: return this.units.rx
      case MELO_DEVICE_TYPE.REMOTE_CONTROL: return this.units.remote
      case MELO_DEVICE_TYPE.EP1: return this.units.earL
      case MELO_DEVICE_TYPE.EP2: return this.units.earR
      case MELO_DEVICE_TYPE.TX1: return this.units.tx1
      case MELO_DEVICE_TYPE.TX2: return this.units.tx2
      case MELO_DEVICE_TYPE.BOX: return this.units.box
      default: return null // SOUND_CARD_SLAVE: no second RX in the simulated kit
    }
  }

  /** GET payloads (also used for pushes). */
  private dataFor(cmd: number, p: Uint8Array): Uint8Array | null {
    switch (cmd) {
      case MELO_CMD.HEARTBEAT: return this.heartbeatPayload()
      case MELO_CMD.DEVICE_INFO: {
        const type = p[0] ?? 0
        const u = this.unitOfType(type)
        if (!u || !u.online) return null
        const version = u === this.units.rx ? this.rxVersion : u.version
        return encodeMeloDeviceInfo({ deviceType: type, serial: u.serial, swVersion: version, hwVersion: '1.0.0.0' })
      }
      case MELO_CMD.NC_GET: return Uint8Array.of(this.ncOn ? 1 : 0, this.ncLevel)
      case MELO_CMD.NOISE_GATE_GET: return encodeMeloNoiseGate(this.noiseGate)
      case MELO_CMD.MIC_GAIN_GET: return encodeMeloI32(this.micGainPreset)
      case MELO_CMD.TX_GAIN_GET: return encodeMeloTxGains(...this.txGains)
      case MELO_CMD.BIT_DEPTH_GET: return encodeMeloBitDepths(this.bitDepths)
      case MELO_CMD.AUTO_SPEAKER_GET: return encodeMeloI32(this.autoSpeaker ? 1 : 0)
      case MELO_CMD.JACK_DIR_GET: return encodeMeloI32(this.jack === 'output' ? 1 : 0)
      case MELO_CMD.WORK_MODE_GET: return encodeMeloI32(this.workMode)
      case MELO_CMD.STREAM_IN_GET: return encodeMeloStreamIn(this.streamIn)
      case MELO_CMD.STREAM_OUT_GET: return encodeMeloStreamOut(this.streamOut)
      case MELO_CMD.LED_GET: return Uint8Array.from(this.leds.flatMap((l) => [...encodeMeloLed(l)]))
      case MELO_CMD.VU_ALL_GET: {
        if (!this.vuSources.inputs && !this.vuSources.outputs) return null
        const l = this.levelsNow()
        return encodeMeloAllLevels(l.inputs, l.outputs)
      }
      default: return null
    }
  }

  private handle(cmd: number, p: Uint8Array): MomaItemInput[] {
    const data = this.dataFor(cmd, p)
    if (data) return [momaData(cmd, data)]
    const ack = (ok = true) => [momaAck(cmd, ok ? 0 : 1)]
    switch (cmd) {
      case MELO_CMD.NC_SET:
        if (p.length < 2) return ack(false)
        this.ncOn = p[0] === 1
        this.ncLevel = p[1]
        return ack()
      case MELO_CMD.NOISE_GATE_SET: {
        const g = parseMeloNoiseGate(p)
        if (!g) return ack(false)
        this.noiseGate = g
        return ack()
      }
      case MELO_CMD.MIC_GAIN_SET: {
        const v = i32(p, 0)
        if (v === undefined) return ack(false)
        this.micGainPreset = v
        return ack()
      }
      case MELO_CMD.TX_GAIN_SET: {
        const g = parseMeloTxGains(p)
        if (!g) return ack(false)
        this.txGains = g
        return ack()
      }
      case MELO_CMD.BIT_DEPTH_SET: {
        const b = parseMeloBitDepths(p)
        if (!b) return ack(false)
        this.bitDepths = b
        this.restarts++
        return ack()
      }
      case MELO_CMD.AUTO_SPEAKER_SET: {
        const v = i32(p, 0)
        if (v === undefined) return ack(false)
        this.autoSpeaker = v === 1
        this.restarts++
        return ack()
      }
      case MELO_CMD.JACK_DIR_SET: {
        const v = i32(p, 0)
        if (v === undefined || this.jack === 'empty') return ack(false)
        this.jack = v === 1 ? 'output' : 'input'
        return ack()
      }
      case MELO_CMD.WORK_MODE_SET: {
        const v = i32(p, 0)
        if (v === undefined || v < 0 || v > 2) return ack(false)
        this.workMode = v
        return ack()
      }
      case MELO_CMD.STREAM_IN_SET: {
        const s = parseMeloStreamIn(p)
        if (!s) return ack(false)
        this.streamIn = s
        return ack()
      }
      case MELO_CMD.STREAM_OUT_SET: {
        const s = parseMeloStreamOut(p)
        if (!s) return ack(false)
        this.streamOut = s
        return ack()
      }
      case MELO_CMD.LED_SET: {
        if (p.length < 3) return ack(false)
        const l = this.leds.find((x) => x.device === p[1])
        if (!l) return ack(false)
        l.on = p[0] !== 0
        l.brightness = p[2]
        return ack()
      }
      case MELO_CMD.VU_SOURCE_SET:
        if (p.length < 2) return ack(false)
        this.vuSources = { inputs: p[0] === 1, outputs: p[1] === 1 }
        return ack()
      case MELO_CMD.NOTIFY_START: {
        const n = p[0] ?? 0
        if (!n || p.length < 1 + n * 4) return ack(false)
        const cmds: number[] = []
        let interval = 100
        for (let i = 0; i < n; i++) {
          cmds.push(p[1 + i * 4] | (p[2 + i * 4] << 8))
          interval = p[3 + i * 4] | (p[4 + i * 4] << 8)
        }
        this.subscription = { cmds, intervalMs: Math.max(1, interval) }
        this.syncTimer()
        return ack()
      }
      case MELO_CMD.NOTIFY_STOP:
        this.subscription = null
        this.syncTimer()
        return ack()
      default:
        // Unknown and uncatalogued ids, destructive / OTA ids: no reply (the engine never sends the latter).
        return []
    }
  }

  // ----------------------------------------------------------------------- test helpers

  /** A device-side change pushed as an unsolicited GET reply (the mixer page handles a "PUSH" of 0x1309). */
  pushGetReply(cmd: number): void {
    const data = this.dataFor(cmd, new Uint8Array(0))
    if (!data || !this.inject) return
    for (const p of applyMomaFaults([encodeMomaReply(MOMA_6201_USB, [momaData(cmd, data)], { source: 1, control: this.replyControl ?? this.lastControl })], this.faults)) {
      this.inject(p)
    }
  }

  setOnline(unit: keyof MeloSimulator['units'], online: boolean): void {
    this.units[unit].online = unit === 'rx' ? true : online
  }
}
