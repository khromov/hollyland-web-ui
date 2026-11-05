/**
 * Product registry: USB VID/PID -> model, protocol family and capabilities.
 *
 * Sources: Android application/common/protocol/Product.java (PIDs),
 * application/common/compatibility/DeviceCompat.getDeviceName + res/values/strings.xml (names),
 * iOS -[EADSessionManager setupControllerForAccessory:withProtocolString:] @0x10012477c and
 * +[HLDeviceUtils getDeviceNameWithType:] @0x1003210e0 (EA model numbers / display names).
 * See docs/PROTOCOL.md §4.
 */
import { isNewerVersionAndroid, isNewerVersionIos, isVersionMissing, lastVersionComponent, type Family } from './commands'

export const HOLLYLAND_VENDOR_ID = 0x3547
/** EAGLESHERO OEM builds of the Lark M2 (USBHIDService.isSupportedUsbDevice). */
export const EAGLESHERO_VENDOR_ID = 0x4417

export type RxVariant = 'mobile' | 'camera'

export interface Capabilities {
  heartbeat: boolean
  /** Version command id: 0x41 (6118) or 0x03 (M2/M2S). */
  versionCmd: 0x41 | 0x03
  serial: boolean
  /** Max noise level (0 = off): 3 on 6118, 2 on M2/M2S. */
  noiseMaxLevel: number
  noiseToggle: boolean
  /** RX volume: number of steps (values 0..steps-1). */
  volumeSteps: number
  /** Supported channel modes (0 mono, 1 stereo, 2 safety track). */
  channelModes: readonly number[]
  voicePreset: boolean
  led: boolean
  micRecognition: boolean
  smartBattery: boolean
  speakerPassthrough: boolean
  autoPowerOff: boolean
  voiceLock: boolean
  customButtons: boolean
  removePairing: boolean
  factoryReset: boolean
  restartRx: boolean
  /** Camera-RX battery/charging in heartbeat bytes 15/16. */
  rxBattery: boolean
  /** Firmware upload exists in the apps (not implemented here). */
  ota: boolean
  /**
   * Features that also need a minimum RX firmware. Until the RX version is known they count as
   * unavailable (see resolveFeatures / HollylandDevice.features).
   */
  firmwareGates?: Partial<Record<GatedFeature, VersionGate>>
}

export type GatedFeature = 'noiseToggle' | 'voiceLock' | 'led' | 'customButtons'

/**
 * RX firmware requirement. Where the apps disagree the library takes the intersection, so a
 * feature is offered only where both apps would offer it.
 */
export interface VersionGate {
  /** Android Util.isNewVersion(rxVersion, ref): strictly newer, first 4 parts. */
  androidAbove?: string
  /** iOS `compare:options:NSNumericSearch` == NSOrderedDescending against ref. */
  iosAbove?: string
  /** iOS: last '.' component as int >= n (Lark M2 noise switch). */
  iosLastComponentAtLeast?: number
  /** Where the rule comes from. */
  source: string
}

export function versionGatePasses(gate: VersionGate, rxVersion: string | undefined): boolean {
  if (isVersionMissing(rxVersion)) return false
  if (gate.androidAbove && !isNewerVersionAndroid(rxVersion, gate.androidAbove)) return false
  if (gate.iosAbove && !isNewerVersionIos(rxVersion, gate.iosAbove)) return false
  if (gate.iosLastComponentAtLeast !== undefined && (lastVersionComponent(rxVersion) ?? -1) < gate.iosLastComponentAtLeast) return false
  return true
}

export type FeatureGateState = 'ok' | 'version-unknown' | 'firmware-too-old'

export interface ResolvedFeatures {
  /** Capabilities with every gated feature that does not pass set to false. */
  caps: Capabilities
  /** Per gated feature: why it is (un)available. */
  gates: Partial<Record<GatedFeature, FeatureGateState>>
}

/**
 * Runtime feature set: the PID's static capabilities, minus the firmware-gated features whose
 * gate does not pass for `rxVersion` (or all of them while the version is unknown, unless
 * `ignoreFirmwareGates`).
 */
export function resolveFeatures(
  caps: Capabilities | null,
  rxVersion: string | undefined,
  o: { ignoreFirmwareGates?: boolean } = {},
): ResolvedFeatures | null {
  if (!caps) return null
  const out: Capabilities = { ...caps }
  const gates: ResolvedFeatures['gates'] = {}
  for (const [k, gate] of Object.entries(caps.firmwareGates ?? {}) as [GatedFeature, VersionGate][]) {
    if (!caps[k]) continue
    const state: FeatureGateState = o.ignoreFirmwareGates || versionGatePasses(gate, rxVersion)
      ? 'ok'
      : isVersionMissing(rxVersion) ? 'version-unknown' : 'firmware-too-old'
    gates[k] = state
    if (state !== 'ok') out[k] = false
  }
  return { caps: out, gates }
}

export interface ProductInfo {
  vendorId: number
  productId: number
  /** Marketing name (overseas Android strings.xml). */
  name: string
  /** Name used by the Chinese "Moma" brand build of the iOS app, if different. */
  chinaName?: string
  /** Internal product code. */
  code: string
  /** Protocol family understood by this library, or null for out-of-scope products. */
  family: Family | null
  variant: RxVariant | null
  /** Number of TX units / audio channels. */
  txCount: number
  channels: number
  /** iOS EA modelNumber (lowercase) for cross-reference. */
  eaModel?: string
  /** Heartbeat interval used by the Android app (ms). */
  heartbeatIntervalMs: number
  capabilities: Capabilities | null
  notes?: string
}

const NONE: Capabilities = {
  heartbeat: false, versionCmd: 0x03, serial: false, noiseMaxLevel: 0, noiseToggle: false, volumeSteps: 0, channelModes: [],
  voicePreset: false, led: false, micRecognition: false, smartBattery: false, speakerPassthrough: false, autoPowerOff: false,
  voiceLock: false, customButtons: false, removePairing: false, factoryReset: false, restartRx: false, rxBattery: false, ota: false,
}

const CAPS_6118_MOBILE: Capabilities = {
  ...NONE,
  heartbeat: true, versionCmd: 0x41, serial: true, noiseMaxLevel: 3, noiseToggle: true,
  volumeSteps: 6, // C6118DeviceActivityKt.homeRxVolumeStepCount(1041) = 6 (iOS HLLark6118View setTotalCount:6 @0x100662cf8)
  channelModes: [0, 1, 2], voicePreset: true, led: true, micRecognition: true,
  smartBattery: true, // MoreSetting6118ActivityKt.shouldShowSmartBatteryItem(i) = (i == 1041)
  speakerPassthrough: true, autoPowerOff: true, removePairing: true, factoryReset: true, restartRx: true, ota: true,
}

const CAPS_6118_CAMERA: Capabilities = {
  ...CAPS_6118_MOBILE,
  volumeSteps: 3, // homeRxVolumeStepCount(1042) = 3 (iOS setTotalCount:3 @0x1006666e0)
  smartBattery: false, // shouldShowSmartBatteryItem(1042) = false; the app still sends the 0x3E GET
  rxBattery: true, // C6118DeviceActivityKt.shouldShowRxCameraStatus(1042)
}

/** M2 / M2S volume: Android 6 buttons, tags 0..5 (DeviceCompat.getVoiceLevels, layout
 * activity_hldevice(_6302).xml voice_1..voice_6). iOS HLLarkM2View voiceView offers only 3
 * (0..2, @0x1000cf958). Unresolved; the library keeps the Android range (PROTOCOL.md §12 #33). */
const M2_VOLUME_STEPS = 6

const GATE_6301_SPEC: VersionGate = {
  androidAbove: '2.0.0.31', iosLastComponentAtLeast: 32,
  source: 'A HLDeviceActivity.onEvent cmd 3 (isNew6301CameraOrMobile, SPEC_VERSION "2.0.0.31"); I applyRXVersionCapabilities: @0x1000bd810-0x1000bd824',
}
const GATE_6301_LOCK: VersionGate = {
  androidAbove: '2.0.0.31',
  source: 'A HLDeviceActivity.onEvent cmd 3 (isNew6301Camera) + setVoiceLockVisibility; iOS needs only isCameraDevice',
}
const GATE_6302_SPEC: VersionGate = {
  androidAbove: '2.0.0.9', iosAbove: '2.0.0.9',
  source: 'A HLDevice6302Activity.onResGetVersion (SPEC_VERSION "2.0.0.9", ctLight); I applyRXVersionCapabilities: @0x1000bd880-0x1000bd8e0 (showKeyFunc)',
}

const CAPS_6301_MOBILE: Capabilities = {
  ...NONE,
  heartbeat: true, versionCmd: 0x03, serial: true, noiseMaxLevel: 2,
  noiseToggle: true, // gated, see firmwareGates
  volumeSteps: M2_VOLUME_STEPS, channelModes: [], speakerPassthrough: true,
  voiceLock: false, // HLDeviceActivity.setVoiceLockVisibility: only isNew6301Camera (PID 8/33) or 1030
  restartRx: true, ota: true,
  firmwareGates: { noiseToggle: GATE_6301_SPEC },
}

const CAPS_6301_CAMERA: Capabilities = {
  ...CAPS_6301_MOBILE,
  voiceLock: true,
  firmwareGates: { noiseToggle: GATE_6301_SPEC, voiceLock: GATE_6301_LOCK },
}

const CAPS_6302_MOBILE: Capabilities = {
  ...NONE,
  heartbeat: true, versionCmd: 0x03, serial: true, noiseMaxLevel: 2,
  noiseToggle: true, // always: HLDevice6302Activity; I applyRXVersionCapabilities type 7 (@0x1000bd860)
  volumeSteps: M2_VOLUME_STEPS, channelModes: [0, 1], led: true, speakerPassthrough: true, autoPowerOff: true,
  voiceLock: false, // HLDevice6302Activity.initView: voiceLock visible only for productId == 1030
  customButtons: true, restartRx: true, ota: true,
  // Android shows the custom-button entry on every firmware; iOS only above 2.0.0.9 -> intersection.
  firmwareGates: { led: GATE_6302_SPEC, customButtons: GATE_6302_SPEC },
}

const CAPS_6302_CAMERA: Capabilities = { ...CAPS_6302_MOBILE, voiceLock: true }

function p(x: Omit<ProductInfo, 'vendorId'> & { vendorId?: number }): ProductInfo {
  return { vendorId: HOLLYLAND_VENDOR_ID, ...x }
}

export const PRODUCTS: readonly ProductInfo[] = [
  p({ productId: 1041, name: 'LARK A2', code: '6118', family: '6118', variant: 'mobile', txCount: 2, channels: 2, eaModel: 'lark a2',
    heartbeatIntervalMs: 1000, capabilities: CAPS_6118_MOBILE }),
  p({ productId: 1042, name: 'LARK A2S', chinaName: 'LARK A2', code: '6118', family: '6118', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark a2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6118_CAMERA,
    notes: 'Camera receiver variant of the A2 (strings.xml product_6118_camera)' }),
  p({ productId: 7, name: 'Lark M2', chinaName: 'Lark MIX', code: '6301', family: '6301', variant: 'mobile', txCount: 2, channels: 2,
    eaModel: 'lark m2', heartbeatIntervalMs: 3000, capabilities: CAPS_6301_MOBILE }),
  p({ productId: 8, name: 'Lark M2', chinaName: 'Lark MIX', code: '6301', family: '6301', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark m2', heartbeatIntervalMs: 3000, capabilities: CAPS_6301_CAMERA }),
  p({ vendorId: EAGLESHERO_VENDOR_ID, productId: 32, name: 'Lark M2 (EAGLESHERO)', code: '6301', family: '6301', variant: 'mobile',
    txCount: 2, channels: 2, heartbeatIntervalMs: 3000, capabilities: CAPS_6301_MOBILE, notes: 'OEM build (PRODUCT_EAGLES_6301_*); VID 0x4417 inferred from USBHIDService' }),
  p({ vendorId: EAGLESHERO_VENDOR_ID, productId: 33, name: 'Lark M2 (EAGLESHERO)', code: '6301', family: '6301', variant: 'camera',
    txCount: 2, channels: 2, heartbeatIntervalMs: 3000, capabilities: CAPS_6301_CAMERA, notes: 'OEM build (PRODUCT_EAGLES_6301_*); VID 0x4417 inferred from USBHIDService' }),
  p({ productId: 1029, name: 'LARK M2S', chinaName: 'LARK M2', code: '6302', family: '6302', variant: 'mobile', txCount: 2, channels: 2,
    eaModel: 'lark m2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6302_MOBILE }),
  p({ productId: 1030, name: 'LARK M2S', chinaName: 'LARK M2', code: '6302', family: '6302', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark m2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6302_CAMERA }),
  // Out of scope (different framing or transport); listed so the UI can name them.
  p({ productId: 1031, name: 'LARK A1', code: '6108', family: null, variant: null, txCount: 2, channels: 2, eaModel: 'lark a1',
    heartbeatIntervalMs: 0, capabilities: null, notes: 'Feature-report framing (ProtocolV2), not supported' }),
  ...[1036, 1037, 1038, 1039].map((pid) =>
    p({ productId: pid, name: 'LARK M3', code: '6303', family: null, variant: pid <= 1037 ? 'camera' : 'mobile', txCount: pid % 2 ? 4 : 2,
      channels: pid % 2 ? 4 : 2, eaModel: 'lark m3', heartbeatIntervalMs: 0, capabilities: null,
      notes: 'Moma TLV framing with report id 8 (Protocol6303Provider), not supported' })),
  ...[1026, 1027].map((pid) =>
    p({ productId: pid, name: 'LARK MAX 2', code: '6701', family: null, variant: pid === 1027 ? 'camera' : 'mobile', txCount: 2, channels: 2,
      eaModel: 'lark max 2', heartbeatIntervalMs: 0, capabilities: null, notes: 'BLE product, not supported' })),
  ...[1032, 1033, 1034, 1035, 1040, 772].map((pid) =>
    p({ productId: pid, name: 'MELO P1', code: '6201', family: null, variant: null, txCount: 2, channels: 2, eaModel: 'melo p1',
      heartbeatIntervalMs: 0, capabilities: null, notes: 'Moma TLV framing with XOR (Protocol6201Provider), not supported' })),
  p({ productId: 1, name: 'Lark C1', code: '6501', family: null, variant: null, txCount: 2, channels: 2, eaModel: 'lark c1',
    heartbeatIntervalMs: 3000, capabilities: null, notes: 'Same legacy framing; command set not verified here' }),
  p({ productId: 11, name: 'Lark C1', code: '6501PRO', family: null, variant: null, txCount: 2, channels: 2, eaModel: 'lark c1 pro',
    heartbeatIntervalMs: 3000, capabilities: null, notes: 'Same legacy framing; TX1/TX2 swapped in the UI' }),
  p({ productId: 12, name: 'Lark M1', code: '6502PRO', family: null, variant: null, txCount: 2, channels: 2, eaModel: 'lark m1 pro',
    heartbeatIntervalMs: 3000, capabilities: null, notes: 'Same legacy framing; command set not verified here' }),
  p({ productId: 13, name: 'Lark Mini', code: '6502JF', family: null, variant: null, txCount: 2, channels: 2,
    heartbeatIntervalMs: 3000, capabilities: null, notes: 'Same legacy framing; command set not verified here' }),
]

export function lookupProduct(vendorId: number, productId: number): ProductInfo | undefined {
  return PRODUCTS.find((x) => x.productId === productId && x.vendorId === vendorId)
}

export function isSupportedProduct(info: ProductInfo | undefined): info is ProductInfo & { family: Family; capabilities: Capabilities } {
  return !!info && info.family !== null && info.capabilities !== null
}

/** A synthetic entry for an unknown Hollyland PID (the UI should treat it as unsupported). */
export function unknownProduct(vendorId: number, productId: number): ProductInfo {
  return {
    vendorId, productId, name: `Unknown Hollyland device (PID 0x${productId.toString(16).padStart(4, '0')})`, code: 'unknown',
    family: null, variant: null, txCount: 0, channels: 0, heartbeatIntervalMs: 0, capabilities: null,
  }
}

export function resolveProduct(vendorId: number, productId: number): ProductInfo {
  return lookupProduct(vendorId, productId) ?? unknownProduct(vendorId, productId)
}
