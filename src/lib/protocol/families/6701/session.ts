/**
 * LARK MAX 2 session: the ProtocolSpec the generic engine (core/engine.ts FamilyDevice) runs, for both links.
 * docs/research/families/max2-6701.md §4; FAMILIES.md §3.8 row 6701.
 *
 *            probe                     status poll (3 s)                       start-up reads (fetchIdentity / fetchSettings)
 *  USB RX    0x600B to the RX id       0x600B (A HLBleDeviceActivity$mRunnable$1)   as Android, see onConnected
 *  BLE BOX   0x600A [0] to target 5    0x600B to target 2 through the BOX           as Android over BLE (pushes 0x6000–0x6002
 *            (the BOX itself)          (I -[HLBleDeviceController sendHeartInfo]      are mapped when they come)
 *                                      @0x1002454ec; Android polls nothing)
 *
 * Start-up order (A HLBleDeviceActivity ConnectDeviceStatus → getIsSupportFourMic → getFourModeOrVersion →
 * $getDeviceAllInfo$1, 200 ms apart there): 0x600A [RX] (resolves the 3.0.0.50 gate), GET 0x6016 (USB, new
 * firmware), 0x600A for BOX, TX1, TX2 (+ TX3/TX4 in 4 Mic & 1 RX mode), the "get all" batch, (0x6009 system time:
 * a write, sent only with `syncTimeOnConnect`), GET 0x6013 (USB). Then the GETs the official app sends when a page
 * opens, so that every readable control has a value after connect (conformance check 10): 0x8044 USB Output, over
 * BLE 0x600F / 0x6010 (TC page; the USB heartbeat carries both), and on the mobile RX with monitoring on 0x6017 /
 * 0x6019 (Wireless Monitoring page). All start-up requests are background reads.
 *
 * Correlation: by command id (no sequence numbers, max2-6701.md §3.1) plus the item type, as the app branches on
 * it: a SET is answered by a type 2 ack (A `cmdType == 2 → showSetResult`), a GET by type 3 data (or a type 0 push
 * of the same item); 0x600A replies echo the unit in payload[0].
 */
import { DestructiveCommandError, DisconnectedError, UnsupportedError } from '../../device-errors'
import { controlById, controlKey, validateControlValue } from '../../core/controls'
import { FamilyDevice } from '../../core/engine'
import { ControlUnavailableError } from '../../core/errors'
import type {
  ControlId, ControlSpec, ControlValue, EngineContext, EngineRequestOptions, MicDeviceOptions, MicSetOptions, MicUnit, ProtocolSpec, SetResult,
  UnitId, WritePlan,
} from '../../core/types'
import type { ProductInfo } from '../../models'
import { unitsOf } from '../../models'
import type { Transport } from '../../transport'
import { MOMA_TYPE } from '../../moma/codec'
import { momaProfileFor, type MomaProfile } from '../../moma/profiles'
import { createMomaSpecBase, describeMoma, momaRequest, type MomaMessage, type MomaRequest } from '../../moma/spec'
import { toHex } from '../../codec'
import {
  isMax2Read, MAX2_BLE_TARGET, MAX2_CMD, MAX2_COMMANDS, MAX2_GAIN_LEVEL, MAX2_GAIN_TYPE, max2CommandOf, max2Get, max2GetAll, max2ItemKey,
  max2KeyName, max2KeysOf, max2Set, max2SystemTimePayload, max2Version, type Max2VersionUnit,
} from './commands'
import { max2Availability, max2BlindAvailability, max2Controls, max2LinkOf, MAX2_MIC_UNITS, type Max2Link } from './controls'
import {
  isMax2Box, isMax2Camera, isMax2Mobile, max2ChannelRefusal, MAX2_CONTROL, MAX2_STATUS_VALUE, MAX2_TC_RESET_TEXT, MAX2_TIMING,
} from './ids'
import { parseMax2Gain, parseMax2Heartbeat, parseMax2MicPush, parseMax2Noise, parseMax2TcTime, parseMax2Version, type Max2Heartbeat } from './status'

export { isMax2Device, MAX2_STATUS_VALUE } from './ids'


export interface Max2SpecOptions {
  /**
   * Send 0x6009 (system time, BE64 local ms) after the start-up reads, as both apps do on every connect
   * (A HLBleDeviceActivity$getDeviceAllInfo$1 SynchronizeSystemTimeIntent). Off by default: it is a write, and the
   * products are not tested on hardware; TC "Real-time Timing" needs it.
   */
  syncTimeOnConnect?: boolean
  /**
   * Over BLE, send a NC change to the RX and then to every ONLINE mic, at Android's targets (3, 4, and 10, 11 in
   * 4 Mic & 1 RX mode). Default true. Neither app does exactly this:
   *  - A BleDeviceControlViewModel.processUserIntent SetNoiseLevelIntent → AnonymousClass19 sends [on, depth] to 2,
   *    then 3 and 4 (+ 10, 11 when is6701FourMicMode) 200 ms apart, fire-and-forget, with no online check;
   *  - I -[HLLarkMAX2View updateNoiseView:selIndex:] sends it to each TX whose tx1IsOnline..tx4IsOnline is set
   *    (deviceType 1..4 @0x100010ff0 / 0x100011080 / 0x100011110 / 0x1000111a0), at targets 3, 4, 5, 5
   *    (+[NSData hl_targetByteForDeviceType:] @0x10011d288).
   * The library takes Android's targets and iOS's online filter, because every write here waits for its ack (an
   * offline mic would fail the write after the RX took it). The frames go out one ack apart plus interFrameDelayMs
   * (40 ms over BLE), not 200 ms. Which targets the mics answer through the case is open (max2-6701.md §9 #7).
   */
  bleNoiseFanOut?: boolean
  /** Clock for the system time (tests). */
  now?: () => number
  /** Time-zone offset in minutes as Date.getTimezoneOffset() (tests). */
  tzOffsetMinutes?: number
}

/** Per-device driver state the engine does not keep. */
interface Max2Session {
  link: Max2Link
  profile: MomaProfile
  controls: readonly ControlSpec[]
  units: ReadonlySet<UnitId>
  /** Heartbeat byte 19 (TX internal recording) and 27 (earphones), for availability. */
  recording?: boolean
  earConnect?: number
  /**
   * Values sent but not yet acknowledged or reported: multi-field payloads (NC, gain) are built from them, so two quick
   * changes do not undo each other. An entry lives until the device reports the key, or PENDING_MS (a failed write).
   */
  pending: Map<string, { v: ControlValue; at: number }>
  /** onUnitOnline stays quiet until the start-up reads ran (they read every unit anyway). */
  startupDone: boolean
}

type Ctx = EngineContext<MomaRequest, MomaMessage>

/** Request target per role on the link (A BleMicCmd: `isBle() ? target : identifier`; cmdMultiMapSend 2 / 0). */
function targets(link: Max2Link, profile: MomaProfile) {
  return link === 'ble'
    ? { rx: MAX2_BLE_TARGET.rx, box: MAX2_BLE_TARGET.box, ncGet: MAX2_BLE_TARGET.tx1, getAll: MAX2_BLE_TARGET.rx }
    : { rx: profile.target, box: profile.target, ncGet: profile.target, getAll: 0 }
}

/** Unit → BLE target for the NC fan-out. */
const BLE_MIC_TARGET: Readonly<Record<string, number>> = { tx1: MAX2_BLE_TARGET.tx1, tx2: MAX2_BLE_TARGET.tx2, tx3: MAX2_BLE_TARGET.tx3, tx4: MAX2_BLE_TARGET.tx4 }

const unavailable = (id: string, reason: string, message: string) => new ControlUnavailableError(id, reason, message)

/** Lifetime of a pending (sent, unconfirmed) value. */
const PENDING_MS = 2000

export function createMax2Spec(product: ProductInfo, o: Max2SpecOptions = {}): ProtocolSpec<MomaRequest, MomaMessage> {
  const link = max2LinkOf(product)
  const profile = momaProfileFor('6701', product.productId, link)
  const T = targets(link, profile)
  const session: Max2Session = {
    link, profile, controls: max2Controls(product), units: new Set(unitsOf(product)), pending: new Map(), startupDone: false,
  }
  const has = (id: string) => session.controls.some((c) => c.id === id)
  const fanOut = o.bleNoiseFanOut ?? true
  const now = o.now ?? (() => Date.now())

  const framing = createMomaSpecBase(profile, {
    commands: MAX2_COMMANDS,
    matchItem: (it, msg) => {
      if (msg.type === MOMA_TYPE.REQUEST) return false
      if (it.cmd === MAX2_CMD.DEVICE_VERSION) return msg.type !== MOMA_TYPE.EXEC_RESP && msg.payload[0] === (it.payload?.[0] ?? -1)
      return isMax2Read(max2ItemKey(it)) ? msg.type !== MOMA_TYPE.EXEC_RESP : msg.type === MOMA_TYPE.EXEC_RESP
    },
  })

  const version = (u: Max2VersionUnit) => max2Version(u, link === 'ble' ? T.box : undefined)
  const rxGet = (cmd: number) => max2Get(cmd, link === 'ble' ? T.rx : undefined)
  const rxSet = (cmd: number, payload: ArrayLike<number>) => max2Set(cmd, payload, link === 'ble' ? T.rx : undefined)
  const heartbeatReq = () => max2Get(MAX2_CMD.HEART_INFO, link === 'ble' ? T.rx : undefined)
  const ncGet = () => max2Get(MAX2_CMD.NOISE_LEVEL, link === 'ble' ? T.ncGet : undefined)

  /** Background read that never stops the start-up sequence (a unit that does not answer costs one timeout). */
  const bg = async (ctx: Ctx, req: MomaRequest, extra: EngineRequestOptions = {}) => {
    try {
      return await ctx.request(req, { priority: 'background', ...extra })
    } catch (e) {
      if (e instanceof DisconnectedError) throw e
      return null
    }
  }

  const current = (ctx: Ctx, key: string): ControlValue | undefined => {
    const p = session.pending.get(key)
    if (p && ctx.now() - p.at < PENDING_MS) return p.v
    session.pending.delete(key)
    return ctx.state.values[key]
  }
  const remember = (ctx: Ctx, values: Record<string, ControlValue>) => {
    for (const [k, v] of Object.entries(values)) session.pending.set(k, { v, at: ctx.now() })
  }

  /** Set values the device reported; keys of controls this product lacks are dropped, out-of-range values logged. */
  const report = (ctx: Ctx, vals: Record<string, ControlValue | undefined>) => {
    const out: Record<string, ControlValue> = {}
    for (const [k, v] of Object.entries(vals)) {
      if (v === undefined) continue
      session.pending.delete(k)
      const [id, unit] = k.split(':') as [string, UnitId | undefined]
      if ((Object.values(MAX2_STATUS_VALUE) as string[]).includes(k)) {
        out[k] = v
        continue
      }
      const c = session.controls.find((x) => x.id === id)
      if (!c) continue
      try {
        validateControlValue(c, v, unit)
        out[k] = v
      } catch (e) {
        ctx.note(`ignored ${k} = ${JSON.stringify(v)} from the device: ${(e as Error).message}`)
      }
    }
    if (Object.keys(out).length) ctx.setValues(out)
  }

  const patch = (ctx: Ctx, p: Partial<Record<UnitId, Partial<MicUnit>>>) => {
    const out: Partial<Record<UnitId, Partial<MicUnit>>> = {}
    for (const [u, v] of Object.entries(p) as [UnitId, Partial<MicUnit>][]) if (session.units.has(u)) out[u] = v
    ctx.patchUnits(out)
  }

  const updateAvailability = (ctx: Ctx) =>
    ctx.setAvailability(
      max2Availability(session.controls, ctx.state, {
        recording: session.recording, earConnect: session.earConnect, ignoreFirmwareGates: ctx.options.ignoreFirmwareGates,
      }),
    )

  /** RX kind: by PID over USB; through the BOX from heartbeat byte 18. */
  const rxKind = (hb?: Max2Heartbeat): MicUnit['kind'] | undefined =>
    isMax2Mobile(product) ? 'phone-rx' : isMax2Camera(product) ? 'camera-rx' : hb ? (hb.isCamera ? 'camera-rx' : 'phone-rx') : undefined

  function applyHeartbeat(ctx: Ctx, p: Uint8Array): void {
    const hb = parseMax2Heartbeat(p)
    if (!hb) {
      ctx.note(`heartbeat payload of ${p.length} B is shorter than the 33-byte layout: ignored`)
      return
    }
    session.recording = hb.recording
    session.earConnect = hb.earConnect
    const units: Partial<Record<UnitId, Partial<MicUnit>>> = {
      // A HLBleDeviceActivity.updateRxState: the mobile RX 1026 shows no battery.
      rx: { online: true, ...(isMax2Mobile(product) ? {} : { battery: hb.rxBattery }), kind: rxKind(hb) },
      // A HLBleDeviceActivity HeartInfoState: updateBoxState(boxBattery, 1, isOnline = false); the BOX is shown from 0x600A.
      box: { battery: hb.boxBattery },
    }
    hb.mics.forEach((m, i) => (units[MAX2_MIC_UNITS[i]] = { online: m.online, battery: m.battery, charging: m.charging }))
    // A updateEarState: L when earConnectStatus is 1 or 3, R when 2 or 3.
    units.earL = { online: hb.earConnect === 1 || hb.earConnect === 3, battery: hb.earL.battery, charging: hb.earL.charging }
    units.earR = { online: hb.earConnect === 2 || hb.earConnect === 3, battery: hb.earR.battery, charging: hb.earR.charging }
    patch(ctx, units)
    const gains: Record<string, number> = {}
    hb.mics.forEach((m, i) => (gains[controlKey(MAX2_CONTROL.MIC_GAIN, MAX2_MIC_UNITS[i])] = m.gain))
    const x = hb.extended
    report(ctx, {
      [MAX2_CONTROL.SPEAKER]: hb.speaker,
      [MAX2_CONTROL.BIT_DEPTH]: hb.sampleDepth,
      [MAX2_CONTROL.MIC_LOCK]: hb.micLock,
      [MAX2_CONTROL.NOISE_ENABLED]: hb.noiseOn,
      [MAX2_CONTROL.NOISE_DEPTH]: hb.noiseDepth,
      [MAX2_CONTROL.GAIN_TYPE]: hb.gainType,
      [MAX2_CONTROL.GAIN_DYNAMIC]: hb.gainLevel,
      ...gains,
      [MAX2_CONTROL.CHANNEL_MODE]: hb.channelMode,
      [MAX2_CONTROL.TC_ENABLED]: hb.tcEnabled,
      [MAX2_CONTROL.TC_MODE]: hb.tcMode,
      [MAX2_CONTROL.TC_FPS]: hb.inputFps,
      [MAX2_CONTROL.TC_TIMING]: hb.timingMode,
      [MAX2_CONTROL.MIC_RECOGNITION]: hb.txIdentify,
      ...(x
        ? {
            [MAX2_CONTROL.FOUR_MIC]: x.fourMic,
            // A WirelessMonitorActivity: isWirelessMonitor == Status.FAIL_CLOSE(1) → on.
            [MAX2_CONTROL.WIRELESS]: x.wireless === 1,
            [MAX2_CONTROL.OWS_MONITOR]: x.earMonitor === 1,
            [MAX2_STATUS_VALUE.TC_TIME]: has(MAX2_CONTROL.TC_ENABLED) ? [x.tcTime.min, x.tcTime.sec, x.tcTime.frame] : undefined,
          }
        : {}),
    })
    ctx.statusApplied(hb)
  }

  function applyVersion(ctx: Ctx, p: Uint8Array): void {
    const v = parseMax2Version(p)
    if (!v?.unit) {
      if (p.length) ctx.note(`0x600A reply for unit ${p[0]} (${p.length} B) not decoded`)
      return
    }
    const u: Partial<MicUnit> = { charging: v.charging, battery: v.battery }
    if (v.version) u.version = v.version
    if (v.serial) u.serial = v.serial
    if (v.unit === 'rx') {
      if (isMax2Mobile(product)) delete u.battery
      // Over USB the RX is the device we talk to; through the BOX the reply says whether it is there.
      u.online = link === 'usb' ? true : v.online
    } else {
      u.online = v.online
    }
    patch(ctx, { [v.unit]: u })
  }

  function onItem(ctx: Ctx, msg: MomaMessage): void {
    const p = msg.payload
    const b0 = p[0]
    switch (msg.cmd) {
      case MAX2_CMD.HEART_INFO:
        return applyHeartbeat(ctx, p)
      case MAX2_CMD.DEVICE_VERSION:
        return applyVersion(ctx, p)
      case MAX2_CMD.BOX_BATTERY:
        // Pushed by the BOX (A parseNotifyResult → BoxBatteryInfoResult); the BOX is the BLE peer, so it is there.
        if (p.length) patch(ctx, { box: { battery: b0, ...(link === 'ble' ? { online: true } : {}) } })
        return
      case MAX2_CMD.RX_BATTERY:
        if (p.length && !isMax2Mobile(product)) patch(ctx, { rx: { battery: b0 } })
        return
      case MAX2_CMD.MIC_BATTERY: {
        const m = parseMax2MicPush(p)
        if (m) patch(ctx, { tx1: m[0], tx2: m[1] })
        return
      }
    }
    if (!p.length) return
    switch (msg.cmd) {
      case MAX2_CMD.RX_OUTSWITCH:
        return report(ctx, { [MAX2_CONTROL.SPEAKER]: b0 === 1 })
      case MAX2_CMD.RX_SAMPLING:
        return report(ctx, { [MAX2_CONTROL.BIT_DEPTH]: b0 })
      case MAX2_CMD.MIC_LOCK:
        return report(ctx, { [MAX2_CONTROL.MIC_LOCK]: b0 === 1 })
      case MAX2_CMD.NOISE_LEVEL: {
        const n = parseMax2Noise(msg.type, p)
        if (n) report(ctx, { [MAX2_CONTROL.NOISE_ENABLED]: n.on, [MAX2_CONTROL.NOISE_DEPTH]: n.depth })
        return
      }
      case MAX2_CMD.VOICE_GAIN: {
        const g = parseMax2Gain(msg.type, p)
        if (!g) return
        const gains: Record<string, number> = {}
        g.gains?.forEach((v, i) => (gains[controlKey(MAX2_CONTROL.MIC_GAIN, MAX2_MIC_UNITS[i])] = v))
        return report(ctx, { [MAX2_CONTROL.GAIN_TYPE]: g.gainType, [MAX2_CONTROL.GAIN_DYNAMIC]: g.level, ...gains })
      }
      case MAX2_CMD.VOCAL_TRACT:
        return report(ctx, { [MAX2_CONTROL.CHANNEL_MODE]: b0 })
      case MAX2_CMD.TC_SWITCH:
        return report(ctx, { [MAX2_CONTROL.TC_ENABLED]: b0 === 1 })
      case MAX2_CMD.TC_MODE:
        return report(ctx, { [MAX2_CONTROL.TC_MODE]: b0 })
      case MAX2_CMD.INPUT_FPS:
        return report(ctx, { [MAX2_CONTROL.TC_FPS]: b0 })
      case MAX2_CMD.TIMING_MODE:
        return report(ctx, { [MAX2_CONTROL.TC_TIMING]: b0 })
      case MAX2_CMD.TX_IDENTIFY:
        return report(ctx, { [MAX2_CONTROL.MIC_RECOGNITION]: b0 === 1 })
      case MAX2_CMD.SWITCH_MIC_QUANTITY:
        // A HLBleDeviceActivity MicQuantityState: updateFourMicOneRxState(data == 1).
        return report(ctx, { [MAX2_CONTROL.FOUR_MIC]: b0 === 1 })
      case MAX2_CMD.EARPHONE_PAIR:
        // A WirelessMonitorActivity.updateEarPairState: isPaired = pairStatus != SUC_OPEN(0).
        return report(ctx, { [MAX2_STATUS_VALUE.OWS_PAIRED]: b0 !== 0 })
      case MAX2_CMD.EARPHONE_MONITOR:
        return report(ctx, { [MAX2_CONTROL.OWS_MONITOR]: b0 === 1 })
      case MAX2_CMD.EARPHONE_VOLUME:
        return report(ctx, { [MAX2_CONTROL.OWS_VOLUME]: b0 })
      case MAX2_CMD.WIRELESS_STATUS:
        return report(ctx, { [MAX2_CONTROL.WIRELESS]: b0 === 1 })
      case MAX2_CMD.UAC_OUT_MODE_GET:
        return report(ctx, { [MAX2_CONTROL.USB_OUTPUT]: b0 })
      case MAX2_CMD.START_ZERO_TIMING: {
        const t = parseMax2TcTime(p)
        if (t) report(ctx, { [MAX2_STATUS_VALUE.TC_TIME]: [t.hour, t.min, t.sec, t.frame] })
        return
      }
    }
  }

  /** The GETs the official app sends when a page opens, for readable controls the status does not carry here. */
  async function pageReads(ctx: Ctx): Promise<void> {
    await bg(ctx, rxGet(MAX2_CMD.UAC_OUT_MODE_GET))
    if (link === 'ble' && has(MAX2_CONTROL.TC_FPS)) {
      // A TimeCodeActivity.initData coroutine: GetTcSwitch, GetTcMode, GetInputFps, GetTiming (100 ms apart). Switch and
      // mode came with "get all"; over USB the heartbeat carries fps and timing (bytes 21, 22).
      await bg(ctx, rxGet(MAX2_CMD.INPUT_FPS))
      await bg(ctx, rxGet(MAX2_CMD.TIMING_MODE))
    }
    const owsOpen = has(MAX2_CONTROL.OWS_VOLUME) && ctx.state.availability[MAX2_CONTROL.WIRELESS]?.ok !== false && ctx.state.values[MAX2_CONTROL.WIRELESS] === true
    if (owsOpen) {
      // A WirelessMonitorActivity.initData GetEarphonePairIntent, then (connected) GetEarphoneVolume / GetEarphoneMonitor.
      await bg(ctx, rxGet(MAX2_CMD.EARPHONE_PAIR))
      await bg(ctx, rxGet(MAX2_CMD.EARPHONE_VOLUME))
    }
  }

  async function identity(ctx: Ctx, all: boolean): Promise<void> {
    if (all) await bg(ctx, version('rx'))
    await bg(ctx, version('box'))
    const four = ctx.state.values[MAX2_CONTROL.FOUR_MIC] === true
    for (const u of ['tx1', 'tx2', ...(four ? ['tx3', 'tx4'] : [])] as Max2VersionUnit[]) await bg(ctx, version(u))
  }

  async function settings(ctx: Ctx): Promise<void> {
    await bg(ctx, max2GetAll(T.getAll))
    if (link === 'usb') await bg(ctx, rxGet(MAX2_CMD.TX_IDENTIFY))
    await pageReads(ctx)
  }

  const spec: ProtocolSpec<MomaRequest, MomaMessage> = {
    ...framing,
    commandOf: max2CommandOf,
    commandsOf: max2KeysOf,
    describe(x) {
      if ('items' in x) {
        const items = x.items.map((it) => `${max2KeyName(max2ItemKey(it))}${it.payload?.length ? ` [${toHex(Array.from(it.payload))}]` : ''}`)
        const to = x.target !== undefined && x.target !== profile.target ? ` → target ${x.target}` : ''
        return `${items.length > 1 ? `batch ${items.length}: ` : ''}${items.join(', ')}${to}`
      }
      return describeMoma(x, { commands: MAX2_COMMANDS, defaultTarget: profile.target })
    },
    // USB: the heartbeat (A HLBleDeviceActivity$mRunnable$1). BLE: the BOX's own 0x600A [0], which needs no forwarding.
    probe: () => (link === 'usb' ? heartbeatReq() : version('box')),
    heartbeat: { request: heartbeatReq, intervalMs: 3000 },
    async onConnected(ctx) {
      session.startupDone = false
      try {
        if (ctx.options.fetchIdentity) await bg(ctx, version('rx'))
        updateAvailability(ctx)
        // A HLBleDeviceActivity.getFourModeOrVersion: GetMicQuantityIntent when isNew6701USBDevice.
        if (ctx.options.fetchSettings && has(MAX2_CONTROL.FOUR_MIC) && ctx.state.availability[MAX2_CONTROL.FOUR_MIC]?.ok) {
          await bg(ctx, rxGet(MAX2_CMD.SWITCH_MIC_QUANTITY))
        }
        if (ctx.options.fetchIdentity) await identity(ctx, false)
        if (ctx.options.fetchSettings) await settings(ctx)
        if (o.syncTimeOnConnect) {
          await ctx.request(rxSet(MAX2_CMD.SYSTEM_TIME, max2SystemTimePayload(now(), o.tzOffsetMinutes))).catch(() => null)
        }
      } finally {
        session.startupDone = true
        updateAvailability(ctx)
      }
    },
    onMessage(ctx, msg) {
      // Set acknowledgements carry no state (A: `cmdType == 2 → showSetResult`).
      if (msg.type === MOMA_TYPE.EXEC_RESP) return
      onItem(ctx, msg)
      updateAvailability(ctx)
    },
    onUnitOnline(ctx, unit) {
      if (!session.startupDone || !unit.startsWith('tx')) return
      // A HLBleDeviceActivity DeviceVersionInfoState: a TX that comes online triggers GetNoiseLevelIntent; its version
      // and serial come with 0x600A. The NC GET goes to TX1 (A BleMicCmd.getNoiseLevelStatus: target 3) whichever TX
      // came online; iOS reads it from that TX instead (-[HLBleViewModel seprateDataWithCmdNum:] → +[HL6701Messenger
      // sendGetDeviceNoiseWithType:] with types 2 / 3 / 1 / 4 as each 0x600A arrives).
      if (ctx.options.fetchIdentity) void bg(ctx, version(unit as Max2VersionUnit))
      if (ctx.options.fetchSettings) void bg(ctx, ncGet())
    },
    async refresh(ctx, what) {
      if (what === 'status') await ctx.request(heartbeatReq())
      else if (what === 'identity') await identity(ctx, true)
      else await settings(ctx)
    },
    encodeSet(ctx, id, value, { unit }) {
      return encodeSet(ctx, id, value, unit)
    },
    blindAvailability: (ctx) => max2BlindAvailability(session.controls, ctx.state, { ignoreFirmwareGates: ctx.options.ignoreFirmwareGates }),
    controls: () => session.controls,
    timing: link === 'usb'
      // A USBHIDService CommandExecutionConfig(timeout = 250 ms write, timeoutRead = 1000 ms).
      ? { replyTimeoutMs: 1000, probeTimeoutMs: 1500, interFrameDelayMs: 20 }
      // BLE through the BOX: one more hop; A BleFileUpload.BLE_REPLY_TIME_OUT = 3000 ms for OTA replies.
      : { replyTimeoutMs: 1500, probeTimeoutMs: 2000, interFrameDelayMs: 40 },
  }

  function noisePlan(ctx: Ctx, id: ControlId, value: ControlValue): WritePlan<MomaRequest> {
    // A SetNoiseLevelIntent(isOpen, progress): the depth slider always sends on = true.
    const on = id === MAX2_CONTROL.NOISE_ENABLED ? value === true : true
    const depth = id === MAX2_CONTROL.NOISE_DEPTH ? (value as number) : current(ctx, MAX2_CONTROL.NOISE_DEPTH)
    if (typeof depth !== 'number') throw unavailable(id, 'state-unknown', 'the NC depth is not known yet; read the status first')
    const payload = [on ? 1 : 0, depth]
    const requests = [rxSet(MAX2_CMD.NOISE_LEVEL, payload)]
    if (link === 'ble' && fanOut) {
      const four = ctx.state.values[MAX2_CONTROL.FOUR_MIC] === true
      for (const u of four ? MAX2_MIC_UNITS : MAX2_MIC_UNITS.slice(0, 2)) {
        if (ctx.state.units[u]?.online) requests.push(max2Set(MAX2_CMD.NOISE_LEVEL, payload, BLE_MIC_TARGET[u]))
      }
    }
    const optimistic = { [MAX2_CONTROL.NOISE_ENABLED]: on, [MAX2_CONTROL.NOISE_DEPTH]: depth }
    remember(ctx, optimistic)
    return { requests, optimistic }
  }

  function gainPlan(ctx: Ctx, id: ControlId, value: ControlValue, unit?: UnitId): WritePlan<MomaRequest> {
    // A SetVoiceGainIntent: [type, level, g1, g2] or, in 4 Mic & 1 RX mode, [type, level, g1, g2, g3, g4].
    const four = current(ctx, MAX2_CONTROL.FOUR_MIC) === true
    const mics = four ? MAX2_MIC_UNITS : MAX2_MIC_UNITS.slice(0, 2)
    if (id === MAX2_CONTROL.MIC_GAIN && unit && !mics.includes(unit)) throw unavailable(id, 'two-mic-mode', 'Mic 3/4 exist in 4 Mic & 1 RX mode only')
    const gains = mics.map((u) => (id === MAX2_CONTROL.MIC_GAIN && u === unit ? (value as number) : current(ctx, controlKey(MAX2_CONTROL.MIC_GAIN, u))))
    if (gains.some((g) => typeof g !== 'number')) throw unavailable(id, 'state-unknown', 'the mic gains are not known yet; read the status first')
    let type: number
    let level: number
    if (id === MAX2_CONTROL.GAIN_DYNAMIC) {
      type = MAX2_GAIN_TYPE.DYNAMIC
      level = value as number
    } else if (id === MAX2_CONTROL.GAIN_TYPE && value === MAX2_GAIN_TYPE.DYNAMIC) {
      type = MAX2_GAIN_TYPE.DYNAMIC
      const l = current(ctx, MAX2_CONTROL.GAIN_DYNAMIC)
      level = typeof l === 'number' ? l : MAX2_GAIN_LEVEL.HIGH
    } else {
      // A initView seek-bar listeners: SetVoiceGainIntent(CUSTOM_GAIN, VoiceGainLevel.STRONG_GAIN.getLevel(), …).
      type = MAX2_GAIN_TYPE.CUSTOM
      level = MAX2_GAIN_LEVEL.HIGH
    }
    const optimistic: Record<string, ControlValue> = { [MAX2_CONTROL.GAIN_TYPE]: type, [MAX2_CONTROL.GAIN_DYNAMIC]: level }
    mics.forEach((u, i) => (optimistic[controlKey(MAX2_CONTROL.MIC_GAIN, u)] = gains[i] as number))
    remember(ctx, optimistic)
    return { requests: [rxSet(MAX2_CMD.VOICE_GAIN, [type, level, ...(gains as number[])])], optimistic }
  }

  function encodeSet(ctx: Ctx, id: ControlId, value: ControlValue, unit?: UnitId): WritePlan<MomaRequest> {
    const bool = (cmd: number) => ({ requests: [rxSet(cmd, [value ? 1 : 0])], optimistic: { [id]: value } })
    const num = (cmd: number) => ({ requests: [rxSet(cmd, [value as number])], optimistic: { [id]: value } })
    switch (id) {
      case MAX2_CONTROL.SPEAKER:
        return bool(MAX2_CMD.RX_OUTSWITCH)
      case MAX2_CONTROL.BIT_DEPTH:
        return num(MAX2_CMD.RX_SAMPLING)
      case MAX2_CONTROL.USB_OUTPUT:
        // A initView lambda 17: 32bit float on "USB Output" only toasts "Only supports Apple devices."; lambda 18 sends 0.
        // Max2Device.set refuses the value before the confirm check; this is the encoder's own guard.
        if (value !== 0) throw unavailable(id, 'apple-only', 'Only supports Apple devices.')
        return { requests: [rxSet(MAX2_CMD.UAC_OUT_MODE_SET, [0])], optimistic: { [id]: 0 }, readBack: { request: rxGet(MAX2_CMD.UAC_OUT_MODE_GET) } }
      case MAX2_CONTROL.MIC_LOCK:
        return bool(MAX2_CMD.MIC_LOCK)
      case MAX2_CONTROL.NOISE_ENABLED:
      case MAX2_CONTROL.NOISE_DEPTH:
        return noisePlan(ctx, id, value)
      case MAX2_CONTROL.GAIN_TYPE:
      case MAX2_CONTROL.GAIN_DYNAMIC:
      case MAX2_CONTROL.MIC_GAIN:
        return gainPlan(ctx, id, value, unit)
      case MAX2_CONTROL.CHANNEL_MODE: {
        const r = max2ChannelRefusal(product, value as number, ctx.state.values)
        if (r) throw unavailable(id, r.reason, r.message)
        return num(MAX2_CMD.VOCAL_TRACT)
      }
      case MAX2_CONTROL.TC_ENABLED:
        return bool(MAX2_CMD.TC_SWITCH)
      case MAX2_CONTROL.TC_MODE:
        return num(MAX2_CMD.TC_MODE)
      case MAX2_CONTROL.TC_FPS:
        return num(MAX2_CMD.INPUT_FPS)
      case MAX2_CONTROL.TC_TIMING:
        // A TimeCodeActivity.updateTimingModeView: the Reset row is visible only while the method is Count From Zero.
        if (value === MAX2_TIMING.RESET && ctx.state.values[MAX2_CONTROL.TC_TIMING] === MAX2_TIMING.REAL_TIME) {
          throw unavailable(id, 'real-time-timing', 'Reset is offered in Count From Zero only')
        }
        return num(MAX2_CMD.TIMING_MODE)
      case MAX2_CONTROL.MIC_RECOGNITION:
        return bool(MAX2_CMD.TX_IDENTIFY)
      case MAX2_CONTROL.FOUR_MIC:
        return bool(MAX2_CMD.SWITCH_MIC_QUANTITY)
      case MAX2_CONTROL.RX_PAIR:
        // A BleMicCmd.setMobileRxPair: cmdSingleSend (empty payload).
        return { requests: [momaRequest(MAX2_CMD.MOBILE_RX_PAIR, [], link === 'ble' ? { target: T.rx } : {})] }
      case MAX2_CONTROL.WIRELESS:
        // A WirelessMonitorActivity: on → Status.FAIL_CLOSE (1), off → SUC_OPEN (0).
        return bool(MAX2_CMD.WIRELESS_STATUS)
      case MAX2_CONTROL.OWS_MONITOR:
        return bool(MAX2_CMD.EARPHONE_MONITOR)
      case MAX2_CONTROL.OWS_VOLUME:
        // A WirelessMonitorActivity EarphoneVolumeState type 2 → GetEarphoneVolumeIntent.
        return { ...num(MAX2_CMD.EARPHONE_VOLUME), readBack: { request: rxGet(MAX2_CMD.EARPHONE_VOLUME) } }
      case MAX2_CONTROL.OWS_PAIR:
        // A WirelessMonitorActivity earPairBtn → SetEarphonePairIntent(Status.SUC_OPEN (0)).
        return { requests: [rxSet(MAX2_CMD.EARPHONE_PAIR, [0])], readBack: { request: rxGet(MAX2_CMD.EARPHONE_PAIR), delayMs: 1000 } }
      default:
        throw new UnsupportedError(`${id} is not a LARK MAX 2 control`)
    }
  }

  return spec
}

/**
 * The LARK MAX 2 MicDevice: FamilyDevice plus the value-dependent rules ControlSpec.safety cannot express:
 *  - Timing Method: Count From Zero ↔ Real-time Timing is a plain write, but Reset (2) is sent only after the app's
 *    confirm dialog (A TimeCodeActivity$initView$1$17$1 awaits confirmReset() before SetTimingIntent(RESET)), so it
 *    needs { confirm: true }, as every disruptive control;
 *  - USB Output: 32bit float is refused ("Only supports Apple devices.", A initView lambda 17) before the confirm
 *    check, so the refusal says why instead of asking for a confirm that could not help.
 */
export class Max2Device extends FamilyDevice<MomaRequest, MomaMessage> {
  /** Whether `set(MAX2_CONTROL.TC_TIMING, value)` needs { confirm: true } (for the UI's dialog: MAX2_TC_RESET_TEXT). */
  timingNeedsConfirm(value: number): boolean {
    return value === MAX2_TIMING.RESET
  }

  override async set(id: ControlId, value: ControlValue, o: MicSetOptions = {}): Promise<SetResult> {
    const control = controlById(this.controls, id)
    if (control && id === MAX2_CONTROL.USB_OUTPUT && validateControlValue(control, value, o.unit) !== 0) {
      throw new ControlUnavailableError(id, 'apple-only', 'Only supports Apple devices.')
    }
    if (control && id === MAX2_CONTROL.TC_TIMING && o.confirm !== true) {
      const v = validateControlValue(control, value, o.unit) as number
      const s = this.state
      // Refusals the engine would give first keep their type (not connected, replies not delivered).
      const engineRefuses = !s.connected || (s.rx === 'unavailable' && !this.opts.blindWrites)
      if (!engineRefuses && this.timingNeedsConfirm(v)) {
        throw new DestructiveCommandError(`Timing Method: ${MAX2_TC_RESET_TEXT} Pass { confirm: true }.`)
      }
    }
    return super.set(id, value, o)
  }
}

/** A MicDevice for a LARK MAX 2 row (USB RX 1026 / 1027 or the BLE charging case 101). */
export function createMax2Device(transport: Transport, product: ProductInfo, o: MicDeviceOptions = {}, so: Max2SpecOptions = {}): Max2Device {
  const p = o.product ?? product
  if (p.idKind === 'app' && !isMax2Box(p)) throw new UnsupportedError(`${p.name} (${p.productId}) has no MAX 2 control link`)
  return new Max2Device(transport, p, { family: '6701', commands: MAX2_COMMANDS, spec: createMax2Spec(p, so) }, o)
}
