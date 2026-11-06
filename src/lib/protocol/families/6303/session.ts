/**
 * LARK M3 (6303) ProtocolSpec for the generic engine (core/engine.ts) on the shared Moma codec (moma/, profile
 * MOMA_6303: report id 8, target 0, no checksum, 64 / 512-byte padding), and M3Device.
 *
 * Session (m3-6303.md §4, A larkc1/c6303/viewmodel/HLDeviceVolTrack6303ViewModel, BaseViewModel6303):
 *  - no handshake; the probe and the status poll are the heartbeat 0x6000 every 1.5 s
 *    (A BaseViewModel6303.heartLooper EventLooper(1500), HLDeviceVolTrack6303Activity.getHeartTime() = 1500;
 *    I HL6303HeartBeatManager.heartBeatTimer, NSTimer 1.5 s @0x1004b6378)
 *  - after the first heartbeat, under `fetchIdentity`: 0x600A for the current RX (getCurrentDeviceInfo:
 *    rxIndexToDeviceId(currentRxDeviceId)), then 0x600A for every online unit (collectOnlineDeviceSn:
 *    VersionUtilKt.snProbeDeviceIds; the hot shoe, id 10, on camera RXs only here), then 0x6012 [deviceMode]
 *    (getFirmwareVer). A unit that comes online later gets its 0x600A.
 *  - under `fetchSettings`: 0x6011 (A MoreSetting6303ViewModel.getMoreSettingsDeviceInfo: bit depth and playback
 *    without unplugging have no other read path) and, on a camera RX, 0x100E (A EquipmentViewModel
 *    GetGainLevelDetail: the three dB levels). The apps read them when the page opens; this library reads them at
 *    start-up so every readable control has a value after connect (conformance check 10).
 *  - correlation by command id, plus the echoed unit in payload[0] for 0x600A and 0x1000 (m3-6303.md §4 #5)
 *  - acks: payload[0] == 0 (A DeviceControlConstant.SetResult; moma momaStatusAck)
 *  - unsolicited Bluetooth events (0x0029–0x0036, wireless monitoring) are logged and mapped to M3_INFO values
 *
 * Not reproduced: the apps' automatic 0x6015 after a heartbeat with isRefreshCanto == 1 (A EquipmentViewModel.
 * handleNotification) is a write, and background requests may only read (FAMILIES.md §2.3); the flag is shown
 * (M3_INFO.PROFILES_CHANGED) and M3Device.acknowledgeVoiceProfileRefresh() sends 0x6015 on request. The 0x0039
 * earphone poll (5 s in 2T2R) belongs to wireless monitoring (later extra).
 */
import { DestructiveCommandError, UnsupportedError, type SetResult } from '../../device'
import { CONTROL, controlKey, controlById, validateControlValue } from '../../core/controls'
import { FamilyDevice } from '../../core/engine'
import { ControlUnavailableError, TimeoutError } from '../../core/errors'
import type { ControlAvailability, ControlId, ControlValue, EngineContext, MicDeviceOptions, MicSetOptions, ProtocolSpec, UnitId } from '../../core/types'
import type { ProductInfo } from '../../models'
import type { Transport } from '../../transport'
import { MOMA_TYPE } from '../../moma/codec'
import { MOMA_6303 } from '../../moma/profiles'
import { createMomaSpecBase, type MomaMessage, type MomaRequest } from '../../moma/spec'
import {
  M3Cmd, M3Requests, M3_COMMANDS, M3_DEVICE_ID, M3_SAMPLING, M3_SOUND_MODE, M3_SYSTEM, M3_TX_UNITS, m3RxDeviceId, m3TxDeviceId, type M3TxUnit,
} from './commands'
import { M3_RESTART_TEXT, m3Controls } from './controls'
import { isM3CameraRx, isM3PhoneRx } from './products'
import {
  M3_CAMERA_LEVELS, M3_CONTROL, M3_INFO, describeM3Heartbeat, m3Availability, m3CameraGainValues, m3CameraGainsWith, m3ChannelModeValue,
  m3DeviceIdOfUnit, m3HeartbeatUnits, m3HeartbeatValues, m3NoiseLevelValue, m3UnitOfDeviceId, parseM3BtStatus, parseM3CameraGains,
  parseM3DevValue, parseM3DeviceInfo, parseM3FirmwareVersions, parseM3Heartbeat, parseM3Noise, parseM3SettingInfo, isM3VersionKnown,
  type M3DeviceInfo, type M3FirmwareItem, type M3Heartbeat,
} from './status'

/** Status poll interval of both apps (see the header). */
export const M3_HEARTBEAT_INTERVAL_MS = 1500

/**
 * Engine timing. Android waits 200 ms for a reply and retries 3× (A Protocol6303Provider.getCommandExecutionConfig →
 * CommandExecutionConfig defaults) and spaces sends by 50 ms (A mic_usb/messenger/UsbMessenger6303$1: delay(50)).
 * 500 ms leaves room for browser / bridge latency.
 */
export const M3_TIMING: ProtocolSpec<MomaRequest, MomaMessage>['timing'] = { replyTimeoutMs: 500, probeTimeoutMs: 1000, interFrameDelayMs: 50 }

/** Delay before reading back a write that the heartbeat does not carry (A MoreSetting6118ViewModel.TOGGLE_CONFIRM_DELAY_MS-like). */
const READBACK_MS = 150

type Ctx = EngineContext<MomaRequest, MomaMessage>

/** What the M3 reports beyond MicState (hardware check, console, later pages). */
export interface M3Session {
  /** Hot-shoe accessory of a camera RX (0x600A [10]). */
  hotShoe?: M3DeviceInfo
  /** 0x6012 lists by system (0 = 4T4R, 1 = 2T2R). */
  firmware: Partial<Record<number, M3FirmwareItem[]>>
  /** 0x600A replies by payload device id. */
  deviceInfo: Partial<Record<number, M3DeviceInfo>>
  /** Envelope bytes of the last heartbeat reply (source / target / item type are unverified, m3-6303.md §3.2). */
  lastHeartbeat?: { source: number; target: number; type: number; length: number }
  /** Connected Bluetooth earphone (0x0039), wireless monitoring. */
  earphone?: { mac: string; name: string }
  /** 0x6011 replies whose isSuccess byte was not 0. */
  settingInfoFailures: number
  /** Set once onConnected took its identity snapshot; later units get their 0x600A from onUnitOnline. */
  startupDone: boolean
  /** The engine context (captured from the hooks), for M3Device's extra requests. */
  ctx?: Ctx
}

export function createM3Session(): M3Session {
  return { firmware: {}, deviceInfo: {}, settingInfoFailures: 0, startupDone: false }
}

const lastHeartbeat = (ctx: Ctx): M3Heartbeat | undefined => {
  const raw = ctx.state.raw as M3Heartbeat | undefined
  return raw && typeof raw === 'object' && 'currentRxDeviceId' in raw ? raw : undefined
}

async function backgroundRead(ctx: Ctx, req: MomaRequest): Promise<void> {
  try {
    await ctx.request(req, { priority: 'background' })
  } catch (e) {
    // One missing reply must not skip the remaining reads; disconnects and safety refusals propagate.
    if (!(e instanceof TimeoutError)) throw e
  }
}

/** Payload ids that echo in reply payload[0] (A CmdGetDeviceInfo6303 / CmdGetAudioMute6303 replies start with deviceId). */
const UNIT_ECHO = new Set<number>([M3Cmd.GET_DEV_INFO, M3Cmd.GET_MUTE])
/** Per-unit setters: queued writes coalesce per unit. */
const PER_UNIT = new Set<number>([M3Cmd.SET_MUTE, M3Cmd.GET_DEV_INFO, M3Cmd.GET_MUTE])

const isTx = (u: UnitId | undefined): u is M3TxUnit => !!u && (M3_TX_UNITS as readonly string[]).includes(u)

function unknown(id: ControlId, what: string): never {
  throw new ControlUnavailableError(id, 'state-unknown', `${what} is not known yet (wait for the receiver's status)`)
}

/** The LARK M3 ProtocolSpec for one product; `session` collects what MicState has no place for. */
export function createM3Spec(product: ProductInfo, session: M3Session = createM3Session()): ProtocolSpec<MomaRequest, MomaMessage> {
  const phone = isM3PhoneRx(product)
  const camera = isM3CameraRx(product)
  const base = createMomaSpecBase(MOMA_6303, {
    commands: M3_COMMANDS,
    matchItem: (it, msg) => !UNIT_ECHO.has(it.cmd) || msg.payload[0] === (it.payload?.[0] ?? 0),
    coalesceKey: (r) => r.items.map((it) => (PER_UNIT.has(it.cmd) ? `${it.cmd}:${it.payload?.[0] ?? ''}` : String(it.cmd))).join(','),
  })

  const currentRx = (ctx: Ctx) => lastHeartbeat(ctx)?.currentRxDeviceId ?? 0

  /** Payload ids to identify: current RX, online TXs, online other RXs, the camera RX's hot shoe. */
  function identityIds(ctx: Ctx): number[] {
    const hb = lastHeartbeat(ctx)
    const cur = currentRx(ctx)
    const ids = [m3RxDeviceId(cur)]
    if (hb) {
      hb.txOnline.forEach((on, i) => on && ids.push(i + 1))
      hb.rxOnline.forEach((on, i) => on && i !== cur && ids.push(m3RxDeviceId(i)))
    }
    if (camera) ids.push(M3_DEVICE_ID.HOT_SHOE)
    return ids
  }

  function applyAvailability(ctx: Ctx): void {
    const hb = lastHeartbeat(ctx)
    if (hb) ctx.setAvailability(m3Availability(hb, ctx.state.values))
  }

  function onDeviceInfo(ctx: Ctx, info: M3DeviceInfo): void {
    session.deviceInfo[info.deviceId] = info
    if (info.deviceId === M3_DEVICE_ID.HOT_SHOE) {
      session.hotShoe = info
      return
    }
    const unit = m3UnitOfDeviceId(info.deviceId, currentRx(ctx))
    if (!unit) return
    ctx.patchUnits({
      [unit]: {
        ...(info.serial ? { serial: info.serial } : {}),
        ...(isM3VersionKnown(info.version) ? { version: info.version } : {}),
        ...(info.mac && info.mac !== '00:00:00:00:00:00' ? { mac: info.mac } : {}),
      },
    })
  }

  function onFirmware(ctx: Ctx, system: number, items: M3FirmwareItem[]): void {
    session.firmware[system] = items
    // The list of the running system names each unit's version; a 0x600A version already known wins.
    const hb = lastHeartbeat(ctx)
    if (hb && (hb.is4t4r ? M3_SYSTEM.FOUR_T_FOUR_R : M3_SYSTEM.TWO_T_TWO_R) !== system) return
    const patch: Partial<Record<UnitId, { version: string }>> = {}
    for (const it of items) {
      const unit = m3UnitOfDeviceId(it.id, currentRx(ctx))
      if (unit && isM3VersionKnown(it.version) && !ctx.state.units[unit]?.version) patch[unit] = { version: it.version }
    }
    if (Object.keys(patch).length) ctx.patchUnits(patch)
  }

  const spec: ProtocolSpec<MomaRequest, MomaMessage> = {
    ...base,
    describe(x, dir) {
      const s = base.describe(x, dir)
      if (dir === 'rx' && 'cmd' in x && x.cmd === M3Cmd.HEART_BEAT_GET && x.payload.length) return `${s} — ${describeM3Heartbeat(parseM3Heartbeat(x.payload))}`
      return s
    },
    probe: () => M3Requests.heartbeat(),
    heartbeat: { request: () => M3Requests.heartbeat(), intervalMs: M3_HEARTBEAT_INTERVAL_MS },
    async onConnected(ctx) {
      session.ctx = ctx
      const ids = ctx.options.fetchIdentity ? identityIds(ctx) : []
      session.startupDone = ctx.options.fetchIdentity
      if (ids.length) await backgroundRead(ctx, M3Requests.deviceInfo(ids[0]))
      if (ctx.options.fetchSettings) {
        await backgroundRead(ctx, M3Requests.settingInfo())
        if (camera) await backgroundRead(ctx, M3Requests.gainLevelDetail())
      }
      for (const id of ids.slice(1)) await backgroundRead(ctx, M3Requests.deviceInfo(id))
      if (ctx.options.fetchIdentity) {
        const hb = lastHeartbeat(ctx)
        await backgroundRead(ctx, M3Requests.firmwareVersions(hb && !hb.is4t4r ? M3_SYSTEM.TWO_T_TWO_R : M3_SYSTEM.FOUR_T_FOUR_R))
      }
    },
    onUnitOnline(ctx, unit) {
      if (!ctx.options.fetchIdentity || !session.startupDone || unit === 'rx') return
      const id = m3DeviceIdOfUnit(unit, currentRx(ctx))
      if (id !== null) void backgroundRead(ctx, M3Requests.deviceInfo(id)).catch(() => undefined)
    },
    onMessage(ctx, msg) {
      session.ctx ??= ctx
      const p = msg.payload
      switch (msg.cmd) {
        case M3Cmd.HEART_BEAT_GET: {
          const hb = parseM3Heartbeat(p)
          session.lastHeartbeat = { source: msg.frame.source, target: msg.frame.target, type: msg.type, length: p.length }
          ctx.setValues(m3HeartbeatValues(hb, product))
          ctx.statusApplied(hb)
          ctx.patchUnits(m3HeartbeatUnits(hb, product))
          applyAvailability(ctx)
          return
        }
        case M3Cmd.GET_DEV_INFO: {
          const info = parseM3DeviceInfo(p)
          if (info) onDeviceInfo(ctx, info)
          else ctx.note(`0x600A reply of ${p.length} bytes (25 expected)`)
          return
        }
        case M3Cmd.GET_FIRMWARE_VER: {
          // The reply does not echo the system: it answers the request that matched it (or, unsolicited, the running one).
          const hb = lastHeartbeat(ctx)
          onFirmware(ctx, hb && !hb.is4t4r ? M3_SYSTEM.TWO_T_TWO_R : M3_SYSTEM.FOUR_T_FOUR_R, parseM3FirmwareVersions(p))
          return
        }
        case M3Cmd.GET_SETTING_INFO: {
          const s = parseM3SettingInfo(p)
          if (!s) return
          if (s.isSuccess !== 0) {
            session.settingInfoFailures++
            ctx.note(`0x6011 isSuccess = ${s.isSuccess}: values ignored (A MoreSetting6303ViewModel retries)`)
            return
          }
          ctx.setValues({
            [M3_CONTROL.BIT_DEPTH]: s.sampling === 1 ? 1 : 0, [CONTROL.SPEAKER]: s.soundOut,
            [M3_CONTROL.TX_BUTTON_LOCK]: s.micLock, [CONTROL.AUTO_OFF]: s.micAutoExit,
          })
          return
        }
        case M3Cmd.GET_GAIN_LEVEL_DETAIL: {
          const g = parseM3CameraGains(p)
          if (g && camera) ctx.setValues(m3CameraGainValues(g))
          return
        }
        // GET replies the apps do not send at start-up (console reads, read-backs).
        case M3Cmd.GET_MUTE: {
          const r = parseM3DevValue(p)
          const unit = r ? m3UnitOfDeviceId(r.deviceId, currentRx(ctx)) : null
          if (r && isTx(unit ?? undefined)) {
            ctx.setValues({ [controlKey(CONTROL.MIC_MUTE, unit!)]: r.value === 1 })
            ctx.patchUnits({ [unit!]: { muted: r.value === 1 } })
          }
          return
        }
        case M3Cmd.GET_NOISE_STATUS: {
          const r = parseM3Noise(p)
          if (r) ctx.setValues({ [CONTROL.NOISE_ENABLED]: r.on, [CONTROL.NOISE_LEVEL]: m3NoiseLevelValue(r.level) })
          applyAvailability(ctx)
          return
        }
        case M3Cmd.GET_SOUND_MODE: {
          const r = parseM3DevValue(p)
          if (r) ctx.setValues({ [CONTROL.CHANNEL_MODE]: m3ChannelModeValue(r.value) })
          return
        }
        case M3Cmd.GET_SOUND_OUT: {
          const r = parseM3DevValue(p)
          if (r) ctx.setValues({ [CONTROL.SPEAKER]: r.value === 1 })
          return
        }
        case M3Cmd.GET_SAMPLING: {
          const r = parseM3DevValue(p)
          if (r) ctx.setValues({ [M3_CONTROL.BIT_DEPTH]: r.value === 1 ? 1 : 0 })
          return
        }
        case M3Cmd.GET_MIX_ENABLE: {
          const r = parseM3DevValue(p)
          if (r) ctx.setValues({ [M3_CONTROL.SMART_MIX]: r.value === 1 })
          return
        }
        case M3Cmd.GET_GAIN_LEVEL: {
          const r = parseM3DevValue(p)
          if (r && phone) ctx.setValues({ [CONTROL.VOLUME]: Math.min(5, r.value) })
          return
        }
        case M3Cmd.GET_AUTO_POWEROFF:
          if (p.length) ctx.setValues({ [CONTROL.AUTO_OFF]: p[0] === 1 })
          return
        case M3Cmd.GET_KEY_LOCK:
          if (p.length) ctx.setValues({ [M3_CONTROL.TX_BUTTON_LOCK]: p[0] === 1 })
          return
        case M3Cmd.GET_MIC_LED_OFF:
          if (p.length) ctx.setValues({ [CONTROL.LED]: p[0] !== 1 })
          return
        case M3Cmd.GET_MIC_LINK_KNOW_LED:
          if (p.length) ctx.setValues({ [CONTROL.MIC_RECOGNITION]: p[0] === 1 })
          return
        case M3Cmd.GET_WORK_MODE:
          if (p.length) ctx.setValues({ [M3_INFO.WORK_MODE]: p[0] })
          return
        case M3Cmd.BT_STATUS_FOR_HEART: {
          const bt = parseM3BtStatus(p)
          if (bt) session.earphone = bt
          return
        }
        // Device-initiated Bluetooth events while wireless monitoring is on (m3-6303.md §4 #6, §5.5).
        case M3Cmd.BT_CONNECT_EVT:
          ctx.setValues({ [M3_INFO.EAR_CONNECTED]: true })
          return
        case M3Cmd.BT_DISCONN_EVT:
          ctx.setValues({ [M3_INFO.EAR_CONNECTED]: false })
          return
        case M3Cmd.BT_AVRCP_VOL_RPT:
          if (p.length) ctx.setValues({ [M3_INFO.EAR_VOLUME]: p[0] & 0x7f })
          return
        case M3Cmd.BT_INQ_REPORT:
        case M3Cmd.BT_INQ_COMPLETE:
          if (msg.type === MOMA_TYPE.NOTIFY || msg.type === MOMA_TYPE.DATA) ctx.note(`Bluetooth event ${M3_COMMANDS[msg.cmd]?.name} (wireless monitoring is a later extra)`)
          return
      }
    },
    async refresh(ctx, what) {
      session.ctx ??= ctx
      if (what === 'status') {
        await ctx.request(M3Requests.heartbeat())
      } else if (what === 'identity') {
        const ids = identityIds(ctx)
        await ctx.request(M3Requests.deviceInfo(ids[0]))
        for (const id of ids.slice(1)) await backgroundRead(ctx, M3Requests.deviceInfo(id))
        const hb = lastHeartbeat(ctx)
        await backgroundRead(ctx, M3Requests.firmwareVersions(hb && !hb.is4t4r ? M3_SYSTEM.TWO_T_TWO_R : M3_SYSTEM.FOUR_T_FOUR_R))
      } else {
        await ctx.request(M3Requests.settingInfo())
        if (camera) await ctx.request(M3Requests.gainLevelDetail())
      }
    },
    encodeSet(ctx, id, value, o) {
      session.ctx ??= ctx
      const v = ctx.state.values
      const on = value === true
      switch (id) {
        case CONTROL.MIC_MUTE: {
          if (!isTx(o.unit)) throw new UnsupportedError(`${id} needs a TX unit`)
          const tx = m3TxDeviceId(o.unit)
          // A EquipmentViewModel refreshes the mute with 0x1000 [txId] after a toggle (currentRefreshMuteMicId).
          return { requests: [M3Requests.setMute(tx, on)], optimistic: { [controlKey(id, o.unit)]: on }, readBack: { request: M3Requests.getMute(tx), delayMs: READBACK_MS } }
        }
        case CONTROL.NOISE_ENABLED: {
          // A EquipmentFragment.setNoiseStatus sends its current level with the switch.
          const level = v[CONTROL.NOISE_LEVEL]
          if (typeof level !== 'number') unknown(id, 'The NC level')
          return { requests: [M3Requests.setNoise(level - 1, on)], optimistic: { [id]: on } }
        }
        case CONTROL.NOISE_LEVEL: {
          // A EquipmentFragment.setNoiseLevel sends the current switch state with the level.
          const ncOn = v[CONTROL.NOISE_ENABLED]
          if (typeof ncOn !== 'boolean') unknown(id, 'The NC switch')
          return { requests: [M3Requests.setNoise((value as number) - 1, ncOn)], optimistic: { [id]: value } }
        }
        case CONTROL.VOLUME:
          if (!phone) throw new UnsupportedError('the camera RX sets its volume per level (m3.cameraVolume.level1–3)')
          return { requests: [M3Requests.setGainLevel(value as number)], optimistic: { [id]: value } }
        case M3_CONTROL.CAMERA_LEVEL_1:
        case M3_CONTROL.CAMERA_LEVEL_2:
        case M3_CONTROL.CAMERA_LEVEL_3: {
          if (!camera) throw new UnsupportedError(`${id} is a camera RX control`)
          const cur = M3_CAMERA_LEVELS.map((k) => v[k])
          if (!cur.every((x): x is number => typeof x === 'number')) unknown(id, 'The camera RX volume levels')
          const g = m3CameraGainsWith(cur as [number, number, number], M3_CAMERA_LEVELS.indexOf(id) as 0 | 1 | 2, value as number)
          return {
            requests: [M3Requests.setGainDetailAll(g[0] + 10, g[1] + 10, g[2] + 10)], optimistic: m3CameraGainValues(g),
            readBack: { request: M3Requests.gainLevelDetail(), delayMs: READBACK_MS },
          }
        }
        case CONTROL.CHANNEL_MODE: {
          // A EquipmentFragment.initSoundMode: clicking the selected mode sends nothing.
          if (v[id] === value) return { requests: [] }
          if (value === M3_SOUND_MODE.FOUR_TRACK && ctx.options.enforcePreconditions && v[M3_INFO.SYSTEM] === M3_SYSTEM.TWO_T_TWO_R) {
            throw new ControlUnavailableError(id, 'not-4t4r', '4-track needs 4TX&4RX mode (wireless monitoring is on).')
          }
          return { requests: [M3Requests.setSoundMode(value as number)], optimistic: { [id]: value } }
        }
        case M3_CONTROL.SMART_MIX:
          return { requests: [M3Requests.setMixEnable(on)], optimistic: { [id]: on } }
        case CONTROL.MIC_RECOGNITION:
          return { requests: [M3Requests.setMicLinkKnowLed(on)], optimistic: { [id]: on } }
        case CONTROL.LED:
          return { requests: [M3Requests.setMicLedOff(!on)], optimistic: { [id]: on } }
        case M3_CONTROL.HOT_SHOE_SYNC:
          if (!camera) throw new UnsupportedError(`${id} is a camera RX control`)
          return { requests: [M3Requests.setSyncHotshoe(on)], optimistic: { [id]: on } }
        case CONTROL.SPEAKER:
          return { requests: [M3Requests.setSoundOut(on)], optimistic: { [id]: on }, readBack: { request: M3Requests.settingInfo(), delayMs: READBACK_MS } }
        case M3_CONTROL.BIT_DEPTH:
          // A MoreSetting6303Activity.initView$lambda$8: 32bit float only toasts R only_support_apple, nothing is sent
          // (iOS offers it; the library follows Android, as for the MAX 2 "USB Output"). M3Device.set refuses it
          // before the confirm check; this is the encoder's own guard.
          if (value === M3_SAMPLING.FLOAT32) throw new ControlUnavailableError(id, 'apple-only', 'Only supports Apple devices.')
          // A initView$lambda$7: `if (rxSample == SAMPLE_24_BIT) return` — no restart when it is already 24bit.
          if (v[id] === value) return { requests: [] }
          return { requests: [M3Requests.setSampling(value as number)], optimistic: { [id]: value }, readBack: { request: M3Requests.settingInfo(), delayMs: READBACK_MS } }
        case M3_CONTROL.TX_BUTTON_LOCK:
          return { requests: [M3Requests.setKeyLock(on)], optimistic: { [id]: on } }
        case CONTROL.AUTO_OFF:
          return { requests: [M3Requests.setAutoPowerOff(on)], optimistic: { [id]: on } }
        default:
          throw new UnsupportedError(`${id} is not a LARK M3 control`)
      }
    },
    // Write-only link: the NC switch and level are sent together, the camera RX volume as all three levels, so
    // those writes need values that cannot be read (encodeSet refuses them with the same reason).
    blindAvailability(ctx) {
      const v = ctx.state.values
      const unknownA = (what: string): ControlAvailability => ({ ok: false, reason: 'state-unknown', message: `${what} cannot be read (replies are not delivered)` })
      const ok: ControlAvailability = { ok: true }
      const a: Partial<Record<ControlId, ControlAvailability>> = {
        [CONTROL.NOISE_ENABLED]: typeof v[CONTROL.NOISE_LEVEL] === 'number' ? ok : unknownA('The NC level'),
        [CONTROL.NOISE_LEVEL]: typeof v[CONTROL.NOISE_ENABLED] === 'boolean' ? ok : unknownA('The NC switch'),
      }
      if (camera) {
        const all = M3_CAMERA_LEVELS.every((k) => typeof v[k] === 'number')
        for (const k of M3_CAMERA_LEVELS) a[k] = all ? ok : unknownA('The camera RX volume levels')
      }
      return a
    },
    controls: (p) => m3Controls(p),
    timing: M3_TIMING,
  }
  return spec
}

/**
 * The LARK M3 MicDevice: FamilyDevice plus the one value-dependent safety rule the engine cannot express from
 * ControlSpec.safety alone. Channel Mode is a plain write between Mono and Stereo, but entering or leaving 4-track
 * restarts the receiver (A EquipmentFragment.initSoundMode$lambda$28 / 31 / 34 → showSwitchDialog "Restart Device /
 * This change requires a restart. Continue?"), so that change needs { confirm: true }, as every disruptive control.
 * An unknown current mode counts as 4-track (it might be).
 */
export class M3Device extends FamilyDevice<MomaRequest, MomaMessage> {
  readonly session: M3Session

  constructor(transport: Transport, product: ProductInfo, options: MicDeviceOptions = {}, session: M3Session = createM3Session()) {
    const p = options.product ?? product
    super(transport, p, { family: '6303', commands: M3_COMMANDS, spec: createM3Spec(p, session) }, options)
    this.session = session
  }

  /** Whether `set(CONTROL.CHANNEL_MODE, value)` needs { confirm: true } right now (for the UI's restart dialog). */
  channelModeNeedsConfirm(value: number): boolean {
    const cur = this.state.values[CONTROL.CHANNEL_MODE]
    if (cur === value) return false
    return value === M3_SOUND_MODE.FOUR_TRACK || cur === M3_SOUND_MODE.FOUR_TRACK || cur === undefined
  }

  override async set(id: ControlId, value: ControlValue, o: MicSetOptions = {}): Promise<SetResult> {
    const control = controlById(this.controls, id)
    // Bit Depth 32bit float: refused for what it is ("Only supports Apple devices.", A MoreSetting6303Activity
    // .initView$lambda$8), not with a confirm request that could not help.
    if (id === M3_CONTROL.BIT_DEPTH && control && validateControlValue(control, value, o.unit) === M3_SAMPLING.FLOAT32) {
      throw new ControlUnavailableError(id, 'apple-only', 'Only supports Apple devices.')
    }
    if (id === CONTROL.CHANNEL_MODE && control && o.confirm !== true) {
      const v = validateControlValue(control, value, o.unit) as number
      const s = this.state
      // Refusals the engine would give first keep their type (not connected, replies not delivered, preconditions).
      const engineRefuses = !s.connected || (s.rx === 'unavailable' && !this.opts.blindWrites)
      if (!engineRefuses && this.channelModeNeedsConfirm(v)) {
        if (v === M3_SOUND_MODE.FOUR_TRACK && this.opts.enforcePreconditions && s.values[M3_INFO.SYSTEM] === M3_SYSTEM.TWO_T_TWO_R) {
          throw new ControlUnavailableError(id, 'not-4t4r', '4-track needs 4TX&4RX mode (wireless monitoring is on).')
        }
        throw new DestructiveCommandError(`Channel Mode: switching to or from 4-track restarts the receiver. ${M3_RESTART_TEXT} Pass { confirm: true }.`)
      }
    }
    const r = await super.set(id, value, o)
    // Optimistic values change preconditions (NC off hides the level row): recompute them now, not at the next poll.
    const ctx = this.session.ctx
    const hb = ctx ? lastHeartbeat(ctx) : undefined
    if (ctx && hb) ctx.setAvailability(m3Availability(hb, this.state.values))
    return r
  }

  /**
   * Clear the heartbeat's "voice profiles changed" flag with 0x6015, as the apps do automatically (A EquipmentViewModel
   * .handleNotification: isRefreshCanto == 1 → setBelAppUpdate). A user write: background requests may only read.
   */
  async acknowledgeVoiceProfileRefresh(): Promise<SetResult> {
    const ctx = this.session.ctx
    if (!ctx) throw new UnsupportedError('not connected yet')
    const m = await ctx.request(M3Requests.setBelAppUpdate(), { expectReply: this.state.rx !== 'unavailable' })
    const code = m && m.payload.length ? m.payload[0] : null
    return { ok: m === null || code === 0, confirmed: m !== null, code }
  }
}

/** A MicDevice for a LARK M3 row on any transport (WebHidTransport with report id 8, the bridge, a simulator). */
export function createM3Device(transport: Transport, product: ProductInfo, options?: MicDeviceOptions): M3Device {
  return new M3Device(transport, product, options)
}
