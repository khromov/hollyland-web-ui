/**
 * MELO P1 driver frames, computed independently of the TypeScript encoder (a Python re-implementation of
 * A CommandPostBuilder.build with the A Protocol6201Provider settings and the A *ExtKt serializers; scratch
 * tool w8/frames.py, committed here as test data, FAMILIES.md §5.1). The doc's own frames are in
 * moma/__tests__/vectors.ts (MELO_VECTORS). Replies are constructed: their header bytes are guesses [?].
 */
export interface MeloFrameVector {
  name: string
  /** Source of the layout (A = Android 3.1.0, I = iOS). */
  source: string
  hex: string
}

export const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.trim().split(/\s+/).map((x) => parseInt(x, 16)))

export const MELO_DRIVER_VECTORS = {
  vuSourceUsb: {
    name: '0x11E0 inputs + outputs on, chains off (36 B), USB',
    source: 'A data/HLSoundChinaVUTypeExtKt.cmdSerialize; A HLVolumeListView.setVolumeAllVuType',
    hex: 'AA DD 06 00 04 00 01 11 E0 01 00 24 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 A0',
  },
  vuSourceBle: {
    name: '0x11E0 inputs + outputs on, BLE (target 1)',
    source: 'A mic_ble/entity/BleResolveConfig (IDENTIFIER_PHONE_RX)',
    hex: 'AA DD 06 01 04 00 01 11 E0 01 00 24 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 A1',
  },
  notifyStart20Ble: {
    name: '0x6048 [1, 0x11EB LE, 20 ms LE], BLE',
    source: 'A data/HlSoundNotifyInfoExtKt.cmdSerialize',
    hex: 'AA DD 06 01 04 00 01 60 48 01 00 05 01 EB 11 14 00 B6',
  },
  notifyStopBle: { name: '0x6049, BLE', source: 'A CmdSetNotifyStop6201', hex: 'AA DD 06 01 04 00 01 60 49 01 00 00 5D' },
  deviceInfoTx1Ble: { name: '0x600A [TX1 = 5], BLE', source: 'A CmdGetDeviceInfo6201.encodePayload', hex: 'AA DD 06 01 04 00 01 60 0A 01 00 01 05 1A' },
  streamInMic2: {
    name: '0x130A mic 2 → 5, other tracks as read (12 10 12 8 | effect 6), mute[4] = 0, solo kept',
    source: 'A HLVolumeListView.setVolumeInMicAllVolumeAndMute; data/HLAudioInVoiceEntityExtKt',
    hex: 'AA DD 06 00 04 00 01 13 0A 01 00 0F 0C 05 0C 08 06 00 00 00 00 00 00 00 00 00 00 68',
  },
  txGain: { name: '0x1319 tx1 30 dB, tx2 23 dB', source: 'A data/HLIndependentTxGainEntityExtKt', hex: 'AA DD 06 00 04 00 01 13 19 01 00 08 1E 00 00 00 17 00 00 00 7E' },
  noiseGateOn60: {
    name: '0x1142 [1, on, 2, 0] f32 −60, attack 0, release 0, floor 0',
    source: 'A MoreSettingActivity (HlAudioNoiseGateParamSetEntity(…, 0, 0, 0f, 28, null)); data/HlAudioNoiseGateParamSetEntityExtKt',
    hex: 'AA DD 06 00 04 00 01 11 42 01 00 14 01 01 02 00 00 00 70 C2 00 00 00 00 00 00 00 00 00 00 00 00 82',
  },
  bitDepthMic32: { name: '0x1304 mics 32-bit, RX 32-bit, slave 0', source: 'A data/HLAudioUACBitEntityExtKt; MoreSettingActivity.sampleEntity', hex: 'AA DD 06 00 04 00 01 13 04 01 00 04 01 01 01 00 67' },
  autoSpeakerOn: { name: '0x1310 i32 1', source: 'A CmdSetNotPlugPlay6201 → SingleRadioDataExtKt', hex: 'AA DD 06 00 04 00 01 13 10 01 00 04 01 00 00 00 73' },
  workMode2: { name: '0x1154 i32 2 (instrument creation)', source: 'A data/HLWorkModeEntityExtKt', hex: 'AA DD 06 00 04 00 01 11 54 01 00 04 02 00 00 00 36' },
  iosDeviceInfo: { name: 'iOS 0x600A [0] (target 1, control 0, no XOR)', source: 'I +[NSData requestCommand:payload:] @0x10011d7e0', hex: 'AA DD 06 01 00 00 01 60 0A 01 00 01 00' },
  deviceInfoReply: {
    name: 'constructed 0x600A reply: master, SN MP1RX000001, SW 4.0.1.2 (bytes 02 01 00 04), HW 1.0.0.0',
    source: 'A CmdGetDeviceInfo6201.decodePayload (header bytes [?])',
    hex: 'BB DD 01 06 04 00 01 60 0A 03 00 14 00 4D 50 31 52 58 30 30 30 30 30 31 02 01 00 04 00 00 00 01 38',
  },
  vuPush: {
    name: 'constructed 0x11EB push (type 0): in −24 −30 −28 −20 −21, out −18 −19 −96 −96 −96 −96 −25 −25',
    source: 'A data/HLSoundChainInputAndOutputVUSerializer (push type and header bytes [I])',
    hex: 'BB DD 01 06 04 00 01 11 EB 00 00 1A E8 FF E2 FF E4 FF EC FF EB FF EE FF ED FF A0 FF A0 FF A0 FF A0 FF E7 FF E7 FF 91',
  },
} satisfies Record<string, MeloFrameVector>

/**
 * Every command id of A protocol/core/sound/command/type/Command6201 (Android 3.1.0), as read from the decompile,
 * plus the BleMicCommUtil ids it references (0x2007, 0x4000–0x4005, 0x600A, 0x600B).
 */
export const ANDROID_COMMAND6201_IDS: readonly number[] = [
  0x7011, 0x7013, 0x3100, 0x3101, 0x001c, 0x001f, 0x0022, 0x1146, 0x1147, 0x1102, 0x1103, 0x1104, 0x1105, 0x1106, 0x1107, 0x1108,
  0x1109, 0x110a, 0x110b, 0x110e, 0x110f, 0x1110, 0x1111, 0x1112, 0x1113, 0x1114, 0x1115, 0x1117, 0x1118, 0x1126, 0x1127, 0x1128,
  0x1129, 0x112a, 0x112b, 0x112e, 0x112f, 0x1132, 0x1133, 0x1134, 0x1135, 0x1138, 0x1139, 0x1136, 0x1137, 0x113a, 0x113b, 0x113c,
  0x113d, 0x113f, 0x1140, 0x1141, 0x1152, 0x1153, 0x1154, 0x1155, 0x1142, 0x1143, 0x1144, 0x1145, 0x1148, 0x1149, 0x114a, 0x114b,
  0x114c, 0x114d, 0x114e, 0x114f, 0x1150, 0x1317, 0x1318, 0x11e1, 0x11e0, 0x11e2, 0x11e3, 0x11e4, 0x11e5, 0x11e6, 0x11e7, 0x11e8,
  0x11e9, 0x11eb, 0x1300, 0x1301, 0x1302, 0x1303, 0x1304, 0x1312, 0x1305, 0x1313, 0x1319, 0x131a, 0x131d, 0x1306, 0x1307, 0x1308,
  0x1309, 0x130a, 0x130b, 0x130c, 0x130d, 0x130e, 0x130f, 0x1310, 0x1311, 0x2000, 0x3002, 0x3004, 0x1314, 0x1315, 0x6044, 0x6048,
  0x6049, 0x4006, 0x4001, 0x4007, 0x4008, 0x6045, 0x6046, 0x6047, 0x700a,
  // BleMicCommUtil constants used by Command6201
  0x2007, 0x4000, 0x4002, 0x4003, 0x4004, 0x4005, 0x600a, 0x600b,
]
