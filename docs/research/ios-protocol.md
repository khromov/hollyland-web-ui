# HollyAudio iOS (3.1.0) protocol reconstruction: LARK A2 (6118) and LARK M2

Source analysed: `/Applications/larkSound.app/Wrapper/larkSound.app/larkSound`, an arm64 Mach-O, bundle `com.hollyland.larkc2`, CFBundleVersion 20261022111449. The Jenkins job name embedded in the binary is `LarkSound_iOS_story_6118`. Frameworks: `Commonlibs` (provides `YJDataHelper`) and `cmsis_api_ios`.

Method: static analysis only, using `otool -ov` for ObjC metadata, `otool -tV` for disassembly, radare2 for function-level disassembly, and small Python helpers that resolve objc_msgSend selector stubs, classrefs and CFStrings. No device I/O was done, and the Android sources were not read.

Citation conventions:
- `-[Class sel]` / `+[Class sel]` followed by an `@0x…` address cites an ObjC method implementation in the main binary. Addresses are virtual addresses with image base `0x100000000`.
- A bare address is an instruction site.
- CFString contents are quoted.
- Only one 4 KB page is encrypted (`cryptoff 0x253000`). It contains `HLLevelMeterView` UI code and none of the protocol code cited here.

Confidence labels used below:
- **[V]** verified directly in disassembly.
- **[I]** inferred, but strongly supported by the code.
- **[?]** open question that needs a live device.

---

## 0. TL;DR

* The **LARK A2 (6118)** and the **LARK M2** use the same protocol family: the "Lark C1 / 6501" family (`HL6501*` classes, `HLLarkC1ViewModel`). **6118 does not use the 6303 family.**
  * 6303 is **LARK M3** (deviceType 14, `HL6303MainTabController`).
  * The 6118 differs from the M2 in only a few places: version command `0x41` instead of `0x03`, plus Mic-Recognition (`0x3B/0x3C`), Smart-battery (`0x3D/0x3E`) and the `0x3A` noise command.
* Transport on iOS: **External Accessory (iAP2)**, protocol string `com.hollyland.protocol`, over USB.
  * Writes go out in ≤ 64-byte chunks, with a 20 ms gap between framed commands.
  * Reads are 512-byte reads, and one read is handled as one frame.
* **Request frame:** `AA DD | CMD | 0x40|target | LEN_hi LEN_lo | payload… | XOR`
  * `target`: 0 = RX, 1 = TX1/Mic1, 2 = TX2/Mic2.
  * `XOR` = XOR of every preceding byte, starting at `AA`, with initial value 0.
  * LEN is a big-endian uint16 payload length.
  * No CRC is used for this family.
* **Response frame**, as seen by the app: 2 bytes of header (believed to be `BB DD`) are stripped without being checked. After that comes `CMD | SRC | LEN_hi LEN_lo | payload… [| XOR?]`. The SRC byte encodes RX/TX1/TX2. The app never verifies a response checksum.
* **Session:** there is no cryptographic handshake.
  * When the EA session opens, the app runs a timed sequence of GETs (sec. 3.2).
  * It then sends a **heartbeat/status poll `0x10` every 3.0 s**. The reply carries TX link state, battery levels, noise level, volume, lock state, channel mode, auto-off, key functions, LED, EQ, mute and charging flags.
* **Firmware upload** does not use AA DD framing. The image is sent as raw 64-byte packets: `0x55` followed by 63 bytes of image data, zero padded. This is destructive and is documented only.

---

## 1. Transport

### 1.1 External Accessory (USB / iAP2), used for A2 and M2

* `Info.plist`:
  * `UISupportedExternalAccessoryProtocols = ["com.hollyland.protocol"]`
  * `UIBackgroundModes` includes `external-accessory` and `bluetooth-central`.
* The class `EADSessionManager` (source path `larkc1/MessageTools/EADSessionManager.m`) is a singleton returned by `+sharedController @0x100124438`. Its ivars [V] (from `otool -ov`) are:
  * `_accessory` (EAAccessory) and `_protocolString`
  * `_session` (EASession)
  * `_writeData` / `_readData` (NSMutableData)
  * `_manager` (EAAccessoryManager)
  * `_myHeaderData`, `_resHeaderData`
  * `_writeQueue` (`"com.lark.writeQueue"`), `_pendingCommands`
  * `_deviceType`, `_curUpgrateType`, `_usbIsIn`, `_isUsbRecognized`
* Connection handling:
  * `-checkAccessory @0x1001256ac` iterates `connectedAccessories` and matches the protocol string `"com.hollyland.protocol"`.
  * `-accessoryDidConnect @0x1001255c0` and `-accessoryDidDisconnect: @0x100126f08` handle EAAccessoryDidConnect/DidDisconnect notifications.
  * `-openSession @0x100125198` and `-closeSession @0x10012536c` manage the session.
  * `-stream:handleEvent: @0x100126fcc` is the NSStream delegate.
* Accessory metadata getters: `getAccessoryName @0x10012596c`, `getAccessoryModelNumber @0x1001259e8`, `getAccessorySerialNumber @0x100125a98`, `getAccessoryVision @0x100125b48` (firmwareRevision).

#### Product identification (iOS)

`-[EADSessionManager setupControllerForAccessory:withProtocolString:] @0x10012477c` compares `accessory.modelNumber.lowercaseString` with the strings below (CFStrings at `0x100cc39e8…0x100cc3b68`) and calls `setDeviceType:` [V].

| EA modelNumber (lowercased) | deviceType | Display name (`+[HLDeviceUtils getDeviceNameWithType:] @0x1003210e0`, switch table `0x100c17260`) |
|---|---|---|
| `lark c1` | 0 | "Lark C1" |
| `lark max` | 1 | "Lark MAX" |
| (none) | 2 | "Lark C1" |
| **`lark m2`** | **3** | **"Lark M2"** (shown as "Lark MIX" when the app is the Moma brand, i.e. CFBundleDisplayName starts with "猛玛音频") |
| `lark c1 pro` | 4 | "Lark C1" (Moma: "悦声S1(二代)") |
| `lark m1 pro` | 5 | "Lark M1" (Moma: "Lark M1(二代)") |
| (none) | 6 | "Lark Mini" |
| `lark m2s` | 7 | "LARK M2S" (Moma: "LARK M2") |
| **`lark a2`, `lark a2s`** | **8** | **"LARK A2"** ("LARK A2/A2S" for Moma) |
| (set later, see sec. 4.4 `0x16`) | **9** | **"LARK A2"**: the A2 with a camera RX |
| `lark a1` | 10 | "LARK A1" (6108 family, `protocolType 2`) |
| `melo p1` | 11 | "MELO P1" (6201 family) |
| (none) | 12 | "MELO P1 耳机" (earphone) |
| `melo p1 04` | 13 | "MELO P1 麦克风" (mic) |
| `lark m3` | 14 | "LARK M3" (**6303** family, `HL6303MainTabController`) |
| `lark max 2` | 15 (and 16) | "LARK MAX 2" (6701, BLE) |
| (none) | 17 | "OWS Monitor Earphone" |
| anything else | -1 | the app shows "当前APP无法支持该设备,请进行APP升级" (unsupported, upgrade the app) |

* `+[HLDeviceUtils isConnect6118Device] @0x1003230b8` returns `deviceType == 8 || deviceType == 9` [V].
* `+[HLDeviceUtils connectEAPDeviceWithEntity:from:] @0x100322e08` routes devices [V]:
  * 11 → `HLSoundMainViewController`
  * 15 → `HLBleDeviceController`
  * 13 → `HLSingleUpgradeVC`
  * 14 → `HL6303MainTabController`
  * every other type → `HLDeviceController` with `protocolType = (deviceType == 10) ? 2 : 0`
* `-[HLDeviceController viewDidLoad] @0x1002c3ed0` [V]:
  * `protocolType == 0` → `c1ViewModel start` (owns an `HL6501Engine`, `-[HLLarkC1ViewModel initPrivate] @0x1000b5ed4`), then `+[HL6501Messenger getDeviceInitialInfo]`.
  * `protocolType == 2` (A1) → `HL6108Engine` / `HL6108Messenger`.
* `-[HLDeviceController setupView] @0x1002c4bb4` [V]:
  * `protocolType == 0` and `isConnect6118Device` → Swift `HLLark6118View` (classref `0x100e88068`)
  * otherwise → `HLLarkM2View`
  * `protocolType == 2` → `HLLarkA1View`

**Web implication:** the browser cannot see the EA modelNumber. Use the USB PID instead (0x0411 = A2 mobile RX, 0x0412 = A2 camera RX, per the orchestrator's Product.java pointer). Inside the protocol, confirm the RX variant with command `0x16` (sec. 4.4).

### 1.2 Write path

* `+[HLMessageUtils sendMsg:] @0x100123154` → `+doSendMsg: @0x1001233c0`.
  * `transportMode` 1 → BLE: `-[HLBluetoothManager write:forCharacteristic:]`.
  * `transportMode` 2 → USB/EA: `-[EADSessionManager writeData:] @0x100125c38` [V].
* `-[EADSessionManager writeSimpleData] @0x1001239cc` [V]:
  * Checks that the pending buffer starts with `headerData` = `AA DD` (`-headerData @0x1001271e8`, which builds `coverDataWithUInt8:0xAA` + `0xDD`).
  * The maximum bytes per `write:maxLength:` is **0x40 = 64** for every type except 11/13 (MELO), which use 0x1F4 = 500.
  * If `isNeedSleep:` is true (`@0x10012589c`: the buffer starts with `myHeaderData` = `AA DD`), it calls **`usleep(0x4E20)` = 20 ms** before each write.
* Priority queue: `writeData:priority:` / `enqueueCommand:priority:` / `removeDuplicateCommandsWithPrefix:` (only used for types 11/13).

### 1.3 Read path

* `-[EADSessionManager _readData] @0x100124050` calls `read:maxLength:0x200` (512) in a loop while `hasBytesAvailable`, then `dealWithCurrentData`.
* `-dealWithCurrentData @0x100124228` [V], for every type except 11/13/14:
  * `payload = readData[2 ..< len]`. The first 2 bytes are dropped without being checked.
  * The whole `readData` buffer is cleared, so **one read is treated as one frame**. There is no reassembly.
  * The result goes to `-[HLProtocolDispatcher dispatchReceivedData:] @0x1000d941c` → current handler `-[HL6501SimpleHandler handleReceivedData:] @0x1000d95ec` → `HL6501PacketParser parseMessageFromData:` → `HL6501EventMapper` → `HL6501Engine`.
  * The dispatcher is only used when the EA delegate does not implement `inputStreamReceive:`.
* `-resHeaderData @0x1001272f0` builds the constant `BB DD` (`mov w8,#0xddbb; strh`, little-endian), but nothing references it. **[I]:** responses start with `BB DD`. **[?]:** confirm on hardware.

### 1.4 BLE (not used by A2/M2)

`HLBluetoothManager` (CoreBluetooth) is used for LARK MAX 2, MELO and OWS. UUID strings near `HLMessageUtils` include `E49A25E0-F69A-11E8-8EB2-F2801F1B9FD1`, `FFE1`, `E49A28E1-…`, `E49A25F8-…`, `FFD0`, `FFD2`, `FFE2`. These are listed for completeness; the A2 and M2 code paths never use BLE.

### 1.5 Mapping to WebHID (hypothesis)

* The A2's iAP interface (#7) is not reachable from a browser.
* The HID vendor collection with report ID **0x41** (usage page FF82, 63-byte IN + 63-byte OUT) is the obvious counterpart.
* The EA writer's 64-byte chunk limit and the firmware packets, which start with a `0x55` tag byte (the same number as the input-only HID report 0x55), suggest the firmware tunnels the same byte stream through HID.
* **[?]** Most likely form: OUT report `0x41`, data = the AA DD frame zero-padded to 63 bytes. IN reports `0x41`/`0x55` likely carry `BB DD …`. This is a hypothesis to test, not something proven by the iOS binary.

---

## 2. Framing (6501 / "Lark" family, used by A2 and M2)

### 2.1 Request builder [V]

`+[NSData(HL6902Data) headerWithCommand:payload:andType:] @0x10027a484` builds the request, appending bytes in this order:

1. `0xAA`, then `0xDD` (`YJDataHelper coverDataWithUInt8:`).
2. `CMD` (uint8).
3. **TYPE byte** = `decodeBinaryString([NSString stringWithFormat:@"0100000%@", @"%zd" of type])`. For type 2 the code uses the special string `"01000010"`.
   * Result: type 0 → **0x40**, type 1 → **0x41**, type 2 → **0x42**.
   * CFStrings: `"0100000%@"` @0x100ccbf68, `"01000010"` @0x100ccbf88, `"%zd"` @0x100cbfd28.
   * `YJDataHelper decodeBinaryString:` (Commonlibs `@0x9778`) is `strtoul(s, 0, 2)`.
4. `LEN`: `ToHexStr(payload.length)` → `convertHexStrToData` → left-padded with `addZero:` to **2 bytes, big-endian** (Commonlibs `ToHexStr @0x8e68`, `convertHexStrToData @0x962c`, `addZero @0x9aa4`).
5. `payload`.
6. `XOR`: `-[NSData getOrData:] @0x10027a6f8` enumerates every byte of the frame so far, starting at `0xAA`. The block at `@0x10027a7c4` does `acc ^= b` with `acc` initialised to 0. The result is appended as one byte.

The `type` argument is the **addressee**: 0 = RX (receiver), 1 = TX1 (Mic 1), 2 = TX2 (Mic 2). Evidence: `getDeviceInitialInfo` sends `0x15` with type 0/1/2, and `sendGetAllDeviceVersion` sends version GETs with type 1/2 only when `tx1IsOnline`/`tx2IsOnline` (`@0x10008afb0`).

Two related builders exist but are not used for A2/M2 controls:

* `headerWithCommand:payload: @0x10027a9ac`: `AA DD CMD LEN(2) payload XOR`, with no type byte. Used for the A1 (6108) heartbeat `0x1F`.
* `headerWithCommand: @0x10027ab54`: `AA DD CMD 00 00 XOR`.

Reference implementation:

```ts
function frame(cmd: number, target: 0|1|2, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const b = [0xAA, 0xDD, cmd, 0x40 | target, payload.length >> 8, payload.length & 0xFF, ...payload];
  b.push(b.reduce((a, x) => a ^ x, 0));
  return Uint8Array.from(b);
}
```

### 2.2 Response layout as parsed [V]

`-[HL6501PacketParser parseMessageFromData:] @0x1000d9718` receives the data after the 2-byte strip. Offsets below are relative to that buffer:

| off | meaning |
|---|---|
| 0 | CMD (switch on `CMD-3`, jump table `0x100c16380`, 0x3F entries) |
| 1 | SRC: device-type byte, decoded by `-[NSData judgeCurrentDevTypeWithData:] @0x10027a898` |
| 2–3 | LEN (uint16 BE; `coverDecimalismData` of `subdata(2,2)`) |
| 4… | payload (`payload[0]` is at offset 4) |
| last | presumably the XOR. **It is never checked by the app.** |

`judgeCurrentDevTypeWithData:` maps the SRC byte as follows [V]:

| SRC value | result |
|---|---|
| 0x00 | 5 |
| 0x01 | 0 (RX) |
| 0x02 or 0x81 | 1 (TX1) |
| 0x03 or 0x82 | 2 (TX2) |
| 0x04 | 3 |
| 0x05 | 4 |
| anything else, including 0x80 | 0 (RX) |

**[I]** Replies use `0x80 | target` (0x80 RX, 0x81 TX1, 0x82 TX2), mirroring the `0x40 | target` of requests.

### 2.3 Other framings in the binary (for triangulation only)

* `HLCommandFrameBuilder +frameWithSource:target:control:commands:startMagic:includeStart:endMagic:includeEnd:checksum: @0x1000a3058`:
  * Layout: `AA DD src tgt ctl COUNT(BE16)`, then TLV items `cmd(BE16) type(u8) len(BE16) payload`, with optional start/end marker items.
  * Checksum options (`checksumDataFor:body: @0x1000a2f20`): 0 = none, 1 = XOR (`getOrData:`), 2 = CRC16 (`HLSoundTransTools crc16_compute2WithData:crc:`, BE), 3 = CRC32 (`HL6201UpgradeTools crc32_compute2With:crc:`, BE).
  * Used only through the `NSData requestCommand…` category (`@0x10011d320` etc.) by **LARK MAX 2 / 6201**. **Not used for A2/M2.**
* A1 / 6108 uses `HL6108Messenger` / `HL6108DefaultPayloadCodec` (`action6108Set…`) and is not covered here.

---

## 3. Session flow

### 3.1 Connect

1. iOS reports an EA accessory with protocol `com.hollyland.protocol`.
2. `setupControllerForAccessory…` assigns deviceType 3 (M2) or 8 (A2). `setConnectState:1` is called, then `openSession`.
3. `HLDeviceController viewDidLoad` → `HLLarkC1ViewModel start` (HL6501Engine) and `+[HL6501Messenger getDeviceInitialInfo]`.

There is **no authentication or handshake exchange** beyond iAP2 itself. On WebHID, simply start with the GET sequence.

### 3.2 Initial GET sequence

`+[HL6501Messenger getDeviceInitialInfo] @0x10008aa48`, scheduled with `dispatch_after` [V]:

| t (s) | frame |
|---|---|
| 0.0 | `0x11` get noise level (RX) |
| 0.5 | `0x16` get device info (RX) — block `@0x10008ac88` |
| 1.0 | `0x04` get volume level |
| 1.5 | version of RX: `0x41` on 6118, `0x03` on others (`sendGetDeviceInfoVersion:0`) |
| 2.0 | `0x13` get speaker / "voice out" status |
| 2.5 | `0x15` get SN, type 0 (RX) |
| 3.0 | `0x15` get SN, type 1 (TX1) |
| 3.5 | `0x15` get SN, type 2 (TX2) |
| 4.0 | 6118 only: `0x3C` get Mic-Recognition |
| 4.5 | 6118 only: `0x3E` get Smart-battery-life |

`HL6501Engine handleTXOnlineChangeWithType:connectStatus:versionDelay:snDelay: @0x1000bd498` re-queries a TX's version and SN when that TX comes online (TX1 type 1, TX2 type 2).

### 3.3 Heartbeat / status poll

* `-[HLDeviceController sendHeartInfo] @0x1002c4998` [V]:
  * Repeating `NSTimer` with **3.0 s** interval (`@0x1002c4230 fmov d0,#3.0`).
  * `protocolType 0` → sends `0x10`, type 0, empty payload: **`AA DD 10 40 00 00 27`**.
  * The poll is skipped while `curUpgrateType == 3` (upgrade in progress).
  * A1 instead sends `0x1F` without a type byte.
* Reply `0x10` → `-[HL6501PacketParser messageForHeartbeat:] @0x1000d9980` → `-[HLHeartEntity initEntityWithData:] @0x1001fa17c`. See sec. 4.3 for the layout.
* Engine side, `-[HL6501Engine handleHeartbeatEntity:] @0x1000bc1d0`:
  * `txNOnline = (txNConnectStatus == 1)`.
  * `noiseSwitch = noiseLevel > 0`.
  * A heartbeat noise level is only accepted if `< 4` (`isHeartbeatNoiseLevelValid: @0x1000bafac`).
  * Heartbeat values for noise/volume are ignored for **1.0 s after a user change** (`isInUserConfigProtectWindow @0x1000baf10`), to avoid UI bounce.

### 3.4 Timeouts and retries

* No per-command ACK timeout was found in the 6501 path. Responses update state asynchronously, so the protocol is effectively fire-and-forget plus polling.
* The 20 ms inter-frame sleep (sec. 1.2) is the only pacing.
* `0x41` (6118 version) responses are parsed with `getNewVersionWithData:`, which requires exactly 6 version bytes.

---

## 4. Command catalog (A2 = 6118 and M2)

Legend:

* All requests are framed as in sec. 2.1.
* "type" is the TYPE argument (0 = RX unless stated).
* Set commands are issued as `HLDeviceAction actionWithCommand:payload:` → `HL6501Engine dispatchAction: @0x1000bafb8` → `HL6501Transport sendAction: @0x1000b64f4` → `HL6501DefaultPayloadCodec payloadForAction:deviceType: @0x10011b9fc` → `headerWithCommand:payload:andType:0`.
* The payload dictionary uses keys `"value"` (CFStr @0x100cbf828) and `"isOn"` (@0x100cbf848).

### 4.1 GET / plain commands (HL6501Messenger, class methods)

| CMD | Method (addr) | type | payload | reply parser |
|---|---|---|---|---|
| 0x03 | `sendGetDeviceInfoVersion:` @0x10008af00 (non-6118) | arg (0/1/2) | none | 0x03 → `messageForDeviceVersion:` @0x1000d99f8 |
| **0x41** | same method, **6118** (`csel` on `isConnect6118Device`) | arg | none | 0x41 → `messageForDeviceNewVersion:` @0x1000da7dc |
| 0x04 | `sendGetDeviceVoliceLevel` @0x10008b4f0 | 0 | none | 0x04 → `messageForVolumeLevel:` (payload[0]) |
| 0x11 | `sendGetDeviceNoiseLevel` @0x10008b3e4 | 0 | none | 0x11 → `messageForNoiseLevel:` (payload[0]) |
| 0x13 | `sendGetDeviceVoiceStatus` @0x10008b688 | 0 | none | 0x13 → `messageForSpeakerStatus:` (speakerOn = payload[0] **== 0**) |
| 0x15 | `-[HL6501Transport sendGetSN:]` @0x1000b6450, also the initial sequence | 0/1/2 | none | 0x15 → `messageForDeviceSN:` @0x1000da26c |
| 0x16 | initial-info block @0x10008ac88 | 0 | none | 0x16 → `messageForDeviceInfo:` (raw) → `HL6501Engine handleDeviceInfoPayload:` |
| 0x08 | `sendGetDeviceInfoIDWithType:` @0x10008b11c | arg; payload `[type]` if type ≠ 0, else empty with type 0 | see left | 0x08 → `messageForDeviceInfoID:` (device ID blob for OTA) |
| 0x3C | `sendGetMicIdentify` @0x10008b798 | 0 | none | 0x3C → `messageForMicIdentify:` (payload[0] ≠ 0) |
| 0x3E | `sendGetDeviceEndurance` @0x10008b710 | 0 | none | 0x3E → `messageForEndurance:` (payload[0] ≠ 0) |
| 0x38 | `-[HLKeyFuncController requestLightColor]` @0x1000dea9c | 0 | (built in caller) | 0x38 → `messageForKeyFunctionColors:` (color1 = payload[0], color2 = payload[1]) |
| 0x10 | heartbeat (sec. 3.3) | 0 | none | 0x10 → heartbeat |
| 0x0C | `sendRestartRxDevice` @0x10008b1f4 | 0 | none | restarts the RX (**disruptive**) |
| 0x3F | `deleteDevicePairWithType:` @0x10008b820 | 0 | `[type]` (1 = TX1, 2 = TX2 [I]) | config ack. **DESTRUCTIVE**: unpairs a mic |
| 0x40 | `sendRestoreFactoryReset` @0x10008b8b0 | 0 | none | config ack. **DESTRUCTIVE**: factory reset |
| 0x12 | `sendSetDeviceVoiceOutStatus:(BOOL)` @0x10008b5fc | 0 | `[!on]` (**inverted**) | 0x12 → `messageForSpeakerConfigResponse:` (success = payload[0] == 1) |
| 0x05 | `sendSetDeviceVoliceLevel:` @0x10008b56c | 0 | `[level]` | config ack |
| 0x06 | `sendSetDeviceNoiseLevel:` @0x10008b460 | 0 | `[level]` | config ack |
| 0x0D / 0x09 | `sendEnterUpgradeToDevice:devid:` @0x10008aea4 | devType (0 → cmd 0x0D RX; ≠ 0 → cmd 0x09 TX) | devId blob (from 0x08) | 0x0D → `messageForEnterUpgrade:isRX:1`; 0x09 → `isRX:0`. **DESTRUCTIVE** |

### 4.2 SET actions

The codec rules come from `HL6501DefaultPayloadCodec payloadForAction:deviceType: @0x10011b9fc` [V]. The UI sources are `HLLarkM2View` (ObjC) and `HLLark6118View` / `HL6118FunctionSetView` (Swift).

| CMD | Payload rule (codec) | Feature (UI) | Seen in |
|---|---|---|---|
| 0x05 | `[value]` | **Output volume / level**. The M2 `voiceView` offers 3 levels, labelled "1", "2", "3" (CFStr @0x100cbaf08/@0x100cc07c8/@0x100cc07e8). Engine: optimistic `setVolumeLevel:`. If locked: "音量调节功能已锁定，请先解锁" (volume locked). | M2 `-voiceView` @0x1000cf8c4 (site 0x1000cfc14); 6118 Swift closure @0x10066a718; `HLDocumentController gainBtn` |
| 0x06 | `[value]` | **Noise-cancellation level**: slider from "弱" Weak to "强" Strong (also "中" Medium). Valid 0..3, where 0 = off. Engine: `setNoiseLevel:`. | M2 `-noiseView` @0x1000cee24 (0x1000cf4e4); 6118 @0x100669e1c |
| 0x19 | `[value]`; the UI always passes `value = 2` together with `isOn: Bool`, and **the codec ignores `isOn`** → wire payload is always `02` | **Noise-cancellation on/off toggle** ("降噪开关"). Engine optimistically sets `noiseSwitch = isOn`. [?] The exact device semantics of `[02]` are unknown (toggle? "mode 2"?). | M2 `-noiseViewSwitchChanged:` @0x1000ccf58; 6118 @0x100665f70 |
| 0x3A | `[isOn ? 1 : 0, value]` (2 bytes) | **6118 noise switch + level in one command** (Swift dictionary keys `"isOn"` / `"value"` as immediates 0x6e4f7369 / 0x65756c6176) | 6118 only, sites @0x10066a108 and @0x10066a440 |
| 0x18 | `[value]` | **Channel mode** "声道模式": 单声道 Mono / 立体声 Stereo (CFStr @0x100cba5c8/@0x100cba5e8/@0x100cba628; icons `device_voice_m` / `device_voice_s`). Heartbeat field `vocalMode`. | M2 `-vocalView` @0x1000d0638; 6118 @0x1006698f4 |
| 0x34 | `[isOn ? 1 : 0]` (falls back to `value` if `isOn` is absent) | **Volume / button lock** (heartbeat `lockStatus`; reply `0x34` → `messageForVoiceLockStatus:`) | M2 `-voiceLockView` @0x1000cfd34 |
| 0x36 | `[value]` | **Auto power-off**: options "15分钟" (15 min) / "永不" (never) (CFStr @0x100cc0948/@0x100cc0968). Heartbeat `shutTime`. | M2 `-shutDownView` @0x1000d1d74; `HL6118FunctionSetView renderWithState:` @0x1005af8ac |
| 0x12 | `[!isOn]` (inverted) | **Phone speaker / "免拔插外放"** (playback without unplugging) | M2 `-outSwitch` @0x1000ceba8; `HL6118FunctionSetView` @0x1005af9f4 |
| 0x39 | `[!isOn]` (inverted) | **Indicator LED** ("指示灯开关"). Heartbeat `lightStatus`. | M2 `-lightSwitch` @0x1000d2020; 6118 `setLightSwitch:` closure @0x100664664 |
| 0x3B | `[isOn ? 1 : 0]` | **Mic Recognition** ("Mic识别"), 6118 `checkSwitch`; GET is 0x3C | 6118 @0x10066761c |
| 0x3D | `[isOn ? 1 : 0]` | **Smart battery life** ("智能续航"); GET is 0x3E | `HL6118FunctionSetView` @0x1005afb74 |
| 0x3F | `[value]` | delete pairing (see 4.1) | settings |
| 0x37 | `[customNum (1 \| 2 = key index), btnFuncType, keyType, tx1Color, tx2Color]` (`-[HLKeyFuncEntity getPaylodWithEntity] @0x1000dad5c`) | **Custom TX button function and color** (`HLKeyFuncController`; reply `0x38` colors) | `HLKeyFuncController` @0x1000dff08 / @0x1000e1294 / @0x1000e1568 |

Codec notes:

* Commands not listed in the codec switch (anything other than 05/06/12/18/19/34/36/39/3A/3B/3D/3F) produce `nil`, and nothing is sent.
* `0x37`, `0x38` and the plain GETs bypass the codec and call `headerWithCommand:payload:andType:` directly.

### 4.3 Heartbeat reply (`0x10`)

Parsed by `-[HLHeartEntity initEntityWithData:] @0x1001fa17c` [V]. Offsets are after the 2-byte strip, so offset 0 is the CMD byte. Each field is read with `+[NSData getSubDataFrom:WithSafeRange:]` (out of range → zeros).

| off | field | notes |
|---|---|---|
| 0 | CMD = 0x10 | |
| 1 | SRC | |
| 2–3 | LEN (BE) | |
| 4 | tx1ConnectStatus | 1 = online |
| 5 | tx2ConnectStatus | 1 = online |
| 6 | tx1BatteryValue | presumably %. For deviceType 4 the engine swaps TX1/TX2 |
| 7 | tx2BatteryValue | |
| 8–9 | (not parsed) | |
| 10 | noiseLevel | 0..3, 0 = off |
| 11 | volumeLevel | −1 if LEN < 8 |
| 12 | lockStatus | ≠ 0 means locked |
| 13 | vocalMode (channel mode) | −1 if LEN < 8 |
| 14 | shutTime (auto-off) | −1 if LEN < 8 |
| 15 | keyEntity1 | `HLKeyFuncEntity`: high nibble = btnFuncType (1..4 valid), low nibble = keyType (1..7 valid); only parsed if LEN > 9 |
| 16 | keyEntity2 | same encoding |
| 17 | lightStatus | ≠ 0 means LED on |
| 18 | bit0 = eqSwitch, bits1..7 = eqMode | |
| 19 | bit0 tx1Mute, bit1 tx2Mute, bit2 tx1Charging, bit3 tx2Charging, bit4 rxCharging | |
| 20 | rxBatteryValue | |

The A1 (10) and M3 (14) use `initA1HeartInfo:` instead.

### 4.4 Other reply payloads [V]

* **Config ACK**: `0x05, 0x06, 0x18, 0x19, 0x36, 0x37, 0x39, 0x3A, 0x3B, 0x3D, 0x3F, 0x40` → `messageForConfigResponse:command: @0x1000da000`. `success = (payload[0] == 0x01)`; a reply shorter than 5 bytes counts as success.
* **0x34**: on M2S (type 7), `payload[0] == 1` is an ACK for command 5. Otherwise it reports `lock = payload[0] ≠ 0`.
* **0x15 SN**: SN = UTF-8 string from offset 4, length LEN, with some characters replaced (`stringByReplacingOccurrencesOfString:`). The source TX comes from SRC.
* **0x03 / 0x41 version** (`HLDeviceEntity initDeviceEntityWith: @0x1001fcce4`, applied to the buffer starting at SRC):
  * Field layout: `[SRC][LEN BE16][version bytes]`.
  * **6118 (0x41)**: exactly 6 bytes, formatted `"%u.%u.%u.%u%u%u"` (CFStr @0x100cc8e88), e.g. `01 02 03 04 05 06` → `1.2.3.456` (`getNewVersionWithData: @0x1001fd054`).
  * Others (0x03): bytes joined with `.` (`getVersionWithData: @0x1001fd0f8`).
* **0x16 device info**: `payload[0]` is the RX variant. For deviceType 8, `payload[0] == 2` means **camera RX** → `isCameraDevice = YES` and the camera banner is shown, i.e. deviceType 9 (`-[HL6501Engine resolveDeviceHeaderImageWithPayload:] @0x1000bd910`, `handleDeviceInfoPayload: @0x1000bca60`). For M2 (3), `payload[0] == 2` is also the camera variant.
* **0x08 device ID**: `[SRC][LEN][devId…]`. The devId is fed back into `0x0D` / `0x09` for OTA.
* **0x0B upgrade result**: `payload[0]` = result code. **0x0E** packet response: `payload[0]`. **0x0D / 0x09** enter-upgrade ACK: `payload[0]`.
* `0x0A` and `0x0F` are recognised but ignored. Unknown commands are logged via NSLog.

---

## 5. Example frames

All checksums below were computed with the algorithm in sec. 2.1.

| Purpose | Request (app → RX) | Expected reply (after `BB DD`, [I]) |
|---|---|---|
| Heartbeat / status | `AA DD 10 40 00 00 27` | `10 8x LL LL tx1 tx2 b1 b2 ?? ?? nc vol lock mode off k1 k2 led eq flags rxbat [xor]` (sec. 4.3) |
| Device info (RX variant) | `AA DD 16 40 00 00 21` | `16 80 00 0n v0 …` (v0 == 2 → camera RX) |
| Version RX (A2) | `AA DD 41 40 00 00 76` | `41 80 00 06 a b c d e f` → "a.b.c.def" |
| Version TX1 / TX2 (A2) | `AA DD 41 41 00 00 77` / `AA DD 41 42 00 00 74` | same, SRC 0x81 / 0x82 |
| Version RX (M2) | `AA DD 03 40 00 00 34` | `03 80 LL LL v…` |
| SN RX / TX1 / TX2 | `AA DD 15 40 00 00 22` / `AA DD 15 41 00 00 23` / `AA DD 15 42 00 00 20` | `15 8x LL LL 'G''6''Z'…` (ASCII) |
| Battery and status | use the heartbeat (bytes 6, 7, 20 and the flags at 19) | |
| Get noise level | `AA DD 11 40 00 00 26` | `11 80 00 01 nn` |
| **Set noise level 2** | `AA DD 06 40 00 01 02 32` | `06 80 00 01 01` (ack) |
| Noise off (level 0) | `AA DD 06 40 00 01 00 30` | ack |
| Noise toggle (as the app sends it) | `AA DD 19 40 00 01 02 2D` | ack |
| A2 noise on + level 2 (0x3A) | `AA DD 3A 40 00 02 01 02 0C` | ack |
| A2 noise off (0x3A) | `AA DD 3A 40 00 02 00 00 0F` | ack |
| Get volume / gain level | `AA DD 04 40 00 00 33` | `04 80 00 01 vv` |
| **Set volume / gain level 2** | `AA DD 05 40 00 01 02 31` | ack |
| Channel mode = 1 | `AA DD 18 40 00 01 01 2F` | ack |
| Speaker status / on | `AA DD 13 40 00 00 24` / `AA DD 12 40 00 01 00 24` (inverted) | `13 80 00 01 00` (on) / `12 80 00 01 01` |
| LED on / off | `AA DD 39 40 00 01 00 0F` / `AA DD 39 40 00 01 01 0E` (inverted) | ack |
| Mic Recognition get / on | `AA DD 3C 40 00 00 0B` / `AA DD 3B 40 00 01 01 0C` | `3C 80 00 01 01` / ack |
| Smart battery get / on | `AA DD 3E 40 00 00 09` / `AA DD 3D 40 00 01 01 0A` | `3E 80 00 01 01` / ack |
| Auto-off index 0 | `AA DD 36 40 00 01 00 00` | ack |
| Volume lock on | `AA DD 34 40 00 01 01 03` | `34 80 00 01 01` |
| Device ID (OTA prerequisite) | `AA DD 08 40 00 00 3F` | `08 80 LL LL id…` |
| Restart RX (disruptive) | `AA DD 0C 40 00 00 3B` | none / disconnect |
| Delete pairing TX1 (**DESTRUCTIVE**) | `AA DD 3F 40 00 01 01 08` | ack |
| Factory reset (**DESTRUCTIVE**) | `AA DD 40 40 00 00 77` | ack |

"Settings read" on this family means the heartbeat plus the dedicated GETs (`0x04, 0x11, 0x13, 0x3C, 0x3E, 0x38`). There is no single "read all settings" command.

---

## 6. Firmware upgrade, pairing and reset (documented only; DESTRUCTIVE)

* **OTA metadata and download**: `HL6501UpgradeCoordinator`.
  * `-startDownloadDeviceOTA @0x1000b6900`, `downloadOtaWithUrl:fileName:group:errorFlag: @0x1000b8938`, `checkDeviceUpgradeInfo @0x1000b8cec`.
  * `HLDeviceUpgradeHelper` (`checkLatestVersionWithEntities…`).
  * Package codes are listed in `HLDeviceUpgradeHelper`: `6118TX`, `6118RX`, `6118CAMRX`, `6302TX`, `6302RX`, …
  * URL `https://appupgrade.blob.core.windows.net/6501json/6501upgrade.json` (for the 6501 family) plus the Hollyland cloud config API.
  * The bundle file `localupgrade` is a test JSON fixture listing **6201** packages (`6201TX/RX/EAR/CONTROL/RXSLAVE`, `versionName V9.9.9.9`, test-OSS URLs). It is unrelated to the A2.
* **Sequence [I]:**
  1. `0x08` get device ID for the target.
  2. `0x0D` (RX) or `0x09` (TX), with the devId payload, to enter upgrade (`onEnterUpgradeMode:isRX:result: @0x1000b7410`).
  3. Stream the image as **raw 64-byte packets** (`+[HL6501Messenger sendUpgradeDataWithIndex:name:] @0x10008a63c`) [V]:
     * Byte 0 = **0x55**.
     * Bytes 1..63 = `file[index*63 ..< index*63+63]`.
     * Zero-pad to 64 (`addZero:(0x40 - len)`).
     * Sent through `HLMessageUtils sendMsg:`, with no AA DD header and therefore no 20 ms sleep.
     * Total packets = ceil(fileLen / 63).
  4. The device answers `0x0E` per packet / window (`onUpgradePacketResponse: @0x1000b7c48`) and finally `0x0B` with a result (`onUpgradeResult:result: @0x1000b777c`).
  5. After the upgrade, the UI says the device restarts in about 2 minutes.
* Low-battery guard: `getTXBatteryLowStatus`; the UI string is "低电无法升级，请充电" (can't upgrade on low battery).
* **Pairing**: there is no "start pairing" command for the A2/M2 family. The UI tells the user to hold the RX button for 3 s or the Mic for 6 s ("长按RX按键3s配对", "长按Mic6s配对"). The app can only **delete a pairing** (`0x3F [type]`).
* **Factory reset** `0x40`, **restart RX** `0x0C`: see sec. 4.1.

---

## 7. App-side vs device-side features

**Device-side** (protocol commands exist for A2/M2):

* Output volume/level (0x05)
* NC level (0x06) and NC switch (0x19 / 0x3A)
* Channel mode mono/stereo (0x18)
* Auto power-off (0x36)
* Phone-speaker passthrough (0x12)
* Indicator LED (0x39)
* Volume / button lock (0x34)
* Mic Recognition (0x3B, A2)
* Smart battery life (0x3D, A2)
* Key function and colors (0x37 / 0x38)
* Unpair (0x3F), restart (0x0C), factory reset (0x40)
* Versions / SN / device info (0x03 / 0x41, 0x15, 0x16)
* Telemetry: battery, link and charging state (0x10)
* OTA (0x08 / 0x0D / 0x09 / 0x55 packets)

**App-side only:**

* Recording, multi-track recording and the file manager (`HLAudioRecorderManager`, `HLMultiTrackRecord*`, AVAudioSession over the USB audio interface).
* Voice preset JSONs (`pure_vocals_0.json` etc.): compressor, exciter, 10-band EQ, de-esser and LUFS. These run in the **app's own DSP** (`cmsis_api_ios.framework`: `cmsis_init`, `cmsis_process_frame`, `cmsis_set_eq_band`…; `FX6303DSPWrapper`) for the LARK M3 / 6303 "SmileSound" preview. They are not sent to the A2/M2.
* Cloud presets, login, community, analytics, the firmware-version check and the download.
* Tutorials and GIFs.
* EQ / reverb fields appear in the heartbeat (byte 18), but the A2/M2 UIs expose no EQ set command in this family.

---

## 8. Key symbol index

* EA: `EADSessionManager`
  * `@0x10012477c` setupControllerForAccessory
  * `@0x1001239cc` writeSimpleData
  * `@0x100124228` dealWithCurrentData
  * `@0x1001271e8` / `@0x10012728c` / `@0x1001272f0` header constants
* Frame builder: `NSData(HL6902Data)`
  * `@0x10027a484` headerWithCommand:payload:andType:
  * `@0x10027a6f8` getOrData: (XOR; block `@0x10027a7c4`)
* Messenger: `HL6501Messenger` `@0x10008a63c…0x10008b8b0`
* Codec: `HL6501DefaultPayloadCodec` `@0x10011b9fc`
* Transport: `HL6501Transport` `@0x1000b6444…0x1000b6620`
* Engine: `HL6501Engine` (dispatchAction `@0x1000bafb8`, heartbeat `@0x1000bc1d0`)
* Parser: `HL6501PacketParser` `@0x1000d9718` (jump table `0x100c16380`)
* Heartbeat: `HLHeartEntity initEntityWithData:` `@0x1001fa17c`
* Version: `HLDeviceEntity` `@0x1001fcce4` / `@0x1001fd054`
* Views: `HLLarkM2View` (`@0x1000ccf58…0x1000d2208`); Swift `HLLark6118View` (`@0x100662184…0x100666cf8`), `HL6118FunctionSetView` (`@0x1005aeee4`), `HL6118CameraRXView`
* Device list and type mapping: `HLDeviceUtils` `@0x1003210e0` / `@0x1003230b8` / `@0x100322e08`
