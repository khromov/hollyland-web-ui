# HollyAudio for Android 3.1.0: USB control protocol (LARK A2 / 6118, LARK M2 / 6301, LARK M2S / 6302)

Source: `com.hollyland.larkc1` 3.1.0, decompiled with jadx. Every claim below cites a file under
`jadx-out/sources/` (shortened to the path after `sources/`) and the method name. Resource strings come from
`jadx-res/resources/res/values/strings.xml`, and the manifest from `jadx-res/resources/AndroidManifest.xml`.
All of this is static analysis. Nothing was sent to the hardware. Anything marked **UNVERIFIED** has to be
checked on the device.

---

## 0. Key findings

* **Product naming.** The resources contradict the brief (`strings.xml`, plus `application/common/compatibility/DeviceCompat.getDeviceName`):
  | Family | USB PID(s) (decimal / hex) | UI name (strings.xml) |
  |---|---|---|
  | 6118 | 1041 / 0x0411 (`PRODUCT_6118`), 1042 / 0x0412 (`PRODUCT_6118_CAMERA`) | `product_6118` = **LARK A2**; `product_6118_camera` = **LARK A2S** (the camera-RX variant) |
  | 6301 | 7 / 0x0007 (mobile), 8 / 0x0008 (camera), 32/33 (EAGLESHERO OEM) | `product_6301` = **Lark M2** |
  | 6302 | 1029 / 0x0405 (mobile), 1030 / 0x0406 (camera) | `product_6302` = **LARK M2S** |
  | 6108 | 1031 / 0x0407 | **LARK A1** |
  | 6303 | 1036–1039 | **LARK M3** |
  | 6501/6502/… | 1, 11, 12, 13 | Lark C1 / Lark M1 / Lark Mini |
  | 6701 | 1026/1027 (+101 box) | LARK MAX 2 |
  | 6201 | 1032–1035, 1040, 772 | MELO P1 |

  (`application/common/protocol/Product.java`). This means **"LARK M2" is family 6301, and 6302 is the M2S.**
  The app runs 6301 and 6302 on the same legacy protocol, so this document covers both.
* **Transport (all three families).** Android claims the **first HID-class interface (class 3)** that has an interrupt
  endpoint, then does raw `UsbDeviceConnection.bulkTransfer()` on its **interrupt IN/OUT endpoints**. It sends no HID
  SET_REPORT/GET_REPORT, no handshake, no authentication, and never touches the iAP interface.
* **Framing (all three families).** A fixed **64-byte** packet with no checksum, no sequence number and no escaping:
  `AA DD <cmd> <dst> <lenHi> <lenLo> <payload…> 00…` toward the device and `BB DD <cmd> <src> <lenHi> <lenLo> <payload…>`
  back. `dst` is `0x40` RX, `0x41` TX1 or `0x42` TX2. `src` is `0x80` RX, `0x81` TX1 or `0x82` TX2. The length field is
  big-endian and counts only the payload bytes. **There is no CRC.** The 6118 provider declares an XOR "post builder",
  but its `buildPacket` override never calls it.
* **6118 and 6301/6302 share one command set.** Command bytes are the same (`0x10` heartbeat, `0x05` volume, `0x06`
  noise level, …). The 6118 adds `0x3A` (voice preset), `0x3B/0x3C` (mic identify), `0x3D/0x3E` (smart battery),
  `0x3F` (delete pairing), `0x40` (factory reset) and `0x41` (firmware version).
* **The session is polled.** There is no handshake. The app polls the heartbeat (`0x10`) every **1 s** (6118 and 6302)
  or every **3 s** (6301). Battery, connection, mute, charging and all settings come from the heartbeat. Version and
  serial number are fetched per RX/TX1/TX2 once each unit appears online. **Audio level meters are computed on the
  phone** from the USB audio stream, not reported by the device.
* **HID report IDs vs. Android bytes.** On the wire, the first byte of a control packet is `0xAA` and the first byte of
  a response is `0xBB`. Neither ID is declared in the descriptor. The firmware-upload data packet is `0x55` followed by
  63 bytes, which matches the declared **output report 0x55** exactly. So **report 0x55 (page 0xFF90) is the OTA data
  channel**. Report 0x41 (page 0xFF82) is declared as 63-byte in/out, but the Android app never puts `0x41` in byte 0.
  See §1.5 for what this means for WebHID.

---

## 1. Transport

### 1.1 Discovery and filtering
* The manifest has no `device_filter.xml` and no `USB_DEVICE_ATTACHED` intent filter on an activity. It only declares
  `<uses-permission android:name="android.permission.USB_PERMISSION"/>`, `<uses-feature android:name="android.hardware.usb.host"/>`
  and the foreground service `com.hollyland.usbmic.core.USBHIDService` (`AndroidManifest.xml`, lines 17, 32 and 529).
* Attach and detach are caught at runtime by a broadcast receiver on `android.hardware.usb.action.USB_DEVICE_ATTACHED`
  and `…_DETACHED` (`usb/core/AbstractUsbHidService.java` around line 425, and `AbstractUsbHidService$usbReceiver$1`).
* Device match predicate (`usbmic/core/USBHIDService.onServiceCreate$lambda$1` and `isSupportedUsbDevice`):
  * PIDs 1036–1039 (6303) are always accepted. PID 2 is always rejected.
  * Otherwise the VID must be `VENDOR_ID = 13639 (0x3547)`, or `17431 (0x4417)` for EAGLESHERO builds. There is also
    a manufacturer-string check against `"Hollyland"` / `"EAGLESHERO"`, but its branch is garbled in the decompile.
    The A2 matches on VID either way.
* Permission (`AbstractUsbHidService.requestPermission/requestPermissionInner`):
  `UsbManager.requestPermission(device, PendingIntent(ACTION "com.google.android.HID.action.USB_PERMISSION"))`, read back
  through `intent.getBooleanExtra("permission")`. It retries up to `DEFAULT_MAX_PERMISSION_RETRY = 3` times, with
  `DEFAULT_MAX_CONNECTION_RETRY = 3` connection retries and `DEFAULT_RETRY_DELAY_MS = 1000` between them.
* Product identification is the **USB PID only**: `HlDevice.INSTANCE.setProductId(device.getProductId())`
  (`larkc1/ui/connect/DeviceModelActivity.java:740`, `larkc1/BaseDeviceActivity.onCreate`). The PID selects both the
  UI screen and the protocol provider. The protocol has no model-identification command.

### 1.2 Interface and endpoint selection
`usb/core/HlUsbManagerImpl.findSuitableInterface` (line 802):
```java
UsbInterface usbInterface = androidDevice.getInterface(i);
if (usbInterface.getInterfaceClass() == 3) {                 // HID
    for (endpoints) {
        if (endpoint.getType() == 3 && endpoint.getDirection() == 128) usbEndpoint = endpoint;   // interrupt IN
        else if (endpoint.getType() == 3 && endpoint.getDirection() == 0) usbEndpoint2 = endpoint; // interrupt OUT
    }
    if (in != null || out != null) return Pair(usbInterface, Pair(in, out));
}
```
* The A2 uses **interface #0 (HID)**. `claimInterface(iface, forceClaim=true)` detaches the kernel HID driver
  (`HlUsbManagerImpl.connectAndroidDevice`, and `UsbConnectionConfig` with default `forceClaim = true`). The app never
  opens the audio interfaces (#1, #3) or the vendor "iAP Interface" (#7). `writeSizeListener` receives the OUT
  endpoint's `wMaxPacketSize` and defaults to 64.
* **Read loop** (`HlUsbManagerImpl$startDataReceiveLoop$1`, line 874): repeats
  `bulkTransfer(IN, buf, IN.maxPacketSize, 500 ms)` forever. Each chunk goes to `UsbPacketManager.processReceivedData`.
  6118 uses `DefaultPacketProcessor`, which concatenates chunks until `checkDataComplete` is true.
* **Write** (`HlUsbManagerImpl.executeBulkTransfer`, line 1320): `bulkTransfer(OUT, packet, packet.length, timeout)`.
  The packet is split at `maxPacketSize` (64 for 6118), and every 6118 packet is exactly 64 bytes, so one transfer
  per command.
* **Control transfers** (`executeControlTransfer`) are used only for **6108 / LARK A1** (PID 1031). That is SET_REPORT
  with `bmRequestType 0x21`, `bRequest 0x09`, `wValue 0x0305` (Feature, ID 5), 64 bytes, or `wValue 0x0306`, 160 bytes,
  during upgrade; and GET_REPORT with `0xA1`, `bRequest 0x01`
  (`application/common/manager/UsbHandlerManager`, `usbmic/core/USBHIDService.onEventMainThread(USBDataSendEvent)`).
  6118 and 6301/6302 never use them.

### 1.3 Which code path each product takes

| PID | UI activity (`larkc1/utils/OpenPageHelper.obtainUsbPageIntent`) | RX dispatch (`USBHIDService.onCmdDataReceive` / `isOldDevice`) | TX builder |
|---|---|---|---|
| 1041/1042 (A2/A2S) | `larkc1/c6118/ui/home/C6118DeviceActivity` | **not** "old": `HlUSBDataReceiveEvent` → `mic_usb/manager/MicUsbManager.parseResponse` → `MomaProtocol` → `protocol/core/sound/provider/Protocol6118Provider` | `mic_usb/messenger/UsbMessenger6118` → `MicUsbManager.buildSendData` → `Protocol6118Provider.buildPacket` → `LegacyUsb6118ProtocolCodec.buildPacket` |
| 7, 8, 32, 33 (Lark M2) | `larkc1/HLDeviceActivity` | "old": `USBDataReceiveEvent` → `usbmic/protocol/ProtocolFactory` | `usbmic/protocol/Pro_*` → `application/common/protocol/Protocol.getData()` |
| 1029/1030 (M2S) | `larkc1/HLDevice6302Activity` + `larkc1/viewmodel/HLDevice6302ViewModel` | "old" (same as above) | `usbmic/messenger/UsbMessengerV1` (chosen by `UsbMessengerFactory` because PID ≠ 1031) |
| 1031 (A1) | `HLDevice6302Activity` | "old", but parsed through `ProtocolFactoryV2` | `UsbMessengerV2` + `ProtocolV2` (**different framing**, out of scope) |

Every path ends in the same `HlUsbManagerImpl` interrupt-endpoint I/O (§1.2).

### 1.4 Transfer parameters
* 6118 provider config (`Protocol6118Provider.getUsbConfig`): `UsbCommandInfo(maxPacketSize=64, BULK, …defaults)`,
  where "BULK" means `bulkTransfer` on the interrupt endpoints. `cmdSingleStandardSize() = 6`, the header overhead.
  `Base6118UsbCmd.DEFAULT_PACKET_SIZE = 64` and `STANDARD_PACKET_OVERHEAD = 6`.
* Timeouts (`Protocol6118Provider.getCommandExecutionConfig` → `CommandExecutionConfig()` defaults): write timeout
  **200 ms**, read timeout 200 ms, and retryCount 3. The retry count is never used on the BULK path.
* Raw packets sent through `USBDataSendEvent` (all M2/M2S commands and every OTA data packet for every family) use a
  **250 ms** write timeout (3000 ms for 6108) and a 1000 ms read timeout (`USBHIDService.onEventMainThread(USBDataSendEvent)`).

### 1.5 HID reports on the A2 and what they mean for WebHID
The orchestrator decoded the descriptor. I re-checked it with `scratchpad/android-re/hiddesc.py`. One correction: report
**0x55 also declares a 63-byte OUTPUT report** (item `91 01` at offset 192, flagged Constant).

| Report ID | Usage page | Declared | How Android uses it |
|---|---|---|---|
| 0x06 | Consumer (0x0C) | 1-byte IN bitfield (vol+/−, mute, play/pause…) | Never read. It is the RX/TX button → host-OS media-key path. |
| 0x07 | Telephony (0x0B) | IN/OUT telephony (hook switch, mute, LEDs) | Never used |
| 0x55 | Vendor 0xFF90 | 63 B IN, 63 B OUT (Const) | **OTA data**: Android writes `0x55` + 63 firmware bytes, i.e. exactly output report 0x55 (`application/common/util/FileUtils.getDataWithIndex`, `USBHIDService.LEGACY_RAW_OTA_HEADER = 85`, `HlUsbManagerImpl.isLegacyRawOtaPacket`). The app never looks for an IN report 0x55. OTA acks come back as `BB DD 0E …`. |
| 0x41 | Vendor 0xFF82 | 63 B IN, 63 B OUT | Never addressed by ID. Android writes `AA DD …` as raw 64-byte interrupt-OUT transfers and requires responses whose raw bytes start `BB DD` (`ProtocolManagerImpl.parseResponse` → `Protocol6118Provider.isValidProtocolData` → `LegacyUsb6118ProtocolCodec.isValidPacket`). |

The control channel is therefore the **vendor interrupt pipe of interface 0**, using the "legacy" framing at byte 0.
This framing predates report IDs: the M2/M2S code builds the same bytes in `Protocol.getData()`. Read with HID
semantics, Android **sends report ID 0xAA** and **receives report ID 0xBB**. Neither is declared, so the declared
0x41 collection is not literally how Android talks to the device.

WebHID mapping, to verify on hardware:
1. **H1, most faithful to Android (UNVERIFIED):** `device.sendReport(0xAA, frame.subarray(1, 64))`, where `frame` is
   the 64-byte `AA DD …` packet. On macOS, Chromium passes `[reportId, …data]` to `IOHIDDeviceSetReport`, which writes
   it to the interrupt-OUT pipe unchanged, so the bytes on the wire match Android. Expect `inputreport` events with
   `reportId === 0xBB` and `data` holding the 63 bytes `DD cmd src lenHi lenLo payload…`. Reconstruct the frame as
   `[0xBB, ...data]`. Risks: Chromium may reject an undeclared report ID (protected-report or size checks), and
   macOS may drop IN reports whose ID it does not know.
2. **H2 (fallback):** `sendReport(0x41, frame.subarray(0, 63))`. This puts `41 AA DD …` on the wire and only works if
   the firmware strips a 0x41 prefix. The app gives no evidence for it.
3. **OTA data:** `sendReport(0x55, chunk63)` produces exactly what Android sends.
4. For a quick bench test, node-hid on macOS should behave like H1: `write([0xAA, 0xDD, …64 bytes])`, because hidapi
   treats `data[0]` as the report ID and passes the buffer through.

---

## 2. Framing (6118 legacy codec, identical to the 6301/6302 `Protocol` class)

### 2.1 Request (host → device), exactly 64 bytes
Code: `protocol/core/sound/command/device6118/LegacyUsb6118ProtocolCodec.buildPacket` (line 41):
```java
private static final byte[] requestHeader  = {-86, -35};                               // AA DD
private static final byte[] responseHeader = {ByteSourceJsonBootstrapper.UTF8_BOM_2 /*0xBB*/, -35}; // BB DD
private final int mapRequestDeviceType(int t) { if (t != 1) return t != 2 ? 64 : 66; return 65; } // 0x40/0x41/0x42
public final byte[] buildPacket(int commandByte, byte[] payload) {
    int deviceType = payload.length > 0 ? payload[0] & 255 : 0;           // first byte = logical target
    byte[] body = payload.length > 1 ? copyOfRange(payload, 1, payload.length) : new byte[0];
    byte[] p = new byte[64];                                               // zero-filled
    p[0]=0xAA; p[1]=0xDD; p[2]=(byte)commandByte; p[3]=(byte)mapRequestDeviceType(deviceType);
    p[4]=(byte)((body.length>>8)&255); p[5]=(byte)(body.length&255);       // big-endian body length
    copyInto(body, p, 6);  return p;
}
```
`Base6118UsbCmd.encodePayload` builds `payload = [coerceIn(resolveRequestDeviceType(),0,2)] + encodeLegacyPayload()`,
and `Protocol6118Provider.buildPacket` parses `commandName()` (`"0x%02X"`) back into `commandByte`.

| Offset | Size | Value |
|---|---|---|
| 0 | 1 | `0xAA` |
| 1 | 1 | `0xDD` |
| 2 | 1 | command ID (§4) |
| 3 | 1 | target: `0x40` RX (logical 0), `0x41` TX1 (1), `0x42` TX2 (2). Anything else is sent as `0x40`. |
| 4–5 | 2 | **body length, big-endian**. It counts only bytes 6…; the header is excluded. Maximum 58. |
| 6… | n | body |
| 6+n…63 | – | `0x00` padding |

The format has no checksum, no sequence or transaction ID, no escaping, and no end marker.
`Protocol6118Provider.createCommandPostBuilder()` declares `VerificationAlgorithm.XOR`, but that builder is only used
by the 6201/6303 providers. The 6118 `buildPacket` override bypasses it.

The 6301/6302 builder produces the same bytes (`application/common/protocol/Protocol.getData`, line 93): a 64-byte
buffer, `0xAA 0xDD`, `getCmd()`, then `0x40`/`0x41`/`0x42` for RX/TX1/TX2 (`0x00` for TX3/TX4/BOX), `intToByte2(len)`,
which is big-endian (`application/common/util/NumberUtil.intToByte2`), then the payload at offset 6.

### 2.2 Response (device → host)
`LegacyUsb6118ProtocolCodec.parseValidatedPacket / isValidPacket / isPacketComplete`:
```java
isValidPacket:   data.length >= 6 && data[0]==0xBB && data[1]==0xDD
resolvePayloadLength: ((data[4]&255)<<8) | (data[5]&255)
isPacketComplete: isValidPacket && data.length >= len + 6
parseValidatedPacket: cmd=data[2]&255; device=mapResponseDeviceType(data[3]&255) /*0x81→1, 0x82→2, else 0*/;
                      payload = data[6 .. min(6+len, data.length))
```
| Offset | Value |
|---|---|
| 0–1 | `BB DD` |
| 2 | command ID, echoing the request |
| 3 | source: `0x80` RX, `0x81` TX1, `0x82` TX2. This is how the app learns which unit a version or SN belongs to. |
| 4–5 | payload length, big-endian |
| 6… | payload ("body" in §4) |

Decoding dispatch (`Protocol6118Provider.parseResponse`): the executor is looked up by `"0x%02X"` of `data[2]`, then
called with `[logicalDevice] + payload`. Every `decodeLegacyPayload` uses `payloadBody()`, which drops that first byte,
so **"body[i]" in this document is `frame[6+i]`**.

The 6301/6302 parser (`Protocol.parse`, line 159) is looser. It **does not check `BB DD`**, it takes `cmd = data[2]`,
maps `0x80`/`0x81`/`0x82` to RX/TX1/TX2, and computes the length as `data[4]*16 + data[5]`. The ×16 is an app bug that
is harmless for lengths below 16. It returns false if `len > data.length - 6`.

### 2.3 Fragmentation and reassembly
Fragmentation never happens for 6118 control traffic, because every request and response fits in 64 bytes.
`Protocol6118Provider.checkDataComplete` reports a buffer complete when it does not start with `BB`, or when
`isPacketComplete` is true. `DefaultPacketProcessor` concatenates IN chunks until that holds.
`UsbPacketManager.splitData` cuts writes at `maxPacketSize`, but 6118 writes are already 64 bytes.

### 2.4 OTA data packet (raw; this is not an `AA DD` frame)
`application/common/util/FileUtils.getDataWithIndex(byte[] fw, int i)` (line 1239):
```java
byte[] p = new byte[64]; p[0] = 0x55;
for (j = 1..63) { k = (j-1) + i*63; if (k < fw.length) p[j] = fw[k]; }   // zero-padded last chunk
```
Packet count is `ceil(fileSize/63)` (`application/httpcommon/utils/FirmwareUpgrade.getPkgCount`). This matches HID
output report `0x55` with 63 data bytes. The legacy constants already name this byte:
`Protocol.HIP_6501_SET_DEVUPGRADE = 85` (0x55). They also define `HIP_6501_DEVWARNING = 10` (0x0A), but no class
implements it; the meaning is unknown and it could be device-initiated.

---

## 3. Session flow

### 3.1 6118 (LARK A2 / A2S)
1. Attach → permission → `connectAndroidDevice` claims interface 0 and starts the read and command loops.
   `DeviceAttachedEvent` then opens `C6118DeviceActivity`.
2. **There is no handshake or authentication command.** `larkc1/c6118/data/runtime/C6118RuntimeSession.ensureSessionActive`
   starts the heartbeat loop: wait `INITIAL_HEARTBEAT_DELAY_MS = 1000`, then `getHeartInfo()` (cmd `0x10`, target RX)
   every `HEART_BEAT_INTERVAL_MS = 1000` ms (`sendHeartbeatIfAllowed`, line 799). The loop is skipped while
   `C6118OtaTrafficGate` is open, i.e. during firmware update, and can be paused or resumed with `pauseHeartbeat` and
   `resumeHeartbeat`.
3. Each heartbeat response runs `consumeRuntimeNotification` → `syncDeviceInfoByHeart` (line 770). For RX, and for TX1
   and TX2 only while they are online, `C6118DeviceRuntimeManager.prepareDeviceInfoRequest` asks for the firmware
   version (`getDeviceVersion(t)`, which actually sends **cmd 0x41**, §4) and the serial number (`getDeviceSn(t)`,
   cmd 0x15), each until it has an answer, with at most `MAX_REQUEST_RETRY_COUNT = 4` tries per unit.
4. The home screen (`ui/home/viewmodel/HLDevice6118ViewModel`) also sends `getTxIdentify()` (0x3C). The More-settings
   screen (`ui/setting/viewmodel/MoreSetting6118ViewModel.refreshPageStateNow`) sends `getSmartBattery()` (0x3E) and
   `getSpeaker()` (0x13).
5. Every other setting is read from the heartbeat. Sets are applied to the UI optimistically and rolled back if the
   response body is `[0]`, i.e. not 1 (`HLDevice6118ViewModel.rollbackOptimisticOperation`).

**Correlation.** No request IDs exist. The response echoes the command byte. The app decodes every Set* reply to a
generic `SetResponseData(isSuc = body[0]==1)` and matches it FIFO against its own `pendingSetOperations` queue. A web
implementation can match on the echoed command byte (and the source byte for TX-targeted gets).

**Command queue** (`usb/core/queue/UsbCommandQueue`): one command at a time. A BULK command is marked COMPLETED as
soon as the OUT transfer returns; the queue **does not wait for the response**. A newly enqueued command replaces any
*pending* command with the same name ("0x05" and so on): "Command replaced by newer request". This deduplicates
slider spam. Raw OTA and M2 packets get random names and are never deduplicated.

**Unsolicited traffic.** The code shows no device-initiated reports other than OTA progress (`0x0E` ack per packet and
`0x0B` final result) answering OTA traffic. Connection changes, battery, mute (set with the TX button), charging and
settings changed on the device all reach the app only through the 1 s heartbeat poll. That matches the orchestrator's
observation of zero input reports during passive listening.

### 3.2 6301 Lark M2 (`larkc1/HLDeviceActivity`)
* On start, `getDeviceVersion()` sends six raw packets back to back: `0x03` version RX, `0x11` get noise, `0x04` get
  volume, `0x13` get speaker, `0x15` SN RX, `0x35` get voice lock. One second later the heartbeat starts: `0x10` every
  **3000 ms** (`HLDeviceActivity$8.run`).
* When a heartbeat reports TX1 or TX2 newly online, the app sends `0x03` and `0x15` targeted at that TX. For TX2 it
  waits 1 s first (`AnonymousClass10`). If a version answer is `"0.0.0.0"`, it asks again.
* Feature gating: the noise on/off switch and (camera only) voice lock appear only when the RX version is newer than
  `SPEC_VERSION = "2.0.0.31"` (`isNew6301Camera` / `isNew6301CameraOrMobile`).

### 3.3 6302 LARK M2S (`larkc1/HLDevice6302Activity`, `UsbMessengerV1`)
* Start-up: `0x15` SN, `0x03` version RX (plus TX1/TX2 if online), then `0x11`, `0x04`, `0x13`, `0x35`, then the
  heartbeat **every 1000 ms** (`HLDevice6302Activity$mRunnable$1.run`). `getMac` is a no-op on V1.
* The LED switch and custom-button screen appear only when the RX version is newer than `SPEC_VERSION = "2.0.0.9"`
  (`onResGetVersion`).

---

## 4. Complete command catalog: 6118 (LARK A2 / A2S)

The command IDs come from `protocol/core/sound/command/type/Command6118Usb` (the integer passed to `super(n)`). The
codecs are `protocol/core/sound/command/device6118/Cmd*6118.java`, the sender is `mic_usb/messenger/UsbMessenger6118`,
and the registry is `protocol/core/sound/provider/Protocol6118ProviderProxy.getSupportedCommands`. "dst" is byte 3 of
the request and "body" is bytes 6… of the request or response. All Set* responses use
`Base6118UsbCmd.parseSetResponse`: **body[0] == 1 means success**, anything else means failure.

| Cmd | Name (Command6118Usb) | dst | Request body | Response body | UI feature / caller |
|---|---|---|---|---|---|
| `0x10` | CMD_USB_HEART_INFO_GET | 0x40 | – | heartbeat, §4.1 | 1 s poll (`C6118RuntimeSession`) |
| `0x41` | CMD_USB_RULE_VERSION_GET | 0x40/41/42 | – | ≥6 bytes `v0..v5` → string `"v0.v1.v2." + v3 + v4 + v5` (decimal digits concatenated, `formatSixByteDeviceVersion`) | Firmware version per unit. **`UsbMessenger6118.getDeviceVersion()` sends this, not 0x03.** |
| `0x03` | CMD_USB_DEVICE_VERSION_GET | 0x40/41/42 | – | n bytes → decimal values joined with `.`, last one zero-padded to 3 digits (`formatLegacyVersion`) | Decoder is registered, but the A2 UI never sends it |
| `0x15` | CMD_USB_DEVICE_SN_GET | 0x40/41/42 | – | ASCII up to the first `0x00`, trimmed (`asciiString`) | Serial number per unit (device info page) |
| `0x08` | CMD_USB_DEVICE_ID_GET | 0x40/41/42 | `[t]` (t = 0/1/2, repeating the target) | body[0] = 1-byte device ID | OTA preparation |
| `0x11` | CMD_USB_NOISE_LEVEL_GET | 0x40 | – | body[0]: bit7 = NC on, bits0–6 = level. Decoded level = `on ? b&0x7F : 0`, clamped to 0..3 | sender only; the UI reads the heartbeat |
| `0x06` | CMD_USB_NOISE_LEVEL_SET | 0x40 | `[level]`, clamped 0..3 (UI: 1 = Weak, 2 = Medium, 3 = Strong, from `blemic/device/DeviceConnectVariable.NoiseLevel`) | set-response | Noise-cancellation level buttons |
| `0x19` | CMD_USB_NOISE_SWITCH_SET | 0x40 | **always `[0x02]` (toggle)**. The isOpen argument is ignored (`CmdSetNoiseSwitch6118`, `LEGACY_6118_NOISE_SWITCH_TOGGLE = 2`). | set-response | NC on/off switch. Read the result back from heartbeat byte 6. |
| `0x04` | CMD_USB_VOICE_LEVEL_GET | 0x40 | – | body[0] = level | sender only |
| `0x05` | CMD_USB_VOICE_LEVEL_SET | 0x40 | `[level]`. UI range **0..5** on 1041 and **0..2** on 1042 (`C6118DeviceActivityKt.homeRxVolumeStepCount`). The default UI index is 3. | set-response | "RX volume" segmented bar (output/gain step) |
| `0x18` | CMD_USB_VOICE_MODE_SET | 0x40 | `[mode]`: 0 = Mono, 1 = Stereo, 2 = SafeTr (safety track) (`C6118DeviceActivity.setupVoiceModeActions`) | set-response | "Channel Mode" |
| `0x3A` | CMD_USB_BEAUTY_VOICE_SET | 0x40 | `[enable(0/1), preset]`, preset 0 = Bright, 1 = Low, 2 = Balance (`DeviceConnectVariable.PRESET`) | set-response | "Bel canto preset" switch and buttons (on-device voice EQ) |
| `0x39` | CMD_USB_LIGHT_SET | 0x40 | `[v]`: **0 = LED on, 1 = LED off** (`LEGACY_LIGHT_VALUE_OPEN = 0`) | set-response | "Indicator Light Switch" |
| `0x3B` | CMD_USB_TX_IDENTIFY_SET | 0x40 | `[0/1]` | set-response | "Mic Recognition" switch |
| `0x3C` | CMD_USB_TX_IDENTIFY_GET | 0x40 | – | body[0] == 1 → on | home screen start-up |
| `0x3D` | CMD_USB_SMART_BATTERY_SET | 0x40 | `[0/1]` | set-response | "Smart battery life" |
| `0x3E` | CMD_USB_SMART_BATTERY_GET | 0x40 | – | body[0] == 1 → on | More settings |
| `0x12` | CMD_USB_SPEAKER_SET | 0x40 | `[v]`: **0 = enabled, 1 = disabled** | set-response. **On success the app counts down 3 s and sends `0x0C` restart** (`MoreSetting6118ViewModel.startSpeakerRestartCountdown`, `SPEAKER_RESTART_COUNTDOWN_SECONDS = 3`) | "External speaker without unplugging" |
| `0x13` | CMD_USB_SPEAKER_GET | 0x40 | – | body[0] == 0 → enabled | More settings |
| `0x36` | CMD_USB_SHUTDOWN_TIME_SET | 0x40 | `[v]`: **0 = auto power-off on (15 min idle), 1 = off** | set-response | "Mic auto power-off" |
| `0x34` | CMD_USB_VOICE_LOCK_SET | 0x40 | `[0/1]` | set-response | sender exists, not used by the A2 UI |
| `0x35` | CMD_USB_VOICE_LOCK_GET | 0x40 | – | body[0] | sender exists, not used by the A2 UI |
| `0x3F` | CMD_USB_DELETE_PAIR_SET ⚠ | 0x40 | `[txIndex]`, 1 = TX1, 2 = TX2 (clamped) | set-response | "Remove Pairing" (`ui/setting/viewmodel/C6118PairDeviceViewModel`). **Destructive: the mic must be re-paired.** |
| `0x40` | CMD_USB_FACTORY_RESET_SET ⚠ | 0x40 | – | set-response | "Factory Reset" (`MoreSetting6118ViewModel`), then a 1 s runtime recovery delay. **Destructive.** |
| `0x0C` | CMD_USB_RESTART_RX ⚠ | 0x40 | – | set-response (may not arrive before the RX drops off USB) | Reboots the RX. Sent after a speaker toggle. The USB link drops. |
| `0x09` | CMD_USB_OTA_TX_UPGRADE ⚠ | 0x41/0x42 | `[devId]` (1 byte from 0x08) | body[0] == 1 → TX entered upgrade mode | OTA (§6) |
| `0x0D` | CMD_USB_OTA_RX_UPGRADE ⚠ | 0x40 | – | body[0] == 1 → RX entered upgrade mode | OTA |
| `0x0E` | CMD_USB_OTA_PACKET_ACK | (response only) | – | body[0] ≠ 0 → packet OK; body[1..2] = big-endian `needCount`, the packet index the device wants next | OTA ack per 0x55 packet |
| `0x0B` | CMD_USB_OTA_UPGRADE_RESULT | (response only) | – | body[0] == 1 → success. src byte = the unit that was upgraded. | OTA final |

The A2 has **no command to set mic mute**. Mute is a TX button, and the app only reads it (heartbeat byte 15). It also
has no gain-per-TX or low-cut commands, and no command that starts pairing.

### 4.1 Heartbeat `0x10` response body (6118)
`CmdGetHeart6118.decodeLegacyPayload` → `Protocol6118Data.HeartInfo`. A missing byte reads as 0.

| body[i] | frame offset | Field | Decoding |
|---|---|---|---|
| 0 | 6 | tx1Online | `== 1` |
| 1 | 7 | tx2Online | `== 1` |
| 2 | 8 | tx1Battery | 0–100 % |
| 3 | 9 | tx2Battery | 0–100 % |
| 4–5 | 10–11 | (not decoded on 6118; the M2 calls it "uvValue") | – |
| 6 | 12 | noiseLevel | 0 = NC off, 1 = Weak, 2 = Medium, 3 = Strong. `noiseOpen = noiseLevel != 0` (`HLDevice6118ViewModel.mapHeartInfo`) |
| 7 | 13 | voiceLevel | RX volume index (0–5, or 0–2 on 1042) |
| 8 | 14 | (not decoded; the M2 voice lock) | – |
| 9 | 15 | voiceMode | 0 Mono / 1 Stereo / 2 SafeTr |
| 10 | 16 | autoPowerOffOpen | `== 0` → auto-off enabled |
| 11–12 | 17–18 | (not decoded; the M2S custom buttons) | – |
| 13 | 19 | lightOpen | `== 0` → LED on |
| 14 | 20 | beauty preset | bit0 = enabled, bits1–7 = preset (0 Bright / 1 Low / 2 Balance) |
| 15 | 21 | flags | bit0 TX1 muted, bit1 TX2 muted, bit2 TX1 charging, bit3 TX2 charging, bit4 camera-RX charging |
| 16 | 22 | rxCamBattery | % (camera RX 1042 only, `shouldShowRxCameraStatus`) |

Note the encoding asymmetry: heartbeat byte 14 packs `(preset<<1)|enable`, but the `0x3A` set takes two separate bytes.

---

## 5. Command catalog: 6301 Lark M2 / 6302 LARK M2S (legacy `usbmic/protocol`)

These use the same frame layout (§2) and the same IDs as 6118 (`application/common/protocol/Protocol` constants
`HIP_6501_*`, `HIP_6301_*`, `HIP_6302_*`). They are sent through `USBDataSendEvent` and parsed by
`usbmic/protocol/ProtocolFactory.createProtocol`. Unless noted, the target is `0x40`; classes that never call
`setDeviceType` default to RX. Set responses: body[0] == 1 means success.

| Cmd | Class | Request body | Response body | Used by | vs. 6118 |
|---|---|---|---|---|---|
| `0x10` | Pro_get_heart | – | §5.1 | M2 every 3 s, M2S every 1 s | same ID, different layout |
| `0x03` | Pro_get_version | – (dst = target) | n bytes → `"a.b.c.d"` (decimal values joined by `.`) | both | the 6118 uses 0x41 |
| `0x15` | Pro_get_sn | – (dst = target) | whole body as UTF-8 | both | same |
| `0x08` | Pro_get_devid | `[0/1/2]` (dst = target) | body[0] = devId | OTA | same |
| `0x11` | Pro_get_noise | – | body[0] (signed): 0 off / 1 low / 2 strong | both | 6118 adds a bit7 flag and levels up to 3 |
| `0x06` | Pro_set_noise | `[level]`: 1 = Weak/Low, 2 = Strong | body[0] = status, body[1] = level | both | 6118 scale is 1..3 |
| `0x19` | Pro_set_noise_status | `[0x02]` (toggle) | status | M2 ≥ 2.0.0.31, M2S | same |
| `0x04` | Pro_get_voice | – | body[0] = level 0..5 | both | same |
| `0x05` | Pro_set_voice | `[level 0..5]` (`DeviceCompat.getVoiceLevels` = [0..5]) | status | both | same |
| `0x13` | Pro_get_speaker | – | body[0] == 0 → on | both | same |
| `0x12` | Pro_set_speaker | `[0 = on, 1 = off]` | status. On success the app restarts the RX after 3 s with `0x0C`. | "Phone Speaker" | same |
| `0x35` | Pro_get_voice_lock | – | body[0] == 1 → locked | both | unused on A2 |
| `0x34` | Pro_set_voice_lock | `[1 lock / 0 unlock]` | status | M2 camera ≥ 2.0.0.31, M2S | unused on A2 |
| `0x18` | Pro_set_voice_mode | `[0 Mono / 1 Stereo]` | status | M2S only | 6118 adds 2 = SafeTr |
| `0x36` | Pro_set_shutdown_time | `[0 = 15 min, 1 = never]` | status | M2S only | same |
| `0x39` | Pro_set_light | `[0 on / 1 off]` | status | M2S ≥ 2.0.0.9 | same |
| `0x37` | Pro_set_btn_custom | 5 bytes `[functionIndex(1 = TX1 / 2 = TX2), function, keyOp, tx1LightColor, tx2LightColor]` (`usbmic/data/DeviceBtnCustom.BtnCustomBean.toByteArray`) | status | M2S custom-button page (`larkc1/ui/custom/CustomFunctionActivity`) | **M2S only** |
| `0x38` | Pro_get_btn_custom | – | `[tx1LightColor, tx2LightColor]` (0 not set, 1 purple, 2 yellow) | M2S | **M2S only** |
| `0x0C` | Pro_set_restart ⚠ | – | – | after a speaker change | same |
| `0x09` / `0x0D` / `0x0E` / `0x0B` | Pro_tx_upgrade / Pro_rx_upgrade / Pro_upload_device / Pro_upgrade_response | as 6118 | as 6118 | OTA | same |

`function` (BtnFunction): 0 none, 1 RX self-lock, 2 mute all TX, 3 mute this TX, 4 TX identify.
`keyOp` (KeyOperation): 0 none, 1 mobile-RX power double, 2 mobile-RX power triple, 3 camera-RX power single,
4 camera-RX power double, 5 camera-RX NC-button double, 6 TX power double, 7 TX power triple.

The following exist only on 6118: `0x3A`, `0x3B`, `0x3C`, `0x3D`, `0x3E`, `0x3F`, `0x40` and `0x41`.

### 5.1 Heartbeat `0x10` body (6301/6302), `Pro_get_heart.receiveData`
| body[i] | Field |
|---|---|
| 0 / 1 | TX1 / TX2 online (`== 1`) |
| 2 / 3 | TX1 / TX2 battery % |
| 4–5 | `uvValue = (sbyte)b4*256 + (sbyte)b5` (not used by the UI) |
| 6 | noise 0 off / 1 low / 2 strong |
| 7 | voice level 0..5 |
| 8 | voice lock (1 = locked) |
| 9 | voice mode 0 mono / 1 stereo |
| 10 | shutdown time 0 = 15 min / 1 = never |
| 11 / 12 | custom button TX1 / TX2: high nibble = function, low nibble = keyOp |
| 13 | light, `== 0` → on |

---

## 6. Firmware update (OTA), factory reset, pairing: documented only, **do not implement casually**

### 6.1 6118 OTA (`larkc1/c6118/ui/setting/viewmodel/C6118FirmwareUpgradeViewModel`, `data/firmware/Legacy6118OtaProtocolBridge`, `data/firmware/C6118FirmwareUpgradeCoordinator`)
* Firmware comes from the Hollyland cloud, by package codes `6118TX`, `6118RX` and `6118CAMRX`. The order is
  **TX targets first (TX1, then TX2), then RX** (`C6118FirmwareTarget` TX order 1 < RX order 2). Entry requires
  battery ≥ `ENTRY_BATTERY_THRESHOLD = 10` %. The heartbeat and device-info polling are gated off while it runs
  (`C6118OtaTrafficGate`).
* Per unit:
  1. `0x08` GET_DEVICE_ID → body[0] = devId. The app waits up to `OTA_DEVICE_ID_TIMEOUT_MS = 5000` ms and retries 3 times.
  2. TX: `0x09`, dst `0x41`/`0x42`, body `[devId]`. RX: `0x0D`, dst `0x40`. Wait for body[0] == 1.
  3. Stop-and-wait loop: send the `0x55` + 63 bytes packet `i` (§2.4), then wait for `0x0E`. On OK, `i++`. On failure,
     resume at `needCount` (`OTA_PACKET_ACK_RETRY_LIMIT = 3`).
  4. After the last packet, wait for `0x0B`. body[0] == 1 is success. The unit reboots, and the next unit starts after
     `NEXT_DEVICE_DELAY_MS = 3000`.
* M2/M2S OTA (`larkc1/HLDeviceActivity.onEvent`) runs the same sequence over the same commands, reading the firmware
  file with `RandomAccessFile` (`FileUtils.getDataWithIndex(RandomAccessFile,int)`).

### 6.2 Destructive and disruptive commands
| Cmd | Effect | Notes |
|---|---|---|
| `0x40` | factory reset of the RX (the UI warns "will erase some data") | 6118 only |
| `0x3F [1|2]` | removes the pairing of TX1 or TX2; the mic must be re-paired | 6118 only |
| `0x0C` | reboots the RX; USB disconnects and re-enumerates | all |
| `0x09`, `0x0D`, `0x55` data | puts a unit into bootloader / flashes it; bricking risk | all |
| `0x12` | requires a reboot (`0x0C`) to take effect | all |

**No "enter pairing" command** exists for 6118, 6301 or 6302. Pairing is done on the device itself. Only 6108 has one
(`HID_RX_INTO_PAIR = 61` in `ProtocolV2`).

---

## 7. Hand-built example frames (6118)

Generated by a re-implementation of `buildPacket` (`scratchpad/android-re/frames.py`, run with `python3 -I`). Bytes 10
to 63 are always `00`. Each frame is 64 bytes.

| # | Purpose | Request (first 10 bytes) | Expected response layout |
|---|---|---|---|
| 1 | Heartbeat, used as a "hello" since no handshake exists | `AA DD 10 40 00 00 00 00 00 00` | `BB DD 10 80 LL LL` + §4.1 body (≥17 bytes) |
| 2 | Firmware version of RX | `AA DD 41 40 00 00 00 00 00 00` | `BB DD 41 80 00 06 v0 v1 v2 v3 v4 v5` → `"v0.v1.v2.<v3><v4><v5>"` |
| 3 | Firmware version of TX1 | `AA DD 41 41 00 00 00 00 00 00` | `BB DD 41 81 …` |
| 4 | Serial number of RX | `AA DD 15 40 00 00 00 00 00 00` | `BB DD 15 80 00 LL <ASCII…> 00…` |
| 5 | Serial number of TX2 | `AA DD 15 42 00 00 00 00 00 00` | `BB DD 15 82 00 LL <ASCII…>` |
| 6 | Noise cancellation level Strong | `AA DD 06 40 00 01 03 00 00 00` | `BB DD 06 80 00 01 01` (01 = OK) |
| 7 | Toggle noise cancellation on/off | `AA DD 19 40 00 01 02 00 00 00` | `BB DD 19 80 00 01 01`. Confirm through heartbeat byte 6. |
| 8 | RX volume step 4 | `AA DD 05 40 00 01 04 00 00 00` | `BB DD 05 80 00 01 01` |
| 9 | Channel mode Stereo | `AA DD 18 40 00 01 01 00 00 00` | set-response |
| 10 | Voice preset on, "Low" | `AA DD 3A 40 00 02 01 01 00 00` | set-response |
| 11 | LED off | `AA DD 39 40 00 01 01 00 00 00` | set-response |
| 12 | Mic recognition on | `AA DD 3B 40 00 01 01 00 00 00` | set-response |
| 13 | Get mic recognition | `AA DD 3C 40 00 00 00 00 00 00` | `BB DD 3C 80 00 01 0X` (01 = on) |
| 14 | Smart battery on / get | `AA DD 3D 40 00 01 01 …` / `AA DD 3E 40 00 00 …` | set-response / `… 01` = on |
| 15 | Mic auto power-off on | `AA DD 36 40 00 01 00 00 00 00` | set-response |
| 16 | Get "speaker without unplugging" | `AA DD 13 40 00 00 00 00 00 00` | body[0] == 00 → on |
| 17 | ⚠ Restart RX | `AA DD 0C 40 00 00 …` | – |
| 18 | ⚠ Remove TX1 pairing | `AA DD 3F 40 00 01 01 …` | set-response |
| 19 | ⚠ Factory reset | `AA DD 40 40 00 00 …` | set-response |
| 20 | OTA: device ID of TX1 | `AA DD 08 41 00 01 01 …` | `BB DD 08 81 00 0? <devId>` |

Illustrative heartbeat. These values were made up for the example, and the decode was checked against the
re-implementation:
```
BB DD 10 80 00 11 | 01 01 55 3C 00 00 02 03 00 01 00 00 00 00 03 04 00 | 00…
→ TX1/TX2 online, 85 % / 60 %, NC Medium(2), volume 3, Stereo, auto-off on, LED on,
  preset on = Low(1), TX1 charging, not muted
```
For WebHID under H1 (§1.5), request #1 becomes `sendReport(0xAA, [DD 10 40 00 00 00 …] (63 bytes))`.

---

## 8. Other families and variants (out of scope for A2/M2 work)
* **6108 LARK A1** (PID 1031): `UsbMessengerV2` + `application/common/protocol/ProtocolV2` + `usbmic/protocolV2/*`.
  It sends HID **feature reports through control transfers**. The buffer is `05 03 AA DD <cmd> <lenHi> <lenLo> <payload> EF`
  (64 bytes, or 160 during OTA). Its command numbers differ (for example `HID_GET_HEART_INFO = 31` and
  `HID_SET_VOICE_LEVEL = 3`), and it has EQ, reverb, TX mute, signal mode, performance mode, pairing, and DFU OTA.
* **6201 MELO P1** (USB and BLE) and **6303 LARK M3** (USB): these use the "standard Moma" framing
  (`protocol/core/sound/transfer/CommandPostBuilder.build`):
  `[reportId?] AA DD 06(app) <slave> <flags: end<<1 | start | verif<<2 | longPkg<<4> <frameCount BE16> {cmd BE16, cmdType, len BE16, payload}* [checksum]`.
  6201 uses an XOR checksum (`ChecksumUtils.crcCalculate`). 6303 uses no checksum with report ID 8. Their providers are
  `Protocol6201Provider` and `Protocol6303Provider`.
* **BLE products**: `blemic/*` (LARK MAX 2 6701 through `HLBleDeviceActivity`, OWS earphones 102/772), `mic_ble`,
  `comm/ble`. 6118 and 6301/6302 have no BLE path in this app (`Protocol6118Provider.supportsBluetooth() = false`).
* **USB bridge mode** (`usb/core/bridge/*`, `usbbridge/api/*`): a host app `com.hollyland.cameralive` (S8801) owns the
  USB device and relays endpoints over AIDL. Not relevant to a browser.
* **Lark C1 / M1 / Mini** (PIDs 1, 11, 12, 13) share the legacy protocol and `HLDeviceActivity`. PID 11 swaps TX1 and
  TX2 in the UI.

---

## 9. App-side vs device-side
| Feature | Where | Evidence |
|---|---|---|
| Per-mic **audio level meters** | **App**: `AudioRecord` on the USB audio input, 8 kHz mono or 16 kHz stereo; RMS dB = `20·log10(sqrt(Σx²/n)/32767)`, floor −60 dB; −6 dB on the safety track; displayed through 20 segments with breakpoints (−45 dB→0, −17→6, −10→13, −4→18, 0→20) | `larkc1/c6118/ui/home/C6118AudioLevelMonitor.calculateDbLevel`, `C6118VuLevelMapper`; M2: `AudioRecordUtils` |
| Firmware download, version comparison, product manual, analytics | App + cloud (HTTP) | `C6118LegacyUpgradeInfoAdapter`, `MoreSetting6118ViewModel.requestProductManualInfo` |
| Noise cancellation, RX volume, channel mode / safety track, voice preset (Bright/Low/Balance), LED, mic recognition, smart battery, speaker passthrough, auto power-off, pairing removal, factory reset | **Device** (commands in §4) | §4 |
| TX mute | **Device button only**; the app just reads it | heartbeat byte 15 |
| Recording library, presets, professional effects (EQ, compressor, de-esser), "My voice profile" / "canto", AI and recording-cloud screens | **App or other families only** (6201/6303), using native DSP `libgraphics_algorithm.so`, `libmeisheng.so` (CMSIS), and `libnoise.so` (FFT) | `larkc1/c6201/*`, `larkc1/c6303/ui/canto/*`, `com/example/meisheng/CMSISManager`. Not available on 6118 or 6301/6302. |

---

## 10. Open questions / to verify on hardware
See the structured summary. The main one: whether WebHID can send and receive with the undeclared report IDs
0xAA/0xBB (H1), or whether the firmware also accepts frames prefixed with 0x41 (H2).

## Appendix: source index
* Codec: `protocol/core/sound/command/device6118/LegacyUsb6118ProtocolCodec.java`, `Base6118UsbCmd.java`, `Base6118UsbCmdKt.java`, `LegacyUsb6118CommandsKt.java`, `Cmd*6118.java`
* IDs: `protocol/core/sound/command/type/Command6118Usb.java`
* Provider: `protocol/core/sound/provider/Protocol6118Provider.java`, `Protocol6118ProviderProxy.java`, `protocol/core/parser/ProtocolManagerImpl.java`, `protocol/core/parser/UsbCommandInfo.java`, `CommandExecutionConfig.java`
* Data model: `protocol/core/sound/entity/Protocol6118Data.java`
* Sender: `mic_usb/messenger/UsbMessenger6118.java`, `mic_usb/manager/MicUsbManager.java`
* USB: `usb/core/HlUsbManagerImpl.java`, `usb/core/AbstractUsbHidService.java`, `usb/core/queue/UsbCommandQueue.java`, `usb/core/packet/*`, `usbmic/core/USBHIDService.java`, `application/common/manager/UsbHandlerManager.java`
* Session and UI: `larkc1/c6118/data/runtime/C6118RuntimeSession.java`, `C6118DeviceRuntimeManager.java`, `larkc1/c6118/ui/home/viewmodel/HLDevice6118ViewModel.java`, `larkc1/c6118/ui/home/C6118DeviceActivity(.Kt).java`, `larkc1/c6118/ui/setting/viewmodel/MoreSetting6118ViewModel.java`, `C6118PairDeviceViewModel.java`, `C6118FirmwareUpgradeViewModel(.Kt).java`
* Legacy (M2/M2S): `application/common/protocol/Protocol.java`, `usbmic/protocol/*.java`, `usbmic/messenger/UsbMessengerV1.java`, `usbmic/events/USBDataReceiveEvent.java`, `larkc1/HLDeviceActivity.java`, `larkc1/HLDevice6302Activity.java`, `usbmic/data/DeviceBtnCustom.java`, `application/common/compatibility/DeviceCompat.java`, `application/common/util/FileUtils.java`
