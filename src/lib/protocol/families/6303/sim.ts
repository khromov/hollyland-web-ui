/**
 * Simulated LARK M3 receiver (FAMILIES.md §3.8 row 6303: multi-RX topology, isRefreshCanto, 64 / 512 padding,
 * unsolicited Bluetooth events). It speaks the MOMA_6303 framing: report id 8, BB DD replies padded like requests
 * (moma/sim.ts encodeMomaReply). Reply envelope bytes the real RX sends are unverified [?]: source = 1 (phone RX) or
 * 2 (camera RX), target 6 (app), item type 3 for data and 2 for set acks (m3-6303.md §3.3 illustrative replies).
 *
 * Device behaviour the apps imply, modelled here:
 *  - global settings are refused (ack 1) on a secondary RX [?]; the apps never send them there
 *  - NC set without an online TX fails (ack 1): A EquipmentViewModel SetNoiseStatusResponse !isSuc → SetSwitchFail
 *    ("Setup failed. Please connect the tx and try again")
 *  - 4-track, bit depth, playback without unplugging and work mode "restart" the receiver (counted in `restarts`)
 *  - 0x6015 clears the heartbeat's isRefreshCanto flag; `markVoiceProfilesChanged()` sets it
 *  - `pushBluetoothEvent()` injects the wireless-monitoring events (type 0 notify items)
 *
 * SimOptions.profile: 'secondary' (two RXs, this one secondary), 'multi-rx' (three RXs, this one primary), '2t2r'
 * (wireless monitoring: 2TX&2RX), 'refresh' (isRefreshCanto set). SimOptions.online: TX units and the other RX slots
 * (rx2..rx4 in slot order, status.ts m3RxSlots). SimOptions.params: currentRx, mainRx (0–3), rxSlots (indices online).
 */
import type { DeviceSimulator, SimFaults, SimOptions, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_ID, type MomaItemInput } from '../../moma/codec'
import { MOMA_6303 } from '../../moma/profiles'
import { applyMomaFaults, encodeMomaReply, momaAck, momaData, momaNotify, MomaRequestReader } from '../../moma/sim'
import type { MomaRequest } from '../../moma/spec'
import { M3Cmd, M3_DEVICE_ID, M3_SOUND_MODE, M3_SYSTEM, M3_TX_UNITS } from './commands'
import { isM3CameraRx } from './products'
import { encodeM3Heartbeat, m3RxSlots } from './status'

export interface M3SimUnit {
  online: boolean
  /** Percent; −1 = no battery (phone RX). */
  battery: number
  serial: string
  version: string
  mac: number[]
}

export interface M3SimTx extends M3SimUnit {
  muted: boolean
}

const versionBytes = (v: string) => {
  const parts = v.split('.').map((x) => parseInt(x, 10) & 0xff)
  return [0, 1, 2, 3].map((i) => parts[i] ?? 0)
}
const ascii = (s: string, n: number) => Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0x7f : 0))

/** Every setter the primary RX owns ("The primary RX manages all global parameters", R main_master_switch_note). */
const GLOBAL_SETTERS = new Set<number>([
  M3Cmd.SET_NOISE_STATUS, M3Cmd.SET_MUTE, M3Cmd.SET_MIX_ENABLE, M3Cmd.SET_MIC_LINK_KNOW_LED, M3Cmd.SET_MIC_LED_OFF, M3Cmd.SET_KEY_LOCK,
  M3Cmd.SET_AUTO_POWEROFF, M3Cmd.SET_SAMPLING,
])

export class M3Simulator implements DeviceSimulator {
  readonly info: { vendorId: number; productId: number; productName: string }
  readonly capabilities = { receive: 'yes' as const, link: 'mock' as const }
  faults: SimFaults
  readonly product: ProductInfo
  readonly camera: boolean
  // ---- topology
  /** 0 = 4T4R, 1 = 2T2R (heartbeat byte 22). */
  system: number = M3_SYSTEM.FOUR_T_FOUR_R
  /** Slot (0–3) of the RX the host is plugged into. */
  currentRx = 0
  /** Slot of the primary RX. */
  mainRx = 0
  readonly rx: M3SimUnit[]
  readonly tx: M3SimTx[]
  /** Camera RX hot-shoe accessory (0x600A [10]); null when none is fitted. */
  hotShoeAccessory: M3SimUnit | null
  // ---- settings (wire values)
  ncOn = true
  /** 0 Weak, 1 Medium, 2 Strong. */
  ncLevel = 1
  /** Phone RX volume 0–5; camera RX: the level selected on the receiver, 0–2. */
  volume: number
  channelMode: number = M3_SOUND_MODE.STEREO
  autoShutdown = 0
  eqMode = 0
  txRecognition = false
  ledOff = false
  pairing = false
  hotShoeSync = true
  smartMix = false
  keyLock = false
  autoExit = true
  refreshCanto = false
  earMode = 0
  /** 0 = 24-bit, 1 = 32-bit float. */
  sampling = 0
  soundOut = false
  /** Camera RX levels, wire = dB + 10. */
  gains: [number, number, number] = [6, 10, 14]
  earVolume = 80
  // ---- observation
  /** Every decoded request item (cmd + payload), in order. */
  readonly received: { cmd: number; payload: number[] }[] = []
  /** Every request frame (decoded). */
  readonly requests: MomaRequest[] = []
  /** Commands that restarted the receiver. */
  readonly restarts: number[] = []
  private readonly reader = new MomaRequestReader(MOMA_6303)
  private inject: ((p: Uint8Array) => void) | null = null

  constructor(product: ProductInfo, o: SimOptions = {}) {
    this.product = product
    this.camera = isM3CameraRx(product)
    this.info = { vendorId: product.vendorId, productId: product.productId, productName: `${product.label ?? product.name} (simulated)` }
    this.faults = { dropReplies: o.dropReplies, duplicateReplies: o.duplicateReplies, chunkSize: o.chunkSize }
    this.volume = this.camera ? 1 : 3
    const rxVersion = o.rxVersion ?? '2.0.1.2'
    const unit = (n: number, kind: 'RX' | 'TX', battery: number, online: boolean): M3SimUnit => ({
      online, battery, serial: `M3${kind}${String(n).padStart(7, '0')}`, version: kind === 'RX' ? rxVersion : '2.0.0.9',
      mac: [0x50, 0xc0, kind === 'RX' ? 0x60 : 0x70, 0x00, 0x00, n],
    })
    // Slot 0 is this RX by default; other slots: camera RXs with a battery.
    this.rx = [0, 1, 2, 3].map((i) => unit(i + 1, 'RX', 70 - i * 10, i === 0))
    this.tx = [0, 1, 2, 3].map((i) => ({ ...unit(i + 1, 'TX', 80 - i * 15, i < 2), muted: false }))
    this.hotShoeAccessory = this.camera ? unit(10, 'RX', -1, true) : null
    if (this.hotShoeAccessory) this.hotShoeAccessory.serial = 'M3HS0000010'

    switch (o.profile) {
      case 'secondary':
        this.currentRx = 1
        this.mainRx = 0
        this.rx[1].online = true
        break
      case 'multi-rx':
        this.rx[1].online = true
        this.rx[2].online = true
        break
      case '2t2r':
        this.system = M3_SYSTEM.TWO_T_TWO_R
        break
      case 'refresh':
        this.refreshCanto = true
        break
    }
    const p = o.params ?? {}
    if (typeof p.currentRx === 'number') this.currentRx = p.currentRx & 3
    if (typeof p.mainRx === 'number') this.mainRx = p.mainRx & 3
    if (Array.isArray(p.rxSlots)) for (let i = 0; i < 4; i++) this.rx[i].online = (p.rxSlots as number[]).includes(i)
    this.rx[this.currentRx].online = true
    if (o.online) {
      M3_TX_UNITS.forEach((u, i) => (this.tx[i].online = o.online!.includes(u)))
      for (const s of m3RxSlots(this.currentRx)) if (s.unit !== 'rx') this.rx[s.index].online = o.online.includes(s.unit)
    }
    // The connected RX's own battery: none on a phone RX (heartbeat 0xFF, A EquipmentFragment.updateMasterSlaveMode).
    this.rx[this.currentRx].battery = this.camera ? 76 : -1
    if (this.system === M3_SYSTEM.TWO_T_TWO_R) {
      this.tx[2].online = false
      this.tx[3].online = false
      if (this.channelMode === M3_SOUND_MODE.FOUR_TRACK) this.channelMode = M3_SOUND_MODE.STEREO
    }
  }

  get isPrimary(): boolean {
    return this.currentRx === this.mainRx
  }

  /** Units online, for tests (rx2..rx4 mapped as the driver maps them). */
  onlineUnits(): UnitId[] {
    const out: UnitId[] = ['rx']
    M3_TX_UNITS.forEach((u, i) => this.tx[i].online && out.push(u))
    for (const s of m3RxSlots(this.currentRx)) if (s.unit !== 'rx' && this.rx[s.index].online) out.push(s.unit)
    return out
  }

  attach(inject: (p: Uint8Array) => void): () => void {
    this.inject = inject
    return () => {
      this.inject = null
    }
  }

  /** Device push: a wireless-monitoring Bluetooth event (type 0 notify item), m3-6303.md §5.5. */
  pushBluetoothEvent(kind: 'connect' | 'disconnect' | 'volume', value = this.earVolume): void {
    const mac = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66]
    const item =
      kind === 'volume'
        ? momaNotify(M3Cmd.BT_AVRCP_VOL_RPT, [value & 0x7f])
        : momaNotify(kind === 'connect' ? M3Cmd.BT_CONNECT_EVT : M3Cmd.BT_DISCONN_EVT, [0, 0, 0x01, 0x00, ...mac])
    if (kind === 'volume') this.earVolume = value
    this.inject?.(this.reply([item]))
  }

  /** The device-side edit that sets heartbeat byte 28 (isRefreshCanto), e.g. a profile changed from another phone. */
  markVoiceProfilesChanged(): void {
    this.refreshCanto = true
  }

  /** The 30-byte heartbeat body (status.ts encodeM3Heartbeat). */
  heartbeatBody(): number[] {
    const mask = (xs: readonly { online: boolean }[]) => xs.reduce((m, x, i) => m | (x.online ? 1 << i : 0), 0)
    return encodeM3Heartbeat({
      txConnectState: mask(this.tx),
      rxConnectState: mask(this.rx),
      currentRxDeviceId: this.currentRx,
      txBattery: this.tx.map((t) => (t.online ? t.battery : 0)) as [number, number, number, number],
      rxBattery: this.rx.map((r, i) => (r.online || i === this.currentRx ? r.battery : 0)) as [number, number, number, number],
      txMuteStatus: this.tx.reduce((m, t, i) => m | (t.muted ? 1 << i : 0), 0),
      denoiseSwitch: this.ncOn ? 1 : 0, denoiseLevel: this.ncLevel, volumeLevel: this.volume, channelMode: this.channelMode,
      autoShutdownEnable: this.autoShutdown, eqMode: this.eqMode, txRecognitionSwitch: this.txRecognition ? 1 : 0,
      ledSwitch: this.ledOff ? 1 : 0, pairState: this.pairing ? 1 : 0, masterSlaveMode: this.isPrimary ? 0 : 1,
      deviceMode: this.system, mainRxId: this.mainRx, hotShoeSwitch: this.hotShoeSync ? 1 : 0, swMixNoise: this.smartMix ? 1 : 0,
      micLockSwitch: this.keyLock ? 1 : 0, micAutoExitSw: this.autoExit ? 1 : 0, isRefreshCanto: this.refreshCanto ? 1 : 0,
      earMode: this.earMode,
    })
  }

  respond(packet: Uint8Array): Uint8Array[] {
    const out: Uint8Array[] = []
    for (const f of this.reader.push(packet)) {
      this.requests.push({ items: f.items, target: f.target })
      const items = f.items.flatMap((it) => {
        this.received.push({ cmd: it.cmd, payload: Array.from(it.payload) })
        return this.handle(it.cmd, it.payload)
      })
      if (items.length) out.push(this.reply(items))
    }
    return applyMomaFaults(out, this.faults)
  }

  private reply(items: readonly MomaItemInput[]): Uint8Array {
    return encodeMomaReply(MOMA_6303, items, { source: this.camera ? MOMA_ID.CAMERA_RX : MOMA_ID.PHONE_RX })
  }

  private unitOfDeviceId(id: number): M3SimUnit | null {
    if (id >= 1 && id <= 4) return this.tx[id - 1]
    if (id >= 6 && id <= 9) return this.rx[id - 6]
    if (id === M3_DEVICE_ID.HOT_SHOE) return this.hotShoeAccessory
    return null
  }

  private deviceInfo(id: number): number[] | null {
    const u = this.unitOfDeviceId(id)
    if (!u || (!u.online && !(id >= 6 && id - 6 === this.currentRx))) return null
    // A HLAudioGetDeviceInfoResponseEntity: deviceId, interval1, sn[11], interval2, version[4], interval3, mac[6].
    return [id, 0, ...ascii(u.serial, 11), 0, ...versionBytes(u.version), 0, ...u.mac]
  }

  private firmwareList(): number[] {
    // 9 × {id, version[4]}: TX1–4, RX1–4, hot shoe (A HLGetFirmwareVerResponseEntitySerializer reads 9 items).
    return [1, 2, 3, 4, 6, 7, 8, 9, 10].flatMap((id) => {
      const u = this.unitOfDeviceId(id)
      const present = !!u && (u.online || (id >= 6 && id - 6 === this.currentRx))
      return [id, ...(present ? versionBytes(u!.version) : [0, 0, 0, 0])]
    })
  }

  private restart(cmd: number): void {
    this.restarts.push(cmd)
  }

  private handle(cmd: number, p: Uint8Array): MomaItemInput[] {
    const ok = () => [momaAck(cmd, 0)]
    const fail = () => [momaAck(cmd, 1)]
    const data = (payload: number[]) => [momaData(cmd, payload)]
    if (GLOBAL_SETTERS.has(cmd) && !this.isPrimary) return fail()
    switch (cmd) {
      // ---------------------------------------------------------------- reads
      case M3Cmd.HEART_BEAT_GET:
        return data(this.heartbeatBody())
      case M3Cmd.GET_DEV_INFO: {
        const body = this.deviceInfo(p[0] ?? 0)
        return body ? data(body) : []
      }
      case M3Cmd.GET_FIRMWARE_VER:
        return data(this.firmwareList())
      case M3Cmd.GET_SETTING_INFO:
        return data([0, this.sampling, this.soundOut ? 1 : 0, this.keyLock ? 1 : 0, this.autoExit ? 1 : 0])
      case M3Cmd.GET_HOME_INFO:
        return data([0, this.smartMix ? 1 : 0, this.ledOff ? 0 : 1, this.txRecognition ? 1 : 0])
      case M3Cmd.GET_GAIN_LEVEL_DETAIL:
        return data([0, ...this.gains])
      case M3Cmd.GET_GAIN_LEVEL:
        return data([0, this.volume])
      case M3Cmd.GET_MUTE: {
        const t = this.tx[(p[0] ?? 1) - 1]
        return t ? data([p[0], t.muted ? 1 : 0]) : []
      }
      case M3Cmd.GET_NOISE_STATUS:
        return data([0, this.ncLevel, this.ncOn ? 1 : 0])
      case M3Cmd.GET_SOUND_MODE:
        return data([0, this.channelMode])
      case M3Cmd.GET_SOUND_OUT:
        return data([0, this.soundOut ? 1 : 0])
      case M3Cmd.GET_SAMPLING:
        return data([0, this.sampling])
      case M3Cmd.GET_MIX_ENABLE:
        return data([0, this.smartMix ? 1 : 0])
      case M3Cmd.GET_AUTO_POWEROFF:
        return data([this.autoExit ? 1 : 0])
      case M3Cmd.GET_KEY_LOCK:
        return data([this.keyLock ? 1 : 0])
      case M3Cmd.GET_WORK_MODE:
        return data([this.system])
      case M3Cmd.GET_MIC_LED_OFF:
        return data([this.ledOff ? 1 : 0])
      case M3Cmd.GET_MIC_LINK_KNOW_LED:
        return data([this.txRecognition ? 1 : 0])
      case M3Cmd.GET_RX_INDEX:
        return data([this.system, this.currentRx])
      case M3Cmd.GET_RX_TYPE:
        // I HL6303RxDeviceType: cameraRx1…4 = 0…3, phoneRx1…4 = 4…7 [?].
        return data([(this.camera ? 0 : 4) + this.currentRx, this.currentRx])
      case M3Cmd.BT_STATUS_FOR_HEART:
        return data([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, ...ascii(this.system === M3_SYSTEM.TWO_T_TWO_R ? 'Earphones' : '', 33)])
      // ---------------------------------------------------------------- writes
      case M3Cmd.SET_MUTE: {
        const t = this.tx[(p[0] ?? 0) - 1]
        if (!t?.online) return fail()
        t.muted = p[1] === 1
        return ok()
      }
      case M3Cmd.SET_NOISE_STATUS:
        if (!this.tx.some((t) => t.online)) return fail()
        this.ncLevel = Math.min(2, p[1] ?? 0)
        this.ncOn = p[2] === 1
        return ok()
      case M3Cmd.SET_SOUND_MODE: {
        const mode = p[1] ?? 0
        if (mode > 2 || (mode === M3_SOUND_MODE.FOUR_TRACK && this.system !== M3_SYSTEM.FOUR_T_FOUR_R)) return fail()
        if ((mode === M3_SOUND_MODE.FOUR_TRACK) !== (this.channelMode === M3_SOUND_MODE.FOUR_TRACK)) this.restart(cmd)
        this.channelMode = mode
        return ok()
      }
      case M3Cmd.SET_GAIN_LEVEL:
        if (this.camera) return fail()
        this.volume = Math.min(5, p[1] ?? 0)
        return ok()
      case M3Cmd.SET_GAIN_DETAIL_ALL: {
        const g = [p[1], p[2], p[3]].map((x) => Math.min(20, x ?? 10)) as [number, number, number]
        if (g[0] > g[1] || g[1] > g[2]) return fail()
        this.gains = g
        return ok()
      }
      case M3Cmd.SET_SOUND_OUT:
        this.soundOut = p[1] === 1
        this.restart(cmd)
        return ok()
      case M3Cmd.SET_SAMPLING:
        this.sampling = p[1] === 1 ? 1 : 0
        this.restart(cmd)
        return ok()
      case M3Cmd.SET_MIX_ENABLE:
        this.smartMix = p[1] === 1
        return ok()
      case M3Cmd.SET_AUTO_POWEROFF:
        this.autoExit = p[0] === 1
        return ok()
      case M3Cmd.SET_KEY_LOCK:
        this.keyLock = p[0] === 1
        return ok()
      case M3Cmd.SET_MIC_LED_OFF:
        this.ledOff = p[0] === 1
        return ok()
      case M3Cmd.SET_MIC_LINK_KNOW_LED:
        this.txRecognition = p[0] === 1
        return ok()
      case M3Cmd.SET_SYNC_HOTSHOE:
        if (!this.camera) return fail()
        this.hotShoeSync = p[0] === 1
        return ok()
      case M3Cmd.SET_WORK_MODE:
        this.system = p[0] === 1 ? M3_SYSTEM.TWO_T_TWO_R : M3_SYSTEM.FOUR_T_FOUR_R
        if (this.system === M3_SYSTEM.TWO_T_TWO_R && this.channelMode === M3_SOUND_MODE.FOUR_TRACK) this.channelMode = M3_SOUND_MODE.STEREO
        this.restart(cmd)
        return ok()
      case M3Cmd.SET_BEL_APP_UPDATE:
        this.refreshCanto = false
        return ok()
      case M3Cmd.RF_SET_RX_MASTER:
        if (!this.rx[p[0] ?? 0]?.online) return fail()
        this.mainRx = (p[0] ?? 0) & 3
        return ok()
      case M3Cmd.UI_CONNECT_LED_CTRL:
        return ok()
      case M3Cmd.START_PAIR_DEVICE:
        this.pairing = true
        return ok()
      case M3Cmd.STOP_PAIR_DEVICE:
        this.pairing = false
        return ok()
      case M3Cmd.BT_AVRCP_SET_VOL:
        this.earVolume = (p[0] ?? 0) & 0x7f
        return ok()
      // Destructive ids answer so tests can prove the engine never sends them (a real RX would act on them).
      case M3Cmd.RESTORE_FACTORY:
      case M3Cmd.CLEAR_PAIR_DEVICE:
        return ok()
      default:
        return []
    }
  }
}

