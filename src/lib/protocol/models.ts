/**
 * Product registry: USB VID/PID -> model, protocol family and capabilities.
 *
 * Sources: Android application/common/protocol/Product.java (PIDs),
 * application/common/compatibility/DeviceCompat.getDeviceName + res/values/strings.xml (names),
 * iOS -[EADSessionManager setupControllerForAccessory:withProtocolString:] @0x10012477c and
 * +[HLDeviceUtils getDeviceNameWithType:] @0x1003210e0 (EA model numbers / display names).
 * See docs/PROTOCOL.md §4.
 *
 * Every product the official app supports is listed (docs/FAMILIES.md §1.1). `family` /
 * `capabilities` describe what HollylandDevice drives (legacy `AA DD` families); the optional
 * fields added for the other families (`familyCode`, `support`, `links`, `maxUnits`, …) are filled
 * for every row here. Rows of FamilyDriver families live in families/<code>/products.ts and are
 * aggregated below (import rule: those files import types only from this module).
 */
import { LARK_C1_VOLUME_WIRE, isNewerVersionAndroid, isNewerVersionIos, isVersionMissing, lastVersionComponent, type Family } from './commands'
import {
  EAGLESHERO_VENDOR_ID, FAMILY_RESEARCH, HOLLYLAND_VENDOR_ID, KNOWN_VENDOR_IDS, isLegacyFamilyCode,
  type FamilyCode, type UnitId,
} from './core/ids'
import type { DeviceKind, LinkSpec, SupportInfo, WebHidLinkSpec } from './core/types'
import { A1_PRODUCTS } from './families/6108/products'
import { MELO_APP_PRODUCTS, MELO_PRODUCTS } from './families/6201/products'
import { M3_PRODUCTS } from './families/6303/products'
import { MAX2_APP_PRODUCTS, MAX2_PRODUCTS } from './families/6701/products'

/** Moved to core/ids.ts (import cycles); re-exported here unchanged. */
export { EAGLESHERO_VENDOR_ID, HOLLYLAND_VENDOR_ID }

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

  // ---- 6501 group rules (docs/research/families/legacy-6501.md §8). Optional: absent = the A2/M2/M2S behaviour.
  /**
   * false: the heartbeat drives TX link and battery only; NC level and volume come from 0x11 / 0x04
   * (Lark C1, PID 1: A larkc1/HLDeviceActivity.onEvent cmd 16 `if (productId != 1)` / `productId >= 8`;
   * I -[HL6501Engine handleHeartbeatEntity:] skips every setting for type < 3, `cmp x22, 3; b.lt` @0x1000bc474).
   */
  heartbeatSettings?: boolean
  /**
   * Mic1/Mic2 are swapped FOR DISPLAY: the physical "Mic1" is the unit addressed as TX2 (0x42). Wire
   * addressing never changes (Lark C1 2nd gen, PID 11: A HLDeviceActivity.onEvent cmd 16 `productId == 11`;
   * I -[HLDeviceController deviceTypeForTx1Status] @0x1002c71f4, heartbeat swap `cmp x22, 4` @0x1000bc344).
   */
  txLabelSwap?: boolean
  /**
   * Volume step i (0-based button) is sent as wireValues[i] and read back through the same map
   * (Lark C1: LARK_C1_VOLUME_WIRE = [5, 4, 3, 0, 1, 2], A DeviceCompat.getVoiceLevels(1)). Absent: wire = step.
   */
  volumeWireValues?: readonly number[]
  /**
   * NC level writes are refused while NC is off on the hardware (A HLDeviceActivity.onClick strong_level /
   * low_level toast noise_is_closed_notice; I HLLarkM2View noiseView block @0x1000cf438 for type >= 3).
   * Absent: true (A2/M2/M2S). false on the Lark C1: iOS has no NC-off check for type < 3; Android's check
   * there is asymmetric (Strong passes, Weak does not) and looks accidental (legacy-6501.md §6).
   */
  noiseLevelNeedsNcOn?: boolean
  /**
   * Volume writes need a TX online. Absent: true. false on the Lark C1 (A HLDeviceActivity.isAllowSetVoice
   * returns true for productId == 1; iOS checks the mics for every type, the library follows Android here,
   * FAMILIES.md §3.8).
   */
  volumeNeedsMic?: boolean
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

  // ---- added for the other product families (docs/FAMILIES.md §3.3); optional, filled for every registry row
  /** Product family code (also for rows HollylandDevice does not drive). Default: derived from `family` / `code`. */
  familyCode?: FamilyCode
  /** Disambiguating display name when `name` is shared (PID 11 "Lark C1 (2nd gen)"). See `displayName()`. */
  label?: string
  /** Implementation level and what was tested (FAMILIES.md §0 #6). See `supportOf()`. */
  support?: SupportInfo
  /** How a browser reaches it (FAMILIES.md §3.4). See `linksOf()`. */
  links?: readonly LinkSpec[]
  /** Units the kit can have (connected RX first). See `unitsOf()`. */
  maxUnits?: readonly UnitId[]
  /** false when the official app never checks the vendor id, so `vendorId` is an assumption (M3, MELO P1). */
  vendorIdConfirmed?: boolean
  /** 'app': `productId` is an app-internal id of a non-USB product (BLE case, earphones), never a USB PID. */
  idKind?: 'usb' | 'app'
  deviceKind?: DeviceKind
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

/**
 * 6501 group, PIDs 11/12/13 (legacy-6501.md §5–§7): the Lark M2 screen (A larkc1/HLDeviceActivity) minus
 * what it hides for these PIDs. No NC switch (mNoiseSwitch only for isNew6301CameraOrMobile / 1029 / 1030;
 * I noiseSwitchSupported only for types 3/7, applyRXVersionCapabilities: @0x1000bd78c), no volume lock
 * (setVoiceLockVisibility: isNew6301Camera / 1030), no channel mode or auto-off (layouts only for
 * 1029/1030; I HLLarkM2View initWithFrame: @0x1000ca714 type 7), no LED, no custom buttons. "Phone
 * Speaker" + the restart it needs (voice_outgoing_switch, mVoiceRunable). No firmware gates.
 */
const CAPS_6501_PRO: Capabilities = {
  ...NONE,
  heartbeat: true, versionCmd: 0x03, serial: true, noiseMaxLevel: 2, noiseToggle: false,
  volumeSteps: M2_VOLUME_STEPS, // DeviceCompat.getVoiceLevels(11/12/13) = [0..5]; iOS 0..2 (as on the M2)
  channelModes: [], speakerPassthrough: true, restartRx: true, ota: true,
  heartbeatSettings: true, noiseLevelNeedsNcOn: true, volumeNeedsMic: true,
}
/** Lark C1 2nd gen (PID 11): CAPS_6501_PRO + the display-only Mic1/Mic2 swap. */
const CAPS_6501_PRO_SWAPPED: Capabilities = { ...CAPS_6501_PRO, txLabelSwap: true }
/** Lark C1 (PID 1): heartbeat link/battery only, volume wire map, no NC-off check, volume without a mic. */
const CAPS_6501_C1: Capabilities = {
  ...CAPS_6501_PRO,
  heartbeatSettings: false, volumeWireValues: LARK_C1_VOLUME_WIRE, noiseLevelNeedsNcOn: false, volumeNeedsMic: false,
}

function p(x: Omit<ProductInfo, 'vendorId'> & { vendorId?: number }): ProductInfo {
  return { vendorId: HOLLYLAND_VENDOR_ID, idKind: 'usb', deviceKind: 'receiver', ...x }
}

/**
 * Legacy interrupt link: `sendReport(0xAA, 63 B)`, replies on undeclared input id 0xBB
 * (PROTOCOL.md §2.3–2.4, verified on the A2 §11.3). The A2 control collection is usage page 0xFF82
 * (webhid.ts CONTROL_USAGE_PAGE); the M2/M2S/6501 descriptors are not captured yet.
 */
const LINK_LEGACY_A2: WebHidLinkSpec = { kind: 'webhid', reportId: 'byte0', outSizes: [64], inSize: 64, usagePage: 0xff82 }
const LINK_LEGACY: WebHidLinkSpec = {
  kind: 'webhid', reportId: 'byte0', outSizes: [64], inSize: 64, note: 'HID descriptor not captured yet (FAMILIES.md §5.6)',
}

const LEGACY_UNITS: readonly UnitId[] = ['rx', 'tx1', 'tx2']

/** PROTOCOL.md §11.7 (user test, 2026-11-05). */
const SUPPORT_A2: SupportInfo = {
  level: 'supported', hardware: 'tested', confidence: 'high', research: 'docs/PROTOCOL.md',
  testedOn: [
    'LARK A2 fw 3.0.2.008 · macOS Chrome WebHID: write-only (replies dropped by the OS) · 2026-11-05',
    'LARK A2 fw 3.0.2.008 · macOS local bridge (root libusb): full read/write · 2026-11-05',
  ],
}
const SUPPORT_A2S: SupportInfo = {
  level: 'supported', hardware: 'sibling-tested', confidence: 'high', research: 'docs/PROTOCOL.md',
  note: 'camera receiver of the A2; same protocol, tested on the LARK A2',
}
/** PROTOCOL.md §11.8 (user test, 2026-11-06). */
const SUPPORT_M2: SupportInfo = {
  level: 'supported', hardware: 'tested', confidence: 'high', research: 'docs/PROTOCOL.md',
  testedOn: [
    'Lark M2 mobile RX fw 2.0.0.33, TX fw 2.1.0.33 · macOS Chrome WebHID: write-only (replies dropped by the OS) · 2026-11-06',
    'Lark M2 mobile RX fw 2.0.0.33, TX fw 2.1.0.33 · macOS local bridge (root libusb): full read/write · 2026-11-06',
  ],
}
const SUPPORT_M2_CAMERA: SupportInfo = {
  level: 'supported', hardware: 'sibling-tested', confidence: 'high', research: 'docs/PROTOCOL.md',
  note: 'camera receiver of the Lark M2; same protocol, tested on the Lark M2 mobile receiver',
}
const SUPPORT_M2S: SupportInfo = {
  level: 'supported', hardware: 'untested', confidence: 'high', research: 'docs/PROTOCOL.md',
  note: 'same legacy protocol as the tested Lark M2; M2S-only commands (LED, custom buttons) not run on hardware',
}
const SUPPORT_EAGLES: SupportInfo = {
  level: 'supported', hardware: 'untested', confidence: 'medium', research: 'docs/PROTOCOL.md',
  note: 'OEM build of the Lark M2; VID 0x4417 inferred from USBHIDService',
}
/**
 * FAMILIES.md §1.2 rows 6–9, Phase 1 (W1): driven by HollylandDevice from the official apps' code, not
 * run on hardware. Same commands and classes as the Lark M2, whose test (§5.6 step 4) is the proxy.
 */
const SUPPORT_6501: SupportInfo = {
  level: 'experimental', hardware: 'untested', confidence: 'medium', research: FAMILY_RESEARCH['6501'],
  note: 'high (wire: same classes as the Lark M2; read path run on a real Lark M2 via forced profiles, 2026-11-06), medium (UI semantics), writes not run',
}
/** PID 1: the volume wire map and the short heartbeat are the least certain parts (legacy-6501.md §9 #2, #3). */
const SUPPORT_6501_C1: SupportInfo = {
  ...SUPPORT_6501,
  note: 'high (wire: same classes as the Lark M2), medium (UI semantics), low (volume wire map meaning, heartbeat length)',
}
/** FAMILIES.md §2.1: recognise only (Android 3.1.0 rejects PID 2). */
const SUPPORT_6902: SupportInfo = {
  level: 'recognised', hardware: 'untested', confidence: 'low', research: FAMILY_RESEARCH['6501'],
  note: 'Android rejects PID 2 (USBHIDService.isSupportedUsbDevice); iOS drives it as type 1 with C1 rules',
}

const legacy = (support: SupportInfo, link: WebHidLinkSpec = LINK_LEGACY) => ({ support, links: [link], maxUnits: LEGACY_UNITS })

/** Rows driven by HollylandDevice (legacy `AA DD` framing): A2/A2S, M2, M2S and the 6501 group; Lark MAX recognised only. */
export const LEGACY_PRODUCTS: readonly ProductInfo[] = [
  p({ productId: 1041, name: 'LARK A2', code: '6118', family: '6118', familyCode: '6118', variant: 'mobile', txCount: 2, channels: 2, eaModel: 'lark a2',
    heartbeatIntervalMs: 1000, capabilities: CAPS_6118_MOBILE, ...legacy(SUPPORT_A2, LINK_LEGACY_A2) }),
  p({ productId: 1042, name: 'LARK A2S', chinaName: 'LARK A2', code: '6118', family: '6118', familyCode: '6118', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark a2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6118_CAMERA, ...legacy(SUPPORT_A2S, LINK_LEGACY_A2),
    notes: 'Camera receiver variant of the A2 (strings.xml product_6118_camera)' }),
  p({ productId: 7, name: 'Lark M2', chinaName: 'Lark MIX', code: '6301', family: '6301', familyCode: '6301', variant: 'mobile', txCount: 2, channels: 2,
    eaModel: 'lark m2', heartbeatIntervalMs: 3000, capabilities: CAPS_6301_MOBILE, ...legacy(SUPPORT_M2) }),
  p({ productId: 8, name: 'Lark M2', chinaName: 'Lark MIX', code: '6301', family: '6301', familyCode: '6301', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark m2', heartbeatIntervalMs: 3000, capabilities: CAPS_6301_CAMERA, ...legacy(SUPPORT_M2_CAMERA) }),
  p({ vendorId: EAGLESHERO_VENDOR_ID, productId: 32, name: 'Lark M2 (EAGLESHERO)', code: '6301', family: '6301', familyCode: '6301', variant: 'mobile',
    txCount: 2, channels: 2, heartbeatIntervalMs: 3000, capabilities: CAPS_6301_MOBILE, ...legacy(SUPPORT_EAGLES),
    notes: 'OEM build (PRODUCT_EAGLES_6301_*); VID 0x4417 inferred from USBHIDService' }),
  p({ vendorId: EAGLESHERO_VENDOR_ID, productId: 33, name: 'Lark M2 (EAGLESHERO)', code: '6301', family: '6301', familyCode: '6301', variant: 'camera',
    txCount: 2, channels: 2, heartbeatIntervalMs: 3000, capabilities: CAPS_6301_CAMERA, ...legacy(SUPPORT_EAGLES),
    notes: 'OEM build (PRODUCT_EAGLES_6301_*); VID 0x4417 inferred from USBHIDService' }),
  p({ productId: 1029, name: 'LARK M2S', chinaName: 'LARK M2', code: '6302', family: '6302', familyCode: '6302', variant: 'mobile', txCount: 2, channels: 2,
    eaModel: 'lark m2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6302_MOBILE, ...legacy(SUPPORT_M2S) }),
  p({ productId: 1030, name: 'LARK M2S', chinaName: 'LARK M2', code: '6302', family: '6302', familyCode: '6302', variant: 'camera', txCount: 2, channels: 2,
    eaModel: 'lark m2s', heartbeatIntervalMs: 1000, capabilities: CAPS_6302_CAMERA, ...legacy(SUPPORT_M2S) }),
  // 6501 group (legacy-6501.md §1): same legacy framing and Android screen as the Lark M2 (A larkc1/utils/
  // OpenPageHelper.obtainUsbPageIntent → larkc1/HLDeviceActivity; USBHIDService.isOldDevice), iOS HL6501Engine.
  // One receiver per PID (no mobile/camera split), 3 s heartbeat (HLDeviceActivity.AnonymousClass8.run; I sendHeartInfo).
  // A Product.PRODUCT_6501 = 1; R product_6501 "Lark C1"; I `lark c1` → type 0 (2 on TYPE-C firmware, see isNew6501).
  p({ productId: 1, name: 'Lark C1', chinaName: '悦声S1', code: '6501', family: '6501', familyCode: '6501', variant: null, txCount: 2, channels: 2,
    eaModel: 'lark c1', heartbeatIntervalMs: 3000, capabilities: CAPS_6501_C1, ...legacy(SUPPORT_6501_C1),
    notes: 'Heartbeat carries link/battery only; volume buttons 1–6 send 5,4,3,0,1,2 (legacy-6501.md §7.1)' }),
  // A PRODUCT_6501_PRO = 11; R product_6501_pro "Lark C1" (same string as PID 1, hence the label); I `lark c1 pro` → type 4.
  p({ productId: 11, name: 'Lark C1', label: 'Lark C1 (2nd gen)', chinaName: '悦声S1(二代)', code: '6501PRO', family: '6501', familyCode: '6501',
    variant: null, txCount: 2, channels: 2, eaModel: 'lark c1 pro', heartbeatIntervalMs: 3000, capabilities: CAPS_6501_PRO_SWAPPED, ...legacy(SUPPORT_6501),
    notes: 'Mic1/Mic2 swapped for display: Mic1 is the unit addressed as TX2 (legacy-6501.md §7.2)' }),
  // A PRODUCT_6502_PRO = 12; R product_6502_pro "Lark M1"; I `lark m1 pro` → type 5 "Lark M1" / Moma "Lark M1(二代)".
  p({ productId: 12, name: 'Lark M1', label: 'Lark M1 (2nd gen)', chinaName: 'Lark M1(二代)', code: '6502PRO', family: '6501', familyCode: '6501',
    variant: null, txCount: 2, channels: 2, eaModel: 'lark m1 pro', heartbeatIntervalMs: 3000, capabilities: CAPS_6501_PRO, ...legacy(SUPPORT_6501),
    notes: 'Same rules as the Lark M2 screen minus NC switch, lock, channel mode, auto-off (legacy-6501.md §7.3)' }),
  // A PRODUCT_LARK_C1_PRO = 13 (misnamed constant), code "6502JF"; R product_lark_c1_pro "Lark Mini". No EA model of its
  // own: iOS derives type 6 from `lark m1 pro` + 0x16 body[0] == 3 (-[HL6501Engine resolveDeviceHeaderImageWithPayload:] @0x1000bd910).
  p({ productId: 13, name: 'Lark Mini', code: '6502JF', family: '6501', familyCode: '6501', variant: null, txCount: 2, channels: 2,
    heartbeatIntervalMs: 3000, capabilities: CAPS_6501_PRO, ...legacy(SUPPORT_6501),
    notes: 'Identical to the Lark M1 (2nd gen) (legacy-6501.md §7.4)' }),
  // A PRODUCT_6902 = 2, rejected by USBHIDService.isSupportedUsbDevice; I `lark max` → type 1 (HL6501Engine, C1 rules).
  p({ productId: 2, name: 'Lark MAX', code: '6902', family: null, familyCode: '6501', variant: null, txCount: 2, channels: 2, eaModel: 'lark max',
    heartbeatIntervalMs: 3000, capabilities: null, support: SUPPORT_6902, links: [], maxUnits: LEGACY_UNITS, vendorIdConfirmed: false,
    notes: 'Recognised only: the official Android app rejects it; whether it exposes the control HID interface is unknown (legacy-6501.md §7.5)' }),
]

/**
 * Every USB product (VID/PID), legacy rows first. Products that are not USB devices (BLE charging
 * case, earphones) are in APP_PRODUCTS, so `lookupProduct` and the USB filters never see them.
 */
export const PRODUCTS: readonly ProductInfo[] = [
  ...LEGACY_PRODUCTS,
  ...A1_PRODUCTS,
  ...M3_PRODUCTS,
  ...MAX2_PRODUCTS,
  ...MELO_PRODUCTS,
]

/** Non-USB products, identified by the official app's internal id (FAMILIES.md §1.4): MAX 2 BOX 101, OWS 102, MELO P1 earphones 772. */
export const APP_PRODUCTS: readonly ProductInfo[] = [...MAX2_APP_PRODUCTS, ...MELO_APP_PRODUCTS]

/** PRODUCTS + APP_PRODUCTS. */
export const ALL_PRODUCTS: readonly ProductInfo[] = [...PRODUCTS, ...APP_PRODUCTS]

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

// ------------------------------------------------------------------- registry-data helpers

/** A non-USB product by its app-internal id (101 MAX 2 BOX, 102 OWS, 772 MELO P1 earphones). */
export function lookupAppProduct(appId: number): ProductInfo | undefined {
  return APP_PRODUCTS.find((x) => x.productId === appId)
}

/** Name to show: `label` when the marketing name is shared by several rows. */
export function displayName(p: ProductInfo): string {
  return p.label ?? p.name
}

/** Family code of a row (legacy `family`, else derived from the product code). */
export function familyCodeOf(p: ProductInfo): FamilyCode | null {
  if (p.familyCode) return p.familyCode
  if (p.family) return p.family
  const head = p.code.slice(0, 4)
  return isLegacyFamilyCode(head) || head === '6108' || head === '6201' || head === '6303' || head === '6701' ? head : null
}

const UNKNOWN_SUPPORT: SupportInfo = { level: 'recognised', hardware: 'untested', confidence: 'low', research: 'docs/FAMILIES.md' }

/** Support record of a row; rows without one (custom / unknown products) count as recognised + untested. */
export function supportOf(p: ProductInfo): SupportInfo {
  if (p.support) return p.support
  if (p.family && p.capabilities) return { level: 'supported', hardware: 'untested', confidence: 'medium', research: 'docs/PROTOCOL.md' }
  return UNKNOWN_SUPPORT
}

/** Links of a row; legacy rows without explicit links get the legacy interrupt link. */
export function linksOf(p: ProductInfo): readonly LinkSpec[] {
  if (p.links) return p.links
  if (p.family) return [{ kind: 'webhid', reportId: 'byte0', outSizes: [64], inSize: 64 }]
  return []
}

/** Units of a row (default: RX + `txCount` mics). */
export function unitsOf(p: ProductInfo): readonly UnitId[] {
  if (p.maxUnits) return p.maxUnits
  const tx: UnitId[] = (['tx1', 'tx2', 'tx3', 'tx4'] as const).slice(0, Math.max(0, Math.min(4, p.txCount)))
  return ['rx', ...tx]
}

/**
 * Whether a page can open a session with this product: legacy rows HollylandDevice drives, and
 * rows whose family driver is past the stub (their `support.level` is not 'recognised').
 */
export function isConnectableProduct(p: ProductInfo): boolean {
  if (p.family !== null && p.capabilities !== null) return true
  return supportOf(p).level !== 'recognised'
}

/** The row's interrupt-pipe HID link, if any (WebHID and the local bridge). */
export function webHidLinkOf(p: ProductInfo): WebHidLinkSpec | undefined {
  return linksOf(p).find((l): l is WebHidLinkSpec => l.kind === 'webhid')
}

/** Whether a USB vendor id is one the official apps accept (Hollyland, EAGLESHERO). */
export function isKnownVendorId(vendorId: number): boolean {
  return KNOWN_VENDOR_IDS.includes(vendorId)
}
