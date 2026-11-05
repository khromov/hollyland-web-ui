/**
 * Moma profiles: what each family / link puts around the shared envelope (docs/FAMILIES.md §3.5 table).
 * Command tables stay per family (the same id means different things: 6303 0x600B = TX recognition LED,
 * 6201/6701 0x600B = heartbeat).
 *
 * | Profile             | reportId | target                         | control           | padding            |
 * |---------------------|----------|--------------------------------|-------------------|--------------------|
 * | MOMA_6303           | 0x08     | 0x00                           | 0x00              | <64→64, <512→512   |
 * | MOMA_6701_USB       | –        | 0x01 mobile (0x02 camera)      | 0x07 start+end+XOR| none               |
 * | MOMA_6701_BLE       | –        | 0x02 RX (per unit, see below)  | 0x07              | none               |
 * | MOMA_6201_USB       | –        | 0x00                           | 0x04 XOR          | none               |
 * | MOMA_6201_BLE       | –        | 0x01                           | 0x04 XOR          | none               |
 * | MOMA_6201_IOS       | –        | 0x01                           | 0x00 (iOS)        | none (cross-check) |
 */
import { MOMA_ID } from './codec'

export type MomaFamily = '6201' | '6303' | '6701'

export interface MomaProfile {
  /** Constant name, e.g. 'MOMA_6303'. */
  readonly name: string
  readonly family: MomaFamily
  readonly link: 'usb' | 'ble'
  /** HID report id in byte 0 of every report (6303: 8), null when the frame itself starts at byte 0. */
  readonly reportId: number | null
  /** Target byte of requests that do not name one (MomaRequest.target overrides it). */
  readonly target: number
  /** Control byte of requests; replies are decoded with their own control byte. */
  readonly control: number
  /**
   * Request packets are zero-padded (report id included) to the first size strictly larger than the
   * packet (encodeMomaFrame); [] = unpadded.
   */
  readonly padTo: readonly number[]
  /** Citation (A = Android 3.1.0, I = iOS). */
  readonly source: string
  readonly note?: string
}

/**
 * LARK M3. A protocol/core/sound/provider/Protocol6303Provider.createCommandPostBuilder():
 * setReportId(8), setEnableStartFrame(false), setEnableEndFrame(false), verificationAlgorithm(NONE);
 * buildPacket(): setSlaveIdentify(ResolveConfig.identify = IDENTIFIER_BROADCAST), then `len < 64` → pad to
 * 64, else `len < 512` → pad to 512, else as is (len includes the report id; a 64-byte packet becomes 512).
 * Replies: `new CommandStanderParser(8)` strips byte 0.
 * m3-6303.md §2.3, §3.1.
 */
export const MOMA_6303: MomaProfile = {
  name: 'MOMA_6303',
  family: '6303',
  link: 'usb',
  reportId: 0x08,
  target: MOMA_ID.BROADCAST,
  control: 0x00,
  padTo: [64, 512],
  source: 'A Protocol6303Provider.createCommandPostBuilder / buildPacket; m3-6303.md §3.1',
}

/**
 * LARK MAX 2 mobile RX over USB (PID 1026). A blemic/operation/BleMicCmd.cmdSingleSend / cmdMultiSend:
 * AA DD 06 <identifier> 07 00 03 5A FA 00 00 00 … 5E FE 00 00 00 <XOR>, written unpadded at its exact
 * length (A usbmic/core/USBHIDService UsbCommandInfo(maxPacketSize = frame length)). `identifier` comes
 * from the BleMicCmd constructor: 1 for PID 1026, 2 for PID 1027 (5 otherwise). iOS uses 0 for the mobile
 * RX (I +[NSData hl_targetByteForDeviceType:] @0x10011d288) [?, max2-6701.md §9 #5]. "Get all"
 * (BleMicCmd.cmdMultiMapSend) goes to target 0 over USB: pass `target` per request.
 * max2-6701.md §3.1, §5.
 */
export const MOMA_6701_USB: MomaProfile = {
  name: 'MOMA_6701_USB',
  family: '6701',
  link: 'usb',
  reportId: null,
  target: MOMA_ID.PHONE_RX,
  control: 0x07,
  padTo: [],
  source: 'A BleMicCmd.<init> (1026 → 1) / cmdSingleSend; max2-6701.md §3.1',
  note: 'mobile RX; iOS sends target 0 [?]',
}

/** LARK MAX 2 camera RX over USB (PID 1027): as MOMA_6701_USB with target 2 (A BleMicCmd.<init>: 1027 → 2). */
export const MOMA_6701_USB_CAMERA: MomaProfile = {
  ...MOMA_6701_USB,
  name: 'MOMA_6701_USB_CAMERA',
  target: MOMA_ID.CAMERA_RX,
  source: 'A BleMicCmd.<init> (1027 → 2) / cmdSingleSend; max2-6701.md §3.1',
  note: 'camera RX',
}

/**
 * MAX 2 targets over BLE (through the charging case): A BleMicCmd.IDENTIFIER_RX = 2, TX1 = 3, TX2 = 4,
 * BOX = 5, TX3 = 10, TX4 = 11; the per-command BLE target column of max2-6701.md §5 (most settings 2,
 * versions / OTA / battery health 5).
 */
export const MOMA_6701_BLE_TARGET = {
  RX: 2,
  TX1: 3,
  TX2: 4,
  BOX: 5,
  TX3: 10,
  TX4: 11,
} as const

/**
 * LARK MAX 2 charging case "BOX" over BLE (GATT FEE7 / FEC1, write without response). Same bytes as USB;
 * only the target changes per unit (BleMicCmd.cmdSingleSend: `isBle() ? target : identifier`).
 * max2-6701.md §2.2, §3.1. Not reproduced: BleMicCmd.cmdMultiListSend (target 5, LE16 item length via
 * NumberUtil.intToByte22, end marker appended to the wrong list) is dead code with no caller in 3.1.0.
 */
export const MOMA_6701_BLE: MomaProfile = {
  name: 'MOMA_6701_BLE',
  family: '6701',
  link: 'ble',
  reportId: null,
  target: MOMA_6701_BLE_TARGET.RX,
  control: 0x07,
  padTo: [],
  source: 'A BleMicCmd.cmdSingleSend (isBle → target) / BleBoxOption; max2-6701.md §2.2, §3.1',
}

/**
 * MELO P1 over USB HID (no report-id layer). A Protocol6201Provider.createCommandPostBuilder():
 * no setReportId, start/end frames off, verificationAlgorithm(XOR); buildPacket() targets the default
 * ResolveConfig (IDENTIFIER_BROADCAST = 0) and does not pad; the transport cuts the frame into
 * wMaxPacketSize chunks without headers (HlUsbManagerImpl.executeBulkTransfer). melo-6201.md §2.1, §3.1.
 */
export const MOMA_6201_USB: MomaProfile = {
  name: 'MOMA_6201_USB',
  family: '6201',
  link: 'usb',
  reportId: null,
  target: MOMA_ID.BROADCAST,
  control: 0x04,
  padTo: [],
  source: 'A Protocol6201Provider.createCommandPostBuilder / buildPacket; melo-6201.md §3.1',
}

/**
 * MELO P1 receiver over BLE (GATT FFE0, write FFE1 with response, notify FFE2): target 1
 * (A mic_ble/entity/BleResolveConfig → IDENTIFIER_PHONE_RX), otherwise as USB. melo-6201.md §2.2, §3.1.
 */
export const MOMA_6201_BLE: MomaProfile = {
  ...MOMA_6201_USB,
  name: 'MOMA_6201_BLE',
  link: 'ble',
  target: MOMA_ID.PHONE_RX,
  source: 'A BleResolveConfig (IDENTIFIER_PHONE_RX) + Protocol6201Provider.createCommandPostBuilder; melo-6201.md §2.2',
}

/**
 * MELO P1 as the iOS app frames it (cross-check only, FAMILIES.md §5.2): control 0x00 (no checksum) and
 * target 1 on both links (I +[NSData requestCommand:payload:] @0x10011d7e0 → +[HLCommandFrameBuilder
 * frameWithSource:target:control:commands:…] @0x1000a3058; control and target values as read in
 * melo-6201.md §3.1, §3.4 #3).
 */
export const MOMA_6201_IOS: MomaProfile = {
  name: 'MOMA_6201_IOS',
  family: '6201',
  link: 'usb',
  reportId: null,
  target: MOMA_ID.PHONE_RX,
  control: 0x00,
  padTo: [],
  source: 'I +[NSData requestCommand:payload:] @0x10011d7e0; melo-6201.md §3.1',
  note: 'iOS framing; the Android profiles are the default',
}

export const MOMA_PROFILES: readonly MomaProfile[] = [
  MOMA_6303, MOMA_6701_USB, MOMA_6701_USB_CAMERA, MOMA_6701_BLE, MOMA_6201_USB, MOMA_6201_BLE, MOMA_6201_IOS,
]

/**
 * The profile the Android app would use for a product and link: 6303 → MOMA_6303; 6701 USB → target by PID
 * (1027 camera, else mobile, as BleMicCmd.<init>), 6701 BLE → MOMA_6701_BLE; 6201 → USB or BLE.
 */
export function momaProfileFor(family: MomaFamily, productId: number, link: 'usb' | 'ble'): MomaProfile {
  switch (family) {
    case '6303':
      return MOMA_6303
    case '6701':
      return link === 'ble' ? MOMA_6701_BLE : productId === 1027 ? MOMA_6701_USB_CAMERA : MOMA_6701_USB
    case '6201':
      return link === 'ble' ? MOMA_6201_BLE : MOMA_6201_USB
  }
}

/** Copy of a profile with another default target. */
export function withTarget(p: MomaProfile, target: number): MomaProfile {
  return { ...p, name: `${p.name}@${target}`, target }
}
