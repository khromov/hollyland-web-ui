# Product families: compatibility matrix, implementation plan and library architecture

Status: plan, 2026-11-05; Phase 0/1, Phase 2 and Phase 3 (W9 UI) status and review fixes in §2.4 (2026-11-06). Nothing in here has been run against hardware except where a row says "hardware-tested".
It turns the five family research docs into one decision document:

| Group | Research doc | Products |
|---|---|---|
| legacy-6501 | [`research/families/legacy-6501.md`](research/families/legacy-6501.md) | Lark C1, C1 (2nd gen), M1 (2nd gen), Lark Mini, Lark MAX |
| a1-6108 | [`research/families/a1-6108.md`](research/families/a1-6108.md) | LARK A1 (2-mic and 4-mic firmware) |
| m3-6303 | [`research/families/m3-6303.md`](research/families/m3-6303.md) | LARK M3 (camera/phone RX, 2CH/4CH) |
| max2-6701 | [`research/families/max2-6701.md`](research/families/max2-6701.md) | LARK MAX 2 RX, charging case (BOX), OWS Monitor Earphone |
| melo-6201 | [`research/families/melo-6201.md`](research/families/melo-6201.md) | MELO P1 RX, mic, charging case, TWS earphones |

The A2/M2/M2S families (6118/6301/6302) are specified in [`PROTOCOL.md`](PROTOCOL.md). Every protocol claim below is a
summary; the family doc section named next to it carries the Android (A, jadx path + method) and iOS (I, selector
`@0x…`) citations. Tags: **[V]** read in code, **[I]** inferred, **[?]** needs hardware.

---

## 0. Key decisions

1. **Only one group really shares the A2/M2 format.** Lark C1 / C1 2nd gen / M1 2nd gen / Mini (PIDs 1, 11, 12, 13)
   run the same Android screen, the same `Pro_*` classes and the same `HIP_6501_*` codec as the Lark M2
   (A `larkc1/utils/OpenPageHelper.obtainUsbPageIntent` → `HLDeviceActivity`; I `HL6501Engine`; legacy-6501.md §0).
   They need **no new wire code**. Every other family shares only the `AA DD` / `BB DD` magic bytes and uses a
   different framing (A1: feature reports with `05 03 AA DD … EF`; M3, MAX 2, MELO P1: the multi-item "Moma" envelope
   with 16-bit command IDs). Those can still be prepared without hardware, because both apps give byte-exact builders,
   but they need new codecs and, for three of them, new browser transports.
2. **Two device engines behind one interface.** The legacy families (6118, 6301, 6302 and the new **6501**) stay on
   `HollylandDevice`, unchanged except for the 6501 rules. Every new framing is a **`FamilyDriver`** running on a new
   generic **`FamilyDevice`** engine (queue, correlation, heartbeat, probe, blind writes, destructive gating, traffic).
   The UI talks to a common **`MicDevice`** interface; a thin adapter makes `HollylandDevice` implement it.
3. **One shared Moma codec** (`src/lib/protocol/moma/`) with per-family profiles for 6201, 6303 and 6701 (report-ID
   prefix, start/end items, checksum, padding, target byte). Command tables stay per family: the same IDs mean
   different things (6303 `0x600B` = TX recognition LED; 6201/6701 `0x600B` = heartbeat).
4. **New transports, as `Transport` implementations:** a generalized `WebHidTransport` (report ID 8, reports larger than
   64 B), `WebHidFeatureTransport` (A1: `sendFeatureReport(5)` + `receiveFeatureReport(5)`), and a generic
   `WebBluetoothTransport` (MAX 2 charging case, MELO P1 receiver). No WebUSB (cannot claim HID). No Web Serial.
5. **Order:** 6501 first (same wire, validated by the coming M2 test), then A1 and M3 (the two families whose replies
   are most likely to reach Chrome on macOS without the bridge), then MAX 2 and MELO P1 over Web Bluetooth (full
   read/write on macOS, Windows, ChromeOS and Android Chrome). **Skip** Lark MAX (6902), all earphones, MELO P1
   mic/case, the M3 hot-shoe accessory, every firmware update, the A1 2↔4-mic mode switch and serial-number writes.
6. **"Untested" is data, not prose.** `ProductInfo.support` records the implementation level and what was tested on
   which platform. The UI derives its "Untested on hardware" plate, first-connect notice and safety gating from it.
   Untested families never send destructive or OTA commands; disruptive ones need a confirm.
7. **Parallel-safe layout.** Phase 0 creates every contract, the registry, stub folders and all `index.ts` exports.
   After that, each family agent edits only `src/lib/protocol/families/<code>/**` (plus one assigned transport file),
   and the 6501 agent owns the legacy files. No two agents edit the same file.

---

## 1. Compatibility matrix

### 1.1 Identity, transport and framing (every product the official app supports)

IDs: USB `VID:PID` (decimal), iOS EA `modelNumber` → deviceType (I `-[EADSessionManager setupControllerForAccessory:withProtocolString:]`
@0x10012477c), BLE identity, or the app's internal ID when the product is not a USB device.

| # | Product (international / China "Moma") | Code | IDs | Transport | Framing family | Ref |
|---|---|---|---|---|---|---|
| 1 | **LARK A2** | 6118 | `3547:0411` (1041); `lark a2` → 8 | USB HID interrupt, 64 B | Legacy `AA DD cmd dst len16` | PROTOCOL.md §1–3 |
| 2 | **LARK A2S** (camera RX) / "LARK A2" | 6118 | `3547:0412` (1042); `lark a2s` → 8 (9 after `0x16`) | same | Legacy | PROTOCOL.md §1 |
| 3 | **Lark M2** mobile / camera / "Lark MIX" | 6301 | `3547:0007` / `0008`; `lark m2` → 3 | same | Legacy | PROTOCOL.md §1 |
| 4 | Lark M2 (EAGLESHERO OEM) | 6301 | `4417:0020` / `0021` (32/33) | same | Legacy | PROTOCOL.md §1 |
| 5 | **LARK M2S** mobile / camera / "LARK M2" | 6302 | `3547:0405` / `0406` (1029/1030); `lark m2s` → 7 | same | Legacy | PROTOCOL.md §1 |
| 6 | **Lark C1** / "悦声S1" | 6501 | `3547:0001` (1); `lark c1` → 0 (2 on Type-C firmware) | same (Lightning RX: iAP2 only) | Legacy, 3 s heartbeat | legacy-6501.md §1–3 |
| 7 | **Lark C1 (2nd gen)** / "悦声S1(二代)" | 6501PRO | `3547:000B` (11); `lark c1 pro` → 4 | same | Legacy | legacy-6501.md §1.1–1.3 |
| 8 | **Lark M1 (2nd gen)** / "Lark M1(二代)" | 6502PRO | `3547:000C` (12); `lark m1 pro` → 5 | same | Legacy | legacy-6501.md §1 |
| 9 | **Lark Mini** (Android constant `PRODUCT_LARK_C1_PRO`, misnamed) | 6502JF | `3547:000D` (13); `lark m1 pro` + `0x16` body[0] = 3 → 6 | same | Legacy | legacy-6501.md §0 #4 |
| 10 | Lark MAX | 6902 | PID 2 (**rejected** by A `USBHIDService.isSupportedUsbDevice`); `lark max` → 1 | USB HID [?] | Legacy [?] | legacy-6501.md §7.5 |
| 11 | **LARK A1** (2 Mic & 1 RX or 4 Mic & 1 RX firmware) | 6108 / A6108 | `3547:0407` (1031); `lark a1` → 10 | USB HID **control transfers**: SET_REPORT + GET_REPORT, Feature ID 5, 64 B (ID 6, 160 B for OTA) | "ProtocolV2": `05 03 AA DD cmd len16 payload EF`, no address byte, ack `0` = OK | a1-6108.md §1–3 |
| 12 | **LARK M3** phone RX 2CH / 4CH | 6303 | `?:040E` / `040F` (1038/1039), **VID unconfirmed** (A skips the VID check); `lark m3` → 14 | USB HID interrupt, **report ID 8**, 64 or 512 B | Moma, no checksum, padded | m3-6303.md §1–3 |
| 13 | **LARK M3** camera RX 2CH / 4CH | 6303 | `?:040C` / `040D` (1036/1037) | same | Moma | m3-6303.md §1 |
| 14 | **LARK MAX 2** mobile RX | 6701 | `3547:0402` (1026); `lark max 2` → 15 | USB HID interrupt, unpadded variable length, reports > 64 B [I] | Moma + start/end items + XOR | max2-6701.md §1–3 |
| 15 | **LARK MAX 2** camera RX | 6701 | `3547:0403` (1027) | same | same | max2-6701.md §1 |
| 16 | **LARK MAX 2 charging case** ("BOX", "收纳盒") | 6701 | BLE service data UUID `0xFEE7`; app ID 101 (not a USB PID); iOS type 16 | **BLE GATT** service `FEE7`, characteristic `FEC1` (write without response + notify) | same Moma frame (targets 2 RX, 3 TX1, 5 BOX) | max2-6701.md §2.2 |
| 17 | OWS Monitor Earphone | 6701OWS | app ID 102; BT name + MAC prefix `50:C0:F0`; iOS type 17 | Android: Classic BT SPP `0xE003`; iOS: BLE `E49A25F8-…` + `FFD0/FFD2` | Actions OTA TLV (info + firmware only) | max2-6701.md §2.3, §7 |
| 18 | **MELO P1** receiver, main / second-phone | 6201 | `0408` / `0409` (1032/1033), VID 0x3547 assumed [?]; BLE service data `0xBBBB`, productLine 4, deviceId 1/2; `melo p1` → 11 | USB HID interrupt (no report-ID layer) **and** BLE GATT `FFE0` / `FFE1` (write) / `FFE2` (notify) | Moma + XOR (Android) or no checksum (iOS) | melo-6201.md §1–3 |
| 19 | MELO P1 Mic (and "DY" edition) | 6201 | `0x040A` (1034), `0x0410` (1040); `melo p1 04` → 13 | USB HID | Moma; the app only updates firmware | melo-6201.md §1.1 |
| 20 | MELO P1 Charging Case | 6201 | `0x040B` (1035) | USB HID | Moma; firmware + battery health | melo-6201.md §5.7 |
| 21 | MELO P1 TWS Monitor Earphones | 6201EAR | app ID 772 (not USB); iOS type 12 | Android SPP `0xE003` | Actions OTA TLV | melo-6201.md §8.1 |

Units that are **never connected directly** and are reached through a receiver: every TX (all families), M3 secondary
RXs (IDs 6–9), the M3 hot-shoe accessory (ID 10, firmware only) and the Bluetooth earphones paired to an M3 RX, the
MELO P1 remote control, and MAX 2 / MELO P1 earphone controls (volume, pairing, monitor), which are RX commands.

### 1.2 Browser path per platform, expected read/write, status in Hollyland Web UI

Legend: **✅** verified on hardware · **F** full read/write expected · **F?** full expected if an unverified descriptor
detail holds · **W** write-only (the OS drops replies) · **?** unknown until the HID descriptor is captured ·
**⚑** behind a Chrome flag (Web Bluetooth on Linux) · **✗** no browser path · **+B** the local root-libusb bridge
(`docs/BRIDGE.md`) gives full read/write for interrupt-pipe USB devices on macOS and Linux (Windows can't run it).
On Linux the kernel drops input reports whose ID the descriptor doesn't declare, so the legacy receivers (replies on
the undeclared `0xBB`) are **W** there as on macOS (verified on a Lark M2, PROTOCOL.md §11.9).

| # | Product | Chrome macOS | Windows | Linux | ChromeOS | Android | Full read/write expected | Hollyland Web UI today | Confidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | LARK A2 | W ✅, +B ✅ | ? (W expected), +B | W (as the M2), +B | W (as Linux) | ✗ | bridge (macOS, Linux) | **Supported, hardware-tested** (fw 3.0.2.008) | high (live captures, PROTOCOL.md §11) |
| 2 | LARK A2S | W (as A2), +B | ?, +B | W, +B | W | ✗ | as A2 | Supported, untested variant | high |
| 3 | Lark M2 | W ✅, +B ✅ | ?, +B | W ✅, +B ✅ | W | ✗ | bridge (macOS, Linux) | **Supported, hardware-tested** (macOS 2026-11-06, Linux 2026-11-13; PROTOCOL.md §11.8, §11.9) | high (wire) |
| 4 | Lark M2 EAGLESHERO | as #3 | as #3 | as #3 | as #3 | ✗ | as #3 | Supported, untested | medium (VID inferred) |
| 5 | LARK M2S | as #3 | as #3 | as #3 | as #3 | ✗ | as #3 | Supported, untested (unit on hand) | high (wire) |
| 6–9 | Lark C1 / C1 2nd gen / M1 2nd gen / Mini | as #3, +B | as #3, +B | F | F | ✗ | as #3 | Listed, `family: null` → **Phase 1** | high (wire), medium (UI semantics) |
| 10 | Lark MAX | ? | ? | ? | ? | ✗ | unknown | Not listed → add as recognised only | low |
| 11 | LARK A1 | **F?** (feature reports bypass the input-report filter; Feature 5 must be declared) | F? (needs declared Feature 5) | F | F | ✗ | likely on every desktop OS, no bridge needed | Listed, unsupported → **Phase 2** | high (commands), medium (transport) |
| 12–13 | LARK M3 (all four PIDs) | **F?** (replies on report ID 8, declared [I]) | F? (send the declared report length) | F | F | ✗ | likely on every desktop OS | Listed, unsupported → **Phase 2** | high (framing), medium (transport, VID) |
| 14–15 | LARK MAX 2 RX over USB | ? (byte 0 is still `BB`) | ? | F? (report size) | F? | ✗ | unknown | Listed (note wrongly says "BLE product") → **Phase 2b** | medium |
| 16 | LARK MAX 2 BOX over BLE | **F** | F | ⚑ | F | **F** | yes, also on Android phones | Not listed → **Phase 2** | medium-high |
| 17 | OWS Monitor Earphone | ✗ (not planned) | ✗ | ✗ | ✗ | ✗ | – | Not listed; skip (state comes through the MAX 2 RX) | low |
| 18 | MELO P1 receiver | BLE **F**; USB ? | BLE F; USB ? | BLE ⚑; USB F (frames ≤ 1 report) | BLE F; USB F | BLE **F** | yes over BLE | Listed, unsupported → **Phase 2** (BLE first) | codec high, settings medium-high, DSP medium |
| 19 | MELO P1 Mic | USB ? | ? | ? | ? | ✗ | – | Listed; skip (firmware-update device) | low |
| 20 | MELO P1 Charging Case | USB ? | ? | ? | ? | ✗ | – | Listed; skip (firmware, battery health) | low |
| 21 | MELO P1 TWS Earphones | ✗ | ✗ | ✗ | ✗ | ✗ | – | Listed as a USB PID (wrong: 772 is an app ID) → remove from the USB table | low |

Why the platform columns differ (sources):
- **Input-report filtering** (macOS IOHIDFamily drops undeclared report IDs, verified on the A2, PROTOCOL.md §11.2).
  It hits every device whose replies start with `BB` at byte 0 and no declared report ID: the legacy families
  (descriptor of 6301/6302/6501 still unknown), MAX 2 USB and MELO P1 USB. The M3 tags its reports with ID 8
  (A `Protocol6303Provider.createCommandPostBuilder().setReportId(8)`, `new CommandStanderParser(8)`, m3-6303.md §2.3), and
  the A1 never uses input reports (a1-6108.md §2.3), so both should be readable on macOS without the bridge.
- **Web Bluetooth** works in Chrome on macOS, Windows, ChromeOS and Android, not on iOS; on Linux it needs
  `chrome://flags/#enable-experimental-web-platform-features` [?]. Only the MAX 2 BOX (A `blemic/operation/BleBoxOption`,
  max2-6701.md §2.2) and the MELO P1 RX (A `Protocol6201Provider.providerBluetoothConfig`, melo-6201.md §2.2) expose BLE
  control. The A1, M3 and 6501 group have no BLE path (a1-6108.md §2.3, m3-6303.md §2.1, legacy-6501.md §2).
- **Android Chrome** has no WebHID and WebUSB cannot claim HID interfaces, so phones can only reach the two BLE products.

### 1.3 Framing families at a glance

| Framing | Families | Request bytes | Command ID | Address | Checksum | Ack | Status poll |
|---|---|---|---|---|---|---|---|
| Legacy | 6118, 6301, 6302, 6501 | `AA DD cmd dst len16 payload`, padded to 64 | 8-bit | `0x40` + unit / reply `0x80` + unit | none | `body[0] == 1` | `0x10`: 1 s (A2, M2S), 3 s (M2, 6501) |
| ProtocolV2 | 6108 | `05 03 AA DD cmd len16 payload EF`, 64 B, Feature 5 | 8-bit, **different table** | in the payload (unit 0..4) | none | `body[0] == 0` (A; I: `!= 0xFF`) | `0x1F`, 1 s (Android) / 3 s (iOS) |
| Moma, 6303 profile | 6303 | `08 AA DD 06 00 00 cnt16 {cmd16 type len16 payload}`, padded 64 / 512 | 16-bit BE | payload unit IDs (TX 1–4, RX 6–9) | none | item `payload[0] == 0` | `0x6000` (30 B), 1.5 s |
| Moma, 6701 profile | 6701 | `AA DD 06 tgt 07 cnt16 5A FA 00 00 00 {…} 5E FE 00 00 00 XOR`, unpadded | 16-bit BE | target byte (1/2 RX over USB; 2/3/5 over BLE) | XOR | item type 2, `payload[0] == 0` | USB `0x600B` (49 B), 3 s; BLE: pushes (A) plus `0x600B` to target 2 every 3 s (I) |
| Moma, 6201 profile | 6201 | `AA DD 06 tgt 04 cnt16 {…} XOR`, unpadded, chunked | 16-bit BE | target 0 (USB) / 1 (BLE) | XOR (Android), none (iOS) | `payload[0] == 0` | `0x600B` (31 B), 3 s; VU pushed after `0x6048` |

Payload fields are little-endian in all three Moma profiles (generated `*Serializer` classes,
`ByteOrder.LITTLE_ENDIAN`), with a few big-endian exceptions in 6701 (system time BE64, max2-6701.md §3.1).

### 1.4 Registry corrections for `models.ts`

Found while cross-reading the family docs; applied in Phase 0 / Phase 1:
- PID 13: name "Lark Mini" is right, code `6502JF`; it has no EA model of its own (iOS derives it from `lark m1 pro` +
  `0x16` = 3). PIDs 1/11 both display "Lark C1": add a disambiguating label ("Lark C1 (2nd gen)") for PID 11.
- Add PID 2 "Lark MAX" (`6902`) as recognised only.
- 1032–1040: 1034/1040 are "MELO P1 Mic", 1035 is "MELO P1 Charging Case". **772 is not a USB PID**: move it, and
  the MAX 2 IDs 101/102, to a BLE/app identity list.
- 1026/1027 note: the USB RX speaks the Moma frame; it is not "a BLE product".
- M3 rows: mark the VID as unconfirmed (chooser needs a fallback, §3.4).

---

## 2. Implementation plan

### 2.1 What to build now, what needs a new transport, what to skip

| Family | Decision | Why | Needs a new transport? |
|---|---|---|---|
| **6501** (C1, C1 2nd gen, M1 2nd gen, Mini) | **Build now (Phase 1)** | Same wire as the M2 (same Java classes and iOS engine). Four small capability flags. The M2 test is a direct proxy. | No |
| **6108** LARK A1 | **Build now (Phase 1–2)** | Commands, payloads and the heartbeat agree between Android and iOS (the set ack does not: Android `body[0] == 0`, iOS `!= 0xFF`; the library follows Android, a1-6108.md §3.2). Feature reports are the best chance of full macOS control without the bridge. | **Yes**: `WebHidFeatureTransport` |
| **6303** LARK M3 | **Build now (Phase 1–2)** | Current flagship. Generated serializers give exact layouts; the iOS ID table confirms every command. Report ID 8 should make macOS readable. Voice profiles reuse `src/lib/dsp`. | Generalized `WebHidTransport` (report ID 8, 512 B) |
| **6701** LARK MAX 2 | **Build (Phase 2), BLE first** | The BOX's Web Bluetooth path is full duplex on macOS, Windows, ChromeOS and Android. The USB path has the A2's macOS risk and > 64 B reports, so it waits for a descriptor. | **Yes**: `WebBluetoothTransport`; USB needs > 64 B WebHID |
| **6201** MELO P1 | **Build a subset (Phase 2), BLE first** | Status, device info, More Settings and device-pushed VU meters are simple LE structs. The mixer DSP is large; presets are cloud-shaped blobs. | **Yes**: `WebBluetoothTransport` (write with response as Android; iOS writes without response) |
| 6902 Lark MAX | **Skip** (recognise only) | Android 3.1.0 rejects PID 2; no firmware package; no tester. A C1 profile can be switched on later if a user reports one. | – |
| OWS / MELO earphones | **Skip** | Direct link only gives battery/version/firmware, all of which the RX heartbeat already carries; SPP needs Web Serial over RFCOMM. | – |
| MELO P1 Mic / Case (USB) | **Skip** | The app only updates their firmware (case: also battery health). | – |
| M3 hot-shoe accessory | **Skip** | Firmware update only. | – |
| Firmware update (all), A1 2↔4-mic switch, MELO SN write | **Skip, document only** | Can brick a unit; firmware comes from Hollyland's cloud; the A1 switch re-flashes RX and mics. | – |
| Factory reset / unpair on untested families | **Hidden until hardware-tested** | Destructive with no way to verify the bytes first. | – |

### 2.2 Phases and work packages

Effort is agent-days without hardware. W-numbers are parallel work packages; the owner column lists the only files the
package may edit (see §3.7).

| Phase | WP | Work | Effort | Depends on | Owns |
|---|---|---|---|---|---|
| **0** | W0 | Core contracts and refactor: `core/types.ts` (MicDevice, MicState, ControlSpec, FamilyDriver, ProtocolSpec, DeviceSimulator, SupportInfo, LinkSpec), `core/engine.ts` (generic `FamilyDevice`), `core/bytes.ts`, `core/ids.ts`, `core/registry.ts` with stub drivers for 6108/6201/6303/6701, `families/legacy/` adapter (`LegacyMicDevice`), `ProductInfo` extension and row moves, generalized `WebHidTransport` + `transports/fake-hid.ts`, bridge variable-length packets, `core/conformance.ts` test suite, `index.ts` exports | 2–3 d | – | §3.7 "W0" |
| **1** | W1 | **6501** in the legacy engine: `Family` `'6501'`, capability flags (heartbeat link-only, TX label swap, volume wire map, NC-on precondition), registry rows, simulator profiles, controls in the legacy adapter, tests | 0.5–1 d | W0 | legacy files |
| 1 | W2 | **Moma codec**: profiles 6201-USB/BLE, 6303, 6701-USB/BLE; encoder, multi-item decoder, streaming assembler, lenient checksum; golden vectors from all three docs | 1 d | W0 | `moma/**` |
| 1 | W3 | **A1 wire layer**: `WebHidFeatureTransport` + fake, `families/6108` codec, command table, heartbeat parser (17/22/23 B), vectors | 2 d | W0 | `transports/webhid-feature.ts`, `families/6108/**` |
| 1 | W4 | **`WebBluetoothTransport`** (generic GATT: chooser filters, notify, write with/without response, chunking, disconnect) + `transports/fake-bluetooth.ts` | 1–1.5 d | W0 | `transports/web-bluetooth.ts`, `transports/fake-bluetooth.ts` |
| **2** | W5 | **A1 driver**: session spec, controls (EQ, reverb, per-mic mute, 4-mic, signal mode), gates (RX ≥ 1.0.1.3), simulator, conformance | 2–3 d | W3 | `families/6108/**` |
| 2 | W6 | **M3 driver core**: heartbeat (30 B), device info, versions, home settings, More Settings, primary/secondary gating, simulator | 2–3 d | W2 | `families/6303/**` |
| 2 | W7 | **MAX 2 driver**: BLE BOX path (push status, per-unit `0x600A`, get-all), then USB RX path (heartbeat `0x600B`), timecode, gain, wireless monitoring toggles, simulator | 3–4 d | W2, W4 | `families/6701/**` |
| 2 | W8 | **MELO P1 driver subset**: BLE + USB, heartbeat (31 B), device info, More Settings, VU subscription (`0x6048`/`0x11EB`), track faders (`0x130A`), simulator | 3–4 d | W2, W4 | `families/6201/**` |
| **3** | W9 | **UI integration** (after the current redesign lands): session on `MicDevice`, Bluetooth connect path, generic control renderer, 2/4-mic and multi-unit layouts, untested marking, mock presets from the registry, hardware-check runner | 3–5 d | W0–W8 | `src/lib/state/**`, `src/components/**` |
| 3 | W10 | Family extras: M3 voice profiles (`0x1F04`/`0x1F05`/`0x1F18` with `src/lib/dsp`), M3 multi-RX and wireless monitoring, MELO P1 DSP effects, MAX 2 USB once a descriptor is known | +1, +1–2, +3–5, +1 d | W6–W8, hardware data | the family folder |
| **4** | – | Hardware validation as units appear (§5.6–5.7); promote `support.hardware` per product | ongoing | – | registry rows |

Totals: about 20–28 agent-days; with four parallel agents in Phases 1–2, roughly 8–10 days of wall-clock time.

### 2.3 Safety rules for untested families

Enforced in the engine (`core/engine.ts`) from `ProductInfo.support` and each driver's command catalogue:
- `support.hardware === 'untested'`: commands classed `destructive` or `ota` are refused (`DestructiveCommandError`)
  regardless of options; `disruptive` (restart-causing) commands need `{ confirm: true }` per call.
- The connect probe and every background poll may only use `read` commands (checked against the catalogue).
- `sendRaw` from the console stays read-only unless forced, as today.
- Toggle-type commands are never sent blind (as for the legacy `0x19`).
- Every catalogued item of a multi-item request is checked on its own (`ProtocolSpec.commandsOf`, Moma batches), so
  no item can hide a destructive or OTA one, whatever item the batch is ranked by.
- On an untested product a **forced** `sendRaw` must still be classifiable: bytes that do not parse, and parsed
  frames whose command is not in the family catalogue, are refused (`DestructiveCommandError`). The catalogues come
  from Android and miss iOS-only commands (MELO P1 `0x131B`, which re-enumerates the RX: melo-6201.md §5), so an
  uncatalogued id is not assumed harmless. On a tested product a forced uncatalogued frame is sent, after the
  catalogued items in it pass the rules above.
- `LegacyMicDevice.sendRaw` (6118/6301/6302/6501) applies the same rules on top of `HollylandDevice`: the raw OTA data
  packet (`55` + 63 bytes) and `notify` ids are refused on every product; on an untested product a forced frame must
  be a catalogued request of the product's own family (so `0x19` NC toggle is refused on a 6501 product). The
  wrapped `HollylandDevice` (`.legacy`), which the current UI console uses, keeps its looser rules for hardware
  exploration.

### 2.4 Status after Phase 3 (reviews of 2026-11-05 and 2026-11-06)

**Phase 0/1 (review of 2026-11-05).** Phase 0 (W0) and Phase 1 (W1–W4) are in the tree. A two-lens review (Android
3.1.0 jadx, iOS `larkSound` binary) found and fixed: the forced-`sendRaw` gaps above (engine and legacy adapter), the 6303 padding of a packet of exactly
64 bytes (Android pads it to 512: `len < 64` → 64, `len < 512` → 512), an unhandled rejection when a reply timed out
during a failing `send()` (engine and `HollylandDevice`), the 6501 heartbeat NC byte (ignored when ≥ 4, as iOS
`isHeartbeatNoiseLevelValid:`), the Lark Mini flag (iOS reads `0x16` body[0] only for `lark m1 pro`, PIDs 12/13), the
MELO P1 BLE chooser filter (prefixes `04 01` / `04 02`; `04 03` is the TWS earphones), and documentation of three
app disagreements (A1 set ack: Android `body[0] == 0`, iOS `!= 0xFF`; MAX 2 BOX: iOS polls `0x600B` to target 2 every
3 s over BLE, Android does not; MELO P1 FFE1: Android writes with response, iOS without).

**Phase 2 (W5–W8) and its two-lens review (2026-11-06).** All four drivers are in their family folders and pass the
shared conformance suite (§5.3) including check 10, against their simulators and, for the BLE products, through
`WebBluetoothTransport` and the fake GATT stack. Only the A1 driver is registered (`DRIVERS['6108']`, products
`experimental`); the M3, MAX 2 and MELO P1 drivers are exported (`createM3Driver`, `createMax2Driver`, `MELO_DRIVER`)
while the registry keeps their stubs (catalogue and frame classifier only), so `createMicDevice` still refuses those
PIDs. The review (Android 3.1.0 jadx, iOS `larkSound` disassembly) found and fixed:
- MAX 2: heartbeat byte 18 is `deviceType`, **2 = camera RX** (iOS `initEntityWithData:` `cmp #0x2` → `setIsCamera:`),
  so a camera RX through the BOX is no longer shown as a phone RX; "USB Output" (`0x8043`) restarts the RX (iOS confirm
  dialog + "device will automatically restart"), now `disruptive`; Timing Method "Reset" needs `{ confirm: true }`
  (`Max2Device`, A `confirmReset()`) and is refused in Real-time Timing (the row is hidden there); NC depth no longer
  needs a mic online (only the NC switch checks `isAllowSet`).
- MELO P1: Output Bit Depth no longer needs a mic online (only the mic bit-depth buttons check); the noise-gate
  threshold needs the gate on (`noise-gate-off`); LED brightness needs that LED on (`led-off`, Android hides the tabs)
  and keeps the switch state (iOS); `0x1304` rxSlave follows iOS (output change copies the depth, mic change keeps the
  `0x1305` value, now read at start-up as iOS does) instead of Android's constant 0.
- M3: Bit Depth 32-bit float is refused (`apple-only`, as Android and as the MAX 2 "USB Output"); 24-bit when already
  24-bit sends nothing (Android).
- Documented app disagreements, behaviour unchanged: MAX 2 BLE NC fan-out (Android: targets 3, 4, 10, 11, online or
  not, 200 ms apart; iOS: online TXs only, targets 3, 4, 5, 5; the library: Android targets, iOS online filter, one ack
  apart) and the NC GET on a TX coming online (Android TX1, iOS that TX), max2-6701.md §9 #7; MELO P1 VU interval
  (Android 100 ms, kept; iOS 150 ms, and a VU GET poll over External Accessory), melo-6201.md §10 #8.

**Phase 3 (W9 UI) and its two-lens review (2026-11-06).** Phase 3 is done: all four family drivers are registered
(`DRIVERS['6108' | '6201' | '6303' | '6701']`, products `experimental`), and the UI runs every product through
`MicDevice` (`session.svelte.ts`, `createMicDevice`). The A2 and Lark M2 keep their hand-tuned pages (LegacyOverview,
Settings, Device), unchanged. The other families get:
- **Connect:** one USB chooser for interrupt and feature-report products ("Connect receiver", plus an any-device
  fallback for the unconfirmed M3 / MELO P1 vendor id), "Connect over Bluetooth" (MAX 2 charging case, MELO P1; the only
  key on Android Chrome), "Reconnect <name>" for a granted USB receiver only.
- **Overview** (`overview/family/`): 2 or 4 mic modules (`session.micSlots`), writable mute where the product sets it
  (A1, M3, MELO P1), per-mic gain (MAX 2, MELO P1), meters per mic (USB channels, or the MELO P1's pushed levels); the
  kit row (receivers with primary / secondary, charging case, earphones, remote); the receiver strip from
  `ControlSpec`s (`controls/controls.ts`: NC, volume or gain, channel mode, mixing, A1 EQ / reverb). Set-and-forget
  controls (locks, recognition, bit depths, phone speaker, 4-mic mode, pairing, camera power) are on Settings.
- **Pages of their own:** Mixer (MELO P1: track faders / mutes with pushed levels, scenario, output volumes),
  Timecode (MAX 2 camera RX and charging case), Monitoring (MAX 2 mobile RX), each a tab from `session.extraPages`.
- **Settings:** Feature Settings from the specs, "This browser" with one mic-name field per mic slot (identity lamps
  only for the legacy products). **Device:** units with SN / firmware / battery, the hardware report (read-only check,
  "Copy hardware report" with the write log and its ack codes), About with the receivers line from the registry.
- **Untested marking** (§4.3): "Untested" plate by the model name, a one-line first-connect notice (dismissed per
  product), one notice strip at most (lost link > write-only, which then also carries the untested words > untested).
- **Restart / reset flow** for every disruptive control: "Restart the receiver?" with one house sentence, the restart
  overlay, and the automatic reconnect (USB: the HID `connect` event; Bluetooth: retries on the same device object).

The review (behaviour and UX lenses) found and fixed: write-only links let controls that the engine always refuses
look usable (A1 per-mic mute, MAX 2 NC switch and gains) — drivers now declare `ProtocolSpec.blindAvailability`
(`state-unknown` / `version-unknown`), applied by the engine while replies don't arrive and after every blind write,
so the UI shows "Can't read current value" / "Can't check receiver firmware" up front (A1, M3, MAX 2, MELO P1);
Bluetooth reconnects depended on `navigator.bluetooth.getDevices()` (behind a flag in Chrome) — the session keeps the
`BluetoothDevice` and reconnects it with `gatt.connect()` (`WebBluetoothTransport.reconnect({ devices })`); the
Connect page offered a USB "Reconnect" for a Bluetooth product; "Forget remembered values" left blind values on the
generic pages; the lost band said "Plug the receiver back in" for Bluetooth; the status line had no firmware for the
new families; the About card listed only the legacy receivers; Mic 3 / 4 names did not reach Settings and Device;
"Mic n Connected" toasts on every charging-case connect; an automatic USB reconnect could attach another granted
receiver (now only the same family); two notice strips stacked; channel-mode keys overflowed their module; 32-bit float
("iOS app only") is left out unless it is the current value; official confirm sentences replaced by one house
sentence per kind; bit depths in one order and spelling ("24-bit", "32-bit float"); labels in sentence case without
"Toggle" / "Settings" / "Adjustment" (`src/lib/state/labels.ts`; the hardware report keeps the drivers' labels); the
bridge offered for the A1 (its feature-report link isn't bridged); the charging case name cut in the phone header.

**Left for hardware (Phase 4).** Nothing below has run on a real unit except the A2 and the Lark M2:
- **Every family:** whether replies arrive per OS (A1 feature reports and M3 report ID 8 are expected to read on macOS;
  a write-only result is itself a finding: copy the hardware report), the first-contact checklists (§5.7), and the
  `confidence: 'medium' | 'low'` values. Promote `support.hardware` per product once a unit passes.
- **6108 A1:** the set ack (Android `body[0] == 0` vs iOS `!= 0xFF`, from the report's ack codes), the 22 / 23-byte
  heartbeat cases, per-mic mute on RX ≥ 1.0.1.3.
- **6303 M3:** the vendor id (chooser fallback until confirmed), 4-track re-enumeration (4CH PID) and the reconnect
  after the restart, 4-channel USB audio, multi-RX primary / secondary in the field. W10: voice profiles, wireless
  monitoring page, paired devices.
- **6701 MAX 2:** the BOX advertisement (service data or UUID, max2-6701.md §9 #3) and MTU, push cadence over BLE,
  Bluetooth reconnect after a Phone Speaker / USB Output restart, timecode Reset; the USB RX path still waits for a HID
  descriptor (> 64-byte reports); `syncTimeOnConnect` stays off (the system time is not sent on connect).
- **6201 MELO P1:** write with vs without response on FFE1 (Android vs iOS), VU push rate, the iOS-only `0x131B`, the
  `0x1304` rxSlave choice, firmware-gated rows (3.0.7.9 / 4.0.0.1). W10: Easy / Pro Tuning DSP.

Every family below except the A2 is **untested on hardware**: destructive and OTA commands are refused by the engine
(and hidden), disruptive controls need a per-call confirm, toggles are never sent blind.

| Family | What the library does today | Tested on hardware | In the UI after Phase 3 (W9) |
|---|---|---|---|
| 6118 / 6301 / 6302 | `HollylandDevice` + `LegacyMicDevice`: heartbeat, identity, NC, volume, channel, LED, lock, auto-off, voice presets, meters from USB audio | **A2 tested** (fw 3.0.2.008, write-only on macOS, full via the bridge); **M2 (PID 7) tested** (volume / NC read on connect, PROTOCOL.md §11.6–§11.8); A2S sibling; M2S untested | session on `MicDevice` via `createMicDevice`; the hand-tuned pages, unchanged |
| 6501 (C1, C1 2nd gen, M1 2nd gen, Mini) | same engine with the 6501 rules (heartbeat link-only on PID 1, volume wire map, Mic1/Mic2 swap, NC-on precondition) | untested (the tested M2 is the proxy) | the legacy pages with the 6501 capability flags (NC level only while NC is on; no LED / lock / channel rows); "Untested" plate and first-connect notice (the planned "Same protocol as Lark M2" plate is not drawn) |
| 6108 LARK A1 | **registered** driver: feature-report transport, 1 s poll, 13 controls (per-mic mute, NC + level, volume, Mono/Stereo, EQ, reverb + level, Mic Recognition, auto-off, LED, Mode setting; 2↔4-mic "Wireless settings" catalogued as destructive, hidden), RX ≥ 1.0.1.3 mute gate, 2/4-mic firmware, 5 mock presets | untested | done: `WebHidFeatureTransport` connect path (same USB chooser); 2 or 4 mic modules with writable mute (hidden below RX 1.0.1.3 or while the version is unknown); EQ / reverb on the Overview strip; untested plate + first-connect notice; ack codes of every write in the hardware report |
| 6303 LARK M3 | `createM3Driver()`, registered: report-ID-8 WebHID, 1.5 s `0x6000` poll, 16 controls (mute, NC + level, phone volume, camera 3-level dB gains, Mono/Stereo/4-track with per-value restart confirm in `M3Device`, smart mix, TX recognition, LED, hot-shoe sync, playback without unplugging and Bit Depth (24-bit only) as disruptive, TX button lock, auto-off), primary/secondary RX gating, 4T4R/2T2R, 7 mock presets | untested (VID unconfirmed) | done: registered; chooser fallback for the unconfirmed VID; up to 4 mic modules; receivers row (primary / secondary; a secondary RX's blocked controls say so once); restart dialogs (`M3Device.channelModeNeedsConfirm`, Bit Depth, playback without unplugging); per-mic meters in 4-track. Later (W10): voice profiles, wireless monitoring |
| 6701 LARK MAX 2 | `createMax2Driver()`, registered: USB RX 1026/1027 (`0x600B` 3 s poll) and BLE BOX 101 (pushes + iOS 3 s `0x600B` to target 2), 21 controls (Phone Speaker, internal / USB bit depth, Lock Mic, NC + depth, dynamic / per-mic gain, channel incl. safety track (BOX only), timecode switch / mode / fps / timing with Reset confirm in `Max2Device`, Mic Recognition, 4 Mic & 1 RX, RX pairing, Wireless Monitoring + OWS play / volume / pairing), RX ≥ 3.0.0.50 gates, 9 mock presets; system time on connect only with `syncTimeOnConnect` | untested | done: registered; "Connect over Bluetooth" (BOX); Timecode and Monitoring tabs; case / earphone battery cards; 2/4 mic modules with per-mic gain; restart dialogs (Phone Speaker, USB Output, Wireless Monitoring), 4-mic and pairing confirms, the Reset dialog (`Max2Device.timingNeedsConfirm`); `syncTimeOnConnect` off. USB path still waits for a HID descriptor (> 64-byte reports) |
| 6201 MELO P1 | `MELO_DRIVER`, registered: BLE (FFE0/FFE1/FFE2, target 1) and USB framings, 3 s `0x600B` poll, start-up GETs incl. `0x1305`, 25 controls (NC + depth, noise gate + threshold (< 4.0.0.1), Near/Mid/Far or per-mic gain (≥ 3.0.7.9), mic / output bit depth and auto speaker output as disruptive, 3.5 mm I/O, LED + brightness per unit, scenario, mic / instrument / BGM faders and mutes, wireless / wired / USB output volumes and mutes), VU stream via `0x11E0` + `0x6048` (`startLevels`, not `MicState.values`), 5 mock presets | untested | done: registered; "Connect over Bluetooth" (works on Android Chrome); Mixer tab (track faders and mutes, scenario, output volumes) with the pushed levels; battery cards for RX, mics, case, earphones, remote; version-gated rows (`firmware-too-old` / `firmware-too-new`); restart dialogs. Later (W10): Easy/Pro Tuning DSP |

---

## 3. Library architecture

### 3.1 Goals

- Keep 6118/6301/6302 behaviour, public exports and all existing tests unchanged.
- Let four or more agents build families **in parallel with no file conflicts**.
- One UI contract (`MicDevice`) whatever the framing or transport.
- Each family is self-contained: products, codec glue, requests, status parsing into shared state, capability and
  firmware gates, controls, simulator and test vectors live in one folder.

### 3.2 Module layout

```
src/lib/protocol/
  index.ts                 public exports (W0 adds core/, transports/, moma/, registry, family namespaces)
  app.ts                   what the app imports: index.ts minus every module with driver code (main chunk)
  device-errors.ts         error classes without the command catalogue (re-exported by device.ts)
  versions.ts              firmware version rules, Lark C1 volume map (re-exported by commands.ts)
  transport.ts             Transport contract (generalized, §3.4)                         [W0]
  emitter.ts               unchanged
  codec.ts                 legacy codec, unchanged
  commands.ts              legacy commands; Family += '6501'                               [W1]
  models.ts                ProductInfo + legacy rows + aggregation of family rows          [W0; legacy rows W1]
  device.ts                HollylandDevice (legacy engine); 6501 rules                     [W1]
  mock.ts                  legacy simulator; 6501 profiles                                 [W1]
  webhid.ts                WebHidTransport, generalized report sizes / filters             [W0]
  bridge.ts                BridgeTransport, variable-length packets                        [W0]
  core/
    types.ts               MicDevice, MicState, UnitId, ControlSpec, FamilyDriver, ProtocolSpec,
                           DeviceSimulator, SupportInfo, LinkSpec                           [W0]
    ids.ts                 vendor IDs, FamilyCode (moved out of models.ts to avoid import cycles) [W0]
    engine.ts              FamilyDevice<Req, Msg>: generic engine for non-legacy drivers     [W0]
    bytes.ts               u8/u16/i16/u32/i32/f32 LE+BE readers/writers, fixed ASCII/UTF-8   [W0]
    controls.ts            ControlSpec helpers, value validation, availability             [W0]
    registry.ts            DRIVERS (static imports of every family index.ts), driverFor(),
                           createMicDevice(), mockPresets()                                 [W0]
    loader.ts              the app's lazy registry: openMicDevice(), loadDriver() (one import() per
                           family), canConnect(), DRIVER_STATUS
    control-errors.ts      ControlUnavailableError, ControlValueError (re-exported by errors.ts)
    conformance.ts         describeDriverConformance(driver): shared vitest suite           [W0]
  transports/
    fake-hid.ts            navigator.hid / HIDDevice test double (input, output, feature)  [W0]
    webhid-feature.ts      WebHidFeatureTransport (A1)                                     [W3]
    feature-links.ts       feature-report link helpers and chooser filters (A1)
    web-bluetooth.ts       WebBluetoothTransport (generic GATT)                            [W4]
    ble-links.ts           Web Bluetooth link helpers, requestDevice() options, requestBleDevice()
    fake-bluetooth.ts      navigator.bluetooth test double                                 [W4]
  moma/
    codec.ts               envelope encode/decode, MomaAssembler                           [W2]
    profiles.ts            MOMA_6201_USB/BLE, MOMA_6303, MOMA_6701_USB/BLE                 [W2]
    __tests__/
  families/
    legacy/                LegacyMicDevice adapter (HollylandDevice → MicDevice), legacy controls [W0, then W1]
    6108/  index.ts products.ts protocol.ts commands.ts status.ts controls.ts sim.ts
           hardware-check.ts README.md __tests__/{vectors.ts, codec.test.ts, driver.test.ts}
    6201/  (same shape)
    6303/  (same shape)
    6701/  (same shape)
```

Each `families/<code>/index.ts` exports exactly one `driver: FamilyDriver` (plus family-specific helpers). W0 creates
the four folders with a stub driver (`status: 'stub'`, products only), so the registry and `index.ts` never change
again; family agents replace the stub content inside their own folder.

Code splitting (app build). Every family folder also has `runtime.ts` (its driver without the simulator and `?mock=`
presets: a `FamilyRuntime`) and `ids.ts` (the control ids and checks the UI needs before a product is opened);
`legacy/runtime.ts` serves the four `AA DD` families. The app imports `app.ts`, never `index.ts`, and opens devices with
`openMicDevice()` (core/loader.ts), which fetches the family's `runtime.ts` with import(): each family is its own chunk,
loaded when a product of that family is opened (the legacy one is also prefetched when the page is idle and when a
connect starts), and no simulator ships. The rows, links, support data and chooser filters stay in the main chunk, so
`requestDevice()` still runs inside the click. `src/lib/protocol/__tests__/app-entry.test.ts` fails when the app reaches
driver code statically. Tests, Node scripts and the dev server's `?mock=` presets keep the static registry.

### 3.3 Core contracts (sketch for W0)

```ts
// core/ids.ts
export type FamilyCode = '6118' | '6301' | '6302' | '6501' | '6108' | '6201' | '6303' | '6701'
export type LinkKind = 'webhid' | 'webhid-feature' | 'web-bluetooth' | 'bridge'

// core/types.ts
export interface SupportInfo {
  level: 'supported' | 'experimental' | 'recognised'      // recognised = named only, cannot connect
  hardware: 'tested' | 'sibling-tested' | 'untested'      // sibling = same protocol tested on another model
  testedOn?: readonly string[]  // e.g. "LARK A2 fw 3.0.2.008 · macOS Chrome WebHID: write-only · 2026-11-05"
  research: string              // e.g. "docs/research/families/m3-6303.md"
}

export type LinkSpec =
  | { kind: 'webhid'; reportId: 'byte0' | 'none' | number; outSizes?: readonly number[] }   // M3: reportId 8, [64, 512]
  | { kind: 'webhid-feature'; reportId: number; size: number }                              // A1: 5, 64
  | { kind: 'web-bluetooth'; filters: BluetoothLEScanFilter[]; service: BluetoothServiceUUID;
      write: BluetoothCharacteristicUUID; notify: BluetoothCharacteristicUUID;
      writeMode: 'with-response' | 'without-response' }

// ProductInfo gains (all optional, defaults computed for legacy rows):
//   familyCode: FamilyCode; support: SupportInfo; links: readonly LinkSpec[]; maxUnits: readonly UnitId[]
// `family: Family | null` keeps its meaning: the legacy family handled by HollylandDevice.

export type UnitId = 'rx' | 'tx1' | 'tx2' | 'tx3' | 'tx4' | 'rx2' | 'rx3' | 'rx4' | 'box' | 'earL' | 'earR' | 'remote'
export interface MicUnit {
  id: UnitId; online: boolean; version?: string; serial?: string; mac?: string
  battery?: number; charging?: boolean; muted?: boolean
  role?: 'primary' | 'secondary'; kind?: 'phone-rx' | 'camera-rx'
}

export type ControlId = string            // canonical ('noise.enabled') or family-scoped ('a1.eq', 'max2.tc.fps')
export type ControlValue = boolean | number | readonly number[]
export interface ControlSpec {
  id: ControlId
  label: string                           // official app label (R strings / iOS Localizable), e.g. "EQ Adjustment"
  group: 'mics' | 'receiver' | 'audio' | 'settings' | 'timecode' | 'monitoring' | 'advanced'
  kind: 'switch' | 'choice' | 'steps' | 'range' | 'action'
  options?: readonly { value: number; label: string }[]
  range?: { min: number; max: number; step: number; unit?: string; displayOffset?: number }
  perUnit?: readonly UnitId[]             // per-mic mute / gain
  safety: 'write' | 'disruptive' | 'destructive' | 'ota'
  confirmText?: string                    // disruptive: "The receiver restarts."
  readBack: 'status' | 'get' | 'push' | 'none'
  confidence: 'high' | 'medium' | 'low'
  source: string                          // A …/I … citation
}

export interface MicState {
  product: ProductInfo
  connected: boolean
  rx: 'unknown' | 'available' | 'unavailable'
  missedHeartbeats: number
  lastStatusAt: number | null
  units: { rx: MicUnit } & Partial<Record<UnitId, MicUnit>>
  values: Partial<Record<ControlId, ControlValue>>
  availability: Partial<Record<ControlId, { ok: boolean; reason?: string }>>   // gates + preconditions
  raw?: unknown                           // last decoded status struct, for the console
}

export interface MicDevice {
  readonly product: ProductInfo
  readonly transport: Transport
  readonly state: MicState
  readonly controls: readonly ControlSpec[]
  connect(): Promise<MicState>
  disconnect(): Promise<void>
  probe(): Promise<MicState['rx']>
  refresh(what: 'status' | 'identity' | 'settings'): Promise<void>
  set(id: ControlId, value: ControlValue, o?: { unit?: UnitId; confirm?: boolean }): Promise<SetResult>
  pauseHeartbeat(): void
  resumeHeartbeat(): void
  on<K extends keyof MicEvents>(event: K, listener: (...a: MicEvents[K]) => void): () => void
  onTraffic(listener: (e: TrafficEntry) => void): () => void
}

export interface FamilyDriver {
  readonly code: FamilyCode
  readonly status: 'stub' | 'experimental' | 'supported'
  readonly products: readonly ProductInfo[]
  readonly commands: Readonly<Record<number, { name: string; safety: Safety; retrySafe: boolean; source: string }>>
  createDevice(transport: Transport, product: ProductInfo, o?: MicDeviceOptions): MicDevice
  createSimulator(product: ProductInfo, o?: SimOptions): DeviceSimulator
  readonly mockPresets: readonly { id: string; label: string; productId: number; sim?: SimOptions }[]
  readonly hardwareCheck: readonly HardwareCheckStep[]     // read-only first-contact steps (§5.7)
}
```

The generic engine is parameterized by a per-family protocol spec. `Req` and `Msg` are the family's own request and
decoded-message types (A1: `{cmd, payload}`; Moma: `{target, items[]}` / one item):

```ts
export interface ProtocolSpec<Req, Msg> {
  encode(req: Req): Uint8Array                    // one complete frame, byte-exact to the Android builder
  createAssembler(): { push(chunk: Uint8Array): Msg[]; reset(): void; onGarbage?: (b: Uint8Array) => void }
  matches(req: Req, msg: Msg): 'done' | 'partial' | false   // batch "get all" requests complete on the last item
  ack(req: Req, msg: Msg): { ok: boolean; code: number | null }
  commandOf(req: Req): number                     // catalogue lookup for safety and retry rules
  describe(x: Req | Msg, dir: 'tx' | 'rx'): string
  probe(): Req
  heartbeat?: { request(): Req; intervalMs: number }    // absent for push-only links (MAX 2 BOX on Android; iOS polls 0x600B through it)
  onConnected?(ctx: EngineContext<Req>): Promise<void>  // identity reads, subscriptions (6201 0x6048)
  onMessage(ctx: EngineContext<Req>, msg: Msg, solicited: boolean): void   // status/pushes → units/values
  timing: { replyTimeoutMs: number; probeTimeoutMs: number; interFrameDelayMs: number }
}
// FamilyDevice<Req, Msg> implements MicDevice: user/background queues, coalescing, one request in flight,
// retries for retry-safe reads only, heartbeat with nested pause, rx-unavailable probe + blind writes,
// destructive gating from SupportInfo (§2.3), traffic log. It is a generalized copy of HollylandDevice's
// internals; HollylandDevice itself is not refactored (porting it onto the engine is optional, later).

export interface DeviceSimulator {
  readonly info: TransportDeviceInfo
  readonly capabilities: TransportCapabilities
  respond(packet: Uint8Array): Uint8Array[]                  // plugs into MockTransport.respond
  attach?(inject: (packet: Uint8Array) => void): () => void  // pushes: VU, BLE status, BT events
  faults: { dropReplies?: boolean; duplicateReplies?: boolean; chunkSize?: number; staleFeatureReply?: boolean }
}
```

### 3.4 Transports

**Contract change (`transport.ts`).** `send(frame)` receives one complete protocol frame exactly as the family's
Android builder produces it; the transport maps it onto its API (report ID, padding to the declared report size,
chunking). Legacy frames stay 64 bytes, so nothing changes for 6118/6301/6302. New optional capability fields:
`link: 'interrupt' | 'feature' | 'gatt' | 'bridge' | 'mock'`, `maxWrite?: number`. A synchronous transport (feature
reports) emits the reply through `onPacket` before `send()` resolves, so the engine needs no special case.

| Transport | Used by | Mapping | Notes |
|---|---|---|---|
| `WebHidTransport` (generalized, W0) | legacy, 6303, 6701 USB, 6201 USB | `sendReport(frame[0], pad(frame[1..], declaredSize))` for `byte0`/numbered IDs; `sendReport(0, frame)` for `none`; input `[reportId, ...data]` | Read output/input report sizes from `device.collections[].outputReports[].items` instead of the fixed 63 bytes; fall back to 63 for undeclared IDs (the A2 case, keeps today's bytes). M3: report 8, pad to the declared 63 or 511 (m3-6303.md §2.3). Chooser filters and `getGrantedDevices` come from the registry's `links`; for the M3's unconfirmed VID add a "show all HID devices" fallback (`filters: []`), because WebHID filters cannot name a `productId` without a `vendorId`. Frames longer than one report with no report-ID layer (6201/6701 USB) are rejected with a clear error until a descriptor shows how the device wants them [?]. |
| `WebHidFeatureTransport` (W3) | 6108 | `sendFeatureReport(5, frame[1..64])`, then `receiveFeatureReport(5)`; strip a leading `05` if Chrome includes it; emit | Check the echoed command at offset 4 and retry the GET once on mismatch (stale reply). 3000 ms write / 1000 ms read like Android. Never switches to report 6 (OTA). a1-6108.md §2.3. |
| `WebBluetoothTransport` (W4) | 6701 BOX, 6201 RX | `requestDevice({ filters, optionalServices: [service] })`, `startNotifications()` on the notify characteristic, writes with `writeValueWithoutResponse` (6701) or `writeValueWithResponse` (6201) | Generic, configured by the family's `LinkSpec`. Chunking: try the whole frame first, fall back to 20-byte chunks [?] (Chrome hides the MTU; Android requests 512). Notifications go to the family assembler, which must reassemble by item count and lengths. `gattserverdisconnected` → disconnect event. Filters: 6701 `services: [0xfee7]` or `serviceData: [{ service: 0xfee7 }]` [?]; 6201 `serviceData: [{ service: 0xbbbb, dataPrefix: [4, 1] }]` and `[4, 2]` (productLine 4 + RX deviceId 1/2; `[4]` alone also matched the TWS earphones, deviceId 3; melo-6201.md §1.2). |
| `BridgeTransport` + `scripts/bridge*.ts` (W0) | legacy, later 6303/6701 | WebSocket relay of interrupt packets | Accept packets up to the endpoint's `wMaxPacketSize` (512 for M3) instead of exactly 64; SUPPORTED list from the registry. A control-transfer channel for the A1 is only needed if Chrome cannot read Feature 5 (a1-6108.md §2.3); deferred. |
| `MockTransport` | all | unchanged | Already generic: `respond(packet)` + `inject()`. |

### 3.5 Shared Moma codec (`moma/`, W2)

One encoder/decoder for the `CommandPostBuilder` / `CommandStanderParser` envelope (A `protocol/core/sound/transfer/*`;
I `+[HLCommandFrameBuilder frameWithSource:target:control:commands:…]` @0x1000a3058), configured by a profile:

| Profile | reportId | target | control | start/end items | checksum | padding | Source |
|---|---|---|---|---|---|---|---|
| `MOMA_6303` | `0x08` | `0x00` | `0x00` | no | none | `< 64` → 64, `< 512` → 512, else as is (64 B exactly → 512) | m3-6303.md §3.1 |
| `MOMA_6701_USB` | – | `0x01` mobile / `0x02` camera (iOS sends 0 for mobile [?]) | `0x07` | yes | XOR | none | max2-6701.md §3.1, §9 #5 |
| `MOMA_6701_BLE` | – | per unit: 2 RX, 3 TX1, 4 TX2, 5 BOX, 10/11 TX3/4 | `0x07` | yes | XOR | none | max2-6701.md §3.1 |
| `MOMA_6201_USB` | – | `0x00` | `0x04` (iOS `0x00`) | no | XOR (iOS none) | none | melo-6201.md §3.1 |
| `MOMA_6201_BLE` | – | `0x01` | `0x04` | no | XOR | none | melo-6201.md §2.2, §3.1 |

Decoder rules (all three docs agree): accept `BB DD` (and `AA DD`); ignore source/target; read the checksum bits with
the **builder's** meaning but accept either bit order when deciding completeness (the Android parser reads them
reversed, melo-6201.md §3.2); never require a valid checksum, but report mismatches in the traffic log; split
multi-item replies into one message per item; item type 2 = set ack (`payload[0] == 0` OK), 3 = data, 0 = push.
The assembler resyncs on `BB DD` (a library extension; the apps do not resync).

### 3.6 Minimal refactor of existing files

| File | Change | Owner | Risk to 6118/6301/6302 |
|---|---|---|---|
| `transport.ts` | Contract wording (frame, not "64-byte packet"); optional `link`, `maxWrite` capability fields | W0 | none (optional fields) |
| `webhid.ts` | Descriptor-derived report sizes (63 fallback), registry-driven filters / granted devices / `pickDevice`, `none` framing for any length | W0 | low: A2 bytes pinned by a fake-hid regression test (`sendReport(0xAA, 63 B)`) |
| `bridge.ts`, `scripts/bridge.ts`, `scripts/bridge-server.ts` | Variable-length packets negotiated in `hello` (`maxPacket`), SUPPORTED from the registry | W0 | low (bridge tests) |
| `models.ts` | `ProductInfo` optional fields; legacy rows get `support`/`links`; non-legacy rows move to `families/<code>/products.ts` and are aggregated into `PRODUCTS`; VID constants move to `core/ids.ts` and are re-exported | W0 (rows 1/2/11/12/13: W1) | low: `PRODUCTS`, `lookupProduct`, `isSupportedProduct` keep their behaviour |
| `commands.ts` | `Family` gains `'6501'`; 6501 added to `COMMANDS[*].families` (about 6 call sites, legacy-6501.md §8) | W1 | low |
| `device.ts` | 6501 rules only: heartbeat link/battery-only for PID 1, volume wire map, TX label swap for display, NC-on precondition for 11/12/13 | W1 | low-medium, covered by device.test.ts |
| `mock.ts` | 6501 simulator profiles (6-byte heartbeat for PID 1, `0x16` = 3 for the Mini) | W1 | low |
| `codec.ts` | none | – | – |
| `index.ts` | Export `core/*`, `transports/*`, `moma/*`, `DRIVERS`, `createMicDevice`, and one namespace per family (`export * as a1 from './families/6108'`…) | W0 | none (additive) |
| `src/lib/state/session.svelte.ts` | `createMicDevice()` instead of `new HollylandDevice()`, Web Bluetooth connect path, `unsupported` only when neither WebHID nor Web Bluetooth exists, mock presets from the registry | W9 (Phase 3) | coordinate with the UI redesign workflow |

Import-cycle rule: `families/*/products.ts` import constants from `core/ids.ts` and types only (`import type`) from
`models.ts`, because `models.ts` aggregates them at module evaluation.

### 3.7 File ownership for parallel agents

| Owner | May edit | Must not edit |
|---|---|---|
| W0 (Phase 0, alone) | `core/**`, `transport.ts`, `webhid.ts`, `bridge.ts`, `scripts/bridge*.ts`, `models.ts`, `index.ts`, `transports/fake-hid.ts`, `families/legacy/**`, stub `families/*/` folders | `codec.ts`, `commands.ts`, `device.ts`, `mock.ts` |
| W1 (6501) | `commands.ts`, `device.ts`, `mock.ts`, `models.ts` legacy rows, `families/legacy/**`, legacy tests, `docs/PROTOCOL.md` (6501 section, after the current doc workflow ends) | anything under `core/`, `moma/`, `transports/`, other families |
| W2 (Moma) | `moma/**` | family folders (it publishes vectors other agents copy) |
| W3/W5 (A1) | `transports/webhid-feature.ts`, `families/6108/**` | everything else |
| W4 (BLE) | `transports/web-bluetooth.ts`, `transports/fake-bluetooth.ts` | everything else |
| W6 (M3) | `families/6303/**` | `moma/**` (request changes from W2) |
| W7 (MAX 2) | `families/6701/**` | same |
| W8 (MELO P1) | `families/6201/**` | same |
| W9 (UI) | `src/lib/state/**`, `src/components/**`, `src/lib/ui/**` | `src/lib/protocol/**` |

Rules: a contract change after Phase 0 goes through the W0 owner as a separate small change, never inside a family
package; family research corrections go to that family's doc in `docs/research/families/`.

### 3.8 What each driver contains

| Driver | Status mapping into `MicState` | Gates and preconditions | Simulator must model |
|---|---|---|---|
| legacy (6501 rows) | heartbeat `0x10`; PID 1 applies link/battery only; PID 11 swaps Mic1/Mic2 **for display only** | NC level needs NC on (11/12/13); PID 1 volume allowed without a mic (Android) | short 6-byte heartbeat (PID 1), 14-byte (others), `0x16` body | 
| 6108 A1 | `0x1F` heartbeat: tx1..tx4 online/battery/mute, NC on+level, volume, channel, auto-off, LED, EQ, reverb, mic recognition, signal mode; branch on LEN 17 / 22 / 23 as iOS does | mute row needs RX ≥ 1.0.1.3 (inclusive); 4 units when the RX version's 2nd part is 1; NC blocked when all online mics are muted; mic recognition needs both mics in 2-mic mode | SET→GET pairing, ack `0` = OK, 2/4-mic firmware, stale-reply fault |
| 6303 M3 | `0x6000` (30 B): TX/RX bitmasks, batteries (0xFF = phone RX), mute mask, NC, volume, channel (incl. 4-track), smart mix, LED, recognition, primary/secondary, 4T4R/2T2R, lock, hot shoe, refresh flag | global settings only on the primary RX; 4-track only in 4T4R; camera-only controls by PID; restart-causing: bit depth, 4-track, work mode | multi-RX topology, `isRefreshCanto`, 64/512 padding, unsolicited BT events |
| 6701 MAX 2 | USB `0x600B` (49 B: batteries incl. RX/BOX/earphones, charging, NC depth, gain, channel, TC, OWS, 4-mic); BLE pushes `0x6000`–`0x6002` + `0x600A` per unit, and (as iOS does) `0x600B` to target 2 every 3 s through the BOX | 4-mic, RX pairing, wireless monitoring need RX ≥ 3.0.0.50; safety track only via the BOX; stereo/safety refused with TC on unless TC mode 3; phone speaker, USB Output (iOS) and wireless monitoring restart the RX; timecode Reset needs a confirm; heartbeat byte 18 = 2 is a camera RX (iOS) | USB poll vs BLE push modes, start/end items, XOR, MTU-sized notification chunks |
| 6201 MELO P1 | `0x600B` (31 B: RX/box/mic/ear batteries, charging, links, 3.5 mm, NC, gain, remote), `0x600A` per unit (20 B, reversed version bytes), pushed VU `0x11EB` | V2 structures from RX 4.0.0.1; per-mic gain from 3.0.7.9; Pro Tuning USB-only; auto speaker output restarts | VU push timer after `0x6048`, batch replies, XOR on/off by control byte |

---

## 4. UI implications (for the redesign)

### 4.1 Cross-family changes

- **Connect screen:** one key per available link. "Connect over USB" (WebHID) and "Connect over Bluetooth"
  (Web Bluetooth, MAX 2 charging case and MELO P1). On Android Chrome only the Bluetooth key appears, so the app is no
  longer "unsupported" there. The steps and the "Receiver not in the list?" section gain the Bluetooth case.
- **Generic control renderer:** controls the bespoke modules don't cover are rendered from `ControlSpec`
  (`switch` → slide switch, `choice` → key row, `steps` → detent fader, `range` → slider with unit, `action` → key with
  confirm). This is what makes untested families usable without hand-built pages; bespoke modules stay for the mic
  channel module, NC, volume and channel mode.
- **Unit layouts:** 2 or 4 mic modules (A1 4-mic firmware, M3 4CH/4T4R, MAX 2 4-mic mode), decided at runtime from
  `state.units`. Extra unit cards: receivers list with primary/secondary (M3), charging case, earphones L/R,
  remote (MELO P1). Phone receivers show no RX battery (M3 reports 0xFF; MAX 2 hides it on 1026).
- **Mute becomes writable** on A1 (`0x16`), M3 (`0x1001`) and via faders on MELO P1; on A2/M2 it stays a read-only
  lamp. The mic module needs both states.
- **Meters:** app-side from USB audio as today, but the Audio page must handle 4-channel USB audio (M3 4CH PIDs) and,
  for MELO P1, device-pushed VU levels that work without microphone permission.
- **Restart flow:** reused for every disruptive control (A1 none; M3 bit depth / 4-track / wireless monitoring; MAX 2
  phone speaker / USB Output / wireless monitoring, plus the timecode Reset confirm; MELO P1 auto speaker output), driven by `ControlSpec.confirmText`.

### 4.2 New controls per family

| Family | New or changed controls (official app labels) | Pages |
|---|---|---|
| 6501 | Same as Lark M2 minus the NC switch: "NC Level" Weak/Strong (refused while NC is off on 11/12/13), "Volume" 6 buttons (PID 1 wire map `5,4,3,0,1,2`), "Phone Speaker" (restart). PID 11: Mic1/Mic2 labels swapped. No LED, lock, channel mode, auto-off or custom buttons. | Overview, Settings |
| 6108 A1 | Per-mic mute (Mic 1–4), NC switch + Weak/Medium/Strong, 6-step volume, Mono/Stereo, "EQ Adjustment" Low/Bright/Equalization, "Reverb Adjustment" switch + Small/Medium/Large, "Mic Recognition", "Schedule power off" 15 min/Never, "Indicator Light Switch", "Mode setting" Normal/Performance (advanced: the official app hides it behind a cloud flag). Info only: 2↔4-mic "Wireless settings" (not offered). | Overview, Audio (EQ/reverb), Settings |
| 6303 M3 | Up to 4 mic modules with mute and applied voice-profile name; receivers list (primary badge, locate by LED flash, switch primary); NC switch + 3 levels; RX volume: phone 6 segments, camera 3-gear dB dialog (−10…+10); Mono/Stereo/4-track; Smart mix; TX recognition; LED; TX button lock; auto power-off; camera power sync (camera RX); More Settings: playback without unplugging, bit depth (24-bit / 32-bit float, restart). Later: voice profiles ("Voice Enhancement", One-Tap Enhance, custom profiles written with `src/lib/dsp`), wireless monitoring page, paired devices. | Overview, Audio (voice profiles), Settings, Device |
| 6701 MAX 2 | 2/4 mic modules with charging state; "Dynamic Gain" High/Medium/Low or per-mic "Set gain to" −20…+20 dB; NC switch + depth slider (5–25 dB); Mono/Stereo/"Secure audio track" (BOX only); "Phone Speaker" (restart); "Lock Mic"; "Bit Depth" (internal recording) and "USB Output"; "Mic Recognition" (USB); BOX and earphone batteries; Timecode page (camera RX: switch, Mode 1–3, frame rate, timing method, live TC); Wireless Monitoring (toggle restarts the RX; OWS pair/delete, play/pause, volume); "4 Mic & 1 RX" switch and "RX Pairing Mode" (fw ≥ 3.0.0.50); system time sent on connect. | Overview, Settings, new Timecode and Monitoring pages |
| 6201 MELO P1 | Battery cards for RX, mics, case, earphones, remote; track faders with mute/solo (5 tracks), output volumes (USB, headphone, earphones), monitor, work mode (chat / singing / instrument), NC + level, mic gain (Near/Mid/Far or per mic from 3.0.7.9), bit depths, 3.5 mm jack I/O, LED brightness per unit, USB audio routing, auto speaker output (restart). Later: Easy/Pro Tuning DSP pages; presets library is out of scope. | New Mixer page, Settings |

### 4.3 Marking families as untested

Driven by `ProductInfo.support` (no per-component flags):
- **Header and connect screen:** an "Untested" plate next to the model name for `hardware: 'untested'`, and
  "Same protocol as Lark M2 (tested)" for `sibling-tested`. Hovering or tapping explains what was tested, from
  `support.testedOn`.
- **First connection** of an untested model shows a one-time notice: support comes from the official app's code;
  reading is safe; settings are sent as the official app sends them; risky actions are hidden. It links to the
  hardware check (§5.7) and to "Copy diagnostic report" (product, transport capabilities, HID collections or GATT
  services, the last 50 traffic entries, decoded status).
- **Per control:** `confidence: 'medium' | 'low'` adds a small "?" note ("value meaning not confirmed on hardware").
  Destructive and OTA controls are absent for untested models; disruptive ones keep the confirm step.
- **Confidence marks** from the redesign (solid = read back, hatched = sent but not confirmed, dashed = unknown) apply
  unchanged; on families whose transport is expected to read replies, a write-only result is itself a finding and the
  diagnostic report should say so.
- **Dev mock presets** (`?mock=a1`, `?mock=m3cam4`, `?mock=max2box`, …) come from `driver.mockPresets`, so every family
  can be designed and screenshot without hardware.

---

## 5. Test strategy without hardware

### 5.1 Golden byte vectors

Each family folder has `__tests__/vectors.ts`: `{ name, hex, source, decoded? }[]`, copied from the family docs, whose
frames were produced by re-implementations of the apps' builders (scratch tools `frames6108.py`, `frames.py` in the
families' scratch folders; these scratch files are temporary, so the vectors must be committed as test data).

| Family | Vectors available | Doc section |
|---|---|---|
| 6501 | 7 requests (Android padded form + iOS XOR byte) and 4 illustrative replies | legacy-6501.md §3 |
| 6108 | 20 Feature-5/6 frames + iOS EA equivalents; one decoded heartbeat body | a1-6108.md §3.6 |
| 6303 | 9 requests (64 and 512 B) + 2 illustrative replies; `ModAlgBelT` layout | m3-6303.md §3.3, §5.6 |
| 6701 | 7 requests with XOR + 2 constructed replies | max2-6701.md §3.3 |
| 6201 | 11 requests (USB, BLE, iOS, batch, start/end) + 2 hypothetical replies | melo-6201.md §3.4 |

Encode tests assert exact bytes; decode tests assert every field. Replies marked hypothetical in the docs only pin the
parser's layout, not device behaviour, and are labelled so in the test name.

### 5.2 Android ↔ iOS cross-checks

Where both apps were read, tests pin the agreement and the chosen side of each disagreement:
- A1: iOS EA frame (`AA DD cmd len payload XOR`) from the same request object as the Feature-5 frame; heartbeat offsets
  (Android `ProGetHearInfo` vs I `initA1HeartInfo:` @0x1001fa798) as one table-driven test over LEN 17/22/23; the
  `0x3F` read-back disagreement (`0x40` Android vs `0x46` iOS) is documented in the test.
- M3: the Android `Command6303` ID table equals the iOS `HL6303CommandType` raw values (@0x100c1a318), committed as a
  derived ID list fixture; the `0x1F02` naming conflict is pinned.
- MAX 2: Android `BleMicCmd` frames vs I `frameWithSource:…` builder; heartbeat offsets vs I `HLBleHeartEntity`.
- MELO P1: control `0x04` (Android, XOR) and `0x00` (iOS, none) both encode and both decode.
- 6501: same builder as the M2 (`headerWithCommand:payload:andType:` @0x10027a484); volume steps 0..5 (Android) vs
  0..2 (iOS) pinned to the Android range as for the M2.

### 5.3 Simulators and the shared conformance suite

`core/conformance.ts` exports `describeDriverConformance(driver)`, which every family test file calls. Against the
family simulator it checks:
1. `connect()` sends only `read` commands until `rx` is decided; the probe is the heartbeat (or `0x600A` on BLE pushes).
2. A status message updates `units` and `values`; offline units get no reply and go offline in state.
3. Every `write` control round-trips: `set()` → ack → value visible in the next status or GET.
4. Version gates: below / at / above each threshold (A1 1.0.1.3 inclusive, MAX 2 3.0.0.50, MELO 3.0.7.9 and 4.0.0.1).
5. Preconditions refuse exactly what the app refuses (no mic online, all muted, NC off, secondary RX…).
6. `dropReplies` → `rx: 'unavailable'`, blind writes allowed only for idempotent controls, toggles refused.
7. `duplicateReplies` and stale replies are ignored; chunked replies (every split point) give identical messages.
8. No `destructive`/`ota` command is ever sent for an untested product, even with `allowDestructive`.
9. Unknown commands get no reply and time out cleanly; disconnect rejects pending requests.
10. **Populated after connect**: every readable control has a value once the start-up reads have settled (below).

#### Check 10: populated after connect (added 2026-11-06)

Why: on a real Lark M2 (PID 7) the volume stayed unknown after every reconnect. The mobile M2 ignores heartbeat
volume (A `larkc1/HLDeviceActivity.onEvent` cmd 16: `productId >= 8`), and the library read `0x04` at start-up only
for the 6501 group (fixed in `device.ts` `fetchExtraSettings`, PROTOCOL.md §11.8). Check 10 fails on the pre-fix
`device.ts` and stops the same class of bug in every driver.

What it does (`core/conformance.ts`, per product and per mock preset that sets simulator options):
- connects to the simulator with the **default start-up reads** (`fetchIdentity` / `fetchSettings` on, whatever
  `deviceOptions` says; fast timing; no status poll, so only `connect()` and its start-up reads count), waits
  `settleMs` and then until the device is idle (`FamilyDevice.idle()`, `LegacyMicDevice.idle()`);
- for every **readable** control, `isReadableControl(c)`: `c.readBack` is `'status'`, `'get'` or `'push'` and
  `c.kind !== 'action'`. `ControlSpec.readBack` is the only declaration; `'none'` means write-only;
- requires a value in `MicState.values[controlKey(id, unit)]` for every online unit in `perUnit` (offline units are
  listed, not checked), and that the value passes `validateControlValue` (the A2S simulator's volume 3 outside
  0..2 was found this way);
- accepts a missing value only when `MicState.availability` says why (`ok: false` with a reason: firmware too old, a
  precondition such as `noise-off`) or the driver declares an exception. `'version-unknown'` is **not** a reason:
  once the start-up identity reads have run, the RX version must be known;
- inversely, with every reply dropped (and no packet from the device) no readable control may have a value, so a
  driver cannot pass by filling in defaults.

Exceptions are explicit, with a reason, and are themselves checked:

```ts
describeDriverConformance(driver, {
  // Illustrative keys and reasons; a real reason cites where the apps (do not) read the value.
  notReadOnConnect: {
    'family.control': 'why the value stays unknown after connect (source)',                  // every product and run
    'mic.mute:tx3': { reason: 'why TX3 has no mute state here (source)', runs: ['default'] }, // one unit, one run
    [CONTROL.VOLUME]: { reason: 'why this PID has no volume read (source)', productIds: [1027] }, // one product
  },
})
```

Keys are a control id (every unit) or a per-unit key (`'mic.mute:tx3'`); `runs` takes `'default'` or a mock
preset id. The suite fails on a reason under 10 characters, a key that is not a readable control of the driver, an
unknown product or run, and on a **stale** exception (it applies to a run but the value is known there, or `availability` already explains it). Reasons are
printed in the test name. `checkPopulatedAfterConnect(driver, product, o)` returns the full report (populated,
unavailable, excepted, offline, missing with a hint, invalid, stale, values) for family-specific tests.

How Phase 2 drivers (W5–W8) satisfy it:
1. Give every control an honest `readBack`: where the official app reads the value (heartbeat field, GET command,
   push). Use `'none'` only when neither app can read it back; cite the source as for every other field.
2. Map the status reply in `onMessage` for every field the product's app reads there, per PID where the app
   branches (as the M2 does on `productId`).
3. Send the GET of every GET-backed control from `ProtocolSpec.onConnected` when `ctx.options.fetchSettings`, in
   the official app's start-up order, and the identity reads under `fetchIdentity`, so firmware gates resolve.
4. Push-backed values (MAX 2 BOX `0x6000`–`0x6002`, MELO P1 VU): the simulator's `attach()` pushes what the device
   pushes after connect (or `onConnected` sends the subscription, 6201 `0x6048`).
5. Report a firmware gate or precondition in `availability` with a reason; a value that stays unknown for another
   reason goes into `notReadOnConnect` with the reason and the narrowest scope.

Status on 2026-11-06: legacy 6118/6301/6302/6501 (every row, through `LegacyMicDevice`; per-product pins and the
M2 regression in `families/legacy/__tests__/populated.test.ts`), the toy drivers (engine, Moma, BLE) and the A1
read-only wire driver pass. Since Phase 2 the four family drivers pass it too, with their controls, for every product
and every mock preset with simulator options: the registered A1 driver, and `createM3Driver()`, `createMax2Driver()`
and `MELO_DRIVER` (the registry still holds stubs for 6201/6303/6701, which pass trivially; §2.4).

### 5.4 Transport fakes and property tests

- `fake-hid.ts`: an `HIDDevice` with configurable collections (A2 layout, M3 report 8 at 63/511 B, A1 Feature 5/6),
  recording `sendReport` / `sendFeatureReport` calls, answering `receiveFeatureReport` with or without the ID byte, and
  firing `inputreport`. Pins today's A2 mapping (`sendReport(0xAA, 63 B)`) as a regression test.
- `fake-bluetooth.ts`: `navigator.bluetooth` with a GATT server whose characteristic forwards writes to a simulator and
  delivers notifications in MTU-sized pieces (20, 182, 509 bytes).
- Property tests (plain loops, no new dependency): random payloads round-trip through every codec; random chunk
  splits and leading garbage never change the decoded messages; random bytes never throw from a decoder.

### 5.5 Emulated hardware (optional, uses machines already on hand)

- **Linux `uhid`:** a small Node or Python script creates a virtual HID device with the A1 (Feature 5/6) or M3
  (report 8, 63/511 B) descriptor and answers with the family simulator. Chrome on that Linux machine then exercises the
  real WebHID code path end to end. It cannot reproduce macOS/Windows filtering.
- **BLE peripheral:** emulate the MAX 2 BOX (`FEE7`/`FEC1`) or the MELO P1 RX (`FFE0`/`FFE1`/`FFE2`, service data
  `0xBBBB`) with nRF Connect's GATT server on the Android phone, or with BlueZ on the Linux machine running the TS
  simulator. Chrome on macOS/Windows (and on the phone, against the Linux peripheral) then tests the Web Bluetooth
  transport, chooser filters, notifications and chunking for real.

### 5.6 What to test with the hardware on hand (LARK A2, Lark M2/M2S; Android phone, Linux, Windows)

**Lark M2 / M2S test (next session).** It validates the legacy engine on a second family and stands in for the whole
6501 group:
1. Record the HID descriptor (`npx tsx scripts/probe.ts list`, or WebHID `device.collections`): report IDs and sizes.
   This decides the macOS/Windows column for rows 3–9.
2. Connect in Chrome on macOS, Windows and Linux: does the connect probe get a heartbeat reply (`rx`)?
3. Heartbeat length, the `0x16` body and whether `0x35` (sent to every 6501 PID by Android) gets an answer.
4. **6501 profile over real M2 hardware:** connect with `HollylandDevice`'s existing `product` override set to the
   PID 12 (Lark M1) row and run the read-only path (heartbeat, version, serial, `0x11`, `0x04`) and the two writes the
   group shares (NC level `0x06`, volume `0x05`). Same commands, same firmware generation.
5. The local bridge with the M2 (interface and endpoint numbers).

**LARK A2:** regression of the generalized `WebHidTransport` (bytes must stay `sendReport(0xAA, 63 B)`), the
`LegacyMicDevice` adapter and the bridge; a **Linux** run (hidraw is write-only on the M2, PROTOCOL.md §11.9; the A2
should match) and a **Windows** run (expected write-only) to replace the "expected" entries in §1.2.

**Android phone:** Web Bluetooth transport against an emulated peripheral (§5.5); checks that the connect screen offers
Bluetooth only, and that permission prompts and disconnects behave.

### 5.7 First-contact checklists (built into the app as `driver.hardwareCheck`)

Read-only first, one reversible write last, each step recorded into the diagnostic report:

| Family | Steps |
|---|---|
| 6501 | descriptor; `0x10` heartbeat (length); `0x03` versions RX/TX; `0x15` serials; `0x16` body; reversible write (the group has no LED): volume one step and back |
| 6108 | list `featureReports` (5 = 63 B? 6 = 159 B?); `0x1F`; `0x0D [00]`; reply bytes 1–3; does `receiveFeatureReport` include the ID byte; toggle LED `0x21` and confirm in the heartbeat; the set-ack byte (Android `0` = OK vs iOS `!= 0xFF`) |
| 6303 | descriptor (report 8 sizes), VID; `0x6000` (capture source/target/type bytes); `0x600A [6]`; `0x6012 [0]`; whether 63-byte writes are accepted; LED `0x6009` and back |
| 6701 | BLE: advertised services (FEE7 in UUID list or only service data), notification sizes, pushed item types and cadence; `0x600B` to target 2 through the BOX (iOS polls it every 3 s); `0x600A [1]`; USB: descriptor, `0x600B`, whether broadcast target 0 works |
| 6201 | BLE: advertised name and service data (`04 01` / `04 02`), `FFE0` visible, notification fragmentation, long writes vs split writes, write without response; `0x600A [0]`; `0x600B`; whether the reply carries XOR when the request had control `0x00`; LED `0x2000` and back |

---

## 6. Open questions that would change this plan

1. **Legacy descriptors (M2 test):** if M2/M2S replies use a declared report ID or no report IDs, the 6501 group
   becomes fully usable on macOS and Windows without the bridge; if not, it stays write-only there like the A2.
2. **A1 Feature 5 declaration:** if it is not declared, Chrome cannot read it and the A1 needs the bridge's
   control-transfer channel (macOS IOKit forwards GET_REPORT for undeclared IDs to the device, PROTOCOL.md §11.2).
3. **M3 VID and report sizes:** an undeclared 511-byte input report would truncate voice-profile replies
   (`0x1F04`/`0x1F18`); home and settings traffic fits 64 B.
4. **Web Bluetooth chunking:** whether the MAX 2 BOX and MELO P1 accept frames split across ATT writes; Chrome cannot
   request MTU 512 like the Android app. Neither app uses ATT long writes (Android stays within MTU 512 − 3, iOS cuts at
   `maximumWriteValueLengthForType:` and writes without response), so the transport's whole-frame-with-response
   default for frames above the negotiated MTU is a library choice; iOS shows MELO P1 `FFE1` also takes writes without
   response (melo-6201.md §2.2).
5. **MAX 2 and MELO P1 USB report layout:** frames longer than one report with `AA` at byte 0 have no clean WebHID
   mapping; the USB paths of both stay behind BLE until a descriptor is seen.
