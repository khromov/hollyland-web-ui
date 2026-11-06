/**
 * MeloDevice: FamilyDevice for the MELO P1 receiver, plus the device-pushed VU level stream.
 *
 *   const mic = createMeloDevice(transport, product)          // profile from the transport (BLE or USB)
 *   await mic.connect()
 *   const off = mic.onLevels((l) => draw(l.inputs, l.outputs)) // dB per input and output, every ~100 ms
 *   await mic.startLevels()                                     // 0x11E0 + 0x6048 (writes: the device starts pushing)
 *   …
 *   await mic.stopLevels()                                      // 0x6049
 *
 * The levels are not MicState.values (they change ten times a second and are no setting); `levels` holds the
 * last push. A subscription survives a reconnect of the same device (onConnected sends it again), as the app's
 * C6201VuSubscriptionCoordinator keeps its owners across pages. MELO P1 meters work without microphone
 * permission, unlike the app-side meters of the other families (FAMILIES.md §4.1).
 */
import { DisconnectedError } from '../../device-errors'
import { FamilyDevice } from '../../core/engine'
import type { MicDeviceOptions, MicState } from '../../core/types'
import type { ProductInfo } from '../../models'
import { MOMA_6201_BLE, MOMA_6201_IOS, MOMA_6201_USB, type MomaProfile } from '../../moma/profiles'
import type { MomaMessage, MomaRequest } from '../../moma/spec'
import type { Transport } from '../../transport'
import { MELO_COMMANDS } from './commands'
import { createMeloSpec, MeloSession, meloStructure, startMeloLevels, stopMeloLevels, type MeloLevelListener } from './protocol'
import type { MeloLevels } from './status'

export { hasMeloLevels } from './ids'

export interface MeloDeviceOptions extends MicDeviceOptions {
  /** Default: 'ble' on a Web Bluetooth transport (kind 'web-bluetooth' or capabilities.link 'gatt'), else 'usb'. */
  link?: 'usb' | 'ble'
  /**
   * 'android' (default): control 0x04 + XOR, target 0 (USB) / 1 (BLE), as A Protocol6201Provider.
   * 'ios': control 0x00, no checksum, target 1 (I +[NSData requestCommand:payload:] @0x10011d7e0), for the
   * hardware check of "does the reply carry XOR when the request had none" (FAMILIES.md §5.7 row 6201).
   */
  framing?: 'android' | 'ios'
  /**
   * connect() resolves once the start-up reads (device info, More Settings and mixer GETs) are answered, or after
   * this many ms, whichever comes first (default 4000; 0 = resolve right after the probe). The reads continue in
   * the background after the budget. Default budget: 9 reads take about 0.5 s over BLE; an unanswered GET costs
   * up to 3 × 500 ms (retries of the reply timeout).
   */
  startupWaitMs?: number
}

/** Default MeloDeviceOptions.startupWaitMs. */
export const MELO_STARTUP_WAIT_MS = 4000

/** Which link a transport is: GATT → 'ble' (MOMA_6201_BLE, target 1), anything else → 'usb' (MOMA_6201_USB, target 0). */
export function meloLinkOf(t: Transport): 'usb' | 'ble' {
  return t.kind === 'web-bluetooth' || t.capabilities?.link === 'gatt' ? 'ble' : 'usb'
}

export function meloProfileFor(link: 'usb' | 'ble', framing: 'android' | 'ios' = 'android'): MomaProfile {
  if (framing === 'ios') return MOMA_6201_IOS
  return link === 'ble' ? MOMA_6201_BLE : MOMA_6201_USB
}

export class MeloDevice extends FamilyDevice<MomaRequest, MomaMessage> {
  readonly link: 'usb' | 'ble'
  readonly profile: MomaProfile
  /** Shared with the protocol hooks: structs, device info per type, level stream. */
  readonly session: MeloSession
  private readonly startupWaitMs: number

  constructor(transport: Transport, product: ProductInfo, o: MeloDeviceOptions = {}) {
    const link = o.link ?? meloLinkOf(transport)
    const profile = meloProfileFor(link, o.framing)
    const session = new MeloSession()
    const { link: _l, framing: _f, startupWaitMs, ...rest } = o
    super(transport, product, { family: '6201', commands: MELO_COMMANDS, spec: createMeloSpec(profile, session) }, rest)
    this.link = link
    this.profile = profile
    this.session = session
    this.startupWaitMs = startupWaitMs ?? MELO_STARTUP_WAIT_MS
    this.on('disconnect', () => session.linkDown())
  }

  /**
   * Probe (0x600B), then wait for the start-up reads within the budget (MeloDeviceOptions.startupWaitMs): the first
   * state a page shows is populated, and the read-modify-write setters (0x130A, 0x1308, 0x1319, 0x2000, 0x1142)
   * have their struct. With replies dropped (`rx: 'unavailable'`) nothing is read and this returns at once.
   */
  override async connect(): Promise<MicState> {
    await super.connect()
    if (this.state.rx === 'available' && this.startupWaitMs > 0) await this.idle(this.startupWaitMs)
    return this.state
  }

  override async disconnect(): Promise<void> {
    this.session.linkDown()
    await super.disconnect()
  }

  /** V1 or V2 payload structures (RX 4.0.0.1, A Protocol6201SessionState.isNewStructure); null while the version is unknown. */
  get structure(): 'v1' | 'v2' | null {
    return meloStructure(this.state.units.rx.version)
  }

  /** Last pushed levels (null before the first push). */
  get levels(): MeloLevels | null {
    return this.session.latestLevels
  }

  /** 0x6048 was acknowledged and not stopped since. */
  get levelsActive(): boolean {
    return this.session.levelsActive
  }

  onLevels(listener: MeloLevelListener): () => void {
    return this.session.onLevels(listener)
  }

  /** Subscribe to the VU push (0x11E0 inputs + outputs, then 0x6048 for 0x11EB every `intervalMs`, app default 100). */
  async startLevels(o: { intervalMs?: number } = {}): Promise<void> {
    const ctx = this.session.ctx
    if (!ctx || !this.state.connected) throw new DisconnectedError('not connected')
    await startMeloLevels(ctx, this.session, o.intervalMs ?? 100)
  }

  /** 0x6049 (stops every device push). */
  async stopLevels(): Promise<void> {
    const ctx = this.session.ctx
    this.session.levelsWanted = null
    if (!ctx || !this.state.connected) {
      this.session.levelsActive = false
      return
    }
    await stopMeloLevels(ctx, this.session)
  }
}

export function createMeloDevice(transport: Transport, product: ProductInfo, o: MeloDeviceOptions = {}): MeloDevice {
  return new MeloDevice(transport, product, o)
}
