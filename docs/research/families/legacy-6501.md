# Legacy "6501" family: Lark C1, C1 (2nd gen), M1 (2nd gen), Lark Mini, Lark MAX

Research for the group "legacy-6501": every product besides 6118 (A2/A2S) and 6301/6302 (M2/M2S) that the
apps drive through the legacy `AA DD` protocol. This covers Android PIDs 1, 11, 12, 13 and 2, plus the iOS
"6501" engine (`HL6501Messenger` / `HL6501Engine`) and the EA model numbers that map into it.

Scope: documentation only. Nothing here was run against hardware, because none of these units is available.

Citation conventions follow `docs/PROTOCOL.md`:
- **A:** Android HollyAudio 3.1.0 jadx sources. Paths are relative to `jadx-out/sources/com/hollyland/`.
  The shared `jadx-out` had been cleaned up, so this research used a fresh jadx 1.5.6 decompile of the same
  `com.hollyland.larkc1.apk`, taken from `HollyAudio_3.1.0_APKPure.xapk`.
- **R:** Android resources (`res/values/strings.xml`, `res/layout/…`).
- **I:** iOS `larkSound` 3.1.0 arm64. The citation gives the selector and `@0x…` address (image base
  0x100000000). For `switch` tables it also gives the table address.
- **[?]** marks inference or unverified claims.

---

## 0. Key findings

1. **The command set and framing are the same as the Lark M2.** Android sends PIDs 1, 11, 12 and 13 to the
   same screen as the Lark M2, `larkc1/HLDeviceActivity`. That screen uses the same `usbmic/protocol/Pro_*`
   classes, the same `application/common/protocol/Protocol` codec (whose constants are literally named
   `HIP_6501_*`) and the same USB service path (`USBHIDService.isOldDevice`). iOS sends all of them through
   `HL6501Engine` with the same `AA DD` builder (`+[NSData(HL6902Data) headerWithCommand:payload:andType:]`
   @0x10027a484). Historically "6501", the Lark C1, is where this protocol started. 6301/6302/6118 extended it.
2. **There is no new codec, checksum, handshake or transport.** This is USB HID only: 64-byte interrupt packets
   with `AA DD cmd dst lenHi lenLo payload`. Nothing in this group uses BLE, feature reports or another framing.
3. **The products differ only in a few UI rules**, all of which come from code:
   - PID 1 (Lark C1) reads only link and battery from the heartbeat.
   - PID 1 maps its volume buttons to `[5,4,3,0,1,2]`.
   - PID 11 swaps the TX1/TX2 labels.
   - PIDs 11, 12 and 13 refuse noise-level changes while NC is off on the hardware.
   - There is no NC on/off switch, no volume lock, no channel mode, no auto-off, no LED and no custom buttons.
   - OTA waits 25 s between units on PID 1, and 5 s on the others.
4. **Naming pitfall:** Android `Product.PRODUCT_LARK_C1_PRO = 13` is **not** a C1 Pro. Its name string
   `product_lark_c1_pro` reads "**Lark Mini**", its product code is `6502JF`, and iOS ships firmware
   `6502JFTX/RX` for "Lark Mini" (deviceType 6). The real "lark c1 pro" EA model is **PID 11**
   (`6501PRO`, "Lark C1", Moma name "悦声S1(二代)").
5. **PID 2 / 6902 (Lark MAX) is excluded on Android.** `USBHIDService.isSupportedUsbDevice` returns false for
   PID 2, and nothing routes it to a screen. iOS still supports EA model "lark max" through the 6501 engine,
   with the same reduced feature set as the C1.
6. **macOS receive is unknown.** The report descriptors of these receivers have never been captured. If they
   look like the A2's, replies with ID `0xBB` will be dropped on macOS and the browser can only send blind
   writes, as with the A2. The upcoming **Lark M2 test is the best proxy**, because it is the same code
   generation on the same Android path.

---

## 1. Identity

### 1.1 Android (USB VID 0x3547 = 13639, `USBHIDService.VENDOR_ID`)

| PID | `Product` constant / code (A `application/common/protocol/Product`) | Name (A `DeviceCompat.getDeviceName` → R) | Screen (A `larkc1/utils/OpenPageHelper.obtainUsbPageIntent`, `larkc1/ui/connect/DeviceModelActivity.onEvent`) | Old-device USB path (A `usbmic/core/USBHIDService.isOldDevice`) |
|---|---|---|---|---|
| 1 | `PRODUCT_6501`, "6501" | `product_6501` = **Lark C1** | `HLDeviceActivity` | yes |
| 11 | `PRODUCT_6501_PRO`, "6501PRO" | `product_6501_pro` = **Lark C1** | `HLDeviceActivity` | yes |
| 12 | `PRODUCT_6502_PRO`, "6502PRO" | `product_6502_pro` = **Lark M1** | `HLDeviceActivity` | yes |
| 13 | `PRODUCT_LARK_C1_PRO`, "6502JF" | `product_lark_c1_pro` = **Lark Mini** | `HLDeviceActivity` | yes |
| 2 | `PRODUCT_6902`, "6902" | falls to the default branch → `product_6501` "Lark C1" (unused) | **none**. `obtainUsbPageIntent` returns null and `isUsbDevice(2)` is false. | yes, but filtered out earlier |

Further detail:
- **Detection.** The app recognises a product only by its USB PID: `HlDevice.INSTANCE.setProductId(device.getProductId())`
  in `DeviceModelActivity.onEvent`. Firmware version then splits PID 1 into "old" and "new/TYPEC" C1:
  `application/httpcommon/utils/Util.isNew6501(v)` = at least 4 dot parts and `parts[2] >= 4`.
- **USB filter.** `USBHIDService.isSupportedUsbDevice` and `onServiceCreate$lambda$1` behave as follows:
  - 6303 PIDs are always accepted.
  - **PID 2 is always rejected.**
  - Any other PID is accepted when the VID equals 0x3547 (0x4417 in the EAGLES build), or [?] when the USB
    manufacturer string contains "Hollyland" / "EAGLESHERO". jadx left an empty `if` body there.
- **Device icons and ads** (`DeviceCompat.getDeviceAd/getDeviceIcon/getDeviceModelIcon`):
  - PID 1: `device_ad`, `device_icon_6501`, `lc_model_6501_ic`.
  - PID 11: `device_ad_6501_pro`, with icon `device_icon_6701` (set explicitly in `getDeviceIcon`).
  - PID 12: `device_ad_6502_pro`, `device_icon_6502_pro`, `lc_model_6502_ic`.
  - PID 13: defaults (`device_ad` / `device_icon_6701`).
- **Variants.** The apps know **one receiver per PID**. There is no mobile/camera split (unlike 6301/6302),
  no charging-box PID and no earphone PID. Each kit is RX + TX1 + TX2. TX units are reached through the RX
  (`dst 0x41/0x42`).

### 1.2 iOS: every EA model number that lands in `HL6501Engine`

The EA model is mapped in `-[EADSessionManager setupControllerForAccessory:withProtocolString:]` @0x10012477c. It
compares `modelNumber.lowercaseString` in this order and stores `deviceType`; anything unmatched becomes −1 and
the app shows "当前APP无法支持该设备,请进行APP升级". Routing: `+[HLDeviceUtils connectEAPDeviceWithEntity:from:]`
@0x100322e08 sends every type except 11/13/14/15 to `HLDeviceController` with
`protocolType = (type == 10) ? 2 : 0`, and `protocolType 0` means `HL6501Engine` (`-[HLDeviceController viewDidLoad]` @0x1002c3ed0).

| EA modelNumber | deviceType | Set at | Display name (I `+[HLDeviceUtils getDeviceNameWithType:]` @0x1003210e0, table @0x100c17260) | Moma (CN) name | Firmware package (I `+[HLDeviceUpgradeHelper getDevicePkgCodeWithType:]` @0x100096ecc, table @0x100c16268) |
|---|---|---|---|---|---|
| `lark max` | 1 | @0x10012489c | "Lark MAX" (@0x100321154) | same | **none** (default branch → empty array) |
| `lark m2` | 3 | @0x1001248ec | "Lark M2" | "Lark MIX" | 6301TX/6301RX (in scope elsewhere) |
| `lark c1` | 0 | @0x100124954 | "Lark C1" (case 0 @0x100321170) | "悦声S1" (en.lproj maps it to "LARK C1") | none from the cloud API. iOS uses the legacy JSON `https://appupgrade.blob.core.windows.net/6501json/6501upgrade.json` (`getDeviceLastestVersionWithType:block:` @0x10009505c, type 0 only). |
| (derived from `lark c1`) | **2** | `-[HL6501Engine updateDeviceTypeIfNeededByVersion:]` @0x1000bd6ac: type 0 and the second-to-last version component equals `"4"` → `setDeviceType:2` @0x1000bd760 | "Lark C1" (case 2 = case 0) | "悦声S1" | `6501TX_TYPEC` / `6501RX_TYPEC` |
| `lark m1 pro` | 5 | @0x1001249a4 | "Lark M1" (case 5 @0x100321324) | "Lark M1(二代)" | `6502PROTX` / `6502PRORX` |
| (derived from `lark m1 pro`) | **6** | `-[HL6501Engine resolveDeviceHeaderImageWithPayload:]` @0x1000bd910: type 5 and the `0x16` reply byte at iOS offset 4 (= body[0]) == 3 → type 6 (`cinc` @0x1000bda2c, `setDeviceType:` @0x1000bda48). Only type 5 reads that byte (`cmp x23, 5; b.eq` @0x1000bd994); types 0/1/2/4 fall through @0x1000bda88, so `commands.ts parseDeviceInfo` sets `mini` only for PIDs 12/13 when given the PID | "Lark Mini" (case 6 @0x100321380) | same | `6502JFTX` / `6502JFRX` |
| `lark c1 pro` | 4 | @0x1001249f4 | "Lark C1" (case 4 @0x100321270) | "悦声S1(二代)" | `6501PROTX` / `6501PRORX` |
| `lark m2s` | 7 | @0x100124a44 | "LARK M2S" | "LARK M2" | 6302 (in scope elsewhere) |
| `lark a2`, `lark a2s` | 8 (9 = camera via `0x16`) | @0x100124c20 / @0x100124c84 | "LARK A2" | "LARK A2/A2S" | 6118 (in scope elsewhere) |

So the full membership of the iOS 6501 engine is: C1 (0), MAX (1), C1 TYPEC (2), M2 (3), C1 2nd gen (4), M1 2nd gen
(5), Mini (6), M2S (7) and A2/A2S (8/9). Types 10 (A1) and 14 (M3) use `HLDeviceController` with a different engine.
`+[HLDeviceUtils getFeedbackDeviceModels]` and the other lists are UI-only.

### 1.3 Cross-reference (Android PID ↔ iOS type ↔ firmware)

Android firmware codes come from `application/httpcommon/entities/HlDevice.getDeviceCode`: product name + `RX`/`TX`,
plus `_TYPEC` when PID 1 runs firmware that passes `isNew6501`, and `RX_RU`/`TX_RU` in the EAGLES build.
Both apps produce the same codes.

| Product (internal) | Android PID | iOS type(s) | International name | Moma name | Firmware codes |
|---|---|---|---|---|---|
| 6501 | 1 | 0 (old firmware), 2 (TYPEC firmware) | Lark C1 | 悦声S1 | `6501RX`/`6501TX` (old server, A `FirmwareUpgrade.checkServerInfo` / I legacy JSON); `6501RX_TYPEC`/`6501TX_TYPEC` |
| 6501PRO | 11 | 4 | Lark C1 | 悦声S1(二代) | `6501PRORX`/`6501PROTX` |
| 6502PRO | 12 | 5 | Lark M1 | Lark M1(二代) | `6502PRORX`/`6502PROTX` |
| 6502JF | 13 | 6 | Lark Mini | Lark Mini | `6502JFRX`/`6502JFTX` |
| 6902 | 2 (rejected) | 1 | Lark MAX | Lark MAX | none in 3.1.0. A `FirmwareUpgrade.getUpdateVersion` still accepts deviceId `"6902"` from the old JSON. |

[?] On iOS, type 0 vs type 2 most likely separates the Lightning C1 from the USB-C C1: the cloud package is called
`_TYPEC`, and the Android C1 (USB-C) is PID 1 on either firmware line. A browser can only reach the USB-C RX.
Lightning receivers are iAP2-only.

### 1.4 EAGLES OEM

The `eagles` app flavour (A `Util.isEagles()`, `FLAVOR_EAGLES = "eagles"`) switches the VID to **0x4417** and the
manufacturer to "EAGLESHERO" (`USBHIDService.VENDOR_ID_EAGLES = 17431`). It appends `_RU` to firmware codes
(`HlDevice.getDeviceCode`). The only EAGLES PIDs that exist are `PRODUCT_EAGLES_6301_MOBILE/CAMERA = 32/33`, a
Lark M2 build that `models.ts` already covers. **No EAGLES 6501/6502 PID is defined.** [?] An EAGLES-branded
C1-family unit would still be routed purely by PID (1/11/12/13 → `HLDeviceActivity`).

---

## 2. Transport

| Item | Value | Source |
|---|---|---|
| Physical | USB HID. Android picks the first class-3 interface with interrupt endpoints and does `bulkTransfer` on them (BULK transfer type; the CONTROL path is only for PID 1031). | A `usb/core/HlUsbManagerImpl.findSuitableInterface`; `usbmic/core/USBHIDService.onEventMainThread(USBDataSendEvent)` (`pid != 1031 ? BULK : CONTROL`) |
| Packet size | 64 bytes out (`Protocol.getData` allocates `new byte[64]`). The OTA data packet is 64 bytes starting with `0x55` (`USBHIDService.isLegacyRawOtaPacket`). | A `application/common/protocol/Protocol.getData` |
| Write timeout | 250 ms, 0 retries (`CommandExecutionConfig(250, 1000, 0)`) | A `USBHIDService.onEventMainThread(USBDataSendEvent)` |
| Receive | every IN packet → `USBDataReceiveEvent` → `ProtocolFactory.createProtocol(data[2])` → `Protocol.parse`, one packet = one frame | A `USBHIDService.onCmdDataReceive` (old-device branch), `usbmic/events/USBDataReceiveEvent.updateUSBData` |
| Report IDs | **unknown**. No descriptor has been captured. On the A2 the firmware puts `AA`/`BB` at byte 0 with no report-ID layer, and declares only 0x06/0x07/0x41/0x55 (PROTOCOL.md §2.2). | – |
| BLE | none. No BLE code path exists for PIDs 1/2/11/12/13, and iOS BLE types are 11/12/15/16/17 only. | A `OpenPageHelper.isBleDevice` (101/1032/1033); I `connectEAPDeviceWithEntity:from:` |
| iOS | External Accessory `com.hollyland.protocol` (iAP2). Same frames plus an XOR byte, ≤ 64 B writes, 20 ms gap. | PROTOCOL.md §2.7 |

### Browser path

| Platform | Expected result | Why |
|---|---|---|
| Chrome / Edge on **Linux, ChromeOS** (WebHID over hidraw) | **full** [?] | hidraw does not filter report IDs. Same reasoning as the A2 (PROTOCOL.md §2.4). |
| Chrome / Edge on **macOS** | **unknown**. Writes should work. Replies arrive only if the descriptor declares the reply ID, uses no report IDs, or the firmware replies on a declared ID. | IOHIDFamily drops undeclared report IDs (A2, PROTOCOL.md §11.2) |
| Chrome / Edge on **Windows** | unknown, expected ❌ if the descriptor is like the A2's | hidclass routes by declared report ID |
| **Android Chrome** | ❌ | No WebHID. WebUSB cannot claim the HID interface. These are phone receivers, so the main use case (phone) is out of reach. |
| Web Bluetooth | n/a | no BLE |
| Lightning RX variants (iOS types 0/1/4/5 when Lightning) | ❌ | iAP2 only |

`WebHidTransport` already supports `framing: 'raw' | 'no-report-id'`, so either descriptor style can be handled
once it is known. **Action:** capture the descriptor and IN behaviour of the Lark M2 in the planned test. If the
M2 replies reach macOS, the C1 family very probably does too, because it is the same generation, uses the same
`HIP_6501` code base and the same Android path.

---

## 3. Framing

This is identical to the legacy framing in `codec.ts` (PROTOCOL.md §3). It is restated here byte by byte from the
code these products actually use.

**Request** (A `application/common/protocol/Protocol.getData`; I `headerWithCommand:payload:andType:` @0x10027a484):

| Offset | Value |
|---|---|
| 0–1 | `AA DD` |
| 2 | command (`getCmd()`) |
| 3 | `0x40` RX / `0x41` TX1 / `0x42` TX2. Android: `switch(deviceType)` (any other type leaves `0x00`). iOS formats the binary string `"0100000%zd"` with the type and parses it as a byte; type 2 is overridden with `"01000010"` (CFStrings @0x100cbfd28 `%zd`, @0x100ccbf68 `0100000%@`, @0x100ccbf88 `01000010`). Both give `0x40 \| target`. |
| 4–5 | payload length, big-endian (`NumberUtil.intToByte2(payload.length)`) |
| 6… | payload (`saveReserved(...)`) |
| rest | `00` to 64 bytes (Android). iOS appends XOR(bytes 0…5+n) after the payload instead and writes only the used bytes. |

**Reply** (A `Protocol.parse`): byte 2 = cmd; byte 3 `0x80/0x81/0x82` → RX/TX1/TX2 (any other value leaves the default RX);
`len = b4*16 + b5` (app bug, harmless below 16; the library uses BE16); `payload = data[6 .. 6+len)`.
The `BB DD` magic is **not checked** by `Protocol.parse`, and the frame is rejected only when `len > data.length − 6`.
iOS `judgeCurrentDevTypeWithData:` @0x10027a898 additionally maps `00`→5 (BOX in the shared `HLDeviceType`
order), `01`→RX, `02`→TX1, `03`→TX2, `04`→TX3, `05`→TX4. None of these receivers has a box or a TX3/TX4, so that
table matters only for other families.

**Checksum / sequence / fragmentation:** none, as for the A2/M2. The OTA data packet `55 | 63 bytes` is the
only non-`AA DD` packet (A `FileUtils.getDataWithIndex`, `FirmwareUpgrade.getPkgCount` = ⌈size/63⌉).

**Example frames.** These come from the builders. The left column is the Android form, zero padded to 64 bytes
(not shown). The right column is the byte the iOS form appends.

| Purpose | Android bytes (A source) | iOS XOR |
|---|---|---|
| Heartbeat to RX | `AA DD 10 40 00 00` (`Pro_get_heart`, cmd `Ascii.DLE`) | `27` |
| Version of TX2 | `AA DD 03 42 00 00` (`Pro_get_version`, `setDeviceType(TX2)`) | `36` |
| NC level "Strong" | `AA DD 06 40 00 01 02` (`HLDeviceActivity.onClick` `strong_level` → `Pro_set_noise.saveReserved({2})`) | `32` |
| Lark C1 volume, button "1" (wire value 5) | `AA DD 05 40 00 01 05` (`HLDeviceActivity.onClickBtnGroup`, tag 5 from `DeviceCompat.getVoiceLevels(1)`) | `36` |
| Phone speaker off | `AA DD 12 40 00 01 01` (`HLDeviceActivity.onCreate` listener: `!z ? 1 : 0`) | `25` |
| OTA device id of TX1 | `AA DD 08 41 00 01 01` (`Pro_get_devid.sendData`: TX1→1, TX2→2, RX→0) | `3E` |
| Variant query (iOS only) | `AA DD 16 40 00 00` | `21` |

These replies are illustrative. The layouts are from the parsers; the values are invented.
- `BB DD 03 80 00 04 01 00 04 05` → RX version `"1.0.4.5"` (`Pro_get_version`). `parts[2] = 4` → `isNew6501`
  on PID 1, which gives TYPEC firmware and iOS type 2.
- `BB DD 10 80 00 06 01 00 5A 00 00 00` → TX1 online at 90 %, TX2 offline. This is the minimum length
  `Pro_get_heart` accepts (`data.length >= 6`).
- `BB DD 06 80 00 02 01 02` → NC level set OK (`Pro_set_noise`: status=1, level=2). A 1-byte reply counts as a **failure**.
- `BB DD 16 80 00 01 03` → iOS turns "lark m1 pro" into "Lark Mini".

---

## 4. Session

There is no handshake or authentication. Android (`HLDeviceActivity`) does the following:

1. `onStoragePermissionGranted` → `getDeviceVersion()` (PID 1 directly; other PIDs through `requestDeviceVersion`,
   which also ends in `getDeviceVersion`). The cloud version check is skipped for PID 1 in `onCreate`; PID 1 queries
   the old OTA JSON unless the RX firmware passes `isNew6501`.
2. `getDeviceVersion` sends these back to back to the RX: `0x03` version, `0x11` noise, `0x04` volume, `0x13` speaker,
   `0x15` SN, `0x35` volume-lock GET (sent on every PID even though the lock UI is hidden for this group). After
   1 s it starts the heartbeat (`mHandler.postDelayed(mRunnable, 1000)`).
3. Heartbeat: `0x10` to the RX **every 3 s** (`AnonymousClass8.run`: `postDelayed(mRunnable, 3000)`). iOS also
   polls every 3 s (`-[HLDeviceController sendHeartInfo]`).
4. Heartbeat reply (`onEvent` cmd 16; `Pro_get_heart.receiveData`):
   - The fields are those of PROTOCOL.md §6.2, each present only if the payload is long enough. The minimum is 6 bytes.
   - TX online / battery always drives the UI.
   - **PID 1:** noise, channel mode and auto-off are **not** applied (`if (productId != 1)`), and volume is not
     applied (`if (productId >= 8)`). iOS skips **every** setting for types < 3, i.e. C1, MAX and C1 TYPEC
     (`handleHeartbeatEntity:` block, `cmp x22,3; b.lt` @0x1000bc474). For PID 1 the heartbeat therefore carries
     link and battery only, as far as either app is concerned.
   - **PIDs 11/12/13** (≥ 8): noise level (body[6]) and volume (body[7]) are applied. Mode, auto-off and lock are
     parsed but their views are hidden. iOS types 4/5/6 (≥ 3) apply noise, volume and lock, but the NC level and
     switch only when `-[HL6501Engine isHeartbeatNoiseLevelValid:]` holds (@0x1000bafac: `cmp x2, 4; cset lo`, i.e.
     body[6] < 4; called @0x1000bc4ac, `setNoiseLevel:` / `setNoiseSwitch:` skipped by `cbz w22` @0x1000bc4c4).
     Mic Console follows iOS: an out-of-range byte is ignored instead of reading as "NC on" (device.ts, added
     2026-11-05 in the Phase 0/1 review). The same iOS check covers the M2 (type 3) and M2S (type 7); the library
     leaves those families unchanged until the M2 hardware test.
   - **PID 11 / type 4:** TX1 and TX2 battery/online are swapped for display (§7.2).
5. TX comes online (heartbeat edge) → `0x03` and `0x15` to that TX. For TX2 this is delayed 1 s by a `Timer`.
   TX goes offline → the toast "Mic1/Mic2 Disconnected" and the cached version, SN and MAC for it are cleared
   (`HlDevice.setVersion(2|4, "")`).
6. A version of `"0.0.0.0"` → `0x03` is re-sent to that unit, every time such a reply arrives (`onEvent` cmd 3).
7. USB re-attach (`DeviceAttachedEvent`) → `getDeviceVersion()` again. Detach → the screen closes.

**Notifications:** none. Only OTA acks (`0x0E`, `0x0B`) are device-initiated. `HIP_6501_DEVWARNING = 0x0A` is
declared but never handled.

**iOS start-up** (all 6501-engine types): `+[HL6501Messenger getDeviceInitialInfo]` @0x10008aa48 sends `0x11`,
`0x16`, `0x04`, `0x03`, `0x13` and `0x15` ×3 (PROTOCOL.md §5.1). The 6118 extras are skipped
(`isConnect6118Device` @0x10008abe8).

---

## 5. Command catalogue (this group)

Every command is addressed to the RX unless noted. "Sent by" lists who actually sends it for these PIDs.

| Cmd | Name (A `Protocol.HIP_*`) | Payload | Reply (A `Pro_*.receiveData`) | Sent by (this group) | UI feature | Safety |
|---|---|---|---|---|---|---|
| 0x10 | HIP_6501_HEARTINFO | – | §4 step 4 | A every 3 s; I every 3 s | battery / link (+ NC level, volume on 11/12/13) | R |
| 0x03 | HIP_6501_GET_DEVVERSION | – (dst 40/41/42) | decimals joined with `.`. Android shows "unknown" if the string compares lexicographically above `"4.4.4.4."` (`larkc1/HLDeviceEntity` ctor) | A, I | version info, firmware check, `isNew6501` | R |
| 0x15 | HIP_6501_GET_DEVICE_SN | – (dst 40/41/42) | UTF-8 string (`Pro_get_sn`). Android substitutes `"HL728628"+5 random digits` for a missing SN on PID 1/2 (`Util.fixSN`). | A, I | SN info | R |
| 0x11 | HIP_6501_GET_NOISE_LEVEL | – | signed b0: 0 off / 1 low / 2 strong (`Pro_get_noise`) | A (start-up), I | NC level buttons | R |
| 0x06 | HIP_6501_SET_NOISE_LEVEL | `[1]` Weak / `[2]` Strong | `[status, level]`; < 2 bytes = failure (`Pro_set_noise`) | A, I | "NC Level" Weak/Strong | W |
| 0x04 | HIP_6501_GET_VOLICE_LEVEL | – | b0 = wire value (`Pro_get_voice`) | A (start-up), I | volume buttons | R |
| 0x05 | HIP_6501_SET_VOLICE_LEVEL | `[v]`. **PID 1: buttons 1..6 → v = 5,4,3,0,1,2.** PIDs 11/12/13: v = 0..5. iOS: v = 0..2 for every type. | b0 == 1 (`Pro_set_voice`) | A, I | "Volume" | W |
| 0x13 | HIP_6501_GET_SPEAKER_STATUS | – | b0 == 0 → on (`Pro_get_speaker`) | A, I | "Phone Speaker" | R |
| 0x12 | HIP_6501_SET_SPEAKER_STATUS | `[0]` on / `[1]` off | b0 == 1; on success the app counts down 3 s and sends `0x0C` | A, I | "Phone Speaker" | W (needs restart) |
| 0x0C | HIP_6501_RESTARTRXDEVICE | – | none expected (RX reboots) | A after `0x12` (`mVoiceRunable`) | – | **D** |
| 0x35 | HIP_6301_GET_VOICE_LOCK | – | b0 == 1 | A start-up only (result goes to a hidden view) | none for this group | R |
| 0x16 | (iOS only) | – | body[0]: `3` on a "lark m1 pro" → Lark Mini (type 6); `2` = camera on other families | I | product banner / name | R |
| 0x08 | HIP_6501_GET_DEVINFOID | `[0\|1\|2]` = RX/TX1/TX2 | b0 = devId (`Pro_get_devid`) | A, I (OTA) | firmware upgrade | O-prep |
| 0x09 | HIP_6501_SET_TXENTERUPGRADE | `[devId]` (dst 41/42) | b0 == 1 → start sending | A, I | firmware upgrade | **O** |
| 0x0D | HIP_6501_SET_RXENTERUPGRADE | – | b0 == 1 | A, I | firmware upgrade | **O** |
| 0x55 | HIP_6501_SET_DEVUPGRADE | raw packet `55` + 63 firmware bytes | → `0x0E` | A, I | firmware upgrade | **O** |
| 0x0E | HIP_6501_UPGRADEDEVICE_RES | (notify) | `[ok, needCount BE16]`. On failure Android jumps to `needCount` **except on PID 1**, where it resends the same index (`onEvent` cmd 14: `else if (getProductId() != 1)`). | – | – | notify |
| 0x0B | HIP_6501_DEVUPGRADERESULT | (notify) | b0 == 1 ok. Next unit after **25 s on PID 1** / 5 s otherwise (A `onEvent` cmd 11 `(pid != 1 ? 5 : 25) * 1000`; I `onUpgradeResult:result:` @0x1000b79ac: type > 2 → 5 s, else 25 s). After the last unit, PID 1 resumes the heartbeat after 10 s; the others wait for re-enumeration. | – | – | notify |

**Registered but never sent for this group.** The views are hidden or the receivers lack the feature:
- `0x19` NC toggle: `mNoiseSwitch` is visible only for `isNew6301CameraOrMobile` / 1029 / 1030
  (`setNoiseLevelStrong`); iOS sets `noiseSwitchSupported` only for types 3/7 (`applyRXVersionCapabilities:` @0x1000bd78c).
- `0x34` volume lock: `setVoiceLockVisibility` needs `isNew6301Camera` / 1030; iOS `showVoiceLock = isCameraDevice`,
  and that flag is set only for types 3/7/8/9 (`handleDeviceInfoPayload:` @0x1000bca60).
- `0x18` channel mode and `0x36` auto-off: the layouts are visible only for 1029/1030 (`onCreate`), and iOS shows them
  only for type 7 (`HLLarkM2View initWithFrame:` @0x1000ca714).
- `0x37`/`0x38`/`0x39`: these are M2S-only (`HLDevice6302Activity`).

There is no factory reset, pairing removal, TX mute, gain, low-cut, EQ or recording command for this group.

**Destructive or risky commands:** `0x0C` (RX reboot), and the OTA set `0x08/0x09/0x0D/0x55/0x0E/0x0B`, which can brick
a unit. Firmware images come from Hollyland's cloud. **Keep them documented only**, per the project's scope decision.

---

## 6. UI feature inventory (Android `HLDeviceActivity` + `res/layout/activity_hldevice.xml`; iOS `HLLarkM2View`)

| Feature (R label) | PID 1 Lark C1 | PID 11 Lark C1 (2nd gen) | PID 12 Lark M1 | PID 13 Lark Mini | Lark MAX (iOS type 1) | Gate / source |
|---|---|---|---|---|---|---|
| Title / ad image | "Lark C1" / `device_ad` | "Lark C1" / `device_ad_6501_pro` | "Lark M1" / `device_ad_6502_pro` | "Lark Mini" / `device_ad` | "Lark MAX" | `DeviceCompat` |
| Mic1/Mic2 battery and link ("Mic1", "Mic2") | ✅ | ✅ **swapped**: Mic1 = wire TX2 | ✅ | ✅ | ✅ | heartbeat body[0..3]; PID 11 swap §7.2 |
| Audio level meter | app-side | app-side | app-side | app-side | app-side | `AudioRecordUtils` → `uv_progress` (not from the device) |
| NC on/off switch | – | – | – | – | – | `setNoiseLevelStrong` |
| "NC Level" Weak (1) / Strong (2) | ✅ always visible. Android: "Strong" is allowed while NC is off but "Weak" is not (asymmetric `noise_is_closed_notice` check). iOS: no NC-off check for type < 3. | ✅. Refused while NC is off: "The noise reduction is not enabled on the current device, please enable the noise reduction" (A); iOS type ≥ 3 → "…currently disabled on the device…" (`noiseView` block @0x1000cf438) | ✅ same as 11 | ✅ same as 11 | ✅ like C1 | both apps also need ≥ 1 TX online (`mic_offline_tip`, "Mic not connected, current function not available") |
| NC level state | from `0x11` at start-up only (heartbeat ignored) | heartbeat body[6] + `0x11` | same | same | iOS: `0x11` only | §4 |
| "Volume" six buttons labelled 1–6 | wire `[5,4,3,0,1,2]` (layout default tags; `getVoiceLevels(1)`). Allowed **without** a mic online (`isAllowSetVoice` returns true for PID 1). | wire 0..5, needs a mic | same | same | iOS: 3 buttons, wire 0..2 | `updateVoiceGroup`, `onClickBtnGroup`; iOS `voiceView` @0x1000cf8c4 |
| Volume state | `0x04` only | heartbeat body[7] + `0x04` | same | same | `0x04` | `onEvent` cmd 16 `productId >= 8` |
| Volume lock | – | – | – | – | – | §5 |
| "Phone Speaker" (speaker passthrough, needs restart) | ✅ | ✅ | ✅ | ✅ | ✅ | `voice_outgoing_switch`; restart toast "Settings successful. The device will restart in %d seconds." |
| Channel mode, TX auto-off, LED, custom buttons | – | – | – | – | – | layouts hidden for these PIDs |
| Firmware info / upgrade (`device_upgrade` button) | ✅ old server or TYPEC cloud; upgrade blocked if any mic is at 1–6 % ("Unable to upgrade due to low battery, please charge.") | ✅ | ✅ | ✅ | iOS: no package | `HLDeviceActivity.onClick` (`device_upgrade`), `HLUpgradeView.initView` |
| Version / SN info text | "Mic1 SN: … Mic2 SN: … RX SN: …" | **swapped** order | normal | normal | – | `Util.getSnInfo/getVersionInfo/getUpgradeInfo` |

There are no firmware-version gates in this group, apart from PID 1's TYPEC firmware line, which only changes the
firmware source and the iOS banner and name. Android's `SPEC_VERSION = "2.0.0.31"` gates only PIDs 7/8/32/33.

---

## 7. Per-product notes

### 7.1 6501: Lark C1 (PID 1, iOS 0/2)
This is the minimal profile.
- The heartbeat is used only for TX link and battery. iOS and Android agree on this; [?] the firmware may send only
  the 6-byte form.
- NC level is two buttons with no switch. The state comes from `0x11`.
- Volume uses a non-monotonic wire map: buttons 1..6 → `5,4,3,0,1,2`. [?] Probably 0 = 0 dB, 1/2 = +1/+2 and 3/4/5
  = −1/−2/−3. iOS sends only 0..2 here, which matches the top three Android buttons ("4", "5", "6").
- Speaker passthrough and restart work as on the M2.
- Old-firmware OTA uses a legacy JSON server. OTA leaves 25 s between units, and a failed ack resends the same
  index (no `needCount`).

### 7.2 6501PRO: Lark C1 2nd gen (PID 11, iOS 4)
This is the same as 6502PRO except that the **TX labels are swapped**: the physical "Mic1" is the unit addressed as
**TX2 (0x42)**.
- Android swaps:
  - heartbeat battery and online for display (`onEvent` cmd 16 `if (productId == 11)`);
  - connect/disconnect toasts (`onEvent` cmd 3, cmd 16, `AnonymousClass10`);
  - SN/version text (`Util.getSnInfo` etc.).
- iOS: `-[HLDeviceController deviceTypeForTx1Status]` @0x1002c71f4 returns 2 for type 4, and the heartbeat block
  swaps `tx1Battery`/`tx2Battery` for type 4 (@0x1000bc344).
- Wire addressing is never swapped. Implement this as a display mapping, not in the codec.

### 7.3 6502PRO: Lark M1 2nd gen (PID 12, iOS 5)
- Heartbeat noise and volume are applied.
- NC levels Weak/Strong are refused while NC is off on the hardware.
- Volume runs 0..5 on Android and 0..2 on iOS. [?] This disagreement exists on the M2 too (PROTOCOL.md §12 #33).
- Phone speaker and OTA (5 s gap) are present.

### 7.4 6502JF: Lark Mini (PID 13, iOS 6)
- Identical to 6502PRO.
- iOS has no EA model of its own: it is a "lark m1 pro" whose `0x16` reply body[0] is 3.
- Android identifies it by PID.

### 7.5 6902: Lark MAX (PID 2, iOS 1)
- **Android 3.1.0 refuses it**: PID 2 returns false in `USBHIDService.isSupportedUsbDevice`, and there is no page route.
- Leftovers remain:
  - `isOldDevice` includes 2;
  - `HLUpgradeView.initView` has a PID 2 branch;
  - `FirmwareUpgrade` accepts deviceId "6902";
  - `Util.fixSN` fakes SNs for PID 1/2.
- iOS drives it through `HL6501Engine` as type 1, with the C1 rules (type < 3: heartbeat link/battery only, no NC-off
  check, 25 s OTA gap) and **no firmware package**.
- `HL6902HeartEntity` (`initWithData:` @0x100270d10: length ≥ 7, b0 `connectType`, b1/b2 TX1/TX2 battery) and
  `HL6902VersionEntity` / `-[HLUpgradeView initWith6902WithVersionEntity:]` are **dead code**: there are no classrefs
  to `HL6902HeartEntity` (0x100e99c48).
- The `NSData(HL6902Data)` category name suggests the shared `AA DD` builder was first written for this product.
- [?] VID 0x3547 is assumed. Whether its USB-C port even exposes the control HID interface is unknown, and Android's
  explicit exclusion hints that it does not work or is not wanted. **Low confidence.** List it as recognised but
  unsupported, or behind an "experimental" flag.

---

## 8. Reuse assessment

| Layer | Reuse as-is | Needs change |
|---|---|---|
| `codec.ts` | ✅ all: `encodeRequest`, `decodeFrame`, `FrameAssembler('packet')`, XOR option, OTA packet helpers | – |
| `transport.ts` / `webhid.ts` | ✅ transport, framing modes, `getGrantedDevices` (VID filter already covers 0x3547/0x4417) | `defaultFilters()` adds `{vendorId, productId}` only for PIDs with a non-null `family`, so the new PIDs appear once registered |
| `commands.ts` | ✅ `Requests.heartbeat/versionLegacy/serial/noiseLevelGet/noiseLevelSet(…, '6301')/volumeGet/volumeSet/speakerGet/speakerSet/restartRx/deviceInfo/deviceId/voiceLockGet`; parsers `parseHeartbeatM2`, `parseVersionLegacy`, `parseSerial` (non-6118 path), `parseNoiseLevelGetM2`, `parseNoiseSetM2`, `parseSpeakerGet`, `parseSetAck`, `parseDeviceInfo` | `COMMANDS[*].families`: add the new family, or reuse `'6301'`. A volume value map for PID 1 (UI step ↔ wire `5,4,3,0,1,2`). |
| `models.ts` | `ProductInfo` / `Capabilities` structure. PIDs 1, 11, 12, 13 already have registry rows with `family: null`. | Give them a family and a capability set. New capability fields: `heartbeatSettings: boolean` (false on PID 1: apply link/battery only), `txLabelSwap: boolean` (PID 11), `volumeWireValues?: number[]` (PID 1), `noiseLevelNeedsNcOn: boolean` (11/12/13). `heartbeatIntervalMs: 3000` is already set. Fix the PID 13 row: name "Lark Mini" is right, code `6502JF`; add `eaModel: 'lark m1 pro'` with a note. Optionally add PID 2 "Lark MAX" (`6902`, unsupported). |
| `device.ts` | Start-up and identity flow, heartbeat polling, TX online/offline refetch, set-ack handling, speaker + restart flow, the `productId < 8` heartbeat-volume rule (already coded for `'6301'` at the heartbeat merge), the volume-lock and noise-toggle feature gating | Skip heartbeat settings when `!caps.heartbeatSettings`. Map TX1/TX2 for display when `txLabelSwap`. Use `volumeWireValues` in `setVolume`/`state.settings.volume`. Add a `noise-off` precondition for noise-level writes on 11/12/13, and none on PID 1, following iOS; Android's Weak-only check looks accidental. Use the Android rule for the PID 1 volume `mic-disconnected` exemption, or the stricter iOS one (iOS checks mics for every type). |
| `mock.ts` | ✅ the M2 mock behaviour | add 6501 / 6501PRO / 6502PRO / 6502JF profiles (short 6-byte heartbeat for PID 1, 14-byte for the others, `0x16` = 3 for the Mini) |

**Family modelling options:**
- (a) Map PIDs 1/11/12/13 to the existing `'6301'` family plus new capability sets. This means the fewest code
  paths, and `device.ts` already special-cases `'6301'` the way these PIDs need.
- (b) Add `Family = '6501'`, treated like `'6301'` wherever the code tests `family !== '6118'`. This is cleaner for
  logs and docs. About 6 call sites need `'6501'` added: the `COMMANDS` families, `parseVoiceLockSetReply`, the
  `device.ts` heartbeat merge, `fetchExtraSettings` and `describePayload`.

Recommended: **(b)**. The protocol really is "6501", and the M2 rules (`SPEC_VERSION 2.0.0.31` gates, camera
lock) should not leak into C1 behaviour by accident.

**Effort:** about 0.5–1 day, covering registry rows, 4 capability flags, the volume map, the display swap,
preconditions, mock profiles and unit tests that mirror the Android rules above. No new wire code is needed.

**Confidence:**
- Framing, command IDs and payloads: **high**. It is the same Java classes and the same iOS codec the M2 uses, and
  the A2 live captures already confirm the codec.
- Per-product feature set and UI rules: **high/medium**. They come from code in both apps, and the apps agree except
  for volume step counts.
- Value semantics: **medium/low**. This covers the PID 1 volume map meaning, the real heartbeat length, and what
  each receiver answers for unused commands such as `0x35`.
- macOS replies: **unknown**. It depends on the descriptor; M2 test first.
- Lark MAX: **low**.

---

## 9. Open questions / verify when a unit is available

1. The HID report descriptor and IN report IDs of each receiver. This decides whether WebHID on macOS/Windows can
   read. Use `npx tsx scripts/probe.ts list` and record `collections[].inputReports[].reportId`. The Lark M2 test
   answers the closest analogue.
2. The PID 1 heartbeat length (6 bytes?) and whether body[6]/[7] carry real values that both apps simply ignore.
3. The PID 1 volume encoding (`5,4,3,0,1,2` ↔ −3…+2 dB?) and the iOS 0..2 range.
4. Whether `0x35` (sent by Android to every PID) gets an answer, or an error, on receivers without a lock.
5. Whether PID 2 (Lark MAX) enumerates with the control interface at all, and why Android excludes it.
6. The `0x16` body on C1 / C1 2nd gen / M1 / Mini. Only "3 = Mini" is known.

---

## 10. Summary

| Product | Transport | Framing | Browser path | macOS full? | Reuse | Confidence |
|---|---|---|---|---|---|---|
| Lark C1, `6501`, PID 1 (iOS `lark c1` → 0/2) | USB HID, 64 B interrupt (iOS: iAP2) | legacy `AA DD`/`BB DD`, no checksum, 3 s heartbeat | WebHID (desktop Chrome/Edge). Linux/ChromeOS expected ✅. No Android Chrome. | unknown (descriptor not captured; ❌ if like A2) | codec/transport/commands as-is; new caps: heartbeat link-only, volume map `5,4,3,0,1,2`, no NC-off gate | high (wire) / medium (semantics) |
| Lark C1 2nd gen, `6501PRO`, PID 11 (iOS `lark c1 pro` → 4) | same | same | same | unknown | as M2-mobile minus toggle/lock; + TX1/TX2 **label swap**; NC-on precondition | high / medium |
| Lark M1 2nd gen, `6502PRO`, PID 12 (iOS `lark m1 pro` → 5) | same | same | same | unknown | as PID 11 without swap | high / medium |
| Lark Mini, `6502JF`, PID 13 ("PRODUCT_LARK_C1_PRO"; iOS `lark m1 pro` + `0x16`=3 → 6) | same | same | same | unknown | identical to PID 12 | high / medium |
| Lark MAX, `6902`, PID 2 (iOS `lark max` → 1) | USB HID [?] (Android rejects PID 2); iOS iAP2 | same (iOS 6501 engine) | WebHID [?] | unknown | C1 profile at best | low |
| EAGLES OEM | VID 0x4417, only 6301 PIDs 32/33 defined | same | WebHID | unknown | already in `models.ts` (M2) | n/a for this group |
