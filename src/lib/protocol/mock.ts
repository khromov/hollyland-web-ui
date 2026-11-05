/**
 * In-memory transport + device simulator. Used by the unit tests and useful for UI
 * development without hardware (or on macOS, where the OS drops the real replies).
 *
 * The simulator implements the documented behaviour of the 6118 / 6301 / 6302 firmware
 * (PROTOCOL.md §6–§8). It is a model, not a capture: values are plausible, not real.
 */
import { decodeFrame, HEADER_SIZE, MAGIC1, PACKET_SIZE, RESPONSE_MAGIC0, Target, type DecodedFrame } from './codec'
import { Cmd, type Family } from './commands'
import { BaseTransport, TransportError, type TransportCapabilities, type TransportDeviceInfo } from './transport'

export interface MockTransportOptions {
  info?: TransportDeviceInfo
  /** Called for every packet sent by the host; return reply packets (or nothing). */
  respond?: (packet: Uint8Array) => Uint8Array[] | Uint8Array | void | Promise<Uint8Array[] | Uint8Array | void>
  /** Reply latency in ms (default 0 = next microtask). */
  latencyMs?: number
  capabilities?: TransportCapabilities
}

export class MockTransport extends BaseTransport {
  readonly kind = 'mock'
  info: TransportDeviceInfo | null
  capabilities: TransportCapabilities
  respond: MockTransportOptions['respond']
  latencyMs: number
  /** Every packet the host sent. */
  readonly sent: Uint8Array[] = []
  private open_ = false

  constructor(o: MockTransportOptions = {}) {
    super()
    this.info = o.info ?? { vendorId: 0x3547, productId: 1041, productName: 'Wireless Microphone (mock)' }
    this.respond = o.respond
    this.latencyMs = o.latencyMs ?? 0
    this.capabilities = o.capabilities ?? { receive: 'yes' }
  }

  get isOpen(): boolean {
    return this.open_
  }

  async open(): Promise<void> {
    this.open_ = true
  }

  async close(): Promise<void> {
    this.open_ = false
  }

  async send(packet: Uint8Array): Promise<void> {
    if (!this.open_) throw new TransportError('mock transport is closed')
    this.sent.push(packet.slice())
    const r = await this.respond?.(packet)
    const list = r === undefined ? [] : r instanceof Uint8Array ? [r] : r
    for (const p of list) {
      if (this.latencyMs > 0) setTimeout(() => this.emitPacket(p), this.latencyMs)
      else queueMicrotask(() => this.emitPacket(p))
    }
  }

  /** Push a device -> host packet (e.g. to simulate an unsolicited report). */
  inject(packet: Uint8Array): void {
    this.emitPacket(packet)
  }

  /** Simulate an unplug. */
  unplug(reason?: Error): void {
    this.open_ = false
    this.emitDisconnect(reason)
  }
}

/** Build a device reply packet: BB DD cmd src lenHi lenLo payload, zero padded to 64. */
export function encodeResponse(cmd: number, source: Target, payload: ArrayLike<number> = [], pad = true): Uint8Array {
  const out = new Uint8Array(pad ? PACKET_SIZE : HEADER_SIZE + payload.length)
  out[0] = RESPONSE_MAGIC0
  out[1] = MAGIC1
  out[2] = cmd
  out[3] = 0x80 | source
  out[4] = (payload.length >> 8) & 0xff
  out[5] = payload.length & 0xff
  for (let i = 0; i < payload.length; i++) out[HEADER_SIZE + i] = payload[i]
  return out
}

export interface SimTx {
  online: boolean
  battery: number
  muted: boolean
  charging: boolean
  version: number[]
  serial: string
}

export interface SimulatorOptions {
  family?: Family
  camera?: boolean
  /** Send each reply twice (the live A2 produces 2 IN reports per request). */
  duplicateReplies?: boolean
  /** Drop every reply (models macOS/Windows HID filtering). */
  dropReplies?: boolean
}

/** A behavioural model of the receiver firmware. */
export class SimulatedReceiver {
  family: Family
  camera: boolean
  duplicateReplies: boolean
  dropReplies: boolean
  readonly log: DecodedFrame[] = []
  /** 6 bytes for 0x41 on the 6118; M2/M2S answer 0x03 with the first 4 (default "2.0.0.32"). */
  rxVersion = [1, 0, 0, 0, 1, 5]
  rxSerial = 'SIMRX0000001'
  tx: [SimTx, SimTx] = [
    { online: true, battery: 85, muted: false, charging: false, version: [1, 0, 0, 0, 1, 2], serial: 'SIMTX1000001' },
    { online: true, battery: 60, muted: false, charging: true, version: [1, 0, 0, 0, 1, 2], serial: 'SIMTX2000002' },
  ]
  /** Reply to 0x34 on 6301 with the new lock state instead of an ack (the iOS reading). */
  voiceLockReplyIsState = false
  noiseEnabled = true
  noiseLevel = 2
  volume = 3
  channelMode = 1
  autoPowerOff = true
  ledOn = true
  preset = { enabled: false, preset: 0 }
  micRecognition = false
  smartBattery = true
  speakerOn = false
  voiceLocked = false
  buttons = [0x21, 0x31]
  buttonColors = [1, 2]
  rxCamBattery = 77
  rxCamCharging = false

  constructor(o: SimulatorOptions = {}) {
    this.family = o.family ?? '6118'
    this.camera = o.camera ?? false
    if (this.family !== '6118') {
      this.rxVersion = [2, 0, 0, 32, 0, 0]
      for (const t of this.tx) t.version = [2, 0, 0, 20, 0, 0]
    }
    this.duplicateReplies = o.duplicateReplies ?? false
    this.dropReplies = o.dropReplies ?? false
  }

  /** Bind as MockTransport.respond. */
  readonly respond = (packet: Uint8Array): Uint8Array[] => {
    const f = decodeFrame(packet)
    if (!f || f.direction !== 'request') return []
    this.log.push(f)
    const reply = this.handle(f)
    if (!reply || this.dropReplies) return []
    return this.duplicateReplies ? [reply, reply.slice()] : [reply]
  }

  heartbeatPayload(): number[] {
    const [t1, t2] = this.tx
    if (this.family === '6118') {
      const flags = (t1.muted ? 1 : 0) | (t2.muted ? 2 : 0) | (t1.charging ? 4 : 0) | (t2.charging ? 8 : 0) | (this.rxCamCharging ? 16 : 0)
      return [
        t1.online ? 1 : 0, t2.online ? 1 : 0, t1.battery, t2.battery, 0, 0,
        this.noiseEnabled ? this.noiseLevel : 0, this.volume, 0, this.channelMode, this.autoPowerOff ? 0 : 1,
        0, 0, this.ledOn ? 0 : 1, (this.preset.preset << 1) | (this.preset.enabled ? 1 : 0), flags,
        // The live A2 (mobile RX) sends 16 bytes; body[16] is the camera-RX battery.
        ...(this.camera ? [this.rxCamBattery] : []),
      ]
    }
    return [
      t1.online ? 1 : 0, t2.online ? 1 : 0, t1.battery, t2.battery, 0, 0,
      this.noiseEnabled ? this.noiseLevel : 0, this.volume, this.voiceLocked ? 1 : 0, this.channelMode, this.autoPowerOff ? 0 : 1,
      this.buttons[0], this.buttons[1], this.ledOn ? 0 : 1,
    ]
  }

  private unit(t: Target): { version: number[]; serial: string; online: boolean } {
    if (t === Target.RX) return { version: this.rxVersion, serial: this.rxSerial, online: true }
    return this.tx[t - 1]
  }

  private handle(f: DecodedFrame): Uint8Array | null {
    const ack = (ok = true) => encodeResponse(f.cmd, Target.RX, [ok ? 1 : 0])
    const p = f.payload
    const u = this.unit(f.target)
    if (f.target !== Target.RX && !u.online) return null // offline TX: no answer
    switch (f.cmd) {
      case Cmd.HEARTBEAT:
        return encodeResponse(f.cmd, Target.RX, this.heartbeatPayload())
      case Cmd.VERSION_GET:
        if (this.family !== '6118') return null
        return encodeResponse(f.cmd, f.target, u.version)
      case Cmd.VERSION_LEGACY_GET:
        return encodeResponse(f.cmd, f.target, this.family === '6118' ? u.version.slice(0, 4) : u.version.slice(0, 4))
      case Cmd.SERIAL_GET:
        return encodeResponse(f.cmd, f.target, Array.from(u.serial, (ch) => ch.charCodeAt(0)))
      case Cmd.DEVICE_INFO_GET:
        // live A2: LEN 9 `00 00 00 06 01 01 5b 5c 00` (PROTOCOL.md §11.6); byte 0 = 2 on a camera RX
        return encodeResponse(f.cmd, Target.RX, [this.camera ? 2 : 0, 0, 0, 6, 1, 1, 0x5b, 0x5c, 0])
      case Cmd.DEVICE_ID_GET:
        return encodeResponse(f.cmd, f.target, [0x10 + f.target])
      case Cmd.NOISE_LEVEL_GET:
        return encodeResponse(f.cmd, Target.RX, [
          this.family === '6118' ? (this.noiseEnabled ? 0x80 : 0) | this.noiseLevel : this.noiseEnabled ? this.noiseLevel : 0,
        ])
      case Cmd.NOISE_LEVEL_SET:
        this.noiseLevel = p[0] ?? this.noiseLevel
        if (this.noiseLevel > 0) this.noiseEnabled = true
        return this.family === '6118' ? ack() : encodeResponse(f.cmd, Target.RX, [1, this.noiseLevel])
      case Cmd.NOISE_TOGGLE:
        this.noiseEnabled = !this.noiseEnabled
        return ack()
      case Cmd.VOLUME_GET:
        return encodeResponse(f.cmd, Target.RX, [this.volume])
      case Cmd.VOLUME_SET:
        this.volume = p[0] ?? this.volume
        return ack()
      case Cmd.CHANNEL_MODE_SET:
        this.channelMode = p[0] ?? this.channelMode
        return ack()
      case Cmd.VOICE_PRESET_SET:
        this.preset = { enabled: p[0] === 1, preset: p[1] ?? 0 }
        return ack()
      case Cmd.LED_SET:
        this.ledOn = p[0] === 0
        return ack()
      case Cmd.MIC_RECOGNITION_SET:
        this.micRecognition = p[0] === 1
        return ack()
      case Cmd.MIC_RECOGNITION_GET:
        return encodeResponse(f.cmd, Target.RX, [this.micRecognition ? 1 : 0])
      case Cmd.SMART_BATTERY_SET:
        this.smartBattery = p[0] === 1
        return ack()
      case Cmd.SMART_BATTERY_GET:
        return encodeResponse(f.cmd, Target.RX, [this.smartBattery ? 1 : 0])
      case Cmd.SPEAKER_SET:
        this.speakerOn = p[0] === 0
        return ack()
      case Cmd.SPEAKER_GET:
        return encodeResponse(f.cmd, Target.RX, [this.speakerOn ? 0 : 1])
      case Cmd.AUTO_OFF_SET:
        this.autoPowerOff = p[0] === 0
        return ack()
      case Cmd.VOICE_LOCK_SET:
        this.voiceLocked = p[0] === 1
        if (this.family === '6301' && this.voiceLockReplyIsState) return encodeResponse(f.cmd, Target.RX, [this.voiceLocked ? 1 : 0])
        return ack()
      case Cmd.VOICE_LOCK_GET:
        return encodeResponse(f.cmd, Target.RX, [this.voiceLocked ? 1 : 0])
      case Cmd.BUTTON_CUSTOM_SET:
        // slot 0 = colour-only update (CustomFunctionActivity.sendColor)
        if ((p[0] ?? 0) >= 1) this.buttons[(p[0] ?? 1) - 1] = ((p[1] ?? 0) << 4) | (p[2] ?? 0)
        if (p[3] || p[4]) this.buttonColors = [p[3] ?? 0, p[4] ?? 0]
        return ack()
      case Cmd.BUTTON_COLORS_GET:
        return encodeResponse(f.cmd, Target.RX, this.buttonColors)
      case Cmd.REMOVE_PAIRING:
        this.tx[(p[0] ?? 1) - 1].online = false
        return ack()
      case Cmd.FACTORY_RESET:
        return ack()
      case Cmd.RESTART_RX:
        return null
      default:
        return null
    }
  }
}
