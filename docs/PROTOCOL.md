# Hollyland LARK A2 / M2 USB control protocol: master specification

This is the single reference for the browser implementation in `src/lib/protocol/`. It merges the two
reverse-engineering reports (`docs/research/android-protocol.md`, `docs/research/ios-protocol.md`), resolves
their conflicts against the primary sources, and adds live evidence from the LARK A2 connected to the
development Mac (§11).

Citation conventions:
- **A:** Android HollyAudio 3.1.0 (`com.hollyland.larkc1`), jadx sources. Paths are relative to
  `jadx-out/sources/com/hollyland/`, followed by the class and method.
- **I:** iOS HollyAudio 3.1.0 (`larkSound`, arm64). These cite a selector or symbol, with `@0x…` as the
  virtual address (image base `0x100000000`).
- **L:** live evidence from the LARK A2 (§11).
- **R:** Android resources (`jadx-res/resources/res/values/strings.xml`).

> Safety: everything in §10 is destructive or can brick a unit. The library refuses those commands unless
> the caller opts in twice (`allowDestructive` plus `{ confirm: true }`). The probe CLI refuses every command
> that is not catalogued as read-only.

---

## 0. Summary

| Topic | Answer |
|---|---|
| Families in scope | **6118** = LARK A2 (PID 0x0411) / LARK A2S (camera RX, PID 0x0412). **6301** = Lark M2 (PIDs 7/8). **6302** = LARK M2S (PIDs 0x0405/0x0406). The Chinese "Moma" build of the iOS app calls the 6302 "LARK M2". All three use one framing and one command set. |
| Physical channel | USB HID interface **#0**: interrupt IN `0x82` and interrupt OUT `0x03`, both 64 B, 1 ms (L). Android uses it directly. The iOS app instead uses the iAP2 interface #7, which a browser cannot use (§2.7). |
| Wire packet | Always exactly **64 bytes**. Request `AA DD cmd dst lenHi lenLo payload… 00…`, reply `BB DD cmd src lenHi lenLo payload…`. |
| WebHID mapping | `sendReport(0xAA, packet[1..63])`. The reply arrives as `inputreport` with `reportId 0xBB` and `data` = packet[1..63]. Report IDs 0xAA and 0xBB are **not declared** in the descriptor. |
| Checksum | None that the device checks. The iOS XOR byte is optional (it sits outside LEN, and the device answered both forms, L). |
| Fragmentation / sequence numbers | None. Payload ≤ 58 bytes, one frame per packet. Correlation is by echoed command byte plus source unit. |
| Handshake / authentication | None. The first command can be the heartbeat. |
| Heartbeat | `0x10` to the RX. It carries link, battery, all settings and, on the 6118 only, TX mute/charging. The Android app polls every 1 s (A2, M2S) or 3 s (M2); iOS polls every 3 s. |
| Notifications | None. Everything is polled. The only device-initiated frames are OTA acks. A 3 s passive listen produced 0 IN reports (L), and a TX button press produced none either; it shows up only in the next heartbeat (L §11.7). |
| **Platform caveat (L)** | On **macOS** the device's replies never reach user space through HID. IOHIDFamily drops input reports whose report ID (0xBB) is not declared. Writes do reach the device. WebHID on macOS can therefore only send blind, unconfirmed writes; Chrome's `sendReport(0xAA, …)` resolves and the writes take effect (verified, §11.7). Linux/ChromeOS (hidraw) should work in both directions. Windows is expected to fail (§2.4). A root libusb session that detaches the HID driver does receive the replies (§11.6), and the local bridge (`docs/BRIDGE.md`) gives the page full live state that way, at the cost of the receiver's USB audio while it runs (§11.7). |
| Runtime features | The PID gives a capability superset; some features also need RX firmware above a threshold. `HollylandDevice.state.features` applies those gates (§4.1). The apps' UI preconditions (TX online, NC on, not locked, …) are enforced as `PreconditionError` (§5.4). |

---

## 1. Products and naming

| Family | USB VID:PID | Name (A strings.xml / `application/common/compatibility/DeviceCompat.getDeviceName`) | iOS EA modelNumber → deviceType (I `-[EADSessionManager setupControllerForAccessory:withProtocolString:]` @0x10012477c) | iOS display name (I `+[HLDeviceUtils getDeviceNameWithType:]` @0x1003210e0) |
|---|---|---|---|---|
| 6118 | 3547:0411 (1041) | `product_6118` = **LARK A2** | `lark a2` → 8 | "LARK A2" ("LARK A2/A2S" in Moma builds) |
| 6118 | 3547:0412 (1042) | `product_6118_camera` = **LARK A2S** (camera RX) | `lark a2s` → 8 (9 once 0x16 reports a camera RX) | "LARK A2" |
| 6301 | 3547:0007 / 0008 | `product_6301` = **Lark M2** | `lark m2` → 3 | "Lark M2" (Moma: "Lark MIX") |
| 6301 | 4417:0020 / 0021 | Lark M2, EAGLESHERO OEM (`PRODUCT_EAGLES_6301_*`; VID 0x4417 = `USBHIDService.VENDOR_ID_EAGLES`) | – | – |
| 6302 | 3547:0405 / 0406 (1029/1030) | `product_6302` = **LARK M2S** | `lark m2s` → 7 | "LARK M2S" (Moma: **"LARK M2"**) |
| 6108 | 3547:0407 | LARK A1. Different framing (feature reports). **Out of scope.** | `lark a1` → 10 | |
| 6303 | 3547:040C–040F | LARK M3. TLV framing with report ID 8. **Out of scope.** | `lark m3` → 14 | |

PIDs come from `application/common/protocol/Product.java`. A browser cannot see the EA model number, so the
product is identified by USB PID only, exactly as Android does (`HlDevice.INSTANCE.setProductId(device.getProductId())`).
The registry lives in `src/lib/protocol/models.ts`.

---

## 2. Transport

### 2.1 USB topology (L, A2 serial RXSERIAL001B)

| Interface | Class | Endpoints | Bound by (macOS ioreg) |
|---|---|---|---|
| #0 | HID 03/00/00, HID 1.10, report descriptor 231 B | `0x82` interrupt IN, 64 B, bInterval 1 · `0x03` interrupt OUT, 64 B, bInterval 1 | AppleUserUSBHostHIDDevice (DriverKit) |
| #1 | Audio Control | – | AppleUSBAudioControlNub / usbaudiod |
| #3 | Audio Streaming, 2 ch 48 kHz | `0x81` isochronous IN, 288 B (alt 1) | usbaudiod |
| #7 | Vendor FF/F0 "iAP Interface" | `0x83` bulk IN, `0x02` bulk OUT, 64 B | **accessoryd** (macOS's own iAP2 host) |

Interface #0 has an **interrupt OUT** endpoint, so HID output reports travel on the interrupt pipe, not
SET_REPORT. That is the same pipe Android writes to (A `usb/core/HlUsbManagerImpl.findSuitableInterface` picks
the first class-3 interface with interrupt endpoints; `executeBulkTransfer` calls `bulkTransfer(OUT, packet, 64, 200 ms)`).

### 2.2 HID report descriptor (interface #0)

| Offset | Collection (usage page / usage) | Report ID | Input | Output | Use |
|---|---|---|---|---|---|
| 0 | Consumer 0x0C / 0x01 | 0x06 | 8 × 1-bit (Vol+, Vol−, Mute, Play/Pause, Next, Prev, Stop, Fast-fwd) + 8-bit pad | – | Button → OS media keys. Never read by the apps. |
| 41 | Telephony 0x0B / 0x01 | 0x07 | hook switch, phone mute, … | 15 × 1-bit LEDs + pad | Never used |
| 159 | Vendor **0xFF90** / 0x01 | **0x55** | 63 B (Data,Var,Abs,Buffered Bytes) | 63 B (**Constant** flag, logical max 1) | OTA firmware data channel (§10.2). Android writes `55` + 63 firmware bytes. |
| 195 | Vendor **0xFF82** / 0x01 | **0x41** | 63 B (Data,Var,Abs) | 63 B (Data,Var,Abs) | Declared "control" collection. **Neither app addresses report 0x41.** |

IOKit creates per-report "report handler" elements (type 5, `kIOHIDElementTypeInput_NULL`) only for report IDs
**0x00, 0x06, 0x07, 0x41 and 0x55** (L, §11.2). That is why replies with ID 0xBB are dropped on macOS.

### 2.3 Byte mapping

The firmware speaks the legacy framing at **byte 0** of every interrupt transfer, with no HID report-ID layer.
A `protocol/core/sound/provider/Protocol6118Provider.getUsbConfig` returns
`new UsbCommandInfo(64, BULK, 0, false, 0, 0, 0, false, null, null, 1020, null)`. The mask 1020 (0x3FC, bits 2–9)
makes the synthetic constructor replace the literals with its defaults (`protocol/core/parser/UsbCommandInfo`):
controlTransSize 64, needResponse true, **reportId 773 (0x0305)**, controlRequestRead 1, controlRequestWrite 9. The
report ID is used only on the CONTROL path (`usb/core/HlUsbManagerImpl`: `controlTransfer(33, getControlRequestWrite(),
getReportId(), …)` / `controlTransfer(161, getControlRequestRead(), …)`); the BULK path that the A2 uses never reads it,
so there is still no report-ID layer and `AA` sits at byte 0. `CommandExecutionConfig` defaults are timeout 200 ms,
timeoutRead 200 ms, retryCount 3; the retry count is stored in `UsbCommandItem` but nothing reads it.
A HID stack reads byte 0 as a report ID, so the host "sends report 0xAA" and "receives report 0xBB".

| API | Send | Receive |
|---|---|---|
| Android (reference) | `bulkTransfer(OUT, AA DD …[64])` | `bulkTransfer(IN, buf[64], 500 ms)` → `BB DD …` |
| **WebHID** | `device.sendReport(0xAA, packet.subarray(1, 64))` (63 data bytes) | `inputreport`: `reportId = 0xBB`, `data` = 63 bytes `DD cmd src len…`. Rebuild with `[0xBB, ...data]`. |
| hidapi / node-hid | `write(packet)`. hidapi treats byte 0 = 0xAA as the report ID and passes all 64 bytes through. | `'data'` Buffer, starting with the report ID byte |
| Linux hidraw | `write(fd, packet, 64)` | `read(fd, buf, 64)` → raw `BB DD …` |

Rules:
- **Always send the full 64 bytes.** A 6- or 7-byte write produces 1 IN report instead of the usual 2 (L §11.3),
  so the firmware handles it differently. Android always pads to 64.
- Do **not** prefix report 0x41 ("H2"). `41 AA DD 10 40 …` produced a single IN report and no reply on the
  declared 0x41 channel (L §11.3).
- Each valid 64-byte request produces **two** IN reports at the driver (L). Their content cannot be seen on macOS.
  The second may be a duplicate reply or an answer to a host zero-length packet. Receivers must tolerate an extra
  or duplicate frame. `HollylandDevice` drops identical frames within 1 s and reports any other extra frame as
  `unsolicited`.

### 2.4 Platform support matrix

| Platform / API | Send (`AA` report) | Receive (`BB` report) | Evidence |
|---|---|---|---|
| macOS: hidapi / node-hid / IOKit | ✅ reaches the device. `SetReportCount` +1, and the device answers. | ❌ **dropped by IOHIDFamily**. The driver's `InputReportCount` grows by 2, but the IOKit callback gets nothing, even with the device opened `kIOHIDOptionsTypeSeizeDevice`. | L §11.2–11.3 |
| macOS: Chrome WebHID | ✅ **verified** (2026-11-05): `sendReport(0xAA, 63 B)` resolves and takes effect. Indicator Light Switch (0x39) switched the mic LEDs; Channel Mode (0x18) Stereo/Mono changed the USB audio channels. Chromium's `HidConnectionMac` calls the same `IOHIDDeviceSetReport(type, 0xAA, buf, 64)`. | ❌ Chromium uses the same `IOHIDDeviceRegisterInputReportCallback`; the connect heartbeat gets no reply, so the UI runs write-only. | L §11.7 |
| macOS: root libusb (local bridge, `scripts/bridge.ts`) | ✅ interrupt OUT `0x03` | ✅ interrupt IN `0x82`, one reply per request. Capturing the device takes the **whole** receiver from macOS, so its USB audio is unavailable until the bridge hands it back. | L §11.6, §11.7 |
| macOS: WebUSB | ❌ HID is a protected class, and interface #7 is claimed by `accessoryd`. | ❌ | L (ioreg) |
| macOS: ExternalAccessory (the iOS path) | ❌ `IAPAppRegisterClient: registerWasSuccessful 0`, 0 accessories. No iapd/iap2d on macOS. | ❌ | L §11.5 |
| Linux: hidraw (Chrome WebHID, node-hid) | expected ✅ (raw write to the interrupt OUT) | expected ✅. hidraw does not filter report IDs. Needs a udev rule for access: `SUBSYSTEM=="hidraw", ATTRS{idVendor}=="3547", MODE="0660", TAG+="uaccess"` | not tested (no Linux host) |
| ChromeOS: WebHID | expected ✅ (hidraw underneath) | expected ✅ | not tested |
| Windows: WebHID / hidapi | expected ❌. hidclass routes reports by declared report ID, and Chromium picks a collection handle by report ID. | expected ❌ | not tested |
| Android Chrome | ❌ no WebHID | ❌ | – |

Consequences for the UI:
- `HollylandDevice.connect()` probes with one heartbeat. If no reply arrives it sets `rx = 'unavailable'` and
  emits `rx-unavailable`. Reads then throw `RxUnavailableError`.
- With `blindWrites: true`, idempotent setters still go out and resolve `{ ok: true, confirmed: false }`. These
  are noise level, volume, channel mode, preset, LED, mic recognition, smart battery and auto-off.
- The noise on/off **toggle** (0x19) is never sent blind, because a toggle with unknown state can invert it.
- The UI should warn that state cannot be read on macOS (and Windows), and on macOS offer the local bridge (`docs/BRIDGE.md`).
- M2 and M2S descriptors are unknown. If those devices do not use report IDs, the transport switches to
  `framing: 'no-report-id'` and replies may arrive on every OS. The same applies if their replies use a declared ID.

### 2.5 WebHID specifics (`src/lib/protocol/webhid.ts`)

- Chooser filters (`defaultFilters()`): `{ vendorId: 0x3547, usagePage: 0xFF82 }` for the A2's control
  collection, plus `{ vendorId, productId }` for every M2/M2S PID, because their descriptors are unknown. The
  OEM VID 0x4417 is also accepted.
- One `HIDDevice` exposes all four collections. On macOS the four node-hid entries share one path,
  `DevSrvsID:…` (L). The transport picks the collection with `usagePage 0xFF82` for logging. Report IDs are
  device-wide, so the collection choice does not change the bytes.
- Report size and padding: data passed to `sendReport` is always 63 bytes (64 − report ID). Zero padding is
  part of the frame.
- Framing modes: `raw` is the default when the descriptor uses report IDs. `no-report-id` sends
  `sendReport(0, packet[64])`. `report41` is experimental and known not to work on the A2.
- Input handling: `[reportId, ...data]` is passed up. If reportId is 0x41 and the data starts `BB DD`, the data
  is used as-is (never observed). Other IDs are logged as debug (for example consumer report 0x06 when a button
  is pressed).
- Disconnect: `navigator.hid` `disconnect` event where `e.device === device`. Reconnect: `WebHidTransport.reconnect()`
  uses `navigator.hid.getDevices()` filtered by VID. `WebHidTransport.onDeviceConnect()` listens for `connect`.
- Chromium blocks only protected usages (FIDO, keyboard, mouse, system control). Consumer, Telephony and
  vendor pages are not protected, so undeclared report IDs on this device should not count as protected.
  **Verified (§11.7):** `sendReport(0xAA, …)` resolves on macOS Chrome and the device applies the setting.
- tsconfig: `"types": [..., "w3c-web-hid"]` (added to `tsconfig.app.json`).

### 2.6 Transfer pacing and timeouts (sources)

| Value | Android | iOS | Library default |
|---|---|---|---|
| Write timeout | 200 ms (6118, `CommandExecutionConfig` defaults). 250 ms for raw M2/OTA (`usbmic/core/USBHIDService.onEventMainThread(USBDataSendEvent)`). | – | – (WebHID promise) |
| Read loop | 500 ms per `bulkTransfer` (`HlUsbManagerImpl$startDataReceiveLoop$1`) | 512-byte stream reads (`-[EADSessionManager _readData]` @0x100124050) | event-driven |
| Inter-frame gap | none. The queue sends back to back. | `usleep(20 ms)` before every `AA DD` write (`-[EADSessionManager writeSimpleData]` @0x1001239cc) | 20 ms |
| Reply timeout | none. Android never waits for replies (`usb/core/queue/UsbCommandQueue`). | none | 500 ms, probe 1200 ms |
| Retries | none on the BULK path | none | 2 extra attempts for **read-only** commands only |

### 2.7 iAP2 / External Accessory (iOS only, documented for completeness)

iOS talks to the same firmware over USB interface #7, using EA protocol `com.hollyland.protocol`. Request frames
are identical, with the XOR byte appended (`+[NSData(HL6902Data) headerWithCommand:payload:andType:]` @0x10027a484).
Writes are ≤ 64 B with a 20 ms gap. Reads arrive as a stream, and the first 2 bytes (`BB DD`) are dropped
without being checked (`-[EADSessionManager dealWithCurrentData]` @0x100124228). Browsers cannot use this path.
On macOS `accessoryd` holds the interface and EA is unavailable to Mac processes (L §11.5).

---

## 3. Framing (`src/lib/protocol/codec.ts`)

### 3.1 Request (host → device), exactly 64 bytes

A `protocol/core/sound/command/device6118/LegacyUsb6118ProtocolCodec.buildPacket`, identical bytes to
`application/common/protocol/Protocol.getData` (M2/M2S), I `headerWithCommand:payload:andType:` @0x10027a484.

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `0xAA` |
| 1 | 1 | `0xDD` |
| 2 | 1 | command ID (§7, §8) |
| 3 | 1 | destination: `0x40` RX, `0x41` TX1, `0x42` TX2 (`0x40 \| target`) |
| 4 | 1 | payload length, high byte |
| 5 | 1 | payload length, low byte (big-endian uint16; header **excluded**; max 58) |
| 6 … 6+n−1 | n | payload |
| 6+n | 1 | *optional* iOS XOR = XOR of bytes 0 … 5+n (initial 0). Off by default. |
| … 63 | | `0x00` padding |

### 3.2 Response (device → host)

A `LegacyUsb6118ProtocolCodec.isValidPacket / parseValidatedPacket`.

| Offset | Value |
|---|---|
| 0–1 | `BB DD` (Android checks it. iOS strips it unchecked; its `-resHeaderData` @0x1001272f0 builds `BB DD`.) |
| 2 | command ID (echo of the request) |
| 3 | source: `0x80` RX, `0x81` TX1, `0x82` TX2. Android `mapResponseDeviceType`: `0x81` → TX1, `0x82` → TX2, **anything else → RX** (`Protocol.parse` likewise). iOS `-[NSData judgeCurrentDevTypeWithData:]` @0x10027a898 maps `0x00` → 5, `0x01` → RX, `0x02` → TX1, `0x03` → TX2, `0x04` → 3 (TX3), `0x05` → 4 (TX4), `0x81/0x82` → TX1/TX2, rest → RX; those low values come from the iAP2 stream. On HID the A2 answers `80/81/82` (§11.6), so the library uses the Android mapping, flags `sourceKnown` for `80–82`, and attributes a reply with any other source byte to the unit it asked. |
| 4–5 | payload length, big-endian |
| 6… | payload = `data[6 .. min(6+len, data.length))` |

The M2/M2S parser (`Protocol.parse`) skips the `BB DD` check and computes the length as `hi*16 + lo`. That is an
app bug, harmless for lengths below 16. The library uses BE16.

### 3.3 Checksum

There is none that the device enforces. Android 6118 declares `VerificationAlgorithm.XOR` in
`Protocol6118Provider.createCommandPostBuilder()`, but its `buildPacket` override never uses it. The M2 builder has
none. iOS appends XOR. The live A2 answered heartbeats with and without the XOR byte (L §11.3). Neither app
verifies a checksum on replies. `decodeFrame` reports `trailerIsXor` for diagnostics.

### 3.4 Fragmentation and reassembly

There is no fragmentation: every request and reply fits in one 64-byte packet, so `encodeRequest` throws above
58 payload bytes. Android does **no** resynchronisation (A `Protocol6118Provider.checkDataComplete`: a chunk that
does not start with `BB DD` is declared complete and handed on as-is, then rejected by `isValidPacket`; a chunk
that starts with `BB DD` is concatenated with the next ones by `usb/core/packet/DefaultPacketProcessor.processReceivedData`
until 6+LEN bytes are present). `FrameAssembler('packet')` (default) does exactly that, reporting non-frames via
`onGarbage`. One deviation: a complete `BB DD` packet that arrives while a partial frame is buffered replaces the
stale partial instead of being appended. `FrameAssembler('stream')` is a library extension for byte streams (scan for
`BB DD`, drop leading garbage, split several frames per chunk); neither app does that.

### 3.5 Sequence numbers and correlation

There are none: no transaction ID, no escaping, no end marker. A reply echoes the command byte, and for
TX-addressed reads the source byte names the unit. The library keeps **one request in flight**, matches the reply
by command byte, and attributes it to the unit named in the source byte, falling back to the requested target.
The traffic log has its own `seq` counter for display only.

---

## 4. Model / capability matrix (`models.ts`)

| Capability | LARK A2 (1041) | LARK A2S (1042) | Lark M2 mobile (7, 32) | Lark M2 camera (8, 33) | LARK M2S mobile (1029) | LARK M2S camera (1030) |
|---|---|---|---|---|---|---|
| Heartbeat interval (Android) | 1000 ms | 1000 ms | 3000 ms | 3000 ms | 1000 ms | 1000 ms |
| Version command | 0x41 (6 B) | 0x41 | 0x03 | 0x03 | 0x03 | 0x03 |
| Noise levels (0x06) | 1 Weak / 2 Medium / 3 Strong | same | 1 Low / 2 Strong | same | 1 Low / 2 Strong | same |
| Noise on/off toggle (0x19) | ✅ | ✅ | ⚙ RX fw > 2.0.0.31 **and** last part ≥ 32 | ⚙ same | ✅ | ✅ |
| RX volume steps (0x05) | 6 (0–5) | 3 (0–2) | 6 (0–5) ‡ | 6 ‡ | 6 ‡ | 6 ‡ |
| Channel mode (0x18) | Mono / Stereo / Safety track | same | – | – | Mono / Stereo | same |
| Voice preset "Bel canto" (0x3A) | ✅ Bright / Low / Balance | ✅ | – | – | – | – |
| LED (0x39) | ✅ | ✅ | – | – | ⚙ RX fw > 2.0.0.9 | ⚙ same |
| Mic recognition (0x3B/0x3C) | ✅ (only while LED on) | ✅ | – | – | – | – |
| Smart battery (0x3D/0x3E) | ✅ | **–** | – | – | – | – |
| Speaker passthrough (0x12/0x13, needs restart) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TX auto power-off (0x36) | ✅ | ✅ | – | – | ✅ | ✅ |
| Volume lock (0x34/0x35) | – (sender exists, UI unused) | – | **–** | ⚙ RX fw > 2.0.0.31 | **–** | ✅ |
| Custom buttons (0x37/0x38) | – | – | – | – | ⚙ RX fw > 2.0.0.9 | ⚙ same |
| Camera-RX battery / charging | – | ✅ heartbeat 15/16 | – | – | – | – |
| Remove pairing (0x3F) / factory reset (0x40) | ✅ ⚠ | ✅ ⚠ | – | – | – | – |
| Restart RX (0x0C) | ✅ ⚠ | ✅ ⚠ | ✅ ⚠ | ✅ ⚠ | ✅ ⚠ | ✅ ⚠ |
| TX mute / charging | read-only (heartbeat body[15]) | same | **not reported** | same | **not reported** | same |
| Audio level meters | app-side (USB audio input) | same | same | same | same | same |

⚙ = firmware-gated (§4.1). ‡ = Android value; iOS offers only 3 steps (0–2) on M2 and M2S (§12 #33).

Sources:
- 6118: `larkc1/c6118/ui/home/C6118DeviceActivityKt.homeRxVolumeStepCount` (`i == 1042 ? 3 : 6`), `shouldShowRxCameraStatus`,
  `shouldShowMicIdentifySection(lightOpen)`; `larkc1/c6118/ui/setting/MoreSetting6118ActivityKt.shouldShowSmartBatteryItem`
  (`i == 1041`, applied in `MoreSetting6118Activity.initView`; the 0x3E GET is still sent on 1042);
  `protocol/core/sound/provider/Protocol6118ProviderProxy.getSupportedCommands`.
- M2: `larkc1/HLDeviceActivity` (`SPEC_VERSION = "2.0.0.31"`, `isNew6301Camera` = PID 8/33 and fw newer,
  `isNew6301CameraOrMobile` = PID 7/8/32/33 and fw newer, `setVoiceLockVisibility`, `setNoiseLevelStrong`).
- M2S: `larkc1/HLDevice6302Activity` (`SPEC_VERSION = "2.0.0.9"`; `initView`: `voiceLock` visible only for
  `productId == 1030`, `ctLight` hidden and `ctBtnCustom` shown for non-6108; `onResGetVersion` shows both above 2.0.0.9).
- iOS: `-[HL6501Engine applyRXVersionCapabilities:toState:]` @0x1000bd78c, `handleDeviceInfoPayload:` @0x1000bcb54
  (`isCameraDevice → setShowVoiceLock:`), `HLLark6118View` `setTotalCount:6` @0x100662cf8 / `3` @0x1006666e0,
  `-[HLLarkM2View voiceView]` @0x1000cf8c4 (3 buttons).
- Volume buttons: `DeviceCompat.getVoiceLevels` = [0..5] for 6301/6302; layouts `activity_hldevice.xml` /
  `activity_hldevice_6302.xml` have six buttons `voice_1..voice_6` (R).

### 4.1 Firmware gates and runtime features

`models.ts` keeps the static, per-PID capabilities in `ProductInfo.capabilities` and the firmware requirements in
`capabilities.firmwareGates`. `resolveFeatures(caps, rxVersion)` returns the runtime set, exposed as
`HollylandDevice.state.features` (and `.features`), with `state.featureGates[feature]` = `ok`, `version-unknown`
or `firmware-too-old`. Setters check `features`, not `capabilities`. A gated feature counts as unavailable until
the RX version has been read; `ignoreFirmwareGates: true` turns the gates off (for example in blind mode on macOS,
where the version cannot be read).

Where the apps disagree the library takes the **intersection** (a feature is offered only where both apps offer it):

| Feature | Android rule | iOS rule | Library |
|---|---|---|---|
| Lark M2 noise toggle | `Util.isNewVersion(rx, "2.0.0.31")` (strict, first four parts) for PID 7/8/32/33 | last `.` component `intValue >= 32` (@0x1000bd810–0x1000bd824) | both |
| Lark M2 volume lock | camera PID 8/33 **and** `isNewVersion(rx, "2.0.0.31")` | `isCameraDevice` (0x16), no version check | camera PID and Android version rule |
| M2S LED | `isNewVersion(rx, "2.0.0.9")` | `compare:"2.0.0.9" options:NSNumericSearch == NSOrderedDescending` (@0x1000bd88c) → `showKeyFunc` (LED switch + custom keys) | both |
| M2S custom buttons | always shown | same gate as the LED | gated like the LED |
| M2S volume lock | PID 1030 only | `isCameraDevice` | PID 1030 |
| A2S smart battery | PID 1041 only | – | PID 1041 |

`Util.isNewVersion` (A `application/httpcommon/utils/Util`) needs at least four dot parts in both strings and
returns false when they are equal. `isNewerVersionAndroid`, `isNewerVersionIos` and `lastVersionComponent` in
`commands.ts` implement the three rules.

---

## 5. Session

### 5.1 Connect / handshake

There is no handshake, authentication or model-identification command (A `larkc1/c6118/data/runtime/C6118RuntimeSession.ensureSessionActive`;
I `-[HLDeviceController viewDidLoad]` @0x1002c3ed0). The app identifies the product by PID. The library's
`connect()`:
1. Opens the transport and resolves the product from the PID. It throws `UnsupportedError` for out-of-scope
   PIDs.
2. Sends one heartbeat probe (1200 ms timeout, 1 retry). A reply sets `rx: 'available'`. Silence sets
   `rx: 'unavailable'` and emits `rx-unavailable`.
3. If replies arrive, it runs these in the background: version + serial for the RX, then GET-only settings:
   `0x16` (iOS), `0x13`, `0x3C` (6118), `0x3E` (A2 1041 only), `0x35` (every M2/M2S, as Android does at start-up;
   iOS never sends it), `0x38` (when custom buttons are available). It then starts the heartbeat poll. The RX
   version feeds the firmware gates (§4.1).
4. When a heartbeat shows a TX coming online, it fetches that TX's version + serial; when a TX drops, its version
   and serial are cleared (A `HLDeviceActivity.onEvent` cmd 16: `HlDevice.setVersion(2, "")`).
   - **Missing version**: blank, or every digit 0, so `"0.0.0.0"` and `"0.0.0.000"` (what six zero bytes give through
     `formatSixByteDeviceVersion`) both count (`isVersionMissing`). A `C6118DeviceRuntimeManager.isVersionMissing` =
     blank or `C6118FirmwareUpgradeCoordinator.toVersionInt(v, 0) == 0` (strip `[^0-9.]`, join the digits, parse);
     A `HLDeviceActivity.onEvent` cmd 3 re-sends `0x03` on `"0.0.0.0"`; I `-[HL6501Engine handleDeviceVersionEntity:]`
     @0x1000bc6ec re-queries 1 s later on `"0.0.0.0"` or `"0.0.0.000"` (`dispatch_time(0, 1000000000)`). A missing
     version is never stored.
   - **Budgets**: version and serial have separate budgets of 4 tries per unit (A `shouldRequestVersion` /
     `shouldRequestText`, `MAX_REQUEST_RETRY_COUNT = 4`), reset when the TX comes online again. Retries are
     spaced by `identityRetryDelayMs` (default 1000 ms, the iOS delay; Android retries after each heartbeat).

Start-up sequences the apps use:

| App | Sequence |
|---|---|
| Android A2 | wait 1 s → `0x10` every 1 s. After each heartbeat: `0x41` + `0x15` for the RX and each online TX until answered. Home screen: `0x3C`. More settings: `0x3E`, `0x13`. |
| Android M2 | `0x03`, `0x11`, `0x04`, `0x13`, `0x15`, `0x35` back to back; 1 s later `0x10` every 3 s |
| Android M2S | `0x15`, `0x03` (RX, plus TX if online), `0x11`, `0x04`, `0x13`, `0x35`, then `0x10` every 1 s |
| iOS (all 6501-family) | `+[HL6501Messenger getDeviceInitialInfo]` @0x10008aa48 at 0.5 s steps: `0x11`, `0x16`, `0x04`, version (`0x41` on 6118), `0x13`, `0x15` RX/TX1/TX2, then on 6118 `0x3C`, `0x3E`. Heartbeat every 3 s. |

### 5.2 Queue semantics (library)

- One request in flight. User requests run before background polls. There is a 20 ms gap between frames.
- **Coalescing (library policy):** a queued (not yet sent) setter for the same command **and target** is replaced
  by the newer one, and both callers get the newer result (slider spam). This is narrower than Android: A
  `usb/core/queue/UsbCommandQueue.enqueueCommand` cancels any PENDING item whose `commandName` equals the new one
  ("Command replaced by newer request"), and on the 6118 the name is the command byte alone
  (`Command6118Usb` value `String.format("0x%02X")`), so a pending `0x41` to TX1 is dropped by a newer `0x41` to TX2,
  reads included. On M2/M2S every packet gets a random name (`usbmic/core/USBHIDService.onEventMainThread(USBDataSendEvent)`:
  `String.valueOf(Random.nextFloat())`), so nothing is coalesced. The library never coalesces reads.
- Read-only commands are retried on timeout. Toggles, destructive commands and OTA commands are never resent.
- Set replies: `payload[0] == 1` means success (A `Base6118UsbCmd.parseSetResponse`, `Pro_set_*`), with these
  exceptions: `0x06` on M2/M2S needs `[status, level]` (A `Pro_set_noise.receiveData`: with fewer than 2 bytes
  `setStatus` keeps its default false); `0x34` on the Lark M2 also accepts the new lock state (§8); `0x19` is judged
  by the heartbeat read right after it (iOS shows "设置成功" for every 0x19 reply, `handleConfigResponseEvent:`
  @0x1000bcc48). The new value goes into `state.settings` optimistically on success.
- **Protect window (iOS):** when a `0x05`, `0x06` or `0x19` write is dispatched, heartbeat values for volume, noise
  level and noise on/off are ignored for 1 s (I `-[HL6501Engine dispatchAction:]` @0x1000bafec calls
  `markUserConfigChanged` only for those commands; `handleHeartbeatEntity:` @0x1000bc4bc skips only
  `setNoiseLevel:/setNoiseSwitch:/setVolumeLevel:`; `isInUserConfigProtectWindow` @0x1000baf10 compares with 1.0 s).
  A failed ack for those commands closes the window at once (`handleConfigResponseEvent:` @0x1000bcd24–0x1000bcd50,
  mask 0x2000060). Other fields are not protected (Android applies every heartbeat at once,
  `HLDevice6118ViewModel.applyDeviceHeartInfo`); the one-request-in-flight queue means no heartbeat reply can
  arrive between a write and its ack anyway.
- **Read-backs (A `MoreSetting6118ViewModel`, `TOGGLE_CONFIRM_DELAY_MS = 150`):** `0x3E` is re-read 150 ms after every
  `0x3D` (`scheduleSmartBatteryRefresh`, scheduled when the set is sent); `0x13` is re-read 150 ms after a **failed**
  `0x12` (`handleSpeakerSettingResponse` → `scheduleAutoSpeakerRefresh`; a successful one starts the 3 s restart countdown).
- **Factory reset:** after a successful `0x40` the library drops cached identity and settings and re-reads them
  1 s later. A has `startFactoryResetRuntimeRecovery` (shut the runtime down, wait
  `FACTORY_RESET_RUNTIME_RECOVERY_DELAY_MS = 1000`, `C6118RuntimeSession.ensureSessionActive`) but in 3.1.0 nothing
  calls it (`handleFactoryResetResponse` only updates the UI).
- **Heartbeat pause:** `pauseHeartbeat()` / `resumeHeartbeat()` nest like A `C6118RuntimeSession.pauseHeartbeat`
  (`pauseCount`). Android pauses for the whole firmware upgrade (`C6118OtaTrafficGate`, §10.2).

### 5.3 Notifications

There are none outside OTA. Connection, battery, mute, charging, TX button presses (on the A2 the button toggles
noise cancellation, §11.7), docking and settings changed on the hardware are seen only through the heartbeat poll (A `C6118RuntimeSession.consumeRuntimeNotification`, which only handles
poll replies). `HIP_6501_DEVWARNING = 0x0A` is declared, but no class implements it, and iOS ignores `0x0A`
and `0x0F`. L: a 3 s passive listen saw 0 IN reports at the driver. The library still applies any unsolicited
`0x10` frame and emits every other unexpected frame as `unsolicited`.

### 5.4 UI preconditions

The apps refuse some writes in some states. `HollylandDevice` enforces the same rules (`PreconditionError` with a
`reason`) once a heartbeat has been seen and replies are delivered; `enforcePreconditions: false` turns them off.

| Reason | Applies to | Android | iOS |
|---|---|---|---|
| `mic-disconnected` (no TX online) | 6118 home screen: noise level, NC toggle, volume, channel mode, preset, LED, mic recognition. M2/M2S: noise level, volume, channel mode; NC toggle on M2S only (the Lark M2 switch, `HLDeviceActivity` `mNoiseSwitch` listener, and iOS `noiseViewSwitchChanged:` @0x1000ccf58 check nothing) | `HLDevice6118ViewModel.resolveMicRequiredBlockReason` / `resolveRxAndNoiseBlockReason` (`MIC_DISCONNECTED`), `C6118DeviceActivity.setup*Actions`; `HLDeviceActivity` (`tx1Status`/`tx2Status`, `isAllowSetVoice`); `HLDevice6302Activity.isAllMicOffline` | `+[HLLarkProtocolHelper isAllTXDisonline]` @0x1000d2bc8 in the 6118 closures; `HLLarkM2View voiceView` block @0x1000cfad8 → "Mic未连接，当前功能无法设置" |
| `all-mics-muted` | 6118 noise level and NC toggle | `resolveRxAndNoiseBlockReason` (`ALL_ONLINE_MIC_MUTED`, `isAllOnlineMicMuted`) | toast "当前Mic处于静音状态，降噪设置不可用" (@0x100669c8c) |
| `noise-off` | noise level, all families | levels hidden while NC is off: `C6118DeviceActivity.updateNoiseView` (`ctNoiseLevel`), `HLDevice6302Activity.updateNoiseView` (`noiseLevelBottom`); `HLDeviceActivity.onClick` `strong_level`/`low_level` → `noise_is_closed_notice` | `HLLarkM2View noiseView` block @0x1000cf3d0: `noiseSwitch` false and deviceType ≥ 3 → "当前设备降噪未开启…" |
| `volume-locked` | M2/M2S volume | `HLDeviceActivity.onClickBtnGroup`, `HLDevice6302Activity.onClickBtnGroup` → `device_voice_locked` | `voiceView` block @0x1000cfb48 (`voiceLocked`) |
| `both-mics-required` | M2S custom buttons and colours | `HLDevice6302Activity.initView$lambda$20` (`toast_connect_mic`), `CustomFunctionActivity.onResHeartInfo` finishes when a TX drops | – |
| `led-off` | 6118 mic recognition | `C6118DeviceActivityKt.shouldShowMicIdentifySection(lightOpen)` | – |

Not gated (no check in either app): auto-off, speaker, smart battery, M2S LED, volume lock.

---

## 6. Heartbeat (0x10) reply

Request: `AA DD 10 40 00 00` + zero padding. With XOR: `… 27`. The tables index `body[i] = frame[6+i]`.
iOS offsets in `HLHeartEntity` count from the command byte, so iOS offset k = body[k−4].

### 6.1 6118 (A `device6118/CmdGetHeart6118.decodeLegacyPayload`; I `-[HLHeartEntity initEntityWithData:]` @0x1001fa17c)

The live A2 sends LEN = 16 (body[0..15], §11.6). Android reads missing bytes as 0. iOS validates before applying:
volume, vocal mode and shut time become −1 and are skipped when LEN < 8 (`csinv` @0x1001fa5b0–0x1001fa5bc), both key
entities (and with them the LED, `setLightEnabled:` only when both are non-nil @0x1000bc5d0–0x1000bc61c) need LEN > 9
(@0x1001fa5c0), and noise is applied only if < 4 (`isHeartbeatNoiseLevelValid:` @0x1000bafac). The library parses like
Android but applies a field only when its byte is present (and noise < 4), so a short or odd heartbeat never
reports volume 0, mono, auto-off on, LED on or a bogus noise level (`Heartbeat6118.valid`).

| body | frame | iOS off | Field | Decoding |
|---|---|---|---|---|
| 0 | 6 | 4 | TX1 online | `== 1`. A TX docked in the charging case reports 0 (L §11.7). |
| 1 | 7 | 5 | TX2 online | `== 1` (as body[0]) |
| 2 | 8 | 6 | TX1 battery | percent |
| 3 | 9 | 7 | TX2 battery | percent |
| 4–5 | 10–11 | 8–9 | not decoded on 6118. M2 "uvValue" (signed b4·256 + b5). | – |
| 6 | 12 | 10 | noise level | 0 = NC off, 1 Weak, 2 Medium, 3 Strong. `noiseEnabled = level != 0`. iOS accepts only < 4 (`isHeartbeatNoiseLevelValid:` @0x1000bafac). The level kept while NC is off is not visible here; turning NC on (0x19 or the TX button) brings back the last level used (L §11.7). |
| 7 | 13 | 11 | RX volume step | 0–5 (A2), 0–2 (A2S) |
| 8 | 14 | 12 | volume lock byte. Android ignores it on 6118. iOS copies `!= 0` into `volumeLocked` for every deviceType ≥ 3, the A2 included (`handleHeartbeatEntity:` @0x1000bc474), but no A2 view reads it. Exposed as `lockByte`, not applied. | – |
| 9 | 15 | 13 | channel mode | 0 Mono, 1 Stereo, 2 Safety track |
| 10 | 16 | 14 | TX auto power-off | `== 0` → enabled (15 min idle) |
| 11–12 | 17–18 | 15–16 | not decoded on 6118. M2S custom buttons. | – |
| 13 | 19 | 17 | LED | `== 0` → LED **on** (A `== 0`; I `setLightEnabled:(lightStatus ^ 1)` @0x1000bc614) |
| 14 | 20 | 18 | voice preset | bit0 = enabled, bits1–7 = preset (0 Bright, 1 Low, 2 Balance). iOS calls these `eqSwitch` / `eqMode`. |
| 15 | 21 | 19 | flags | bit0 TX1 muted, bit1 TX2 muted, bit2 TX1 charging, bit3 TX2 charging, bit4 camera-RX charging (A `LEGACY_6118_*_MASK`). iOS applies them only when `+[HLDeviceUtils isConnect6118Device]` (@0x1000bc628). The A2 TX button does **not** set the mute bits (it toggles NC, L §11.7); what does is open (§13). |
| 16 | 22 | 20 | camera-RX battery | percent (A2S only, `shouldShowRxCameraStatus`) |
| ≥17 | | | unknown | `Heartbeat6118.unknown` exposes these |

Note the asymmetry: body[14] packs `(preset << 1) | enabled`, while the `0x3A` set takes two separate bytes.

### 6.2 6301 / 6302 (A `usbmic/protocol/Pro_get_heart.receiveData`; each field present only if the payload is long enough)

| body | Field |
|---|---|
| 0 / 1 | TX1 / TX2 online (`== 1`) |
| 2 / 3 | TX1 / TX2 battery % |
| 4–5 | `uv = (s8)b4·256 + (s8)b5` (unused) |
| 6 | noise 0 off / 1 low / 2 strong |
| 7 | volume 0–5. A `HLDeviceActivity.onEvent` cmd 16 applies it only when `productId >= 8`: the mobile Lark M2 (PID 7) takes its volume from `0x04` alone, and so does the library. M2S applies it always (`HLDevice6302Activity.onResHeartInfo`). iOS applies it for every type. |
| 8 | volume lock (`== 1` locked). Lark M2: used only when `isNew6301Camera` (A cmd 16); M2S: always (`onResHeartInfo`). |
| 9 | channel mode 0 mono / 1 stereo |
| 10 | auto-off `0` = 15 min, `1` = never |
| 11 / 12 | custom-button **function slots 1 / 2** (not TX1/TX2): high nibble = function, low nibble = key operation, which also names the physical button (§9). A `Pro_get_heart`: `BtnCustomBean(1, …)` from data[11], `BtnCustomBean(2, …)` from data[12]. |
| 13 | LED `== 0` → on |
| ≥ 14 | not decoded by either app on M2/M2S (`HeartbeatM2.unknown`). iOS parses the 6118 flags byte (iOS offset 19 = body[15]) for every device but applies mute/charge only to the 6118 (`isConnect6118Device` gate @0x1000bc62c), and `HLLarkM2View` never reads mute or charge. So M2/M2S report **no** TX mute or charging state (`muted`/`charging` undefined). |

---

## 7. Command catalog: LARK A2 / A2S (6118)

Source of IDs: A `protocol/core/sound/command/type/Command6118Usb` (the `super(n)` argument). Codecs:
`protocol/core/sound/command/device6118/Cmd*6118.java`. Sender: `mic_usb/messenger/UsbMessenger6118`.

Columns:
- **dst**: byte 3 of the request.
- **Request bytes**: the first 6+n bytes; the rest is zero padding.
- **Safety**: R = read-only, W = write, D = disruptive, X = destructive, O = OTA.

| Cmd | Name | Safety | dst | Request bytes | Reply payload | Notes / sources |
|---|---|---|---|---|---|---|
| 0x10 | HEARTBEAT | R | 40 | `AA DD 10 40 00 00` | §6.1 | `CmdGetHeart6118` |
| 0x41 | VERSION_GET | R | 40/41/42 | `AA DD 41 4t 00 00` | 6 bytes → `"b0.b1.b2.b3b4b5"` (decimal, last three concatenated). Android: fewer than 6 → `""`, extra bytes ignored. iOS: anything but exactly 6 → `""`. The A2 sends exactly 6 (`03 00 02 00 00 08` = `"3.0.2.008"`, §11.6); library = Android. | A `CmdGetRuleVersion6118` + `LegacyUsb6118CommandsKt.formatSixByteDeviceVersion`. I `getNewVersionWithData:` @0x1001fd054 (`cmp x0,#6; b.ne`) `"%u.%u.%u.%u%u%u"`. |
| 0x03 | VERSION_LEGACY_GET | R | 40/41/42 | `AA DD 03 4t 00 00` | n bytes → decimals joined with `.`, last one zero-padded to 3 (`formatLegacyVersion`) | Decoder registered but unused by the A2 apps. The live A2 answers it (2 IN reports). |
| 0x15 | SERIAL_GET | R | 40/41/42 | `AA DD 15 4t 00 00` | bytes up to the first NUL, decoded US-ASCII (bytes ≥ 0x80 → U+FFFD, not masked), trimmed. iOS instead decodes all LEN bytes as UTF-8 and deletes every U+0000. | A `CmdGetDeviceSn6118` + `asciiString`; I `messageForDeviceSN:` @0x1000da26c. The live RX answered 11 bytes `RXSERIAL001` (no NUL); the USB iSerial is `RXSERIAL001B`, one character longer (§11.6). |
| 0x16 | DEVICE_INFO_GET | R | 40 | `AA DD 16 40 00 00` | payload[0]: 2 = camera RX. The A2 mobile RX answers LEN 9 `00 00 00 06 01 01 5b 5c 00` (§11.6); bytes 1–8 are not decoded by iOS. | iOS only (`getDeviceInitialInfo` block @0x10008ac88, `resolveDeviceHeaderImageWithPayload:` @0x1000bd910: type 8/9 → `isCameraDevice = payload[0] == 2`, deviceType 9 if camera). Read at connect; the PID stays authoritative. |
| 0x08 | DEVICE_ID_GET | R (OTA prep) | 40/41/42 | `AA DD 08 4t 00 01 0t` | payload[0] = devId | A `CmdGetDeviceId6118.encodeLegacyPayload` repeats the target. iOS sends an empty payload for the RX. |
| 0x11 | NOISE_LEVEL_GET | R | 40 | `AA DD 11 40 00 00` | **Unresolved.** Android: bit7 = enabled, bits0–6 = level, level = `enabled ? b & 0x7F : 0`, clamped 0..3. iOS: level = raw byte, NC on = raw > 0 (no bit7, no range check). They agree only for `00` (the live reply with NC off). The library takes 6118 noise state from the heartbeat, never from 0x11; `parseNoiseLevelGet6118` returns both readings and `agree`. | A `CmdGetNoiseLevel6118` (the A2 UI never sends 0x11); I `messageForNoiseLevel:` @0x1000d9eb0, `handleNoiseLevelEvent:` block @0x1000bd034 |
| 0x06 | NOISE_LEVEL_SET | W | 40 | `AA DD 06 40 00 01 LL` (LL 1–3) | set-ack | A `CmdSetNoiseLevel6118` (coerceIn 0..3). UI levels: `blemic/device/DeviceConnectVariable.NoiseLevel`. |
| 0x19 | NOISE_TOGGLE | W, **toggle** | 40 | `AA DD 19 40 00 01 02` (always 02) | set-ack (Android); iOS shows "设置成功" whatever payload[0] is and uses the flag only to clear the protect window (@0x1000bcc48) | A `CmdSetNoiseSwitch6118` (`LEGACY_6118_NOISE_SWITCH_TOGGLE = 2`, isOpen ignored). I codec @0x10011b9fc case 0x19 ignores `isOn`. The library judges the result from the heartbeat read right after. L §11.7: switching on restores the last level used; the TX button flips the same state. |
| 0x04 | VOLUME_GET | R | 40 | `AA DD 04 40 00 00` | b0 = step | A `CmdGetVoiceLevel6118` |
| 0x05 | VOLUME_SET | W | 40 | `AA DD 05 40 00 01 VV` (0–5; 0–2 on A2S) | set-ack | A `CmdSetVoiceLevel6118`, `homeRxVolumeStepCount`. UI default index 3. |
| 0x18 | CHANNEL_MODE_SET | W | 40 | `AA DD 18 40 00 01 MM` (0 mono, 1 stereo, 2 safety) | set-ack | A `C6118DeviceActivity.setupVoiceModeActions` (0/1/2). R `c6118_safe_track` = "SafeTr". |
| 0x3A | VOICE_PRESET_SET | W | 40 | `AA DD 3A 40 00 02 EE PP` (EE 0/1, PP 0 Bright / 1 Low / 2 Balance) | set-ack | A `CmdSetBeautyVoice6118`. R `c6118_preset_title` "Bel canto preset", `c6118_preset_btn1..3`. I closures @0x100669f60/@0x10066a298 read `eqMode`/`eqSwitch`. |
| 0x39 | LED_SET | W | 40 | `AA DD 39 40 00 01 VV` (**0 = on, 1 = off**) | set-ack | A `CmdSetLight6118`, `LEGACY_6118_LIGHT_VALUE_OPEN = 0`. I `[!isOn]`. |
| 0x3B | MIC_RECOGNITION_SET | W | 40 | `AA DD 3B 40 00 01 0/1` | set-ack | A `CmdSetTxIdentify6118`. UI "Mic Recognition", shown only while the LED is on. |
| 0x3C | MIC_RECOGNITION_GET | R | 40 | `AA DD 3C 40 00 00` | b0 == 1 → on (Android); iOS: b0 != 0 (`messageForMicIdentify:` @0x1000da68c). Live: `01`. | A `CmdGetTxIdentify6118` |
| 0x3D | SMART_BATTERY_SET | W | 40 | `AA DD 3D 40 00 01 0/1` | set-ack | A `CmdSetSmartBattery6118`. UI "Smart battery life", **PID 1041 only** (`shouldShowSmartBatteryItem`). 0x3E is re-read 150 ms later. |
| 0x3E | SMART_BATTERY_GET | R | 40 | `AA DD 3E 40 00 00` | b0 == 1 → on (Android); iOS: b0 != 0 (`messageForEndurance:` @0x1000da734). Live: `00`. | A `CmdGetSmartBattery6118` (sent on 1042 too) |
| 0x12 | SPEAKER_SET | W (needs 0x0C) | 40 | `AA DD 12 40 00 01 VV` (**0 = on, 1 = off**) | set-ack | A `CmdSetSpeaker6118`. After success the app counts down 3 s and sends 0x0C (`MoreSetting6118ViewModel.startSpeakerRestartCountdown`). UI "External speaker without unplugging". |
| 0x13 | SPEAKER_GET | R | 40 | `AA DD 13 40 00 00` | b0 == 0 → on | A `CmdGetSpeaker6118`; I `messageForSpeakerStatus:` |
| 0x36 | AUTO_OFF_SET | W | 40 | `AA DD 36 40 00 01 VV` (**0 = auto-off after 15 min, 1 = never**) | set-ack | A `CmdSetShutdownTime6118`. R `c6118_mic_auto_shutdown_summary`. |
| 0x34 | VOICE_LOCK_SET | W | 40 | `AA DD 34 40 00 01 0/1` | set-ack | The sender exists, but the A2 UI never uses it |
| 0x35 | VOICE_LOCK_GET | R | 40 | `AA DD 35 40 00 00` | b0 | sender exists |
| 0x0C | RESTART_RX | **D** | 40 | `AA DD 0C 40 00 00` | may not arrive; USB re-enumerates | A `CmdRestartRx6118`; I `sendRestartRxDevice` @0x10008b1f4 |
| 0x3F | REMOVE_PAIRING | **X** | 40 | `AA DD 3F 40 00 01 0N` (N 1 = TX1, 2 = TX2) | set-ack | A `CmdDeletePair6118` (coerceIn 1..2), `C6118PairDeviceViewModel` |
| 0x40 | FACTORY_RESET | **X** | 40 | `AA DD 40 40 00 00` | set-ack | A `CmdFactoryReset6118`. R "Factory reset will erase some data." |
| 0x09 | OTA_TX_ENTER | **O** | 41/42 | `AA DD 09 4t 00 01 ID` (Android, 1-byte devId); iOS sends the whole 0x08 payload | b0 == 1 | §10.2 |
| 0x0D | OTA_RX_ENTER | **O** | 40 | `AA DD 0D 40 00 00` | b0 == 1 | §10.2 |
| 0x0E | OTA_PACKET_ACK | notify | – | – | Android `[ok, needCount BE16]`; iOS reads b0 only | A `CmdOtaPacketAck6118`; I `messageForUpgradePacketResponse:` @0x1000d9e08 |
| 0x0B | OTA_RESULT | notify | – | – | b0 == 1 success | A `CmdOtaUpgradeResult6118` |

**set-ack** = reply with the same command, `payload[0] == 1` meaning success and anything else failure
(A `Base6118UsbCmd.parseSetResponse`). iOS also counts a reply with no payload as success
(`messageForConfigResponse:command:` @0x1000da000). The library reports that case as `{ ok: false, code: null }`
so the UI can decide.

There is **no** command for TX mute, per-TX gain, low-cut, or starting pairing (A §4 tail; I §6). On the A2 the TX
button toggles noise cancellation, not mute (L §11.7), so how a TX gets muted is open (§13).

---

## 8. Command catalog: Lark M2 (6301) / LARK M2S (6302)

The framing and IDs are the same (A `application/common/protocol/Protocol` `HIP_6501_*` constants, `usbmic/protocol/Pro_*`).
The target is RX unless noted.

| Cmd | Name | M2 | M2S | Request payload | Reply | Source |
|---|---|---|---|---|---|---|
| 0x10 | heartbeat | 3 s | 1 s | – | §6.2 | `Pro_get_heart` |
| 0x03 | version (RX/TX) | ✅ | ✅ | – | decimals joined with `.` (`"2.0.0.31"`) | `Pro_get_version` |
| 0x15 | serial (RX/TX) | ✅ | ✅ | – | whole payload as UTF-8, no NUL cut, no trim (Android); iOS also deletes every U+0000, and so does the library | `Pro_get_sn`; I `messageForDeviceSN:` @0x1000da26c |
| 0x08 | device ID | OTA | OTA | `[t]` | b0 | `Pro_get_devid` |
| 0x11 | noise get | ✅ | ✅ | – | signed b0: 0 off / 1 low / 2 strong | `Pro_get_noise` |
| 0x06 | noise set | ✅ | ✅ | `[1 = low \| 2 = strong]` | `[status, level]`; a 1-byte reply is a **failure** (`setStatus` defaults to false) | `Pro_set_noise.receiveData`, `UsbMessengerV1.onEvent` cmd 6 |
| 0x19 | noise toggle | ⚙ fw > 2.0.0.31 and last part ≥ 32 (§4.1) | ✅ | `[02]` | status | `Pro_set_noise_status`; I `applyRXVersionCapabilities:` |
| 0x04 / 0x05 | volume get / set | ✅ | ✅ | `[0..5]` (Android); iOS sends only `0..2` | b0 / status | `Pro_get_voice`, `Pro_set_voice`, `DeviceCompat.getVoiceLevels`; I `HLLarkM2View voiceView` @0x1000cf8c4 (3 buttons, `actionWithCommand:5` with the 0-based button tag @0x1000cfc14) |
| 0x13 / 0x12 | speaker get / set | ✅ | ✅ | `[0 on \| 1 off]` | `b0 == 0` → on / status (then 0x0C after 3 s) | `Pro_get_speaker`, `Pro_set_speaker` |
| 0x35 / 0x34 | volume lock get / set | ⚙ camera PID 8/33, fw > 2.0.0.31 | camera PID 1030 only | `[1 lock \| 0 unlock]` | 0x35: `b0 == 1` (Android reads it at start-up on every M2/M2S PID; iOS never sends 0x35). 0x34: M2S set-ack `b0 == 1`; Lark M2: Android set-ack, iOS the new lock state `b0 != 0`, so the library accepts `b0 == 1` or `b0 ==` requested state | `Pro_get_voice_lock`, `Pro_set_voice_lock`; I `messageForVoiceLockStatus:` @0x1000da44c (`cmp x22,#7`) |
| 0x18 | channel mode | – | ✅ | `[0 mono \| 1 stereo]` | status | `Pro_set_voice_mode` |
| 0x36 | auto-off | – | ✅ | `[0 = 15 min \| 1 = never]` | status | `Pro_set_shutdown_time` |
| 0x39 | LED | – | ⚙ fw > 2.0.0.9 | `[0 on \| 1 off]` | status | `Pro_set_light`; `HLDevice6302Activity.onResGetVersion` |
| 0x37 | custom button | – | ⚙ fw > 2.0.0.9 (iOS; Android always) | slot write `[slot 1\|2, function, keyOp, tx1Color, tx2Color]`; colour-only `[00 00 00 c1 c2]` with (c1, c2) = (1, 2) or (2, 1) | status | `Pro_set_btn_custom`, `usbmic/data/DeviceBtnCustom.BtnCustomBean.toByteArray`, `ui/custom/CustomFunctionActivity.sendData` / `sendColor` / `initView$lambda$5..8`. I `-[HLKeyFuncEntity getPaylodWithEntity]` @0x1000dad5c. See §9.1. |
| 0x38 | button colours | – | ⚙ with custom buttons | – | `[tx1Color, tx2Color]` | `Pro_get_btn_custom`; I `requestLightColor` @0x1000dea9c |
| 0x0C | restart RX ⚠ | ✅ | ✅ | – | – | `Pro_set_restart` |
| 0x09/0x0D/0x0E/0x0B | OTA ⚠ | ✅ | ✅ | as 6118 | as 6118 | `Pro_tx_upgrade`, `Pro_rx_upgrade`, `Pro_upload_device`, `Pro_upgrade_response` |

The 6118-only commands are 0x3A, 0x3B–0x3E, 0x3F, 0x40 and 0x41.

## 9. Enumerations (`commands.ts`)

| Enum | Values | Source |
|---|---|---|
| Noise level (6118) | 0 off, 1 Weak, 2 Medium, 3 Strong | `LegacyUsb6118CommandsKt` (`NOISE_LEVEL_STRONG = 3`), `DeviceConnectVariable.NoiseLevel` |
| Noise level (M2/M2S) | 0 off, 1 Low, 2 Strong | `Pro_get_noise` |
| Channel mode | 0 Mono, 1 Stereo, 2 Safety track (6118) | `C6118DeviceActivity.setupVoiceModeActions` |
| Voice preset | 0 Bright, 1 Low, 2 Balance | R `c6118_preset_btn1..3`, `DeviceConnectVariable.PRESET` |
| Button function (M2S) | 0 not set, 1 RX self-lock, 2 mute all TX, 3 mute this TX, 4 TX identify | `DeviceBtnCustom.BtnFunction` |
| Key operation (M2S) | 0 not set, 1 mobile-RX power ×2, 2 mobile-RX power ×3, 3 camera-RX power ×1, 4 camera-RX power ×2, 5 camera-RX NC ×2, 6 TX power ×2, 7 TX power ×3 | `DeviceBtnCustom.KeyOperation` (→ `BtnOperation` + `ClickOperation`) |
| Light colour (M2S) | 0 not set, 1 purple, 2 yellow | `DeviceBtnCustom.LightColor` |
| Inverted booleans | LED 0x39, speaker 0x12: **0 = on**. Auto-off 0x36: **0 = enabled**. | §7 |

### 9.1 M2S custom buttons (A `ui/custom/CustomFunctionActivity`, `usbmic/data/DeviceBtnCustom`)

- There are **two function slots** (1, 2), kept in `DeviceDataManager.optionSelectedList` and reported in heartbeat
  bytes 11/12. They are not TX units: the physical button is part of the key operation (mobile-RX power, camera-RX
  power, camera-RX NC, TX power).
- Functions and buttons per receiver (`CameraBtnFunction` / `MobileBtnFunction`, `adapter/CustomFunctionAdapter`):
  camera RX (1030) — RX self-lock and mute all on camera power / camera NC; mute this TX and TX identify also on TX
  power. Mobile RX (1029) — mute all on mobile power; mute this TX and TX identify on mobile power / TX power. RX
  self-lock does not exist on the mobile RX. (`BUTTON_FUNCTIONS` in `commands.ts`.)
- Slot choice (`sendData` / `addFunction`): the slot that already holds the function, else the first slot whose
  function is NOT_SET (`pickButtonSlot`). Switching a function on without choosing a key only edits the local list
  (`addFunction(…, NOT_SET)`, nothing is sent). Choosing "not set" sends `[slot, 0, 0, c1, c2]`, which frees the slot.
- Every slot write carries the current TX colours, which are 0 until the first `0x38` reply.
- Colours are shown only while TX identify is enabled (`clTxLightView`); picking one sends the colour-only write
  `37 [00 00 00 c1 c2]` with the complementary pair (purple, yellow) or (yellow, purple). `setButtonColors()`.
- The editor opens only with both TXs online and closes when one drops (§5.4).

---

## 10. Destructive, disruptive and OTA commands (documented only)

### 10.1 Effects

| Cmd | Effect | Library guard |
|---|---|---|
| 0x0C | Reboots the RX. USB disconnects and re-enumerates. | `restartRx({confirm:true})` + `allowDestructive` |
| 0x3F [1\|2] | Removes the TX1/TX2 pairing; the mic must be re-paired on the hardware (hold RX button 3 s / Mic 6 s, per I UI strings) | `removePairing(tx,{confirm:true})` + `allowDestructive` |
| 0x40 | Factory reset of the RX | `factoryReset({confirm:true})` + `allowDestructive` |
| 0x12 | Takes effect only after 0x0C | `setSpeakerPassthrough(on, {restart, confirm})` |
| 0x09 / 0x0D / 0x55 data | Enter bootloader and flash. Can brick the unit. | **not implemented** (see below). `Requests.otaTxEnter` / `otaRxEnter`, `encodeOtaDataPacket`, `parseOtaAck`, `parseOtaResult` are pure builders/parsers; `HollylandDevice` never sends them and `sendRaw` refuses them. |

### 10.2 OTA sequence (A `larkc1/c6118/data/firmware/C6118FirmwareUpgradeCoordinator`, `Legacy6118OtaProtocolBridge`, `larkc1/c6118/ui/setting/viewmodel/C6118FirmwareUpgradeViewModel(Kt)`; M2/M2S `HLDeviceActivity` / `Pro_upload_device`; I `HL6501UpgradeCoordinator`, `+[HL6501Messenger sendUpgradeDataWithIndex:name:]` @0x10008a63c)

1. Order: TX1, TX2, then RX. Each unit needs ≥ 10 % battery. Android pauses the heartbeat for the whole upgrade
   (`C6118OtaTrafficGate.open/close`, `C6118RuntimeSession.pauseHeartbeat` with a nested `pauseCount`).
2. `0x08` → devId. Android: request payload `[t]`, keeps the first reply byte (`CmdGetDeviceId6118` `take(1)`),
   timeout 5 s, 3 tries (`OTA_DEVICE_ID_TIMEOUT_MS = 5000`, `OTA_DEVICE_ID_RETRY_LIMIT = 3`). iOS: TX request payload
   `[type]`, RX request empty; the devId is the whole reply payload for a TX and empty for the RX
   (`messageForDeviceInfoID:` @0x1000d9abc).
3. TX: `0x09` dst 0x41/0x42 with the devId (Android 1 byte, iOS the whole blob, `sendEnterUpgradeToDevice:devid:`
   @0x10008aea4). RX: `0x0D` with an empty payload. Wait for `payload[0] == 1`.
4. Stop-and-wait over packet i = 0 … ⌈size/63⌉−1. Send `55 | fw[i·63 … i·63+62]`, zero padded (HID output report 0x55,
   `FileUtils.getDataWithIndex`, `OTA_PACKET_PAYLOAD_SIZE = 63`). Wait for `0x0E`:
   - Android: `[ok, needCount BE16]`; on failure resend packet `needCount` if it is in range, at most 3 tries
     (`OTA_PACKET_ACK_RETRY_LIMIT = 3`, `resolvePacketAckRetryIndex`, `handlePacketAckFailure`), then fail the unit.
   - iOS: reads only `payload[0]`; on 0 it resends the **same** index via `sendPkgWithRepeatCount:10`, otherwise the
     next index (`onUpgradePacketResponse:` @0x1000b7c48).
5. Wait for `0x0B`, where `payload[0] == 1` is success. The unit reboots. Wait 3 s before the next unit
   (`NEXT_DEVICE_DELAY_MS = 3000`). Firmware packages come from the cloud: `6118TX`, `6118RX`, `6118CAMRX`, `6302TX`, `6302RX`.

Why the library does not implement the upload: the two apps disagree on the ack semantics (needCount vs same-index
resend), the firmware images come from Hollyland's cloud API, a wrong packet can brick a unit, and on the development
Mac the acks cannot even be received (§2.4). The primitives above are enough to build it once a Linux/ChromeOS
capture of a real upgrade settles step 4.

---

## 11. Live captures (LARK A2, macOS, 2026-11-05)

All traffic below was **read-only**: GET commands (0x03, 0x04, 0x08, 0x10, 0x11, 0x13, 0x15, 0x16, 0x35, 0x38,
0x3C, 0x3E, 0x41), the same heartbeat in XOR, unpadded and 0x41-prefixed variants, HID GET_REPORT and
descriptor reads. Nothing that sets, pairs, resets, restarts or upgrades was sent.

The diagnostic tools are my own code in `scratchpad/protocol-triage/`: `hidraw.c` (IOKit), `usbseize.m` and
`cfgdesc.m` (IOUSBHost), `ea/list.m` (ExternalAccessory), `ioctr.py` (IORegistry counters).

### 11.1 Identity

```
$ npx tsx scripts/probe.ts list
DevSrvsID:4294988812  VID 0x3547 PID 0x0411 if 0 usagePage 0xc usage 0x1  Wireless Microphone -> LARK A2
DevSrvsID:4294988812  VID 0x3547 PID 0x0411 if 0 usagePage 0xb usage 0x1  Wireless Microphone -> LARK A2
DevSrvsID:4294988812  VID 0x3547 PID 0x0411 if 0 usagePage 0xff90 usage 0x1  Wireless Microphone -> LARK A2
DevSrvsID:4294988812  VID 0x3547 PID 0x0411 if 0 usagePage 0xff82 usage 0x1  Wireless Microphone -> LARK A2
```
USB configuration descriptor (IOUSBHostDevice, non-exclusive):
```
IF  num=0 alt=0 eps=2 class=03 sub=00 proto=00
  HID bcdHID=0110 country=0 nDesc=1 type=0x22 len=231
  EP addr=0x82 attr=0x03 maxp=64 interval=1
  EP addr=0x03 attr=0x03 maxp=64 interval=1
IF  num=1 alt=0 eps=0 class=01 sub=01 proto=00
IF  num=3 alt=0 eps=0 class=01 sub=02 proto=00
IF  num=3 alt=1 eps=1 class=01 sub=02 proto=00
  EP addr=0x81 attr=0x05 maxp=288 interval=1
IF  num=7 alt=0 eps=2 class=ff sub=f0 proto=00
  EP addr=0x83 attr=0x02 maxp=64 interval=9
  EP addr=0x02 attr=0x02 maxp=64 interval=9
```
IORegistry: `MaxInputReportSize = 64`, `MaxOutputReportSize = 64`, `MaxFeatureReportSize = 1`,
`ReportInterval = 1000`. Interface #7 has an `accessoryd` AppleUSBHostInterfaceUserClient.

### 11.2 Why replies never arrive on macOS

IOKit element dump (`IOHIDDeviceCopyMatchingElements`). Report-handler elements (type 5) exist only for the
declared IDs:
```
EL type=5 page=0x0 usage=0xffffffff rid=0x0  …  EL type=5 … rid=0x6  …  rid=0x7  …  rid=0x55  …  rid=0x41
```
IOHIDLibUserClient feeds `IOHIDDeviceRegisterInputReportCallback` through these elements, so a report starting
with 0xBB has nowhere to go. The HID driver's own counters still show the device answering. These are
`AppleUserUSBHostHIDDevice` → `DebugState`, read with `ioreg`:
```
before heartbeat  {"InputReportCount": 14, "SetReportCount": 7, …}
after  heartbeat  {"InputReportCount": 16, "SetReportCount": 8, "InputReportTime": 1850570000, "SetReportTime": 1853511000}
```
The `*Time` values count time since the last event. The IN reports arrived about 3 ms after the OUT report.
Opening with `kIOHIDOptionsTypeSeizeDevice` does not help: the counter rises, the callback stays silent.

Other things tried:
- `IOUSBHostInterface` with `IOUSBHostObjectInitOptionsDeviceSeize`, to read the interrupt pipe directly. It is
  refused (`Failed to create IOUSBHostInterface`, 0xE00002C9), so the HID driver keeps the interface.
  `DeviceCapture` needs root or an entitlement.
- HID GET_REPORT(Input, 0xBB / 0x41 / 0x55) after a heartbeat returns a 64-byte stub every time,
  `00 ff 00 00 … 00`. It is not the reply.

### 11.3 Probe runs (TX hex; RX = driver counter delta)

```
$ npx tsx scripts/probe.ts status --timeout 300
# Wireless Microphone [Shenzhen Hollyland Technology Co.,Ltd] VID 0x3547 PID 0x0411 serial RXSERIAL001B -> LARK A2 (family 6118), collection usagePage 0xff82
# platform darwin; transport receive capability: no
TX  aa dd 10 40 00 00 …(58×00)    HEARTBEAT -> RX
    macOS HID driver: +1 SetReport, +2 InputReport
    ! device answered (2 interrupt-IN report(s) reached the macOS HID driver) but IOHIDFamily dropped them: report id 0xBB is not declared in the descriptor
```
`info`, `settings` and `sweep` give the same result for every read-only command. Each one shows
`+1 SetReport, +2 InputReport` and no user-space report:

| TX (first 6+n bytes, 64 B padded) | Command | Driver IN reports |
|---|---|---|
| `aa dd 10 40 00 00` | HEARTBEAT | +2 |
| `aa dd 41 40 00 00` / `41 41` / `41 42` | VERSION_GET RX/TX1/TX2 | +2 each |
| `aa dd 03 40 00 00` / `03 41` / `03 42` | VERSION_LEGACY_GET | +2 each |
| `aa dd 15 40 00 00` / `15 41` / `15 42` | SERIAL_GET | +2 each |
| `aa dd 16 40 00 00` | DEVICE_INFO_GET (iOS-only command) | +2 |
| `aa dd 08 40 00 01 00` / `08 41 00 01 01` / `08 42 00 01 02` | DEVICE_ID_GET | +2 each |
| `aa dd 11 40 00 00`, `04`, `13`, `35`, `3c`, `3e` | noise / volume / speaker / lock / mic recognition / smart battery GET | +2 each |
| `aa dd 38 40 00 00` | BUTTON_COLORS_GET (M2S command) | +2 |
| `aa dd 10 41 00 00`, `aa dd 10 42 00 00` | heartbeat addressed to TX1/TX2 | +2 each |

Framing variants of the heartbeat:

| TX | Bytes written | Driver IN reports | Reading |
|---|---|---|---|
| `aa dd 10 40 00 00` + 58 × 00 (Android) | 64 | **+2** | normal |
| `aa dd 10 40 00 00 27` + 57 × 00 (iOS XOR inside padding) | 64 | **+2** | XOR ignored |
| `aa dd 10 40 00 00 27` (iOS, unpadded) | 7 | +1 | handled differently: pad! |
| `aa dd 10 40 00 00` (unpadded) | 6 | +1 | handled differently |
| `41 aa dd 10 40 00 00` + 57 × 00 (H2) | 64 | +1, nothing delivered on report 0x41 | H2 rejected |

Passive listen, nothing sent:
```
$ npx tsx scripts/probe.ts listen 3
listening 3 s (nothing is sent)…
0 input report(s) delivered to user space; macOS HID driver saw +0
```
Library end to end (`HollylandDevice.connect()` over node-hid):
```
$ npx tsx scripts/probe.ts device --timeout 300
TX  aa dd 10 40 00 00 …(58×00)    → RX HEARTBEAT
RX  -    timeout waiting for HEARTBEAT (300 ms) [timeout]
TX  aa dd 10 40 00 00 …(58×00)    → RX HEARTBEAT [retry 1]
RX  -    timeout waiting for HEARTBEAT (300 ms) [timeout]
{ "rx": "unavailable", … "product": "LARK A2" }
```
The raw guard refuses writes before opening the device:
```
$ npx tsx scripts/probe.ts raw "aa dd 05 40 00 01 02"
refused: VOLUME_SET (write) is not marked read-only. Re-run with --force only if you know exactly what it does.
$ npx tsx scripts/probe.ts raw "aa dd 40 40 00 00"
refused: FACTORY_RESET (destructive) is not marked read-only. …
$ npx tsx scripts/probe.ts raw "55 00 00"
refused: a packet that is not an AA DD request is not marked read-only. …
```

### 11.4 What could not be captured over HID

Through the macOS HID stack no reply payload bytes can be seen. §11.6 has replies captured with root libusb; for
everything else (set acks, M2/M2S, TX-addressed heartbeats, OTA) byte-level captures need a Linux or ChromeOS host
or a root libusb session:
```
npx tsx scripts/probe.ts sweep        # every read-only command, prints RX hex + decode
npx tsx scripts/probe.ts device       # library end-to-end
```
Then paste the output here.

### 11.5 ExternalAccessory on macOS

A Mac Catalyst probe app with `UISupportedExternalAccessoryProtocols = [com.hollyland.protocol]` reported:
```
IAPAppRegisterClient: registerWasSuccessful 0 … IAPDHasLaunched 0, IAP2DHasLaunched 0 … connectedAccessories count 0
```
The iOS transport is therefore not reachable from macOS either.

### 11.6 Read-only replies via root libusb (LARK A2, firmware 3.0.2.008, 2026-11-05)

Captured by another agent with root libusb, detaching the HID driver from interface 0 (interrupt IN `0x82`, OUT
`0x03`): `scratchpad/captures/a2-libusb-2026-11-05.txt`, regression test `src/lib/protocol/__tests__/live-capture.test.ts`.
One 64-byte zero-padded reply per request (not two), no unsolicited packets during a button press.

| Request | Reply (first 6+LEN bytes) | Reading |
|---|---|---|
| `aa dd 10 40 00 00` | `bb dd 10 80 00 10 01 01 5b 5c 00 00 00 05 00 00 00 00 00 00 04 00` | LEN 16; TX1/TX2 online 91 %/92 %, NC off, volume 5, mono, auto-off on, LED on, preset off/Balance, no flags |
| `aa dd 41 4t 00 00` (t = 0/1/2) | `bb dd 41 8t 00 06 03 00 02 00 00 08` | source byte **0x80/0x81/0x82**, `"3.0.2.008"`, exactly 6 bytes |
| `aa dd 15 4t 00 00` | `bb dd 15 8t 00 0b …` | 11 ASCII bytes, no NUL. RX `RXSERIAL001`, TX1 `TX1SERIAL01`, TX2 `TX2SERIAL01`; the USB iSerial is `RXSERIAL001B` (12 characters) |
| `aa dd 03 40 00 00` | `bb dd 03 80 00 04 03 00 02 08` | legacy version `3.0.2.8` / `3.0.2.008` (6118 formatter) |
| `aa dd 16 40 00 00` | `bb dd 16 80 00 09 00 00 00 06 01 01 5b 5c 00` | payload[0] = 0: not a camera RX; LEN 9 |
| `aa dd 11 40 00 00` | `bb dd 11 80 00 01 00` | 0: NC off in both readings (§7) |
| `04` / `13` / `3c` / `3e` / `35` | `05` / `00` / `01` / `00` / `00` | volume 5, speaker on, mic recognition on, smart battery off, unlocked |
| `aa dd 38 40 00 00` (M2S command) | `bb dd 38 80 00 02 00 00` | the A2 answers it with zeros |
| `41 aa dd 10 40 …` | none | report-0x41 prefix rejected |

### 11.7 Verified on hardware (LARK A2, firmware 3.0.2.008, macOS, Chrome, 2026-11-05)

The user tested Hollyland Web UI on the LARK A2 in two ways:

- first over WebHID (write-only, §2.4);
- then through the local bridge (`docs/BRIDGE.md`, root libusb as in §11.6), which shows the heartbeat live.

| What | Path | Observed | Consequence |
|---|---|---|---|
| WebHID writes on macOS | Chrome WebHID, write-only | `sendReport(0xAA, 63 B)` resolves. Indicator Light Switch (0x39) switched the mic LEDs. Channel Mode (0x18) Stereo/Mono changed the channels of the receiver's USB audio (seen in the level meters). | macOS send ✅ (§2.4). Open question 2 is answered for macOS. |
| Live state through the bridge | bridge | Full live readback: heartbeat, versions, serials and settings, the same as on a two-way transport. | Full control on macOS is possible, with the audio trade-off in the next row. |
| USB audio while the bridge runs | bridge | The receiver gives no USB audio while the bridge holds it. Audio returns after the bridge hands the device back. | On macOS, libusb's driver detach captures the **whole** device, the audio interfaces 1 and 3 included. This is expected and can't be avoided (`docs/BRIDGE.md`). |
| TX button press | bridge, heartbeat | Pressing the button on either transmitter **toggles noise cancellation**: body[6] flips between 0 and a level. The mute bits (body[15] bit0/1) stay 0. No IN report arrives except the polled replies. | On the A2 the button is an NC toggle, not mute (§5.3, §6.1, §7). NC is RX-global, so the button on either TX flips the same state. The UI follows on the next heartbeat. |
| Docking a TX | bridge, heartbeat | A TX put into the charging case goes **offline**: its online byte (body[0]/[1]) becomes 0. | The UI shows a docked mic as not connected. Whether the charging bits are ever set is open (§13). |
| NC off → on | bridge, heartbeat | Turning NC on **restores the last level used**. Weak, then off, then on gives Weak again; the same with Medium. The first enable in the session showed Medium (2). | The RX keeps the level while NC is off, when body[6] reads 0. After a toggle, take the level from the heartbeat and never assume one. Medium may be the factory default or a level stored earlier (§13). |
| Unsolicited packets | bridge | None. Every IN packet answered a request. Button presses and docking showed up only in the next heartbeat. | Agrees with §5.3 and §11.6. |

Not verified yet:

- set-ack bytes;
- TX-addressed heartbeats;
- the Lark M2, LARK M2S and LARK A2S;
- Chrome on Linux, ChromeOS and Windows.

---

## 12. Triage log

| # | Topic | Android | iOS | Resolution | Evidence |
|---|---|---|---|---|---|
| 1 | Which product is "LARK M2"? | 6301 = "Lark M2" (PIDs 7/8, 32/33); 6302 = "LARK M2S" (1029/1030) | `lark m2` → type 3 "Lark M2" ("Lark MIX" for Moma); `lark m2s` → type 7 "LARK M2S" (**"LARK M2" for Moma**) | The brief's "M2 = 6302" holds only for the Chinese Moma branding. Both 6301 and 6302 are supported, with names from strings.xml. | R `product_6301/6302`; A `Product.java`; I `getDeviceNameWithType:` @0x1003210e0 |
| 2 | Physical channel | HID interface #0, raw interrupt transfers | EA/iAP2 (interface #7) | Browser uses HID #0. #7 is held by accessoryd on macOS, and EA is unavailable there. | A `HlUsbManagerImpl.findSuitableInterface`; L §11.1, §11.5 |
| 3 | WebHID report-ID mapping | (H1) send ID 0xAA, receive ID 0xBB | (guess) report 0x41 | **H1**: `sendReport(0xAA, 63 B)`. H2 (0x41 prefix) gets 1 IN report and nothing on 0x41. | **live evidence** L §11.3 |
| 4 | Receiving on macOS | – | – | **Not possible.** IOHIDFamily drops undeclared input IDs. The library detects this (`rx: 'unavailable'`) and offers opt-in blind writes. | **live evidence** L §11.2 |
| 5 | Checksum | none (XOR post-builder unused) | XOR appended | Off by default (Android bytes). Optional `appendXor`. Device answers both. | A `Protocol6118Provider.buildPacket`; I `getOrData:` @0x10027a6f8; **live evidence** L §11.3 |
| 6 | Packet length | always 64 | 6+LEN+1 over the EA stream | **Always pad to 64 on HID.** Unpadded writes are handled differently. | **live evidence** L §11.3 |
| 7 | Reply header | `BB DD` checked | 2 bytes stripped unchecked; unused `resHeaderData = BB DD` | `BB DD` required | A `LegacyUsb6118ProtocolCodec.isValidPacket`; I @0x1001272f0 |
| 8 | Reply source byte | 0x81 → TX1, 0x82 → TX2, else RX | 0x00 → 5, 0x01 → RX, 0x02/0x03 → TX1/TX2, 0x04/0x05 → TX3/TX4 | **Revised (#41):** Android mapping; unknown bytes fall back to the requested unit | A `mapResponseDeviceType`; I @0x10027a898; L §11.6 |
| 9 | Heartbeat offsets | body[i] = frame[6+i] | offsets after the 2-byte strip | Same layout: iOS off k = body[k−4] (table §6.1) | A `CmdGetHeart6118`; I `HLHeartEntity` @0x1001fa17c |
| 10 | LED polarity in the heartbeat | body[13] == 0 → on | doc said "≠ 0 means on" | **0 = on.** iOS code inverts it too: `setLightEnabled:(lightStatus ^ 1)`. | I @0x1000bc610–0x1000bc61c, @0x100358264–0x100358270 (primary re-read) |
| 11 | Meaning of 0x3A | BEAUTY_VOICE_SET `[enable, preset]` = "Bel canto preset" | doc said "6118 noise switch + level" | **Voice preset.** The iOS closures read `eqMode`/`eqSwitch`/`selectIndex`, not noise. Noise on/off is 0x19 in both apps. | A `CmdSetBeautyVoice6118`; R `c6118_preset_*`; I @0x100669f60, @0x10066a298 (primary re-read) |
| 12 | Heartbeat byte 14 | beauty preset bit0/bits1–7 | eqSwitch/eqMode | Same field | as #11 |
| 13 | Heartbeat interval | 1 s (A2, M2S), 3 s (M2) | 3 s | Per product, Android values; configurable | A `C6118RuntimeSession.HEART_BEAT_INTERVAL_MS = 1000`, `HLDevice6302Activity` 1000 ms, `HLDeviceActivity` 3000 ms; I @0x1002c4230 |
| 14 | Version command on 6118 | 0x41 (0x03 decoder registered) | 0x41 when `isConnect6118Device` | 0x41. The A2 also answers 0x03 (content unknown). | A `UsbMessenger6118.getDeviceVersion`; I @0x10008af00; L §11.3 |
| 15 | 0x16 device info | not used | sent at start, payload[0] == 2 → camera RX | **Revised (#50):** read at connect and stored; the PID stays the variant source | I @0x10008ac88, @0x1000bd910; L §11.6 |
| 16 | 0x08 request payload | `[t]` always | empty for RX, `[type]` for TX | Android form | A `CmdGetDeviceId6118.encodeLegacyPayload`; I @0x10008b11c |
| 17 | Set-ack without payload | failure | success if reply < 5 bytes | `{ok:false, code:null}`, flagged | A `parseSetResponse`; I @0x1000da000 |
| 18 | Volume range | 0–5 (1041), 0–2 (1042), M2/M2S 0–5 | 6118 same; M2/M2S 0–2 | **See #33** | A `homeRxVolumeStepCount`, `DeviceCompat.getVoiceLevels` |
| 19 | 0x19 semantics | always `[02]`, toggle | always `[02]`, `isOn` dropped | Toggle. Sent only when the heartbeat state differs, never retried, never blind. | A `CmdSetNoiseSwitch6118`; I codec @0x10011b9fc |
| 20 | 0x11 reply encoding | 6118: bit7 enable + level; M2: signed level | raw payload[0] | **Revised (#48):** M2 as Android; 6118 unresolved, state from the heartbeat | A `CmdGetNoiseLevel6118`, `Pro_get_noise` |
| 21 | Queue and ack behaviour | fire-and-forget, dedupe pending same-ID | fire-and-forget + 20 ms sleep | Wait for the echoed reply (timeout), coalesce pending setters, 20 ms gap | A `UsbCommandQueue`; I @0x1001239cc |
| 22 | Unsolicited reports | none (OTA acks only) | 0x0A/0x0F ignored | Strictly polled | A `C6118RuntimeSession`; I parser jump table; **live evidence**: listen → +0 |
| 23 | Duplicate IN reports | – | – | 2 IN reports per 64-byte request: tolerate duplicates and extras | **live evidence** L §11.3 |
| 24 | Interface #0 OUT endpoint | required | – | Present: `0x03` interrupt OUT 64 B | **live evidence** L §11.1 |
| 25 | Report 0x55 direction | IN + OUT (OTA writes) | "input-only" | Both declared: IN 63 B, OUT 63 B (Constant flag) | descriptor offsets 179/192; IOKit elements L §11.2 |
| 26 | Custom buttons 0x37/0x38 | M2S only | `HLKeyFuncController` | M2S only; firmware-gated (#35); slot semantics (#36) | A `HLDevice6302Activity`, `DeviceBtnCustom` |
| 27 | M2 heartbeat body[15] | not parsed | parsed for every device, applied only on 6118 | **Superseded by #47:** not decoded | I `HLHeartEntity`, `handleHeartbeatEntity:` @0x1000bc628 |
| 28 | Speaker restart | 0x0C 3 s after a successful 0x12 | – | Explicit `restart` + `confirm` | A `MoreSetting6118ViewModel.startSpeakerRestartCountdown` |
| 29 | Serial decoding | ASCII to NUL, trimmed (6118); UTF-8 (M2) | UTF-8 of LEN bytes | **Revised (#44):** per family | A `asciiString`, `Pro_get_sn` |
| 30 | Battery units | percent | "presumably %" | Percent | A `C6118DeviceActivity.updateBatteryView` |
| 31 | Channel mode 2 | Safety track (6118) | "SafeTr" string `hl_safe` | 0/1/2 on 6118, 0/1 on M2S | A `setupVoiceModeActions`; I Localizable `hl_safe` |
| 32 | Smart battery on the A2S | shown only for PID 1041; the 0x3E GET is sent anyway | – | **Confirmed, fixed:** `CAPS_6118_CAMERA.smartBattery = false`; setter and connect-time GET only on 1041 | A `MoreSetting6118ActivityKt.shouldShowSmartBatteryItem` (`i == 1041`), `MoreSetting6118Activity.initView`, `MoreSetting6118ViewModel.onStart` (`getSmartBattery()`) |
| 33 | M2/M2S volume steps | 6 buttons, tags 0..5 (`getVoiceLevels`; `voice_1..voice_6`; `voiceViewGroup` visible for non-6108) | 3 buttons "1/2/3", value = 0-based tag 0..2; heartbeat shown with `setSelectedIndex:` | **Conflict, unresolved.** Kept Android's 0..5 (HID reference, superset; 0..2 is common to both). Needs a hardware test: does 0x05 accept 3..5 on M2/M2S, and what does the heartbeat report? | A `DeviceCompat.getVoiceLevels`, `HLDevice6302Activity.initVoiceGroup`, R `activity_hldevice_6302.xml`; I `-[HLLarkM2View voiceView]` @0x1000cf8c4 (count 3 @0x1000cf958, CFStrings "1"/"2"/"3" @0x100cbaf08/@0x100cc07c8/@0x100cc07e8), block @0x1000cfa40 → `actionWithCommand:5` @0x1000cfc14, `-[HLButtonView setTitleArray:]` @0x100269544 |
| 34 | Volume lock availability | M2S: `voiceLock`/`dividerLine` visible only for 1030. M2: shown, written and read from the heartbeat only when `isNew6301Camera` (PID 8/33, fw > 2.0.0.31) or 1030 | `isCameraDevice` → `setShowVoiceLock:` on M2 and M2S, no version check; never sends 0x35 | **Confirmed, fixed:** camera only — `CAPS_6302_CAMERA`, `CAPS_6301_CAMERA` with the Android version gate (intersection). Mobile PIDs have `voiceLock: false`. 0x35 is still read at connect on every M2/M2S PID, as Android does | A `HLDevice6302Activity.initView`, `HLDeviceActivity.setVoiceLockVisibility` / `onEvent` cmd 3 and 16; I `handleDeviceInfoPayload:` @0x1000bcb54, `handleVoiceLockStatusEvent:` @0x1000bd2e8, jump table 0x35 → @0x1000d9888 |
| 35 | Firmware gates only in comments | M2 NC switch: `isNew6301CameraOrMobile` (PID 7/8/32/33, `isNewVersion(rx, "2.0.0.31")`), else level buttons always shown. M2S LED: `isNewVersion(rx, "2.0.0.9")`. M2S custom buttons: always shown | M2 NC switch: last version part ≥ 32. M2S: always NC switch; LED + custom keys (`showKeyFunc`) only above 2.0.0.9 (`NSNumericSearch`) | **Confirmed, fixed:** `capabilities.firmwareGates` + `resolveFeatures` → `state.features` / `featureGates`; setters use features; unknown version = unavailable; intersection where the apps differ (§4.1). `ignoreFirmwareGates` opts out | A `HLDeviceActivity.setNoiseLevelStrong`, `HLDevice6302Activity.onResGetVersion`, `application/httpcommon/utils/Util.isNewVersion`; I `applyRXVersionCapabilities:toState:` @0x1000bd78c, `-[HLLarkM2View setShowKeyFunc:]` @0x1000cd0dc |
| 36 | 0x37 byte 0 and colour writes | byte 0 = function slot 1/2 (heartbeat 11/12); colour-only write `[0,0,0,c1,c2]` with (1,2)/(2,1); slot = the one holding the function, else first empty | `HLKeyFuncEntity` | **Confirmed, fixed:** `buttonCustomSet` accepts slot 0 (colour-only, validated), `buttonColorSet`, `setButtonColors()`, `pickButtonSlot`, `BUTTON_FUNCTIONS`, `KEY_OPERATIONS`; spec §6.2/§9.1 | A `CustomFunctionActivity.sendColor/sendData/addFunction/decFunction/initView$lambda$5..8`, `Pro_get_heart.receiveData`, `DeviceDataManager.optionSelectedList`, `DeviceBtnCustom` |
| 37 | Custom buttons need fw > 2.0.0.9? | entry visible on every 6302 (`ctBtnCustom` shown at init, only the LED row waits) | gated with the LED | **Android claim confirmed, but iOS gates it;** resolved by #35 (gated) | A `HLDevice6302Activity.initView` / `onResGetVersion`; I @0x1000bd8c4 |
| 38 | When is a version "missing"? | 6118: blank or digits join to 0 (`"0.0.0.000"` too), separate 4-try budgets for version and serial; M2: re-send on `"0.0.0.0"` | `"0.0.0.0"` or `"0.0.0.000"` → re-query after 1 s | **Confirmed, fixed:** `isVersionMissing`; `fetchIdentity` with separate budgets and `identityRetryDelayMs` (1 s); missing versions are never stored. Not copied: Android's int overflow (joined digits > 2³¹−1 also count as missing) | A `C6118DeviceRuntimeManager.isVersionMissing/shouldRequestVersion/shouldRequestText`, `C6118FirmwareUpgradeCoordinator.toVersionInt`, `HLDeviceActivity.onEvent` cmd 3; I `handleDeviceVersionEntity:` @0x1000bc6ec (CFStr "0.0.0.0"/"0.0.0.000", 1 s `dispatch_after`) |
| 39 | 0x06 reply on M2/M2S | needs ≥ 2 bytes, else failure | – | **Confirmed, fixed:** `write()` decodes 0x06 with `parseNoiseSetM2` on M2/M2S | A `Pro_set_noise.receiveData`, `UsbMessengerV1.onEvent` (cmd 6) |
| 40 | M2 heartbeat volume / lock | volume only for `productId >= 8`; lock only for `isNew6301Camera` / 1030; M2S applies both always | volume and lock applied for every deviceType ≥ 3 | **Conflict, resolved for Android** (an explicit PID test is stronger evidence than a generic path): PID 7 volume comes from 0x04; 6301 lock only with the feature; 6302 always | A `HLDeviceActivity.onEvent` cmd 16, `HLDevice6302Activity.onResHeartInfo`; I `handleHeartbeatEntity:` @0x1000bc474–0x1000bc50c |
| 41 | Reply source mapping | 0x81/0x82 only, everything else RX | 0x02/0x03 → TX1/TX2, 0x00 → 5, 0x04/0x05 → 3/4 | **Confirmed both claims; resolved for Android:** the live A2 replies 0x80/0x81/0x82. `DecodedFrame.sourceKnown`; a reply with an unknown source byte is attributed to the requested unit | A `LegacyUsb6118ProtocolCodec.mapResponseDeviceType`, `Protocol.parse`; I @0x10027a898; L §11.6 |
| 42 | `getUsbConfig` citation | `reportId = 0` literal is replaced by the default 773 (mask 1020); report ID used only on CONTROL | – | **Confirmed, spec fixed (§2.3);** conclusion unchanged | A `Protocol6118Provider.getUsbConfig`, `UsbCommandInfo` synthetic ctor, `HlUsbManagerImpl` controlTransfer |
| 43 | Reassembly "copies Android" | no resync: non-`BB DD` chunk = complete (rejected), `BB DD` chunk concatenated to 6+LEN | – | **Confirmed, fixed:** packet mode is now Android-faithful; stream mode documented as a library extension (§3.4) | A `Protocol6118Provider.checkDataComplete`, `DefaultPacketProcessor.processReceivedData` |
| 44 | Serial decoding | 6118 `asciiString` (to NUL, US-ASCII → U+FFFD, trim); M2 whole payload UTF-8 | UTF-8 of LEN bytes, every U+0000 removed, no trim | **Confirmed, fixed:** `parseSerial(p, family)`: 6118 = Android; M2/M2S = UTF-8 with NULs removed | A `LegacyUsb6118CommandsKt.asciiString`, `Pro_get_sn.receiveData`; I `messageForDeviceSN:` @0x1000da26c |
| 45 | Coalescing attribution | cancels any PENDING item with the same command byte (any target, reads too); M2 path never (random names) | – | **Confirmed, spec fixed (§5.2):** the library's narrower policy is its own | A `UsbCommandQueue.enqueueCommand`, `Command6118Usb` value, `USBHIDService.onEventMainThread(USBDataSendEvent)` |
| 46 | Setter preconditions | TX online, all-muted, LED for mic recognition, NC on for levels, lock for volume, both TXs for custom buttons | TX online, mic muted, NC on (M2) | **Confirmed, fixed:** `PreconditionError` (§5.4), `enforcePreconditions` (default on, only with a heartbeat) | see §5.4 |
| 47 | M2/M2S TX mute / charging | Pro_get_heart stops at body[12] | parsed, applied only when `isConnect6118Device`; `HLLarkM2View` never reads them | **Confirmed, fixed:** no mute/charge on M2/M2S (`muted`/`charging` undefined) | I `handleHeartbeatEntity:` @0x1000bc620–0x1000bc6cc |
| 48 | 0x11 on the 6118 | bit7 = enabled + level (decoder unused by the A2 UI) | raw = level, switch = raw > 0 | **Conflict confirmed, unresolved:** only `00` captured (both agree). `getNoiseLevel()` on 6118 uses the heartbeat; `parseNoiseLevelGet6118` returns both readings + `agree`; `getNoiseLevelRaw()` for diagnostics | A `CmdGetNoiseLevel6118`; I `messageForNoiseLevel:` @0x1000d9eb0, block @0x1000bd034; L §11.6 |
| 49 | 0x34 reply | set-ack `data[0] == 1` (both families, toast on failure) | M2S: ack; Lark M2: new lock state | **Confirmed, resolved:** M2S ack; Lark M2 ok if `b0 == 1` or equals the requested state (`parseVoiceLockSetReply`) | A `Pro_set_voice_lock`, `HLDeviceActivity.onEvent` cmd 52; I `messageForVoiceLockStatus:` @0x1000da44c |
| 50 | 0x16 at connect | – | sent at start; A2 → type 9 on camera; M2/M2S camera UI | **Confirmed, fixed:** read at connect (`rxVariant`, `rxCameraByDeviceInfo`); Lark M2 rule LEN > 8 implemented. The PID remains authoritative over USB | I `getDeviceInitialInfo` block @0x10008ac88, `resolveDeviceHeaderImageWithPayload:` @0x1000bd910 (@0x1000bd9f4–0x1000bda1c) |
| 51 | 0x41 length | ≥ 6, first 6 used | exactly 6 | **Confirmed; kept Android** — the A2 sends exactly 6 | A `formatSixByteDeviceVersion`; I `getNewVersionWithData:` @0x1001fd054; L §11.6 |
| 52 | 0x3C / 0x3E "on" | `== 1` | `!= 0` | **Confirmed; kept Android** — differ only for values ≥ 2, never observed (live `01`/`00`) | A `CmdGetTxIdentify6118`, `CmdGetSmartBattery6118`; I @0x1000da68c, @0x1000da734 |
| 53 | 6118 heartbeat validation | missing bytes = 0 | noise < 4; volume/vocal/shut −1 if LEN < 8; keys + LED need LEN > 9 | **Confirmed, fixed:** `Heartbeat6118.valid`; only present/valid fields are applied (stricter than both) | I @0x1001fa5ac–0x1001fa5c4, @0x1000bafac, @0x1000bc5d0 |
| 54 | 6118 heartbeat body[8] | ignored | `volumeLocked` for every type ≥ 3, A2 included; no A2 view | **Confirmed, spec fixed;** exposed as `lockByte`, not applied | I @0x1000bc474, @0x1001fa414–0x1001fa444 |
| 55 | Protect window | heartbeat applied at once | 1 s from dispatch, 0x05/0x06/0x19 only, volume/noise only, cleared on failure | **Confirmed, fixed:** aligned with iOS (§5.2) | I @0x1000bafb8, @0x1000bc4bc, @0x1000bcd24 |
| 56 | 0x06 while NC is off | levels hidden / toast | toast, no send | **Confirmed, fixed:** `noise-off` precondition. Open question 4 now only asks what the firmware would do | §5.4 |
| 57 | Writes with no TX online | refused | refused (toast) | **Confirmed, fixed:** `mic-disconnected` precondition | §5.4 |
| 58 | 0x19 reply | 6118 `parseSetResponse` → rollback on failure | always "设置成功"; flag only clears the protect window | **Confirmed, resolved:** result = heartbeat after the toggle; `code` = ack byte | I `handleConfigResponseEvent:` @0x1000bcc48 (CFStr @0x100cbb3a8) |
| 59 | OTA details | `[ok, needCount]`, resend needCount ≤ 3×; 0x09 `[devId]` 1 byte | b0 only, resend same index ×10; 0x09 = whole devId blob; RX devId empty | **Confirmed, documented (§10.2);** builders/parsers for both forms; upload not implemented (rationale in §10.2) | A `CmdOtaPacketAck6118`, `C6118FirmwareUpgradeViewModel.handlePacketAckFailure`, `CmdGetDeviceId6118`; I @0x1000d9e08, @0x1000b7c48, @0x1000d9abc, @0x10008aea4 |
| 60 | Confirming re-reads | 0x3E 150 ms after every 0x3D; 0x13 150 ms after a **failed** 0x12 only | – | **Partly confirmed** (the speaker re-read is only after a failure), implemented | A `MoreSetting6118ViewModel.scheduleSmartBatteryRefresh`, `scheduleAutoSpeakerRefresh`, `handleSpeakerSettingResponse` |
| 61 | Session rebuild after factory reset | `startFactoryResetRuntimeRecovery` (shutdown, 1 s, `ensureSessionActive`) | – | **Partly refuted:** the method has no call site in 3.1.0 (`handleFactoryResetResponse` only updates the UI). Implemented anyway as a read-only refresh 1 s after a successful reset | A `MoreSetting6118ViewModel` |
| 62 | Heartbeat pause during OTA | nested `pauseCount`, `C6118OtaTrafficGate` | – | **Confirmed:** `pauseHeartbeat`/`resumeHeartbeat` now nest; nothing ties them to OTA because OTA is not implemented | A `C6118RuntimeSession.pauseHeartbeat/resumeHeartbeat`, `C6118OtaTrafficGate` |
| 63 | A2 TX button | mute shown read-only; no A2 mute command | – | **Live (L §11.7):** the button toggles NC (heartbeat body[6]); the mute bits stay 0. Mute stays read-only in the UI, and the UI says the button toggles NC | L §11.7 |
| 64 | NC level after switching on | – | – | **Live:** the RX restores the last level used; the first enable in the session showed Medium | L §11.7 |
| 65 | Docked TX | – | – | **Live:** online byte 0 (offline), not "charging" | L §11.7 |
| 66 | WebHID writes on macOS | – | – | **Live:** `sendReport(0xAA, 63 B)` resolves and the setting is applied (LED, channel mode). Closes open question 2 for macOS | L §11.7 |

---

## 13. Open questions and next live tests

1. **Replies that are still unseen.** §11.6 covers the A2's read-only replies. Still needed (Linux/ChromeOS or root
   libusb): set acks, TX-addressed heartbeats, the second IN report the macOS driver counts, and everything on
   M2/M2S. `probe.ts sweep` / `probe.ts device` print them. On macOS the local bridge can capture them too
   (`npm run bridge -- --verbose` prints every packet).
2. **Chrome WebHID:** answered for macOS (§11.7). `sendReport(0xAA, 63 B)` resolves and the writes take effect.
   Still open: Windows. Do writes work there too, and are the replies dropped as expected?
3. M2 / M2S HID descriptors: do they use report IDs at all? If not, receiving may work on macOS too.
4. Does `0x06 [level]` turn NC on when it is off, or only change the stored level? Both apps refuse to send it
   while NC is off (§5.4), so only a firmware test can tell. §11.7 shows that the RX keeps the level while NC is off;
   this question asks whether 0x06 also switches NC on.
5. Meaning of heartbeat bytes 4–5, 8 and 11–12 on the 6118 (all 0 on the live A2), anything past byte 16, and
   0x16 payload bytes 1–8 (`00 00 06 01 01 5b 5c 00`; 5b/5c equal the TX batteries in the same session).
6. Why the RX 0x15 serial (`RXSERIAL001`) is one character shorter than the USB iSerial (`RXSERIAL001B`).
7. **M2/M2S volume range (#33):** does 0x05 accept 3..5, and what does heartbeat byte 7 report after it? Is the
   step a linear dB scale?
8. **0x11 on the 6118 with NC on (#48):** bit7 + level (Android) or raw level (iOS)? Turn NC on on the device and read it.
   This is now testable on macOS through the bridge.
9. **0x34 reply on the Lark M2 (#49):** ack or new state after an unlock?
10. Do 0x0C and 0x40 send their ack before the RX drops off USB?
11. Which commands does the 6118 accept when addressed to TX1/TX2, beyond version, serial, device ID and OTA?
12. OTA ack semantics on real hardware (needCount vs same-index resend, §10.2).
13. **What sets the A2 mute bits** (heartbeat body[15] bit0/1)? A short press of the TX button toggles NC instead
    (§11.7). A double or long press, or a mic setting? Not seen yet.
14. **A2 charging bits** (body[15] bit2/3): a docked TX reports offline (§11.7). Are the bits set while a TX that is
    switched on charges by cable, or never?
15. **NC level default and persistence:** the first enable showed Medium (§11.7). Is that the factory default, or a
    level stored before the session? Does the stored level survive a power cycle of the RX?

---

## 14. Implementation map

| File | Contents |
|---|---|
| `src/lib/protocol/transport.ts` | `Transport` interface (`open/close/send/onPacket/onDisconnect`, `capabilities.receive`), `BaseTransport` |
| `src/lib/protocol/webhid.ts` | `WebHidTransport` (`request()`, `reconnect()`, `getGrantedDevices()`, `onDeviceConnect()`), `defaultFilters()`, framing modes |
| `src/lib/protocol/codec.ts` | `encodeRequest`, `decodeFrame` (`sourceKnown`), `xorChecksum`, `FrameAssembler` (Android packet mode, stream extension), address mapping, hex helpers, `encodeOtaDataPacket` (builder only) |
| `src/lib/protocol/commands.ts` | `Cmd`, `COMMANDS` (safety, families, targets, sources), `Requests.*` builders (incl. `buttonColorSet`, `otaTxEnter`, `otaRxEnter`), all parsers (per family: `parseSerial`, `parseDeviceInfo`, `parseVoiceLockSetReply`, `parseNoiseSetM2`), version helpers (`isVersionMissing`, `isNewerVersionAndroid/Ios`, `lastVersionComponent`), enums, custom-button tables (`BUTTON_FUNCTIONS`, `KEY_OPERATIONS`, `pickButtonSlot`), `describePayload` |
| `src/lib/protocol/models.ts` | product registry, per-PID capability matrix, `firmwareGates`, `resolveFeatures` (§4) |
| `src/lib/protocol/device.ts` | `HollylandDevice`: queue, correlation, timeouts/retries, heartbeat (nested pause), identity fetch, runtime `features`, typed getters and setters, `PreconditionError` (§5.4), protect window, read-backs, destructive gating, RX-unavailable mode, `onTraffic` |
| `src/lib/protocol/mock.ts` | `MockTransport`, `SimulatedReceiver` (firmware model for tests and for UI work without hardware) |
| `src/lib/protocol/bridge.ts` | `BridgeTransport` (WebSocket to the local USB bridge), `BridgeError`, wire types |
| `scripts/bridge.ts`, `scripts/bridge-server.ts` | Local USB bridge: root libusb capture of interface 0, WebSocket relay with Origin/Host checks (`docs/BRIDGE.md`) |
| `scripts/node-hid-transport.ts` | `NodeHidTransport`, `readDarwinHidCounters()` (macOS diagnostics) |
| `scripts/probe.ts` | read-only CLI: `list`, `info`, `status`, `battery`, `settings`, `sweep`, `device`, `listen`, `raw` |
