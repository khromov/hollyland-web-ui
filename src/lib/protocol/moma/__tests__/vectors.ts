/**
 * Golden Moma frames: every example frame in docs/research/families/m3-6303.md, max2-6701.md and
 * melo-6201.md, committed as test data (the scratch generators `frames.py` are temporary,
 * FAMILIES.md §5.1). Request bytes come from re-implementations of the apps' builders; replies are
 * illustrative / constructed / hypothetical in the docs (they pin the parser's layout, not device
 * behaviour, and are labelled `hypothetical`). Family agents (W6–W8) import or copy these.
 *
 * Every vector must round-trip: encode(items, options) === bytes, decode(bytes) === items + header.
 */
import { MOMA_TYPE } from '../codec'

export interface MomaVectorItem {
  cmd: number
  type: number
  payload: readonly number[]
}

export interface MomaVector {
  name: string
  /** Doc section the bytes are copied from. */
  doc: string
  /** Profile constant used to encode a request (absent: encode with the explicit header fields). */
  profile?: 'MOMA_6303' | 'MOMA_6701_USB' | 'MOMA_6701_USB_CAMERA' | 'MOMA_6701_BLE' | 'MOMA_6201_USB' | 'MOMA_6201_BLE' | 'MOMA_6201_IOS'
  head: 'down' | 'up'
  reportId: number | null
  source: number
  target: number
  control: number
  items: readonly MomaVectorItem[]
  /** The packet exactly as on the wire (padding included). */
  bytes: Uint8Array
  /** Reply bytes the doc constructed (source / type / padding are guesses there). */
  hypothetical?: boolean
  note?: string
}

/** Hex string (spaces ignored) → bytes, zero padded to `padTo`. */
function h(hex: string, padTo = 0): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '')
  const n = clean.length / 2
  const out = new Uint8Array(Math.max(n, padTo))
  for (let i = 0; i < n; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

const bytesOf = (hex: string) => Array.from(h(hex))
const req = (cmd: number, payload: readonly number[] = []): MomaVectorItem => ({ cmd, type: MOMA_TYPE.REQUEST, payload })

// ---------------------------------------------------------------------------------- 6303 (LARK M3)

/** 0x1F16 [txIndex 1, name[64] UTF-8 "My Voice"] (m3-6303.md §5.6): 65-byte payload → 512-byte packet. */
const TEMPLATE_NAME = [0x01, ...Array.from('My Voice', (c) => c.charCodeAt(0)), ...new Array<number>(56).fill(0)]
/**
 * 0x1F05 [0, txMask, ModAlgBelT (372 B)] (m3-6303.md §3.3, §5.6). The doc gives the layout, not the struct
 * bytes; a deterministic placeholder pattern stands in for ModAlgBelT.
 */
const VOICE_PROFILE = [0x00, 0x01, ...Array.from({ length: 372 }, (_, i) => (i * 7 + 3) & 0xff)]
/** 30-byte 0x6000 heartbeat body in HLHeartInfo6303EntityExtKt.cmdSerialize order (m3-6303.md §5.2), values chosen for the test. */
export const M3_HEARTBEAT_BODY = [
  0x03, 0x01, 0x00, // TX1+TX2 online, RX1 online, plugged into RX index 0
  80, 60, 0, 0, // tx1..tx4 battery
  0xff, 0, 0, 0, // rx1..rx4 battery (0xFF = phone RX, no battery)
  0x02, // TX2 muted
  1, 1, 3, 1, // NC on, Medium, volume 3, stereo
  0, 0, 0, 0, 0, // auto shutdown, eq, TX recognition, LED off flag, pairing
  0, 0, 0, 0, // primary RX, 4T4R, main RX 0, hot shoe
  1, 0, 0, 0, 0, // smart mix, lock, auto exit, refresh flag, ear mode
]

export const M3_VECTORS: readonly MomaVector[] = [
  {
    name: 'M3 heartbeat GET 0x6000 (64 B)', doc: 'm3-6303.md §3.3 (also §7.1 step 3)', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x6000)],
    bytes: h('08 AA DD 06 00 00 00 01 60 00 01 00 00', 64),
  },
  {
    name: 'M3 NC on, Medium 0x1003 [dev 0, level 1, on 1]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x1003, [0, 1, 1])],
    bytes: h('08 AA DD 06 00 00 00 01 10 03 01 00 03 00 01 01', 64),
  },
  {
    name: 'M3 channel mode Stereo 0x1005 [dev 0, mode 1]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x1005, [0, 1])],
    bytes: h('08 AA DD 06 00 00 00 01 10 05 01 00 02 00 01', 64),
  },
  {
    name: 'M3 phone-RX volume step 4 of 6 0x100D [dev 0, level 3]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x100d, [0, 3])],
    bytes: h('08 AA DD 06 00 00 00 01 10 0D 01 00 02 00 03', 64),
  },
  {
    name: 'M3 mute TX2 0x1001 [tx 2, mute 1]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x1001, [2, 1])],
    bytes: h('08 AA DD 06 00 00 00 01 10 01 01 00 02 02 01', 64),
  },
  {
    name: 'M3 device info of RX1 0x600A [deviceId 6]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x600a, [6])],
    bytes: h('08 AA DD 06 00 00 00 01 60 0A 01 00 01 06', 64),
  },
  {
    name: 'M3 firmware versions, 4T4R system 0x6012 [0]', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x6012, [0])],
    bytes: h('08 AA DD 06 00 00 00 01 60 12 01 00 01 00', 64),
  },
  {
    name: 'M3 template name "My Voice" for TX1 0x1F16 (65-byte payload → 512 B)', doc: 'm3-6303.md §3.3', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x1f16, TEMPLATE_NAME)],
    bytes: h('08 AA DD 06 00 00 00 01 1F 16 01 00 41 01 4D 79 20 56 6F 69 63 65', 512),
  },
  {
    name: 'M3 voice profile 0x1F05 (374-byte payload → 512 B)', doc: 'm3-6303.md §3.3, §5.6', profile: 'MOMA_6303',
    head: 'down', reportId: 8, source: 6, target: 0, control: 0, items: [req(0x1f05, VOICE_PROFILE)],
    bytes: h(`08 AA DD 06 00 00 00 01 1F 05 01 01 76 ${VOICE_PROFILE.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`, 512),
    note: 'ModAlgBelT bytes are a placeholder pattern; the doc gives `00 <txMask> <372-byte ModAlgBelT>`',
  },
  {
    name: 'M3 heartbeat reply (illustrative: src 1, dst 6, type 3)', doc: 'm3-6303.md §3.3, body §5.2',
    head: 'up', reportId: 8, source: 1, target: 6, control: 0, items: [{ cmd: 0x6000, type: MOMA_TYPE.DATA, payload: M3_HEARTBEAT_BODY }],
    bytes: h(`08 BB DD 01 06 00 00 01 60 00 03 00 1E ${M3_HEARTBEAT_BODY.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`, 64),
    hypothetical: true, note: 'body values chosen for the test in §5.2 field order',
  },
  {
    name: 'M3 SET ack (illustrative)', doc: 'm3-6303.md §3.3',
    head: 'up', reportId: 8, source: 1, target: 6, control: 0, items: [{ cmd: 0x1003, type: MOMA_TYPE.EXEC_RESP, payload: [0] }],
    bytes: h('08 BB DD 01 06 00 00 01 10 03 02 00 01 00', 64), hypothetical: true,
  },
  {
    name: 'm3-6303.md §3.4: 0x6000 in the 6201 USB framing', doc: 'm3-6303.md §3.4', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x6000)],
    bytes: h('AA DD 06 00 04 00 01 60 00 01 00 00 15'),
    note: 'the doc calls it the 6201 heartbeat, but the 6201 heartbeat is 0x600B (melo-6201.md §3.4 #1); bytes are correct for 0x6000',
  },
]

// --------------------------------------------------------------------------------- 6701 (LARK MAX 2)

export const MAX2_VECTORS: readonly MomaVector[] = [
  {
    name: 'MAX 2 heartbeat, USB mobile RX (target 1), 23 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_USB',
    head: 'down', reportId: null, source: 6, target: 1, control: 7, items: [req(0x600b)],
    bytes: h('AA DD 06 01 07 00 03 5A FA 00 00 00 60 0B 01 00 00 5E FE 00 00 00 1E'),
  },
  {
    name: 'MAX 2 heartbeat, USB camera RX (target 2), 23 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_USB_CAMERA',
    head: 'down', reportId: null, source: 6, target: 2, control: 7, items: [req(0x600b)],
    bytes: h('AA DD 06 02 07 00 03 5A FA 00 00 00 60 0B 01 00 00 5E FE 00 00 00 1D'),
  },
  {
    name: 'MAX 2 NC on, depth index 10, over BLE (target 2), 25 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_BLE',
    head: 'down', reportId: null, source: 6, target: 2, control: 7, items: [req(0x6006, [1, 10])],
    bytes: h('AA DD 06 02 07 00 03 5A FA 00 00 00 60 06 01 00 02 01 0A 5E FE 00 00 00 19'),
  },
  {
    name: 'MAX 2 version/battery of the RX over BLE (0x600A [1], target 5 = BOX), 24 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_BLE',
    head: 'down', reportId: null, source: 6, target: 5, control: 7, items: [req(0x600a, [1])],
    bytes: h('AA DD 06 05 07 00 03 5A FA 00 00 00 60 0A 01 00 01 01 5E FE 00 00 00 1B'),
  },
  {
    name: 'MAX 2 custom gain 2-mic: Mic1 0 dB, Mic2 -6 dB, USB mobile RX, 27 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_USB',
    head: 'down', reportId: null, source: 6, target: 1, control: 7, items: [req(0x6007, [0, 0, 20, 14])],
    bytes: h('AA DD 06 01 07 00 03 5A FA 00 00 00 60 07 01 00 04 00 00 14 0E 5E FE 00 00 00 0C'),
  },
  {
    name: 'MAX 2 "get all" over BLE (8 items + markers, target 2), 58 B', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_BLE',
    head: 'down', reportId: null, source: 6, target: 2, control: 7,
    items: [0x6003, 0x6004, 0x6005, 0x6006, 0x6007, 0x6008, 0x6015, 0x600e].map((c) => req(c)),
    bytes: h(`AA DD 06 02 07 00 0A 5A FA 00 00 00 60 03 01 00 00 60 04 01 00 00 60 05 01 00 00
      60 06 01 00 00 60 07 01 00 00 60 08 01 00 00 60 15 01 00 00 60 0E 01 00 00 5E FE 00 00 00 6E`),
    note: 'item order follows HashMap iteration in the app (not deterministic)',
  },
  {
    name: 'MAX 2 factory reset 0x2007 [00 00], target 2 (DESTRUCTIVE: encode test only)', doc: 'max2-6701.md §3.3', profile: 'MOMA_6701_BLE',
    head: 'down', reportId: null, source: 6, target: 2, control: 7, items: [req(0x2007, [0, 0])],
    bytes: h('AA DD 06 02 07 00 03 5A FA 00 00 00 20 07 01 00 02 00 00 5E FE 00 00 00 53'),
  },
  {
    name: 'MAX 2 set ack OK for 0x6006 (constructed)', doc: 'max2-6701.md §3.3',
    head: 'up', reportId: null, source: 2, target: 6, control: 7, items: [{ cmd: 0x6006, type: MOMA_TYPE.EXEC_RESP, payload: [0] }],
    bytes: h('BB DD 02 06 07 00 03 5A FA 00 00 00 60 06 02 00 01 00 5E FE 00 00 00 03'), hypothetical: true,
  },
  {
    name: 'MAX 2 noise get reply (on, 10) (constructed)', doc: 'max2-6701.md §3.3',
    head: 'up', reportId: null, source: 3, target: 6, control: 7, items: [{ cmd: 0x6006, type: MOMA_TYPE.DATA, payload: [1, 10] }],
    bytes: h('BB DD 03 06 07 00 03 5A FA 00 00 00 60 06 03 00 02 01 0A 5E FE 00 00 00 0B'), hypothetical: true,
  },
]

// --------------------------------------------------------------------------------- 6201 (MELO P1)

const R1_BODY = bytesOf('50 3C 5A 55 00 01 01 01 00 00 01 00 00 01 01 00 01 02 00 00 00 00 00 00 00 00 00 05 00 00 00')

export const MELO_VECTORS: readonly MomaVector[] = [
  {
    name: 'MELO 1 USB heartbeat GET 0x600B (Android)', doc: 'melo-6201.md §3.4 #1', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x600b)],
    bytes: h('AA DD 06 00 04 00 01 60 0B 01 00 00 1E'),
  },
  {
    name: 'MELO 2 BLE heartbeat GET 0x600B (Android)', doc: 'melo-6201.md §3.4 #2', profile: 'MOMA_6201_BLE',
    head: 'down', reportId: null, source: 6, target: 1, control: 4, items: [req(0x600b)],
    bytes: h('AA DD 06 01 04 00 01 60 0B 01 00 00 1F'),
  },
  {
    name: 'MELO 3 iOS heartbeat (control 0, no checksum)', doc: 'melo-6201.md §3.4 #3', profile: 'MOMA_6201_IOS',
    head: 'down', reportId: null, source: 6, target: 1, control: 0, items: [req(0x600b)],
    bytes: h('AA DD 06 01 00 00 01 60 0B 01 00 00'),
  },
  {
    name: 'MELO 4 USB device info GET 0x600A [device type 0]', doc: 'melo-6201.md §3.4 #4', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x600a, [0])],
    bytes: h('AA DD 06 00 04 00 01 60 0A 01 00 01 00 1E'),
  },
  {
    name: 'MELO 5 USB noise reduction SET 0x1300 on, 15 dB', doc: 'melo-6201.md §3.4 #5', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x1300, [1, 15])],
    bytes: h('AA DD 06 00 04 00 01 13 00 01 00 02 01 0F 6A'),
  },
  {
    name: 'MELO 6 USB notify start 0x6048, VU 0x11EB every 100 ms', doc: 'melo-6201.md §3.4 #6, §4.4', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x6048, [1, 0xeb, 0x11, 0x64, 0x00])],
    bytes: h('AA DD 06 00 04 00 01 60 48 01 00 05 01 EB 11 64 00 C7'),
  },
  {
    name: 'MELO 7 USB LED SET 0x2000 mixer on, 100 %', doc: 'melo-6201.md §3.4 #7', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x2000, [1, 0, 2])],
    bytes: h('AA DD 06 00 04 00 01 20 00 01 00 03 01 00 02 55'),
  },
  {
    name: 'MELO 8 USB 3.5 mm direction SET 0x1302 = output', doc: 'melo-6201.md §3.4 #8', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x1302, [1, 0, 0, 0])],
    bytes: h('AA DD 06 00 04 00 01 13 02 01 00 04 01 00 00 00 61'),
  },
  {
    name: 'MELO 9 USB EQ GET 0x1113 (vocal 1, algo 0)', doc: 'melo-6201.md §3.4 #9', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x1113, [0, 0])],
    bytes: h('AA DD 06 00 04 00 01 11 13 01 00 02 00 00 75'),
  },
  {
    name: 'MELO 10 USB batch: heartbeat + noise GET 0x1301', doc: 'melo-6201.md §3.4 #10', profile: 'MOMA_6201_USB',
    head: 'down', reportId: null, source: 6, target: 0, control: 4, items: [req(0x600b), req(0x1301)],
    bytes: h('AA DD 06 00 04 00 02 60 0B 01 00 00 13 01 01 00 00 0E'),
  },
  {
    name: 'MELO 11 start/end + XOR envelope (control 0x07, codec exercise; not a MELO P1 frame)', doc: 'melo-6201.md §3.4 #11',
    head: 'down', reportId: null, source: 6, target: 0, control: 7, items: [req(0x600b)],
    bytes: h('AA DD 06 00 07 00 03 5A FA 00 00 00 60 0B 01 00 00 5E FE 00 00 00 1F'),
    // I requestCommand:payload:needStartEnd:deviceType: (@0x10011d320, control = needStartEnd ? 7 : 4 `csel` @0x10011d3d4,
    // target from hl_targetByteForDeviceType:) has one caller, -[HLBleViewModel bleStartOTA] @0x10015c9b8 (MAX 2 BOX OTA),
    // where a non-BOX target is 0. iOS MELO frames use +[NSData requestCommand:payload:] @0x10011d7e0 → target 1,
    // control 0x00, no start/end, no XOR (vector 'MELO 3').
    note: 'same envelope as the iOS start/end builder (only used for MAX 2 BOX OTA, target 0 there); encoded with explicit header fields',
  },
  {
    name: 'MELO R1 heartbeat reply, 31-byte payload (hypothetical)', doc: 'melo-6201.md §3.4 R1, body §4.3',
    head: 'up', reportId: null, source: 1, target: 6, control: 4, items: [{ cmd: 0x600b, type: MOMA_TYPE.DATA, payload: R1_BODY }],
    bytes: h(`BB DD 01 06 04 00 01 60 0B 03 00 1F ${R1_BODY.map((b) => b.toString(16).padStart(2, '0')).join(' ')} 76`), hypothetical: true,
  },
  {
    name: 'MELO R2 SET ack success for 0x1300 (hypothetical)', doc: 'melo-6201.md §3.4 R2',
    head: 'up', reportId: null, source: 1, target: 6, control: 4, items: [{ cmd: 0x1300, type: MOMA_TYPE.EXEC_RESP, payload: [0] }],
    bytes: h('BB DD 01 06 04 00 01 13 00 02 00 01 00 74'), hypothetical: true,
  },
]

export const MOMA_VECTORS: readonly MomaVector[] = [...M3_VECTORS, ...MAX2_VECTORS, ...MELO_VECTORS]
