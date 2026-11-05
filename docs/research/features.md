# HollyAudio feature inventory: LARK A2 (6118) and LARK M2 / M2S (6301 / 6302)

Status: static analysis of HollyAudio 3.1.0 (Android `com.hollyland.larkc1`, iOS `com.hollyland.larkc2`). No device traffic was generated for this document.
Scope: the user-facing feature catalogue (screens, controls, values, states, copy) and browser feasibility. Byte-level framing, checksums and transport belong to the protocol research documents. This document only states which command each feature uses and how the value is encoded, so features can be linked to the protocol.

> **Verified on hardware since (LARK A2, macOS, Chrome, 2026-11-05).** Details are in `docs/PROTOCOL.md` §11.7.
>
> - Chrome WebHID writes on macOS take effect: the indicator light and channel mode.
> - The **TX button toggles noise cancellation** and does not mute. That partly answers open question 6: the A2
>   still has no known way to mute a TX.
> - Turning NC on restores the last level used. That answers the "what level is restored" part of open
>   question 1. The first enable showed Medium.
> - A TX docked in the charging case reports **offline**.
> - The local USB bridge gives full live state on macOS, while the receiver's USB audio is paused.

## 0. TL;DR

* The LARK A2 has a small app surface: one home screen with 6 device settings, a "More Settings" screen with 3 toggles and 4 sub-pages (Device Information, Paired Devices, Firmware Update, User Manual), plus Factory Reset.
* All A2 settings are **RX-global**. No setting targets one TX. The per-TX items are status only (online, battery, charging, mute), plus "Remove Pairing" and firmware update.
* Every A2 setting is **device-side** and can be done over WebHID. The only app-side feature on the A2 home screen is the pair of VU meters. The phone computes them from the USB audio input stream. A browser can do the same with `getUserMedia` and Web Audio.
* The A2 app has no recording, no DSP, no AI and no cloud features. Cloud is used only for the firmware catalogue and download, the user manual URL, analytics and account.
* Naming: Android `product_6301` is "Lark M2" (USB PIDs 7/8, Eagles 32/33) and `product_6302` is "LARK M2S" (PIDs 1029/1030). The task brief's "LARK M2 (6302)" is really the M2S. Both are covered in section 16.
* The 8 bundled voice-preset JSONs (`pure_vocals_0.json` and the rest) are LARK M3 (6303) "Custom Voice Profile" templates: EQ, compressor, de-esser, exciter and LUFS settings. They do not apply to the A2 or the M2/M2S.

## 1. Sources and citation conventions

| Prefix | Root |
|---|---|
| `A:` | Android decompiled sources, `<scratchpad>/jadx-out/sources/` |
| `R:` | Android decoded resources (created by this agent with `jadx --no-src`), `<scratchpad>/jadx-res/resources/` |
| `iOS:` | `/Applications/larkSound.app/Wrapper/larkSound.app/`. `L["<zh key>"]` is `en.lproj/Localizable.strings`. Class and ivar names come from `otool -ov larkSound`. |

String values are quoted exactly from `R:res/values/strings.xml` (`@string/<name>`). The base APK has only the default (English) `values/`. `config.zh.apk` was not in the extracted XAPK. Chinese source strings come from the iOS `Localizable.strings` keys.

## 2. Product identification

| Code | USB productId (app constant) | Display name | Android screen | Source |
|---|---|---|---|---|
| 6118 | 1041 = 0x0411 | "LARK A2" | `C6118DeviceActivity` | `A:com/hollyland/application/common/protocol/Product.java` `PRODUCT_6118`; `@string/product_6118` |
| 6118 camera | 1042 = 0x0412 | `@string/product_6118_camera` = "LARK A2S". The home screen and device card still show "LARK A2" (`DeviceCompat.get6118DisplayName()` always returns `product_6118`). | same activity, with variant branches | `Product.PRODUCT_6118_CAMERA`; `A:com/hollyland/larkc1/ui/connect/DeviceMainItemHolder.java#resolveCardTitle` |
| 6302 | 1029 (mobile RX), 1030 (camera RX) | "LARK M2S" | `HLDevice6302Activity` | `Product.PRODUCT_6302_MOBILE/CAMERA`; `@string/product_6302` |
| 6108 | 1031 | "LARK A1" | `HLDevice6302Activity` (6108 branch) | `A:com/hollyland/larkc1/utils/OpenPageHelper.java#obtainUsbPageIntent` |
| 6301 | 7 (mobile), 8 (camera); Eagles 32/33 | "Lark M2". iOS `L["LARK MIX"]` = "LARK M2" (LARK MIX is the China-market name). | legacy `HLDeviceActivity` | `A:com/hollyland/application/common/compatibility/DeviceCompat.java#getDeviceName`; `OpenPageHelper` |

Routing: when a USB device is attached, `OpenPageHelper.obtainUsbPageIntent(productId)` maps 1041/1042 to `C6118DeviceActivity`, 1029/1030/1031 to `HLDevice6302Activity`, and 1/7/8/11/12/13 to `HLDeviceActivity` (`A:com/hollyland/larkc1/utils/OpenPageHelper.java`; same table in `A:com/hollyland/larkc1/ui/connect/DeviceModelActivity.java` around line 749). The main screen also routes a device with vendorId == `USBHIDService.VENDOR_ID` and productId 1041, even if the manufacturer string check fails (`A:com/hollyland/larkc1/ui/connect/MainFragment.java#isC6118UsbDevice`).

## 3. LARK A2 navigation map (Android, iOS equivalent in brackets)

```
Device home  C6118DeviceActivity                  [HLLark6118View in HLDeviceController]
 ├─ back
 └─ gear (red dot = firmware update available) -> More Settings  MoreSetting6118Activity   [HLDeviceSetViewController]
      ├─ "Feature Settings"                         [HL6118FunctionSetView]
      │    ├─ Smart battery life      (toggle, PID 1041 only)
      │    ├─ Mic auto power-off      (toggle)
      │    └─ External speaker without unplugging (toggle -> RX restart)
      ├─ "General Settings"                         [HLDeviceGeneralSetView]
      │    ├─ Device Information  -> DeviceInfoActivity
      │    ├─ Paired Devices      -> PairDeviceActivity
      │    ├─ Firmware Update     -> C6118DeviceVersionUpgradeActivity -> C6118FirmwareUpgradeActivity
      │    └─ User Manual         (PID 1042 only) -> PDF web viewer
      └─ Factory Reset  (confirm dialog)
```
Sources: `R:res/layout/activity_device_home_6118.xml`, `R:res/layout/activity_more_setting_6118.xml`, `A:com/hollyland/larkc1/c6118/ui/home/C6118DeviceActivity.java#setupTitleBarActions`, `A:com/hollyland/larkc1/c6118/ui/setting/MoreSetting6118Activity.java#initView`.

## 4. LARK A2 home screen

### 4.1 Header

| Element | Behaviour | Source |
|---|---|---|
| Title | "LARK A2" (`DeviceCompat.get6118DisplayName()`). The layout placeholder is "6118". | `C6118DeviceActivity#initView`; `activity_device_home_6118.xml#tv_title` |
| Back | `onBackPressed` | `#setupTitleBarActions` |
| Settings gear | Opens More Settings. The icon becomes `ic_to_device_setting_upgrade_dot` when `C6118FirmwareUpgradeCoordinator.shouldShowReminderDot(result)`, which is true when any upgradeable target exists. Needs a cloud check. | `#updateSettingEntry`; `A:com/hollyland/larkc1/c6118/data/firmware/C6118FirmwareUpgradeCoordinator.java#shouldShowReminderDot` |
| Product banner image | `DeviceCompat.getDeviceAd(productId)` (artwork; not copied) | `#initView` |
| Loading dialog | Shown until the first heartbeat state when no cached runtime heart exists | `#initView` (`prepareInitialPageState() == null`) |

### 4.2 Status displays

| Display | Data | Rendering rules | Source |
|---|---|---|---|
| **Camera RX row** (PID 1042 only, `rx_camera_status` hidden otherwise) | `rxCamBattery` (0-100), `rxCamCharging` | Label "Camera RX". Text "--" when battery == 0. "Low" when battery ≤ 10 (`C6118BatteryPolicy.isLowBattery`). Otherwise "Normal". Battery glyph fill = battery/100. The charging animation is never shown: `updateBatteryClipState(..., isCharging=false, ...)` is called even though `rxCamCharging` is parsed. | `C6118DeviceActivity#updateRxCameraBatteryView`; `A:com/hollyland/larkc1/c6118/data/C6118BatteryPolicy.java`; `C6118DeviceActivityKt.shouldShowRxCameraStatus` (== 1042) |
| **Mic 1 / Mic 2 cards** | `txNOnline`, `txNBattery`, `txNCharging`, `txNMuted` | Labels "Mic 1" / "Mic 2". Card alpha is 1.0 when online and 0.6 when offline (`MIC_CARD_OFFLINE_ALPHA`). Battery text shows only when online and battery > 0: "Charging" if charging, else "Normal" if battery > 10, else "Low". Otherwise the text is blank. The glyph is shown only when online and battery > 0, fill battery/100, with a charging animation. | `#updateBatteryView`, `#updateMicCardState`, `#updateMicCardDisabledState` |
| **Mute indicator** (per TX, read-only) | `txNMuted` and `txNOnline` | The label group, label text and mute icon get `selected=true` (muted style) when muted and online. The app cannot mute a TX on the A2: `ProtocolSender6118` has no mute setter. | `#updateMicMuteView`; `A:com/hollyland/protocol/core/sound/sender/ProtocolSender6118.java` |
| **Level meters** (per TX, `AudioLevelView`) | **App-side.** Android `AudioRecord` on the USB input, not HID | Range −60…0 dB. Forced to −60 when the TX is offline or muted. See section 4.6. | `A:com/hollyland/larkc1/c6118/ui/home/C6118AudioLevelMonitor.java`, `C6118VuLevelMapper.java` |
| **Connection toast** | TX online transitions | "%1$s %2$s" built from "Mic 1"/"Mic 2" and "Connected"/"Disconnected", for example "Mic 1 Connected". Shown only when the host activity is on top. | `A:com/hollyland/larkc1/c6118/ui/base/C6118MicConnectionToastHost.java#showMicConnectionToast`; `data/runtime/C6118GlobalMicConnectionToastCoordinator.java` |

### 4.3 Device controls on the home screen (all RX-global)

Values are the integers passed to `ProtocolSender6118` (`A:com/hollyland/mic_usb/messenger/UsbMessenger6118.java`). Command IDs are from `A:com/hollyland/protocol/core/sound/command/type/Command6118Usb.java`. Read-back fields are from the heartbeat (section 15).

| # | Label (exact) | Type | Options and wire value | Read-back | Dependencies and disabled states | Source |
|---|---|---|---|---|---|---|
| 1 | **"Noise Cancellation"** | toggle (`noise_level_switch`) | on/off → `setNoiseSwitch(isOpen)` → cmd **25 (0x19) NOISE_SWITCH_SET**. The payload is the constant `{0x02}` for both on and off (`CmdSetNoiseSwitch6118.encodeLegacyPayload`). The legacy `Pro_set_noise_status` also sends a constant 2, so this looks like a **toggle** command. | `noiseOpen = heart.noiseLevel != 0` | Blocked if no TX is online (toast "Mic not connected, current function not available"). Also blocked if every online TX is muted (toast "Mic is currently muted. Noise cancellation settings are unavailable."). See `resolveRxAndNoiseBlockReason`. | `C6118DeviceActivity#setupNoiseActions`; `HLDevice6118ViewModel#resolveRxAndNoiseBlockReason`; `A:com/hollyland/protocol/core/sound/command/device6118/CmdSetNoiseSwitch6118.java` |
| 1a | Level: **"Weak" / "Medium" / "Strong"** | 3-way segmented (`low_level`/`medium_level`/`strong_level`). Visible only while the switch is on. | Weak = 1, Medium = 2, Strong = 3 (`DeviceConnectVariable.NoiseLevel`) → `setNoiseLevel(level)` → cmd **6 (0x06) NOISE_LEVEL_SET**, payload `[level]` coerced to 0..3 | `heart.noiseLevel` (0 = off, 1..3) | Has no touch interceptor of its own (no block check). It is reachable only when the switch is on. | `#setupNoiseActions`, `#updateNoiseView`; `A:com/hollyland/blemic/device/DeviceConnectVariable.java#NoiseLevel`; `CmdSetNoiseLevel6118` |
| 2 | **"RX volume"** | segmented slider (`VolumeSegmentBar`): tap or drag selects a segment | 0-based index 0..5 (**6 steps**, PID 1041) or 0..2 (**3 steps**, PID 1042) → `setVoiceLevel(index)` → cmd **5 (0x05) VOICE_LEVEL_SET**, payload `[index]` | `heart.voiceLevel` | Blocked if no TX is online | `#setupVoiceLevelActions`; `C6118DeviceActivityKt.homeRxVolumeStepCount` (1042 → 3, else 6); `A:com/hollyland/larkc1/c6118/ui/home/widget/VolumeSegmentBar.java` |
| 3 | **"Channel Mode"**: "Mono" / "Stereo" / "SafeTr" | 3-way segmented. SafeTr is an icon plus text. iOS `L["hl_safe"]` = "SafeTr" (zh "安全音轨", Safety Track). | Mono = 0, Stereo = 1, SafeTr = 2 → `setVoiceMode(v)` → cmd **24 (0x18) VOICE_MODE_SET** | `heart.voiceMode`. Any value other than 0/1 renders as SafeTr. | Blocked if no TX is online. A change restarts the level monitor in the new capture mode. | `#setupVoiceModeActions`, `#updateVoiceModeView`; analytics map `C6118AnalyticsReporterKt.resolveChannelModeValue` (0 单声道, 1 立体声, 2 安全音轨) |
| 4 | **"Bel canto preset"** (zh 美声预设) | toggle (`reset_switch`) plus 3 buttons visible only when on | Switch → `setBeautyVoice(enable, currentPreset)`. Button → `setBeautyVoice(1, preset)`. Bright = 0, Low = 1, Balance = 2 (`DeviceConnectVariable.PRESET`). Cmd **58 (0x3A) BEAUTY_VOICE_SET**, payload `[enable(0/1), mode]`. | `heart.beautyAudioOpen` (byte 14 bit 0), `heart.beautyAudioMode` (byte 14 bits 1-7) | Blocked if no TX is online. The switch and the preset buttons share one rollback group. | `#setupEqActions`, `#setupEqPresetButton`, `#updateEqView`; `HLDevice6118ViewModel.handleUserIntent$lambda$13`; `CmdSetBeautyVoice6118` |
| 5 | **"Indicator Light Switch"** | toggle (`mic_light_switch`, layout default checked) | on → `setLight(0)`, off → `setLight(1)` (inverted, `LEGACY_LIGHT_VALUE_OPEN = 0`) → cmd **57 (0x39) LIGHT_SET** | `lightOpen = heart[13] == 0` | Blocked if no TX is online | `#setupLightActions`; `HLDevice6118ViewModel.handleUserIntent$lambda$11` |
| 6 | **"Mic Recognition"** (zh Mic识别) | toggle (`mic_identify_switch`). The section is visible only when the indicator light is on. A recognition illustration shows when light and recognition are both on. | on = 1 / off = 0 → `setTxIdentify(v)` → cmd **59 (0x3B) TX_IDENTIFY_SET** | **Not in the heartbeat.** Fetched by cmd **60 (0x3C) TX_IDENTIFY_GET** on every `onStart` (`requestTxIdentifyNow`). The reply is `TxIdentifyInfo(isOpen)`. | Blocked if no TX is online. Hidden while the light is off. | `#setupTxIdentifyActions`, `#updateMicLightView`; `C6118DeviceActivityKt.shouldShowMicIdentifySection/shouldShowMicRecognitionImage`; `HLDevice6118ViewModel#handleNotification` |

Layout defaults (before the first heartbeat): noise switch off, preset switch off, light on, mic recognition on (`checked=` in `activity_device_home_6118.xml`). These are placeholders, not device factory defaults. Factory defaults are unknown.

### 4.4 Blocking rules (exact)

`installTouchInterceptor` swallows the touch and shows a toast when a block reason is present (`C6118DeviceActivity#installTouchInterceptor`, `#handleBlockedReason`):

* `resolveMicRequiredBlockReason()` returns `MIC_DISCONNECTED` when neither TX is online. Applies to RX volume, Channel Mode, Bel canto (switch and buttons), Indicator Light and Mic Recognition. Toast: **"Mic not connected, current function not available"** (`@string/c6118_device_disconnect`).
* `resolveRxAndNoiseBlockReason()` returns `MIC_DISCONNECTED` when no TX is online. It returns `ALL_ONLINE_MIC_MUTED` when every online TX is muted. Applies to the Noise Cancellation switch only. Toast: **"Mic is currently muted. Noise cancellation settings are unavailable."** (`@string/c6118_close_mic_mute`).
* The settings gear, back button and More Settings are never blocked.

### 4.5 Write semantics and feedback

* **Optimistic UI.** The control updates its local state immediately (`updateLocalHeartInfo`), then queues the operation in `pendingSetOperations` (a FIFO deque) and sends it.
* **Response matching.** Every `Protocol6118Data.SetResponseData(isSuc)` pops the oldest pending operation. The app does not key responses to commands, so a web client should **serialize writes** (one outstanding set at a time).
* **Failure rollback.** On `isSuc == false`, only that field is reverted to the last heartbeat value (`rollbackOptimisticOperation`). The revert is skipped while another operation of the same group is still pending. EQ_SWITCH and EQ_PRESET form one group (`HLDevice6118SetOperation.hasSameRollbackGroup`).
* **Toast after every home set:** "Setup successful" / "Setup failed" (`@string/c6118_device_set_success` / `c6118_device_set_fail`, `C6118DeviceActivity#showSetResult`).
* **Heartbeat wins.** Each heartbeat replaces both `deviceHeartInfo` and `uiHeartInfo` (`applyDeviceHeartInfo`).
* **Polling cadence.** Heartbeat poll every **1000 ms**, with an initial delay of 1000 ms (`A:com/hollyland/larkc1/c6118/data/runtime/C6118RuntimeSession.java` `HEART_BEAT_INTERVAL_MS`, `INITIAL_HEARTBEAT_DELAY_MS`).

Sources: `A:com/hollyland/larkc1/c6118/ui/home/viewmodel/HLDevice6118ViewModel.java` (`handleUserIntent`, `handleNotification`, `rollbackOptimisticOperation`, `sendHomeSetOperation`).

### 4.6 VU meter algorithm (app-side; reproduce in Web Audio)

* **Capture.** Android `AudioRecord(source=MIC(1), 16-bit PCM)`. Mono at **8 kHz** when channel mode is Mono or SafeTr. Stereo at **16 kHz** when channel mode is Stereo. The monitor restarts on every channel-mode change, and runs only while the home screen is started. It needs RECORD_AUDIO permission. Source: `C6118AudioLevelMonitor` constants `SAMPLE_RATE_MONO = 8000`, `SAMPLE_RATE_STEREO = 16000`, `#setupAudioRecord`, `#isMonoCaptureMode`.
* **Level.** RMS over the read buffer, `dB = max(20·log10(rms/32767), −60)` (`#calculateDbLevel`). In stereo, L feeds Mic 1 and R feeds Mic 2 (`#calculateStereoLevel`). In mono, both meters show the mono level. In SafeTr, Mic 2 shows the mono level −6 dB (`SAFE_TRACK_ATTENUATION_DB = 6.0`, `attenuateSafeTrackLevel`).
* **Display mapping** (`C6118VuLevelMapper.mapRawDbToDisplayLevel`). 20 segments, piecewise-linear on raw dB: (−45 dB → 0 segments), (−17 → 6), (−10 → 13), (−4 → 18), (0 → 20). Anything ≤ −45 shows 0 segments. The result is re-expressed as `segments/20·60 − 60` dB for `AudioLevelView`.
* A meter is forced to −60 when its TX is offline or muted (`#buildDisplayLevels`).

## 5. More Settings (A2)

Title "More Settings". Section headers "Feature Settings" and "General Settings" (`R:res/layout/activity_more_setting_6118.xml`).

| Label (exact) | Type | Wire mapping | Read-back | Visibility and behaviour | Source |
|---|---|---|---|---|---|
| **"Smart battery life"** (zh 智能续航). iOS ivars `manualEnduranceOverride` / `fetchEnduranceWorkItem`. | toggle | on → 1 / off → 0 → `setSmartBattery` → cmd **61 (0x3D) SMART_BATTERY_SET** | cmd **62 (0x3E) SMART_BATTERY_GET**, reply byte0 == 1 → on. Requested on screen start and again 150 ms after each toggle (`scheduleSmartBatteryRefresh`). | **PID 1041 only** (`MoreSetting6118ActivityKt.shouldShowSmartBatteryItem`). Toast "Setup successful" / "Setup failed". The app has no description text, so the function is unknown. | `MoreSetting6118ViewModel.handleUserIntent$lambda$0`; `CmdGetSmartBattery6118` |
| **"Mic auto power-off"** with summary **"Shut down after 15 minutes of inactivity"** | toggle | on → 0 / off → 1 → `setShutdownTime` → cmd **54 (0x36) SHUTDOWN_TIME_SET**. Same encoding as the M2S "15min" = 0 / "Never" = 1. | `heart.autoPowerOffOpen` = byte 10 == 0 (`MicAutoShutdownState` is pushed from each heartbeat) | Always visible. Toast "Setup successful" / "Setup failed". iOS also has `L["相机RX，TX 15分钟未操作将自动关机"]` = "Camera RX and TX will automatically power off after 15‑min inactivity." It is probably the 1042 summary, but this is unconfirmed. | `MoreSetting6118ViewModel.handleUserIntent$lambda$1`, `#publishMicAutoShutdownState` |
| **"External speaker without unplugging"**. iOS `L["免拔插外放"]` = "Playback without unplugging". Same feature as M2S "Phone Speaker". | toggle | on → 0 / off → 1 → `setSpeaker` → cmd **18 (0x12) SPEAKER_SET** | cmd **19 (0x13) SPEAKER_GET**, reply byte0 == 0 → on. Requested on screen start. | Always visible. **On success the RX restarts.** A full-screen touch blocker (`speaker_restart_blocker_view`) and a centred countdown toast appear: "Settings successful. The device will restart in %d seconds." (3, 2, 1; `SPEAKER_RESTART_COUNTDOWN_SECONDS = 3`, 1 s steps). Then `setRestart()` sends cmd **12 (0x0C) RESTART_RX**. On failure "Setup failed" is shown and the state is re-read with SPEAKER_GET after 150 ms (`scheduleAutoSpeakerRefresh`). A web client must expect USB re-enumeration. | `MoreSetting6118Activity#renderSpeakerRestartCountdown`; `MoreSetting6118ViewModel#handleSpeakerSettingResponse`, `#startSpeakerRestartCountdown` |
| **"Device Information"** | nav row | — | — | → section 6 | `#setDeviceInfoEvent` |
| **"Paired Devices"** | nav row | — | — | → section 7 | `#setDevicePairEvent` |
| **"Firmware Update"** | nav row with red dot | — | — | Red dot when an upgrade target exists. Entry checks are in section 8. | `#renderPageState`, `initView$lambda$1` |
| **"User Manual"** | nav row | — | — | **PID 1042 only** (`shouldShowProductManualItem`). Section 9. | `#setProductManualEvent` |
| **"Factory Reset"** | row, then confirm dialog | cmd **64 (0x40) FACTORY_RESET_SET**, no payload | `SetResponseData` | Section 10 | `#showFactoryResetDialog` |

Note on the three toggles: the switch listeners dispatch only when `buttonView.isPressed()` (user-initiated). Programmatic state updates do not echo writes.

## 6. Device Information (A2)

* **Title** "Device Information". First row: **"Model"** = "LARK A2" (`get6118DisplayName`).
* **Device rows.** One card each for **"RX"**, **"Mic 1"** and **"Mic 2"**, in that order. Each card has **"SN"** and **"Firmware Version"** fields (`R:res/layout/item_c6118_device_info.xml`).
* **Placeholder.** A value shows "--" when the device is offline (RX is always treated as online), when the string is empty, or when the version string is not a positive version. Invalid SN strings are those that contain only ':', '-', '.', spaces and '0' (`C6118DeviceInfoViewModel#buildVersionDisplayText`, `#buildPlainDisplayText`, `#isInvalidDisplayText`).
* **Data source.** On entry the app force-refreshes the RX, and each online TX: version via cmd **65 (0x41) RULE_VERSION_GET** with payload `[deviceType]`, and SN via cmd **21 (0x15) DEVICE_SN_GET** with payload `[deviceType]`. deviceType is RX = 0, TX1 = 1, TX2 = 2. `getDeviceVersion` uses RULE_VERSION_GET (65), not the defined DEVICE_VERSION_GET (3). Up to 4 request retries (`C6118DeviceRuntimeManager.MAX_REQUEST_RETRY_COUNT = 4`).
* Sources: `A:com/hollyland/larkc1/c6118/ui/setting/viewmodel/C6118DeviceInfoViewModel.java#refreshRuntimeSnapshot`; `A:com/hollyland/mic_usb/messenger/UsbMessenger6118.java#getDeviceVersion`, `#getDeviceSn`; `A:com/hollyland/larkc1/c6118/data/runtime/C6118RuntimeDevice.java`.

## 7. Pairing (A2)

* **Screen.** Title "Paired Devices". Section "Device List". Rows "Mic 1" and "Mic 2" (`R:res/layout/activity_device_pair.xml`).
* **Row state.** "Paired" here means the TX is currently online (`C6118PairDeviceViewModel.prepareInitialPageState` uses `isTx1Online` / `isTx2Online`). An online row shows the action **"Remove Pairing"** in colour `text_color_F6`. An offline row shows **"Not paired"** in `text_color_FF` (`PairDeviceActivity#renderPairStatus`).
* **Remove Pairing flow.**
  1. The tap is active only when the row is paired.
  2. A non-cancelable dialog asks "This device will need to be paired again after deletion. Are you sure you want to delete it?" with buttons "Cancel" / "Confirm".
  3. Confirm sends cmd **63 (0x3F) DELETE_PAIR_SET** with payload `[txIndex]`, coerced to 1..2 (Mic 1 = 1, Mic 2 = 2).
  4. A toast shows "Deleted" or "Operation failed", and the state re-renders.
* **No in-app "pair new mic" flow** exists for the A2. Pairing is done on the hardware. The app has no A2-specific pairing guide.
* Sources: `A:com/hollyland/larkc1/c6118/ui/setting/PairDeviceActivity.java#bindPairStatusClick`, `#showPairStatusDialog`, `#handleDeletePairResult`; `C6118PairDeviceViewModel.handleUserIntent$lambda$0`; `CmdDeletePair6118`.

## 8. Firmware update (A2)

### 8.1 Entry checks (More Settings, "Firmware Update")

Checks run in this order (`MoreSetting6118Activity.initView$lambda$1`, `C6118FirmwareUpgradeCoordinator#validateEntry`, `#toMessage`):

1. No network: toast "No Internet Connection. Please check your network settings."
2. No upgradeable target: toast "Already up to date".
3. Low battery (**≤ 10 %**, `ENTRY_BATTERY_THRESHOLD = 10`) on any online TX, or on the camera RX for PID 1042. Toast "The battery level of %1$s is too low, upgrade not supported." The name is "Mic 1", "Mic 2", "RX", or "Mic" when several are low.
4. A TX firmware target exists but no TX is online: toast "Connect %1$s before updating" (with "Mic").
5. If only one mic is online, the hint toast "Please connect two microphones." is shown, but entry continues (`shouldShowSingleMicUpgradeHint`).

### 8.2 "Firmware Version" screen (`C6118DeviceVersionUpgradeActivity`)

* Title "Firmware Update", header "Firmware Version".
* Rows Mic 1, Mic 2 and RX. Each row shows "V%1$s" or "--", plus a badge when a newer version exists (`C6118VersionDisplayItem`).
* Button **"Update All Devices"** re-runs the network check and `validateEntry`, then opens the progress screen with `ota_list`.

### 8.3 Progress screen (`C6118FirmwareUpgradeActivity`)

* **Layout.**
  * Progress bar 0-100 % and a tip line: "Preparing firmware update…", "Downloading (%1$d/%2$d), please wait…", "Updating (%1$d/%2$d), please wait…".
  * One state row per device: "%1$s Firmware Update Pending", "… Firmware downloading…", "… Firmware download completed", "… Firmware download failed", "… Firmware Updating…", "… Firmware Update Completed", "… Firmware Update Failed".
  * A "Notes" box: "1. Keep the device connected during switching" and "2. Exiting the app may cause switching issues. Please do not close the app".
* **Order.**
  1. Download each target from the cloud.
  2. Upgrade the TXs first (one shared "6118TX" package for every TX that needs it).
  3. Upgrade the RX second ("6118RX", or "6118CAMRX" for PID 1042).
  4. Wait 3000 ms between devices (`NEXT_DEVICE_DELAY_MS`).
  5. Hold the "download completed" state for 1000 ms.
* **Wire sequence** (protocol doc owns the details).
  * TX: get device id with cmd 8 (5 s timeout, 3 retries), enter upgrade with cmd 9 (`sendTxUpgrade(deviceType, devId)`), then stream raw packets with **63-byte payloads** (`OTA_PACKET_PAYLOAD_SIZE = 63`). Each packet is acked by cmd 14 (`needCount`, 3 retries). The result arrives as cmd 11.
  * RX: enter upgrade with cmd 13.
  * The runtime heartbeat pauses during OTA (`pauseRuntimeHeartbeatIfNeeded`, `C6118OtaTrafficGate`).
* **Interrupt.** Back while running opens "Firmware update in progress. Do you want to interrupt the update?" with Cancel / Confirm. Confirm aborts the upgrade and closes the screen.
* **Result.** Success shows "Firmware update successful! The device will restart after the upgrade. During the restart, the connection to the app will be lost. After the restart, it will reconnect to the device." Failure shows "Firmware update failed" or a stage-specific message. Retry button "Retry". Related toasts: "Device upgrade complete, restarting soon…" and "Device upgrade failed. Restarting soon…".
* Sources: `A:com/hollyland/larkc1/c6118/ui/setting/C6118FirmwareUpgradeActivity.java`, `viewmodel/C6118FirmwareUpgradeViewModel.java` (constants lines 92-94), `viewmodel/C6118FirmwareUpgradeViewModelKt.java` (`OTA_DEVICE_ID_TIMEOUT_MS`, retry limits), `adapter/C6118DeviceUpgradingAdapter.java#buildStateText`, `data/firmware/Legacy6118OtaProtocolBridge.java`.

### 8.4 Cloud catalogue (app-side)

* **Request.** For each device whose version is ready (int > 0), the app builds `UpgradeRequest(sn, packageCode, versionValue)` (`C6118FirmwareUpgradeCoordinator#generateUpgradeRequests`).
* **Endpoints.** `https://device-api.hollyland.com` with `POST /api/v1/upgrade/checkBatchUpgrade`, `/checkUpgrade`, `/getBatchDownloadUrl`, `/getDownloadUrl` (`A:com/hollyland/application/httpcommon/http/HttpService.java`, `HttpConst.OVERSEAS_BASE_URL`).
* **Version comparison.** Strip the "V"/"v" prefix, then `HexUtil.compareVersions`. The numeric form drops everything except digits and dots, then concatenates the digits (`toVersionInt`).
* **Refresh triggers.** The catalogue is re-checked on start, on network reconnect, and 150 ms after a TX online change. Up to 3 retries 3 s apart.

## 9. User Manual (A2, PID 1042 only)

* The row is visible only for PID 1042 and needs network ("No Internet Connection…").
* The app fetches the manual URL with access key **"6201instrument"** (`MoreSetting6118Activity.PRODUCT_MANUAL_KEY`). That key is likely a copy-paste bug: iOS embeds the string "6118instrument".
* The document opens in `https://ota-blob.hollyland.com/statics/pdfViewer/web/viewer.html?file=<urlencoded link>` (`@string/preview_pdf_base_url`).
* Fetch failure toast: "Network error. Fetch failed."
* Sources: `MoreSetting6118Activity#buildProductManualPreviewUrl`, `MoreSetting6118ViewModel#requestProductManualInfo`; `strings -a iOS:larkSound | grep 6118instrument`.

## 10. Factory reset (A2)

1. The "Factory Reset" row opens a non-cancelable dialog: "Factory reset will erase some data. Continue?" with "Cancel" / "Confirm".
2. Confirm sends cmd **64**.
3. A toast shows "Reset successful" or "Reset failed".
4. On success the app tears down the runtime session and rebuilds it after **1000 ms** (`FACTORY_RESET_RUNTIME_RECOVERY_DELAY_MS`). It skips the rebuild if USB is gone.

The iOS confirm copy differs: `L["恢复出厂将清除部分数据,确认恢复出厂?"]` = "Are you sure you want to reset?".

Sources: `MoreSetting6118Activity#showFactoryResetDialog`, `#handleSettingResult`; `MoreSetting6118ViewModel#handleFactoryResetResponse`, `#startFactoryResetRuntimeRecovery`.

## 11. Background behaviours (A2)

* **Home `onStart`:**
  * Re-publish the cached heartbeat.
  * Load RX/TX1/TX2 version and SN if missing.
  * Register a network listener and refresh the upgrade check.
  * Send TX_IDENTIFY_GET (`HLDevice6118ViewModel#onStart`).
* **Home `onStop`:** clear pending set operations and stop the level monitor.
* **More Settings `onStart`:** SMART_BATTERY_GET and SPEAKER_GET (`MoreSetting6118ViewModel`, around line 290).
* **USB detach:** the app leaves the device page. `DeviceConnectVariable.setIsUsbNeedReconnect` is used for the auto-reconnect after an upgrade or restart (`C6118DeviceActivity#finish`; `HLMainActivity` firmware-upgrade recovery reconnect).
* **"Mic fail" banner** (app-side, home list). When a Hollyland USB device is attached but undetected for 6 × 1 s, the app shows a help banner linking to `https://hollyland-techhelp.zendesk.com/hc/en-us/requests/new`. Dismissal is suppressed for 24 h, or 30 days after feedback (`A:com/hollyland/larkc1/ui/connect/MicFailBannerCoordinator.java`).
* **Analytics on every setting:** Sensors Data / Firebase events (`C6118AnalyticsReporter`). Not needed in a web UI.

## 12. A2 camera variant (PID 1042) differences

| Aspect | 1041 (A2) | 1042 (A2 camera / "A2S") | Source |
|---|---|---|---|
| RX volume steps | 6 (0..5) | 3 (0..2) | `C6118DeviceActivityKt.homeRxVolumeStepCount` |
| Camera RX battery row | hidden | shown ("Camera RX", Normal / Low / --) | `shouldShowRxCameraStatus` |
| Smart battery life | shown | hidden | `shouldShowSmartBatteryItem` |
| User Manual | hidden | shown | `shouldShowProductManualItem` |
| Mic Recognition illustration | `mipmap/mic_recognition` | `mipmap/mic_recognition_camera` | `C6118DeviceActivity#initView` |
| RX firmware package | `6118RX` | `6118CAMRX` | `C6118FirmwareUpgradeCoordinator#currentRxPackageCode` |
| Upgrade low-battery check | TXs only | TXs plus camera RX (≤ 10 %) | `#resolveLowBatteryDeviceName` |
| Heartbeat bytes 15 bit 4 and 16 (camera RX charging/battery) | unused (0) | used | `CmdGetHeart6118` |

## 13. iOS parity

The iOS app mirrors the Android A2 UI one-to-one. Swift classes from the binary:

| iOS class | Fields and methods (otool -ov) | Android equivalent |
|---|---|---|
| `_TtC9larkSound14HLLark6118View` | `micCardsView`, `cameraRXView`, `iconView`, `voiceView` (RX volume), `presetView` (Bel canto), `noiseView`, `vocalView` (channel mode), `lightSwitch`, `checkSwitch` (Mic Recognition), `manualMicIdentifyOverride`, `fetchMicIdentityWorkItem`, `heartbeatSyncSkipCounts`, `renderWithState:`, `updateViewWithLeftValue:rightValue:` (L/R meters) | `C6118DeviceActivity` |
| `_TtC9larkSound13HLMicCardView` / `HLMicCardsView` | `txMuteView`, `nameLabel`, `batteryLabel`, `batteryView`, `uvProgressView`, `muteActionCallback`, `onlineStatus` | Mic cards |
| `_TtC9larkSound18HL6118CameraRXView` | `iconImageView`, `titleLabel`, `batteryView`, `batteryLabel` | Camera RX row |
| `_TtC9larkSound21HL6118FunctionSetView` | `manualEnduranceOverride` (smart battery), `manualSpeakerStatusOverride`, `fetchEnduranceWorkItem`, `switchViewMap` | Feature Settings |
| `_TtC9larkSound22HLDeviceGeneralSetView`, `_TtC9larkSound25HLDeviceSetViewController` | `functionSetView`, `generalSetView`, `upgradeView` | More Settings |
| `HL6501Messenger` (ObjC) | `sendGetDeviceEndurance`, `sendGetMicIdentify`, `deleteDevicePairWithType:`, `sendRestoreFactoryReset`, `sendSetDeviceVoiceOutStatus:`, `sendRestartRxDevice`, `sendGetDeviceNoiseLevel`, `sendSetDeviceNoiseLevel:`, `sendGetDeviceVoliceLevel`, `sendSetDeviceVoliceLevel:`, `sendGetAllDeviceVersion`, `sendEnterUpgradeToDevice:devid:`, `sendUpgradeDataWithIndex:name:` | `UsbMessenger6118` |

Differences and notes:

* **Transport.** iOS reaches the RX over the USB iAP2 interface (External Accessory protocol `com.hollyland.protocol`, `EADSessionManager.m`). Android uses USB HID.
* **Heartbeat flicker.** iOS skips N heartbeats after a user change (`heartbeatSyncSkipCounts`). Android uses the pending-op queue instead.
* **Manual key.** iOS uses "6118instrument" for the manual.
* **Mute.** iOS `HLMicCardView.muteActionCallback` exists, but nothing indicates that the A2 supports a TX-mute command. Android has none.
* **Asset names** referenced by iOS: `device_6118_txcheck`, `device_6118_cam_txcheck`, `device_setting_6118`, `device_topbg_6118`.

## 14. A2 feature → command quick reference

Command IDs from `Command6118Usb.java`. "Legacy" marks commands the A2 shares with the M2-family `usbmic/protocol/Pro_*` classes (same numbers: heart 0x10, noise 0x06/0x11/0x19, voice 0x04/0x05, speaker 0x12/0x13, voice mode 0x18, voice lock 0x34/0x35, shutdown 0x36, light 0x39, restart 0x0C, SN 0x15, devid 0x08, OTA 0x09/0x0B/0x0D/0x0E). The A2 protocol looks like an extension of the M2 protocol.

| Feature | Read | Write | Value encoding |
|---|---|---|---|
| Status poll | 16 (0x10) HEART_INFO_GET | — | section 15 |
| Noise on/off | heart[6] != 0 | 25 (0x19) | payload `{0x02}` constant (toggle?) |
| Noise level | heart[6]; also 17 (0x11) NOISE_LEVEL_GET (bit 7 = valid, bits 0-6 = level) | 6 (0x06) | 1 Weak, 2 Medium, 3 Strong (0 = off) |
| RX volume | heart[7]; also 4 (0x04) VOICE_LEVEL_GET | 5 (0x05) | index 0..5 (1041) or 0..2 (1042) |
| Channel mode | heart[9] | 24 (0x18) | 0 Mono, 1 Stereo, 2 SafeTr |
| Bel canto preset | heart[14] (bit 0 on, bits 1-7 mode) | 58 (0x3A) | `[enable 0/1, mode 0 Bright / 1 Low / 2 Balance]` |
| Indicator light | heart[13] == 0 → on | 57 (0x39) | 0 = on, 1 = off |
| Mic Recognition | 60 (0x3C) | 59 (0x3B) | 1 = on, 0 = off |
| Smart battery life | 62 (0x3E), byte0 == 1 → on | 61 (0x3D) | 1 = on, 0 = off |
| Mic auto power-off | heart[10] == 0 → on | 54 (0x36) | 0 = on (15 min), 1 = off (never) |
| External speaker w/o unplugging | 19 (0x13), byte0 == 0 → on | 18 (0x12), then 12 (0x0C) RESTART_RX after 3 s | 0 = on, 1 = off |
| Remove pairing | — | 63 (0x3F) | `[1 or 2]` |
| Factory reset | — | 64 (0x40) | no payload |
| Version / SN | 65 (0x41) / 21 (0x15) | — | payload `[deviceType 0 RX / 1 TX1 / 2 TX2]` |
| Voice lock (A2 UI does **not** expose it) | 53 (0x35) | 52 (0x34) | protocol defines it; A2 firmware support unknown |
| OTA | 8, 9, 13, 14, 11 | — | section 8.3 |

All set commands answer with `SetResponseData(isSuc)` (`Base6118UsbCmd.parseSetResponse`).

## 15. A2 heartbeat status field map

Parsed by `A:com/hollyland/protocol/core/sound/command/device6118/CmdGetHeart6118.java#decodeLegacyPayload`. Offsets index into `payloadBody(payload)`; see the protocol doc for where the body starts.

| Byte | Field | Decode |
|---|---|---|
| 0 | tx1Online | == 1 |
| 1 | tx2Online | == 1 |
| 2 | tx1Battery | 0..100 (%) |
| 3 | tx2Battery | 0..100 (%) |
| 4-5 | (legacy M2 `uvValue`, not read by the A2) | — |
| 6 | noiseLevel | 0 off, 1..3 |
| 7 | voiceLevel | RX volume index |
| 8 | (legacy voiceLock, not read) | — |
| 9 | voiceMode | 0/1/2 |
| 10 | autoPowerOffOpen | == 0 |
| 11-12 | (legacy button-custom, not read) | — |
| 13 | lightOpen | == 0 |
| 14 | bit 0 beautyAudioOpen; bits 1..7 beautyAudioMode | |
| 15 | bit 0 tx1Muted, bit 1 tx2Muted, bit 2 tx1Charging, bit 3 tx2Charging, bit 4 rxCamCharging | |
| 16 | rxCamBattery | 0..100 (%) |

Legacy offsets 4/5/8/11/12 come from `A:com/hollyland/usbmic/protocol/Pro_get_heart.java#receiveData`, which uses the same command 0x10.

## 16. LARK M2S (6302) and LARK M2 (6301)

Confidence is medium for the M2S and lower for the M2: the code paths are older, multi-product screens.

### 16.1 LARK M2S home screen (`A:com/hollyland/larkc1/HLDevice6302Activity.java`, `R:res/layout/activity_hldevice_6302.xml`)

* **Title:** "LARK M2S". The settings gear has a red dot when an update is available. The "gain guide" icon is forced hidden.
* **Battery:** "Mic1" and "Mic2" with "NN%" text and a glyph. Shown only when the TX is online and battery > 0.
* **Mute icon:** updated only by the V2 heartbeat (6108). The legacy M2S heartbeat (`Pro_get_heart`) has no mute field, so the M2S shows no mute status.
* **Level meter:** `BleSingleVolumeView`, fed by app-side `AudioRecordUtils` on the phone's input. App-side.

| Label | Type | Options and wire | Rules | Source |
|---|---|---|---|---|
| **"Phone Speaker"** | toggle | on → `setSpeaker(0)`, off → 1 (legacy `Pro_set_speaker`, cmd 0x12) | On success the restart view "Settings successful. The device will restart in %d seconds." counts down, then `setRestart()` (0x0C) | `initView$lambda$5`, `#onResSpeakerSet` |
| **"NC"** | toggle plus levels "Weak" / "Strong" ("Medium" is invisible on the M2S; it shows only for 6108) | switch → `setNoiseStatus()` (0x19, constant payload 2, a toggle); Weak → `setNoiseLevel(1)`, Strong → `setNoiseLevel(2)` (0x06) | Read-back heart[6]: 0 off, 1 weak, 2 strong. If every mic is offline: toast "Mic not connected, current function not available" (`isAllMicOffline()` → `mic_offline_tip`) and nothing is sent. If the online mics are all muted, toast "Mic is currently muted. Noise cancellation settings are unavailable." | `#onClick`, `#isAllMicOffline`, `#updateNoiseView`, `initView$lambda$4` |
| **"Volume adjustment"** | 6 buttons labelled 1..6 | tag 0..5 → `setVoice(tag)` (0x05) | Read-back heart[7]. If every mic is offline: toast "Mic not connected, current function not available". When the lock is on: toast "Volume adjustment locked, please unlock first". | `#onClickBtnGroup` (`isAllMicOffline()` first), `DeviceCompat.getVoiceLevels` |
| Volume lock icon | toggle icon | `setVoiceLock(1/0)` (0x34) | **Visible only for PID 1030 (camera RX).** Read-back heart[8] == 1. No offline check: the handler toggles without `isAllMicOffline()`. | `#onClick` (voice_lock) |
| **"Channel Mode"** | Mono / Stereo | 0 / 1 → `setVoiceMode` (0x18) | 400 ms debounce (`isNotFastClick`). If every mic is offline: toast "Mic not connected, current function not available" and nothing is sent. No SafeTr on the M2S. | `#onClick` |
| **"Schedule power off"** | "15min" / "Never" | 0 / 1 → `setShutdownTime` (0x36) | An info icon opens the popup "RX and MIC will automatically power off when not paired." | `#onClick`, `@string/pop_window_tip` |
| **"Custom Functions"** | navigation | `CustomFunctionActivity` → `setBtnCustom` (0x37); TX light colour | Requires both mics: toast "Mic1 and Mic2 are not connected; the current function cannot be configured." | `initView$lambda$20`; `A:com/hollyland/larkc1/ui/custom/CustomFunctionActivity.java` |
| "Indicator Light Switch" | toggle | `setLight(on?0:1)` (0x39) | `initView` shows it only on the 6108. On the M2S it appears once the RX version is read and the RX firmware is newer than `SPEC_VERSION` "2.0.0.9" (`Util.isNewVersion`); the same check shows "Custom Functions". | `initView` (`ctLight` visible = `is6108Device`); `#onResGetVersion` (`ctLight` / `ctBtnCustom` visible for non-6108 above 2.0.0.9) |

**Custom Functions (M2S)** (`A:com/hollyland/usbmic/data/DeviceBtnCustom.java`):

* Buttons and click types:
  * "Mobile RX Power Button": Double Click, Triple Click.
  * "Camera RX Power Button": Single Click, Double Click.
  * "Camera RX Noise Cancellation Button": Double Click.
  * "TX Power Button": Double Click, Triple Click.
* Assignable functions:
  * "RX Self-Locking" (1): camera buttons only.
  * "Mic Muted (Simultaneous)" (2): camera buttons and the mobile power button.
  * "Mic Muted (Individual)" (3): all buttons.
  * "Mic Recognition" (4): all buttons.
* KeyOperation codes: 0 not set, 1 mobile-power double, 2 mobile-power triple, 3 camera-power single, 4 camera-power double, 5 camera-noise double, 6 TX-power double, 7 TX-power triple.
* TX light colour per TX ("TX 1" / "TX 2"): purple = 1, yellow = 2.
* Animated GIFs in the iOS bundle illustrate these: `rxDouble`, `rxThree`, `rxCamOne`, `rxCamDouble`, `noiseDouble`, `txDouble`, `txThree`.

**M2S settings** (`A:com/hollyland/blemic/setting/SettingActivity.java#initView`, `R:res/layout/activity_setting.xml`):

* Visible on the M2S: "Version Information" (firmware update, with red dot) and "User Manual".
* Hidden on 6302/6108: "Factory reset".
* Visible only on 6701: "List of paired devices", "Laboratory" and "Version Back".
* Configurable via the cloud, and only for 6108: "Wireless settings" (2 Mic & 1 RX / 4 Mic & 1 RX) and "Mode setting".

iOS mirror: `HLLarkM2View` (ObjC). Ivars include `_voiceLocked`, `_showReduceNoise`, `_showKeyFunc`, `_isNoiseOn`, `_isMono`, `_outSwitch`, `_noiseView`, `_voiceView`, `_voiceLockView`, `_vocalView`, `_shutDownView`, `_tipView`, `_bubbleView`, `_lightSwitch`, `_customFuncView`. Selectors include `updateDeviceNoiseValue:isOpen:`, `updateVoiceLevel:`, `updateVocalMode:shutTime:`, `updateBatteryTX1Value:TX2Value:`, `updateVoiceLockStatus:`, `jumpToKeyFuncVC`.

### 16.2 LARK M2 (6301, PIDs 7/8)

The legacy `HLDeviceActivity` (`R:res/layout/activity_hldevice.xml`) has the same core set as the M2S:

* "Mic1" / "Mic2" battery as a percentage.
* App-side level meter.
* "NC Level" with "Weak" / "Strong".
* "Volume" with 6 levels. The lock icon shows when `isNew6301Camera` is true or the PID is 1030.
* "Phone Speaker" toggle.
* **No** Mono / Stereo and **no** auto power-off: the layout has both rows (`voice_mode`, `shutdown_time`), but `HLDeviceActivity` makes them visible only for PID 1029 / 1030 (the M2S), so they stay hidden on the M2 (PIDs 7/8) (`A:com/hollyland/larkc1/HLDeviceActivity.java`, `voiceModeLayout` / `shutdownTimeLayout`).

It has no custom functions or light. Same legacy `Pro_*` commands.

## 17. Bundled voice-preset JSONs: what they are

* **Files.** `iOS:` bundle root and `R:assets/json/`. Each file pairs a stem with a type number: `pure_vocals_0` (纯净人声), `vocal_enhancement_1` (人声增强), `deep_resonant_2` (浑厚扎实), `textured_magnetic_3` (质感磁性), `bright_eyed_boy_5` (清亮少年), `sweet_and_adorable_6` (圆润饱满), `clear_and_vibrant_8` (清亮元气), `rich_texture_9` (质感醇厚).
* **Structure** (`AudioEffectConfig`):
  * `comment` (zh name), `templateId` (""), `type` (int = filename suffix).
  * `compress {enable, threshold −12, ratio 4, attack 3, release 10, gain 0, knee 0.5, hold 0, range −45}`.
  * `exciter {enable, type 1, airfreshWet 0, gruWet 0}`.
  * `eqBands[10] {enable, filterType, gain dB, f0 Hz, fs 48000, qVal}`. Bands 0-2 are always neutral (200 Hz type 1, 3200 Hz type 3, 10 kHz type 2, gain 0). Bands 3-9 carry the voice shaping. Observed filterType values: 1, 2, 3, 5, 6. Type 3 behaves like a peaking EQ. The enum mapping is not determined.
  * `esser {enable, freqL 6500, freqH 4500, threshold −45, range −15}`.
  * `lufs {time 3, scale 3, alpha 0.7, targetLoud 0}`.
* **Owner: LARK M3 (6303).** These are the default style templates of the "Custom Voice Profiles" / "Create My Voice Profile" editor.
  * Loader: `A:com/hollyland/larkc1/c6303/ui/canto/util/StyleData.java#defaultStyleList`, `#parseStyleDataFromAsset("json/<name>.json")`.
  * The phone previews the effect on a recorded sample with a native CMSIS DSP library: `A:com/hollyland/larkc1/c6303/ui/canto/util/CantoUtil.java` (`com.example.meisheng.CMSISManager` setEqBands/setEsser/...); iOS `Frameworks/cmsis_api_ios`.
  * The result is pushed to the 6303 RX as "Bel" parameters: `A:com/hollyland/protocol/core/sound/sender/ProtocolSender6303.java` `setBelDF`, `setBelEX`, `audioSetBelParam`, `audioSetBelAll`, `setBelTemplateName`.
  * So they are **device-side DSP presets for the M3, authored with app-side preview DSP**.
* **Not applicable to the A2.** The A2 "Bel canto preset" is a fixed on-device choice of 3 (Bright/Low/Balance, cmd 58), with no parameters.
* **Not applicable to the M2/M2S** either.
* A browser could reuse the JSONs as an optional Web Audio chain (BiquadFilter, DynamicsCompressor) for monitoring or recording (v2 at best). That needs the filterType mapping.

## 18. App-side (non-device) features in HollyAudio, relevant or not

| Feature | Devices | Where | Browser feasibility |
|---|---|---|---|
| VU meters from USB audio | A2, M2, M2S | Android `AudioRecord`; iOS meter views | **Feasible.** `getUserMedia({audio:{deviceId, echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:2}})` with AnalyserNode or AudioWorklet. Needs microphone permission. |
| Recording / multi-track recorder, file manager, mixing | MELO P1 (6201) only | `iOS:Device/6201/Recorder/*`, `A:com/hollyland/sound` | Not part of the A2 app. A web A2 recorder (MediaRecorder or WAV via AudioWorklet, per-channel) is **feasible** as a new app-side extra. |
| AI translate, 4-channel record | LARK M3 (6303) only | `iOS:Device/6303/Modules/AiTranslate` | Out of scope |
| Voice profile editor (CMSIS DSP) | LARK M3 only | section 17 | Out of scope (partial in Web Audio) |
| Firmware catalogue and download | all | section 8.4 | **Partial.** The Hollyland API and CDN probably lack CORS for a third-party origin, so a proxy or user-supplied file is needed. Legal and terms-of-service risk. |
| User manual | A2 camera variant, M2S | section 9 | **Feasible** as a static link to Hollyland support pages |
| Account / login, community tab, MOMA school, banners, feedback, Qiyu customer service, Sensors/Firebase analytics | all | `A:com/hollyland/account`, `...feedback`, `HLMainActivity` | Not needed / not feasible (proprietary back-ends) |
| BLE devices, BLE monitor earphones | 6701, 6201, 6303 | `comm/ble`, `blemic` | Not relevant to the A2/M2 USB RX |
| iAP2 External Accessory path | iOS only | `EADSessionManager.m` | Not feasible in a browser and not needed (HID suffices) |

## 19. Feasibility matrix (A2), browser = Chromium + WebHID + Web Audio

General constraints:

* WebHID is available on desktop Chrome, Edge and Opera. It needs a secure context (https or localhost) and a user gesture for `navigator.hid.requestDevice`.
* Filter: `{vendorId: 0x3547, productId: 0x0411 /* or 0x0412 */, usagePage: 0xFF82}`. That is the collection carrying report 0x41 (63-byte IN and OUT).
* WebHID is not available in Firefox, Safari or Android Chrome.
* Linux needs a udev rule for hidraw access.
* After an RX restart (speaker toggle, OTA, factory reset) the device re-enumerates. Listen for `navigator.hid` `connect`/`disconnect` and re-open via `navigator.hid.getDevices()`. A previously granted device normally reappears without a new prompt.

| Feature | Class | Feasible? | Notes |
|---|---|---|---|
| Connect / identify / reconnect | device | **Yes** | PID 1041 vs 1042 selects the variant UI |
| TX online, battery, charging, mute status | device (read) | **Yes** | Heartbeat every 1 s |
| Camera RX battery (1042) | device (read) | **Yes** | |
| Noise Cancellation on/off + level | device | **Yes** | Treat cmd 25 as a toggle: send only when desired != current, then confirm via heartbeat (open question 1) |
| RX volume | device | **Yes** | |
| Channel Mode (Mono / Stereo / SafeTr) | device | **Yes** | |
| Bel canto preset | device | **Yes** | |
| Indicator light | device | **Yes** | Inverted encoding |
| Mic Recognition | device | **Yes** | Not in the heartbeat. Poll 0x3C on entry and after writes. |
| Smart battery life (1041) | device | **Yes** | Semantics unknown |
| Mic auto power-off | device | **Yes** | |
| External speaker without unplugging | device | **Yes (with care)** | Triggers an RX restart. The web UI must show a countdown and blocker, then reconnect. |
| Device Information (SN, firmware) | device (read) | **Yes** | |
| Remove pairing | device | **Yes** | Destructive. Needs the same confirm copy. |
| Pair a new mic | hardware | n/a | The app has no pairing flow either. A web UI can show an instructions panel. |
| Factory reset | device | **Yes** | Destructive. Needs confirm and post-reset re-sync. |
| Firmware update | device + cloud | **Partial** | The HID OTA is feasible (63-byte packets fit report 0x41). Getting firmware needs the cloud API (CORS, ToS) or a user-supplied file. Brick risk. v2 only, after protocol verification. |
| Update-available dot | cloud | **Partial** | Same cloud dependency |
| VU meters | app-side | **Yes** | getUserMedia with processing disabled. A real stereo meter is possible in all modes, not only the app's emulation. |
| User Manual | cloud / static | **Yes** (link) | |
| Toasts, optimistic UI, block rules | app logic | **Yes** | Copy in sections 4-10 |
| Analytics, account, community | app-side | Not needed | |

## 20. Prioritized feature list

### MVP (A2, PID 1041 first, 1042 variant-aware)
1. WebHID connect (device picker with the filter above), auto-reconnect on `connect`, disconnect UI.
2. Heartbeat loop (1 s) and the status cards: Mic 1 / Mic 2 online (dim at alpha 0.6 when offline), battery Normal/Low/Charging plus %, mute badge. Camera RX row for 1042.
3. Home controls with exact labels, values and block rules:
   * Noise Cancellation (toggle-safe) and Weak / Medium / Strong.
   * RX volume (6 or 3 steps).
   * Channel Mode Mono / Stereo / SafeTr.
   * Bel canto preset (Bright / Low / Balance).
   * Indicator Light Switch.
   * Mic Recognition (shown only while the light is on).
4. Write pipeline: serialized sets, optimistic UI, FIFO ACK matching, rollback on failure, "Setup successful" / "Setup failed" toasts.
5. More Settings:
   * Smart battery life (1041 only).
   * Mic auto power-off.
   * External speaker without unplugging, with the 3 s restart countdown, `RESTART_RX`, and reconnect.
6. Device Information: Model, RX / Mic 1 / Mic 2 SN and firmware version.
7. Paired Devices with Remove Pairing (confirm dialog).
8. Factory Reset (confirm dialog, post-reset re-sync).
9. Optional VU meters via getUserMedia, using `C6118VuLevelMapper` (permission-gated, opt-in).

### v2
1. Firmware update. First target: a user-supplied firmware file. Then optionally a proxy to Hollyland's catalogue. Gate on battery > 10 % and the TX online checks. Use the exact progress, interrupt and failure copy. Upgrade TX first, then RX.
2. Update-available indicator (needs the catalogue).
3. App-side recorder: per-channel WAV, SafeTr export, live monitoring to headphones via Web Audio. This is a web-only extra; the official A2 app has none.
4. LARK M2S / M2 support: legacy `Pro_*` command family, volume lock (1030), Custom Functions, Phone Speaker, schedule power-off.
5. Probe undocumented A2 capabilities the protocol already defines: voice lock 0x34/0x35, NOISE_LEVEL_GET 0x11, VOICE_LEVEL_GET 0x04. Only after confirming they are harmless.
6. User Manual link, pairing instructions panel, i18n using the iOS zh/en string pairs.

### Out of scope
Account/login, cloud community, banners, analytics, BLE products, iAP2, LARK M3 AI translate and voice-profile editor, MELO P1 recorder/mixer.

## 21. Open questions (need live-device testing or other sources)
1. **Noise switch (cmd 0x19)** always sends payload 0x02. Confirm that it toggles. Check whether it is idempotent, and what level the device restores when switching on.
2. What **RX volume** controls (USB capture gain? headphone?), and the dB per step for 6 vs 3 steps.
3. **Smart battery life**: the actual behaviour (no description text in either app).
4. **External speaker without unplugging**: the effect on the USB descriptor. Does a playback interface appear or disappear? (The current descriptor shows capture only.) The RX restart and re-enumeration time, and whether the Chrome WebHID permission survives the restart.
5. **SafeTr** channel layout on USB audio. The app assumes the second channel is the first at −6 dB, but it only ever captures mono in that mode.
6. Is TX mute settable on the A2 at all? There is no A2 command, though the heartbeat reports it (probably the TX hardware button).
7. Device factory defaults (state after cmd 0x40).
8. ACK correlation. `SetResponseData` appears untagged. Confirm whether the reply echoes the command ID (protocol doc), so the web client can pipeline safely.
9. Whether the A2 firmware also honours the legacy voice-lock (0x34/0x35) and button-custom (0x37/0x38) commands.
10. Product 1042 naming ("LARK A2S" string vs "LARK A2" title) and how it enumerates on macOS (PID 0x0412 assumed).
11. Firmware file format and whether the cloud endpoints and download URLs are reachable cross-origin.
12. The A2 manual access key: Android "6201instrument" vs iOS "6118instrument".
13. What the consumer-control (report 0x06) and telephony (0x07) HID collections are used for (RX buttons?), and whether WebHID can or should read them.
14. M2/M2S: VID/PID and HID report layout on real hardware. The `Pro_*` heartbeat has no mute or charging fields.
15. Mapping of `filterType` values 1, 2, 3, 5, 6 in the 6303 preset JSONs (only needed for an optional Web Audio preset chain).
