/**
 * MELO P1 (family 6201) registry rows: receiver (USB + BLE), mic, charging case and TWS
 * earphones. docs/research/families/melo-6201.md §1–2.
 * Import rule (FAMILIES.md §3.6): runtime imports from core/ only, types only from models.ts.
 */
import { appProduct, recognised, usbProduct } from '../../core/product-rows'
import type { WebBluetoothLinkSpec, WebHidLinkSpec } from '../../core/types'
import type { ProductInfo } from '../../models'

export const MELO_RESEARCH = 'docs/research/families/melo-6201.md'

/** Phase 0 stub. Codec high, settings medium-high, DSP medium (FAMILIES.md §1.2). */
export const MELO_SUPPORT = recognised(MELO_RESEARCH, 'medium', 'codec high, settings medium-high, DSP medium')
/** Firmware-update devices: the app only updates them (melo-6201.md §1.1). Skipped. */
export const MELO_ACCESSORY_SUPPORT = recognised(MELO_RESEARCH, 'low', 'firmware-update device in the official app; not planned')

/**
 * A Protocol6201Provider.providerUsbConfig: BULK on the interrupt pipe, never setReportId, so AA is
 * byte 0; frames unpadded, cut at the endpoint's wMaxPacketSize without headers (melo-6201.md §2.1).
 */
export const MELO_USB_LINK: WebHidLinkSpec = {
  kind: 'webhid', reportId: 'byte0', variableLength: true,
  note: 'descriptor unknown; frames longer than one report have no clean WebHID mapping (melo-6201.md §2.5)',
}

/**
 * A Protocol6201Provider.providerBluetoothConfig: service FFE0, write FFE1, notify FFE2 (melo-6201.md §2.2).
 *
 * Write type: the apps differ. Android writes with response (BluetoothCommandInfo default WRITE_TYPE_DEFAULT),
 * split at MTU − 3 after requesting MTU 512 (A ble/core/connection/DeviceConnector.setMtu). iOS writes every BLE
 * frame, MELO P1 included, WITHOUT response, cut at maximumWriteValueLengthForType:1 and gated on
 * canSendWriteWithoutResponse (I -[HLBluetoothManager writeData:targetTic:] block @0x1002ad85c: type 1 @0x1002ad89c,
 * writeValue:forCharacteristic:type:1 @0x1002ad9f4 / @0x1002adb30, the binary's only writeValue call sites), so
 * FFE1 accepts both. Neither app uses ATT long writes. 'with-response' is kept because a rejected write is
 * reported (the transport then falls back to 20-byte pieces); the transport's whole-frame default (up to 509 B,
 * web-bluetooth.ts defaultBleWriteChunk) leaves values above the negotiated MTU to the OS long-write path, which
 * no official app exercises [?] (FAMILIES.md §6 #4; hardware check 'ble-fragmentation').
 *
 * Chooser filter: service data UUID 0xBBBB = [productLine, deviceId, SN…]. productLine 4 (SOUND) also covers the
 * MELO P1 TWS earphones, so the filter names the receiver's deviceIds: A ble/core/model/ProductDeviceID.SOUND
 * C6201_INLAND (1) / C6201_OVERSEA (2) → 1032, C6201_EAR (3) → 772 (A mic_ble/parser/DeviceParseV2); I
 * -[HLConnectController didDiscoverPeripheral:advertisementData:] @0x1001d2894 (service data key "BBBB" @0x1001d29d4):
 * hex prefix "0401" → type 11 MELO P1 (@0x1001d2a84), "0403" → type 12 earphones (@0x1001d2a54), "0804" → type 17
 * OWS (@0x1001d2a00); the same "0401" check in -[HLScanViewController didDiscoverPeripheral:advertisementData:]
 * @0x1001e5b44. iOS itself only accepts 04 01; 04 02 (overseas) is Android's [I].
 */
export const MELO_BLE_LINK: WebBluetoothLinkSpec = {
  kind: 'web-bluetooth',
  filters: [
    { serviceData: [{ service: 0xbbbb, dataPrefix: [4, 1] }] },
    { serviceData: [{ service: 0xbbbb, dataPrefix: [4, 2] }] },
  ],
  service: 0xffe0, write: 0xffe1, notify: 0xffe2, writeMode: 'with-response',
  note: 'filters from both apps\' scan parsers (deviceId 1/2; 3 = earphones excluded); advertised name unknown; '
    + 'iOS writes FFE1 without response, Android with response',
}

/** A Protocol6201Provider.getProductId() = {1032, 1033, 1034, 1040, 1035}; VID 0x3547 assumed (FAMILIES.md §1.1 #18). */
export const MELO_PRODUCTS: readonly ProductInfo[] = [
  // A Product.PRODUCT_6201_RX_MAIN = 1032 / RX_SUB = 1033; R product_6201 "MELO P1"; I EA `melo p1` → type 11.
  ...[1032, 1033].map((pid) =>
    usbProduct('6201', MELO_SUPPORT, {
      productId: pid, name: 'MELO P1', label: pid === 1033 ? 'MELO P1 (second phone port)' : undefined, code: '6201',
      txCount: 2, channels: 2, eaModel: 'melo p1',
      // Heartbeat 0x600B every 3 s (melo-6201.md §4.3).
      heartbeatIntervalMs: 3000,
      deviceKind: 'receiver',
      // DeviceControlConstant.DeviceType: TX1/TX2, BOX, EP1/EP2, REMOTE_CONTROL (melo-6201.md §1.1).
      maxUnits: ['rx', 'tx1', 'tx2', 'box', 'earL', 'earR', 'remote'],
      vendorIdConfirmed: false,
      // BLE is a property of the RX; the second-phone RX (1033) is reached over USB only [?].
      links: pid === 1032 ? [MELO_USB_LINK, MELO_BLE_LINK] : [MELO_USB_LINK],
      notes: 'Moma framing with XOR (Android) / none (iOS), unpadded (melo-6201.md §3)',
    }),
  ),
  // A PRODUCT_6201_TX = 1034, PRODUCT_6201_DY_TX = 1040; R product_6201_tx_card "MELO P1 Mic"; I `melo p1 04` → type 13.
  ...[1034, 1040].map((pid) =>
    usbProduct('6201', MELO_ACCESSORY_SUPPORT, {
      productId: pid, name: 'MELO P1 Mic', label: pid === 1040 ? 'MELO P1 Mic (DY edition)' : undefined, code: '6201',
      txCount: 0, channels: 0, eaModel: 'melo p1 04', deviceKind: 'mic', vendorIdConfirmed: false, links: [],
      notes: 'Firmware update only in the official app (A C6201ServiceImpl.isUpgradeProduct)',
    }),
  ),
  // A PRODUCT_6201_BOX = 1035; R product_6201_box_card "MELO P1 Charging Case".
  usbProduct('6201', MELO_ACCESSORY_SUPPORT, {
    productId: 1035, name: 'MELO P1 Charging Case', code: '6201', txCount: 0, channels: 0, deviceKind: 'case',
    vendorIdConfirmed: false, links: [],
    notes: 'Firmware update and battery health only (A c6201/ui/setting/BoxBatteryActivity)',
  }),
]

/** FAMILIES.md §1.4: 772 is an app id, not a USB PID. */
export const MELO_APP_PRODUCTS: readonly ProductInfo[] = [
  // A Product.PRODUCT_6201_EAR = 772 ("6201EAR"); R product_ows_ear_6201; I type 12; ProductDeviceID.SOUND.C6201_EAR (deviceId 3).
  appProduct('6201', MELO_ACCESSORY_SUPPORT, {
    productId: 772, name: 'MELO P1 TWS Monitor Earphones', code: '6201EAR', txCount: 0, channels: 0, deviceKind: 'earphones',
    links: [],
    notes: 'Android SPP 0xE003, Actions OTA TLV only (melo-6201.md §8.1). Not planned.',
  }),
]
