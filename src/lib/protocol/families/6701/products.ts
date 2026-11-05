/**
 * LARK MAX 2 (family 6701) registry rows: USB receivers, the BLE charging case and the OWS
 * earphone. docs/research/families/max2-6701.md §1–2.
 * Import rule (FAMILIES.md §3.6): runtime imports from core/ only, types only from models.ts.
 */
import { appProduct, recognised, usbProduct } from '../../core/product-rows'
import type { WebBluetoothLinkSpec, WebHidLinkSpec } from '../../core/types'
import type { ProductInfo } from '../../models'

export const MAX2_RESEARCH = 'docs/research/families/max2-6701.md'

/** Phase 0 stub. USB RX: medium (report layout unknown); BOX over BLE: medium-high (FAMILIES.md §1.2). */
export const MAX2_SUPPORT = recognised(MAX2_RESEARCH, 'medium', 'USB report layout unknown; replies > 64 B')
export const MAX2_BOX_SUPPORT = recognised(MAX2_RESEARCH, 'medium', 'medium-high: BLE GATT path read in both apps')
export const MAX2_OWS_SUPPORT = recognised(MAX2_RESEARCH, 'low', 'not planned: state comes through the RX (FAMILIES.md §2.1)')

/**
 * A USBHIDService.onEventMainThread(USBDataSendEvent): frames written unpadded at their exact length
 * on the interrupt OUT pipe; replies up to 75 B (max2-6701.md §2.1). No report-id layer: byte 0 = AA/BB.
 */
export const MAX2_USB_LINK: WebHidLinkSpec = {
  kind: 'webhid', reportId: 'byte0', variableLength: true,
  note: 'descriptor unknown; frames > 64 B have no clean WebHID mapping yet (FAMILIES.md §6 #5)',
}

/**
 * A blemic/operation/BleBoxOption SERVICE_UUID 0000fee7-…, CHARACTERISTIC_WRITE/NOTIFY_UUID 0000fec1-…;
 * I -[HLBluetoothManager writeData:targetTic:] writes with type 1 (without response) (max2-6701.md §2.2).
 * Advertising: service data on 0xFEE7 (A mic_ble/parser/DeviceParseV1; I @0x1001e5b70).
 */
export const MAX2_BOX_LINK: WebBluetoothLinkSpec = {
  kind: 'web-bluetooth',
  filters: [{ services: [0xfee7] }, { serviceData: [{ service: 0xfee7 }] }],
  service: 0xfee7, write: 0xfec1, notify: 0xfec1, writeMode: 'without-response',
  note: 'whether 0xFEE7 is in the advertised UUID list or only in service data is unknown',
}

export const MAX2_PRODUCTS: readonly ProductInfo[] = [
  // A Product.PRODUCT_6701_MOBILE = 1026, PRODUCT_6701_CAMERA = 1027; R product_6701 "LARK MAX 2";
  // I EA `lark max 2` → deviceType 15 (@0x10012477c).
  ...[1026, 1027].map((pid) =>
    usbProduct('6701', MAX2_SUPPORT, {
      productId: pid, name: 'LARK MAX 2', label: `LARK MAX 2 (${pid === 1027 ? 'camera' : 'mobile'} RX)`, code: '6701',
      variant: pid === 1027 ? 'camera' : 'mobile', txCount: 2, channels: 2, eaModel: 'lark max 2',
      // USB heartbeat 0x600B every 3 s (max2-6701.md §4.2).
      heartbeatIntervalMs: 3000,
      deviceKind: 'receiver',
      // TX1..TX4 (BleMicCmd.IDENTIFIER_* 3, 4, 10, 11), BOX and OWS earphones (heartbeat 0x600B).
      maxUnits: ['rx', 'tx1', 'tx2', 'tx3', 'tx4', 'box', 'earL', 'earR'],
      links: [MAX2_USB_LINK],
      // FAMILIES.md §1.4: the USB RX speaks the Moma frame; it is not "a BLE product".
      notes: 'Moma framing with start/end items and XOR over USB HID, unpadded (max2-6701.md §3)',
    }),
  ),
]

export const MAX2_APP_PRODUCTS: readonly ProductInfo[] = [
  // A Product.PRODUCT_6701_BOX = 101 (app id only: HLBleDeviceActivity.onStart setProductId(101));
  // ProductDeviceID.SOUND.C6701_INLAND (deviceType 10001); I deviceType 16; R BOX, I "LARK MAX 2(BOX)".
  appProduct('6701', MAX2_BOX_SUPPORT, {
    productId: 101, name: 'LARK MAX 2 charging case', label: 'LARK MAX 2 (BOX)', code: '6701', txCount: 4, channels: 2,
    // The apps differ over BLE (max2-6701.md §4.2). Android sends nothing: BleDeviceControlViewModel.getHeartInfo()
    // returns early on BLE and relies on pushes (0x6000-0x6002). iOS polls the RX heartbeat through the BOX every
    // 3 s: -[HLBleDeviceController viewDidLoad] schedules sendHeartInfo with `fmov d0, #3.0`, repeats 1
    // (@0x100243fb4-0x100243fc4, scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:);
    // -[HLBleDeviceController sendHeartInfo] @0x1002454ec sends 0x600B with requestCommand:payload:deviceType:0,
    // and +[NSData hl_targetByteForDeviceType:] @0x10011d288 maps deviceType 0 to target 2 (RX) when the
    // connected entity is the BOX (type 0x10). So the BOX forwards a read-only 0x600B poll: 3000 ms.
    heartbeatIntervalMs: 3000,
    deviceKind: 'case',
    maxUnits: ['rx', 'tx1', 'tx2', 'tx3', 'tx4', 'box'],
    links: [MAX2_BOX_LINK],
    notes: 'BLE GATT FEE7/FEC1, same Moma frame as the USB RX; targets 2 RX, 3 TX1, 5 BOX (max2-6701.md §2.2, §3.1). ' +
      'Status: pushes (Android) plus a 3 s 0x600B poll to target 2 (iOS), max2-6701.md §4.2',
  }),
  // A Product.PRODUCT_OWS_EAR = 102 ("6701OWS"); EPConnectManager.getEPDeviceType (name + MAC 50:C0:F0); I deviceType 17.
  appProduct('6701', MAX2_OWS_SUPPORT, {
    productId: 102, name: 'OWS Monitor Earphone', code: '6701OWS', txCount: 0, channels: 0,
    deviceKind: 'earphones',
    links: [],
    notes: 'Android: Classic BT SPP 0xE003; iOS: BLE E49A25F8-… (max2-6701.md §2.3). Not planned.',
  }),
]
