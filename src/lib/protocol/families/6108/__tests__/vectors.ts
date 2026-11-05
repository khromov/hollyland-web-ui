/**
 * Golden vectors for the LARK A1 (docs/research/families/a1-6108.md §3.6, FAMILIES.md §5.1). The frames were produced
 * by a re-implementation of A application/common/protocol/ProtocolV2.getData (scratch tool frames6108.py) and the
 * iOS column by +[NSData(HL6902Data) headerWithCommand:payload:] @0x10027a9ac; they are committed here as test data.
 * `hex` is the meaningful prefix of the 64-byte Feature-5 report; the rest is zero padding.
 */
import { A1Requests, type A1Request } from '../commands'

export interface A1RequestVector {
  n: number
  name: string
  /** Feature-5 frame up to and including the EF marker (zero padded to 64 on the wire). */
  hex: string
  /** iOS EA form `AA DD cmd len16 payload XOR` (reference only). */
  ios: string
  request: A1Request
  source: string
}

const S = 'a1-6108.md §3.6; A ProtocolV2.getData; I headerWithCommand:payload: @0x10027a9ac'

export const A1_REQUEST_VECTORS: readonly A1RequestVector[] = [
  { n: 1, name: 'Heartbeat', hex: '05 03 AA DD 1F 00 00 EF', ios: 'AA DD 1F 00 00 68', request: A1Requests.heartbeat(), source: S },
  { n: 2, name: 'Firmware version of RX', hex: '05 03 AA DD 0D 00 01 00 EF', ios: 'AA DD 0D 00 01 00 7B', request: A1Requests.version('rx'), source: S },
  { n: 3, name: 'Firmware version of TX2', hex: '05 03 AA DD 0D 00 01 02 EF', ios: 'AA DD 0D 00 01 02 79', request: A1Requests.version('tx2'), source: S },
  { n: 4, name: 'Serial number of TX1', hex: '05 03 AA DD 12 00 01 01 EF', ios: 'AA DD 12 00 01 01 65', request: A1Requests.serial('tx1'), source: S },
  { n: 5, name: 'MAC of RX', hex: '05 03 AA DD 30 00 00 EF', ios: 'AA DD 30 00 00 47', request: A1Requests.rxMac(), source: S },
  { n: 6, name: 'MAC of TX1 (0-based index 0)', hex: '05 03 AA DD 31 00 01 00 EF', ios: 'AA DD 31 00 01 00 47', request: A1Requests.txMac('tx1'), source: S },
  { n: 7, name: 'NC on, Strong', hex: '05 03 AA DD 13 00 02 01 02 EF', ios: 'AA DD 13 00 02 01 02 65', request: A1Requests.setNoise(true, 2), source: S },
  { n: 8, name: 'Volume index 3', hex: '05 03 AA DD 03 00 01 03 EF', ios: 'AA DD 03 00 01 03 76', request: A1Requests.setVolume(3), source: S },
  { n: 9, name: 'Channel mode Stereo', hex: '05 03 AA DD 01 00 01 01 EF', ios: 'AA DD 01 00 01 01 76', request: A1Requests.setChannelMode(1), source: S },
  { n: 10, name: 'EQ "Bright" (2)', hex: '05 03 AA DD 07 00 01 02 EF', ios: 'AA DD 07 00 01 02 73', request: A1Requests.setEq(2), source: S },
  { n: 11, name: 'Reverb on, Medium (1)', hex: '05 03 AA DD 05 00 02 01 01 EF', ios: 'AA DD 05 00 02 01 01 70', request: A1Requests.setReverb(true, 1), source: S },
  { n: 12, name: 'Mute TX3 (index 2)', hex: '05 03 AA DD 16 00 02 02 01 EF', ios: 'AA DD 16 00 02 02 01 60', request: A1Requests.setTxMute('tx3', true), source: S },
  { n: 13, name: 'LED off', hex: '05 03 AA DD 21 00 01 01 EF', ios: 'AA DD 21 00 01 01 56', request: A1Requests.setLed(false), source: S },
  { n: 14, name: 'Mic recognition on', hex: '05 03 AA DD 23 00 01 01 EF', ios: 'AA DD 23 00 01 01 54', request: A1Requests.setMicRecognition(true), source: S },
  { n: 15, name: 'Auto power-off "Never"', hex: '05 03 AA DD 27 00 01 01 EF', ios: 'AA DD 27 00 01 01 50', request: A1Requests.setShutdownTime(1), source: S },
  { n: 16, name: 'Mode setting → Performance', hex: '05 03 AA DD 3F 00 01 01 EF', ios: 'AA DD 3F 00 01 01 48', request: A1Requests.setSignalMode(1), source: S },
  { n: 17, name: 'Get signal mode', hex: '05 03 AA DD 40 00 00 EF', ios: 'AA DD 40 00 00 37', request: A1Requests.getSignalMode(), source: S },
  { n: 18, name: 'Get hidden performance flag', hex: '05 03 AA DD 46 00 00 EF', ios: 'AA DD 46 00 00 31', request: A1Requests.getPerformanceMode(), source: S },
]

export interface A1OtaVector {
  n: number
  name: string
  /** Feature-6 frame prefix; the rest of the 160 bytes is 0xCD padding. */
  hex: string
  cmd: number
  source: string
}

/** ⚠ Documented only: Mic Console has no builder for these and must refuse them everywhere. */
export const A1_OTA_VECTORS: readonly A1OtaVector[] = [
  { n: 19, name: 'OTA: RX enter upgrade (Feature 6)', hex: '06 03 00 00 00 1A', cmd: 0x1a, source: 'a1-6108.md §3.3, §3.6; A UsbMessengerV2.sendRxUpgrade' },
  {
    n: 20, name: 'OTA: enter DFU, size 123456', hex: '06 0F 00 00 02 1C 00 00 00 00 00 00 00 00 40 E2 01 00', cmd: 0x1c,
    source: 'a1-6108.md §3.3, §3.6; A UsbMessengerV2.enterDfu',
  },
]

/**
 * Expected heartbeat reply [I] (a1-6108.md §3.6): `05 ?? BB DD 1F 00 17 <23-byte body>`. Byte 1 is unknown; the
 * vector uses 0x03 like the simulator. Hypothetical: it pins the parser's layout, not device behaviour.
 */
export const A1_HEARTBEAT_REPLY_HEX = '05 03 BB DD 1F 00 17 01 01 55 3C 00 01 01 02 03 01 00 00 02 01 01 01 00 00 00 00 00 00 00'
export const A1_HEARTBEAT_BODY_HEX = '01 01 55 3C 00 01 01 02 03 01 00 00 02 01 01 01 00 00 00 00 00 00 00'
