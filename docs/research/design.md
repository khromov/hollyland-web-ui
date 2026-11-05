# UI design research: web control panel for LARK A2 / LARK M2 kits

Status: research draft, v1 (2026-11-05)
Scope: visual direction, information architecture, wireframes, component inventory and design tokens
for an original, responsive WebHID control panel (Vite + Svelte 5). The kit is one USB-C receiver
(RX) and two transmitters (TX1, TX2).
Out of scope: the exact feature list and protocol. Another agent is building that inventory. This
document designs for the likely feature set and is **capability-driven**, so controls the connected
model does not report are hidden, not greyed out.

Mobbin reference collection: **"Hollyland Web UI"** (private to the account owner and teammates):
<https://mobbin.com/collections/d8f2e6df-09f7-4c5f-a0ce-180c325f1e26/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp>
It holds 26 screens and 5 flows. Section 5 lists them.

---

## 0. Summary of decisions

| Topic | Decision |
|---|---|
| Direction | **"Quiet Console"**: calm graphite surfaces, channel strips as the main object, meters as the only "lit" elements, one interactive accent and two channel accents. Dark first, with a full light theme. |
| Branding | Original. Working name *Mic Console* (placeholder). No Hollyland logos, product renders, colours or icon artwork. Product names appear only as plain text to name compatible devices, with an "independent project" disclaimer. |
| Layout | Desktop: header, RX bar, TX1 and TX2 strips side by side, and a right inspector panel. Mobile: sticky status bar, stacked cards, bottom sheets for settings and a bottom tab bar. |
| Settings UI | Rendered from a settings schema (type, range, options, capability flag), so A2 and M2 differences need no new screens. |
| Writes | Every control has an idle, pending, confirmed or failed lifecycle. Optimistic updates roll back on NACK or timeout. |
| Risky actions | Firmware update and factory reset use dedicated flows: a pre-flight checklist, typed confirmation, wake lock and an unload guard. |
| Debug | Console is hidden behind "Developer mode". On desktop it is a resizable bottom drawer; on mobile it is a full-screen page. Raw send is gated separately. |
| Type | Geist and Geist Mono (OFL, on Google Fonts), self-hosted, with a system stack fallback. Readouts use tabular numerals. |
| Colour | TX1 is cyan and TX2 is coral (the blue/orange axis is safe for colour-vision deficiency). The UI accent is indigo. Meters use green, amber and red in a dark "meter well" in both themes. Every pairing below has been checked against WCAG AA. |

---

## 1. Design direction

### 1.1 Constraints that shape the look

1. **Third-party tool.** It must not look official. That rules out the vendor's typeface, colour,
   product photography and icon set. Devices are drawn as simple original geometric glyphs: RX is
   a rounded rectangle with a USB-C tab; a TX is a rounded square with a 3x3 dot grille.
2. **WebHID is Chromium desktop only** (Chrome, Edge and Opera on Windows, macOS, Linux and ChromeOS,
   as of writing). Phone browsers, including Chrome on Android, Safari and Firefox, cannot connect. So
   the mobile layout serves narrow desktop windows, ChromeOS tablets, split-screen use and **demo
   mode**. It also covers any future Android support. The unsupported-browser screen is the first
   thing most phone visitors will see, so it has to be useful.
   - A useful side effect: the connected app only needs to run in modern Chromium. Container queries,
     `color-mix()`, `:has()`, `<dialog>`, the Popover API and View Transitions are all safe to use.
     The **connect and unsupported screens must still render in Safari and Firefox**, so those
     screens use only conservative CSS.
3. **Used on set, under pressure.** Battery, mute and link state must be readable at arm's length in
   about a second. Changing a setting must never be ambiguous ("did it apply?").
4. **Hardware writes can fail or brick.** Firmware and reset flows need friction and recovery paths.
   Everyday controls do not.

### 1.2 Candidate directions

| | A. "Studio Hardware" | B. "Companion Card" | C. "Quiet Console" (recommended) |
|---|---|---|---|
| Idea | Mixer and outboard look: near-black panels, vertical faders, LED segment meters, monospace labels, screws and bevels. | Consumer companion app (Sonos, Oura, Meta style): soft rounded cards, large device hero images, generous whitespace, one card per device. | Hybrid. Channel strips borrowed from mixers, made calm: flat graphite cards, few borders, meters as the only luminous elements, consumer-grade settings rows and sheets. |
| Desktop density | High | Low. Lots of scrolling on wide screens. | Medium-high. Two strips and an inspector fit at 1024 px. |
| Mobile fit | Poor. Faders and tiny labels fail on touch. | Excellent | Good. Strips collapse into cards and the inspector becomes a bottom sheet. |
| Light mode | Weak. Skeuomorphic hardware rarely translates. | Strong | Strong. Surfaces are token-driven and the meter well stays dark. |
| Risk | Looks gimmicky; heavy custom drawing; hard to reach AA in small LED text. | Relies on product imagery, which we cannot use. Feels "lifestyle", not pro. | Needs discipline to stay calm. Mitigated by strict rules on accent usage. |
| References | Polestar (stark graphite, one accent), Riveo tick ruler | Sonos, Oura, Meta AI device cards, LARQ | OpenAI Platform inspector, Discord voice settings, Sonos EQ sheet, WHOOP device status, Stripe and Supabase logs |

### 1.3 Recommendation: "Quiet Console"

**Why:** it is the only option that works on desktop and touch, does not depend on product imagery,
has a credible light theme, and still reads as a professional audio tool. The pro-audio character
comes from structure (channel strips, meters with dBFS scales, tabular numerals, mute as a
hardware-style latch) rather than ornament.

**Visual signature (original):**
- **Graphite neutrals** with a slight cool tint. In dark mode, depth comes from three surface steps
  rather than shadows. Hairline borders are used only where surfaces touch.
- **Meter well.** Level meters always sit in a dark inset "instrument window", in both themes. This
  keeps meter colours consistent and gives the screen one glowing focal area.
- **Channel identity.** Each TX has a hue that appears in only four places: the channel badge, a 3 px
  top rule on its strip, its tab in the inspector switcher, and the selection outline. It is **never**
  used for meters, buttons or text blocks.
- **Mute is a latch.** When muted, the mute button turns solid danger red with the label "MUTED", the
  meter dims to 40% opacity and a "MUTED" chip appears in the status bar. This is the only large red
  area on screen in normal use.
- **Numbers are first-class.** Battery %, dB and firmware versions use tabular figures. Units appear in
  a smaller, muted weight (for example **-9** dB).
- **Motion is functional.** Only meters move continuously. Everything else uses short fades and
  slides, and reduced motion is respected (see 4.8).

**Do / don't:**
- Do keep at most one primary button per view. Do place destructive actions in a "Danger zone" at the
  bottom.
- Do show values next to every control (for example "0 dB" or "8 / 15"), not only thumb positions.
- Don't use colour alone. Battery, signal, mute and link states always pair an icon or shape with
  text.
- Don't animate battery or signal changes beyond a 140 ms crossfade. Don't add pulsing "live" dots
  except the console capture indicator.

---

## 2. Information architecture and navigation

### 2.1 Object model

```
Kit (one RX + up to two TX)
|-- Receiver (RX)          output mode, monitor volume, auto power-off, indicator brightness,
|                          pairing slots, firmware, serial, power source/battery
|-- Transmitter 1 (TX1)    mute, noise cancellation, gain, low cut, voice tone/EQ, safety track*,
|                          battery, charging, link/signal, live level, firmware, serial
|-- Transmitter 2 (TX2)    same as TX1
|-- Kit actions            presets (apply/save), factory reset, firmware update (per device)
`-- App (browser-only)     theme, developer mode, console, demo mode, saved presets, about/legal

* "Safety track" may be an RX output mode, a TX setting or both, depending on the model.
  The schema decides where it appears. Recommended home: RX > Output mode.
```

### 2.2 Views

| View | Purpose | Desktop container | Mobile container |
|---|---|---|---|
| Connect | Gatekeeper: unsupported, ready, chooser, permission help, connecting, errors | Full page, two columns | Full page, single column |
| Overview | Live status and quick controls for RX, TX1 and TX2 | Main canvas | Main tab |
| Channel settings (TX1, TX2) | All per-TX settings | Right inspector panel (non-modal) | Bottom sheet (half snap, then full) |
| Receiver settings | All RX settings, pairing, reset entry point | Inspector (RX tab) | Bottom sheet |
| Device | Model, firmware, serial for each unit; firmware update; maintenance | Page tab | Tab |
| Presets | Saved setups; apply with a diff preview | Page tab | Tab |
| Console | Raw HID traffic, decode, export, raw send (gated) | Bottom drawer (resizable) or its own tab | "More", then a full-screen page |
| App settings | Theme, developer mode, units, demo, about | Popover from header menu | "More" tab |

URLs: use hash routes (`#/overview`, `#/device`, `#/presets`, `#/console`). The inspector state is a
query parameter (`?panel=tx1`), so reloads and shared links restore the view. Reloading after a
disconnect lands on Connect with "Reconnect to last receiver" when `navigator.hid.getDevices()`
returns a previously permitted device.

### 2.3 Navigation model

**Desktop (1024 px and up)**
- **Header (56 px):** wordmark, primary tabs (Overview, Device, Presets, plus Console when developer
  mode is on), connection chip ("M2 receiver, connected"), a Lock toggle, the app menu (theme,
  developer mode, about) and Disconnect.
- **RX bar:** one row of receiver status (output mode, monitor volume, power, link to TX1 and TX2,
  firmware). Clicking it opens the RX inspector.
- **Canvas:** TX1 and TX2 strips side by side. From 1600 px, RX becomes a third strip on the left.
- **Inspector (360 px, right):** a TX1 | TX2 | RX switcher, a "Link TX1 + TX2" toggle and the full
  settings for the selection. It is non-modal: meters stay visible while settings change. It
  collapses to a 48 px rail when closed.
- **Console drawer:** bottom, resizable (default 280 px, minimum 160 px). Toggle it with the backtick
  key or the Console tab.

**Tablet or narrow desktop (768 to 1023 px)**
- Header with top tabs. RX bar. TX strips side by side.
- The inspector becomes an **overlay drawer** from the right (modal, with scrim), or a bottom sheet in
  portrait if height is more than 1.3 times the width.

**Mobile (under 768 px)**
- **Sticky status bar (48 px):** connection dot, TX1 battery, TX2 battery, a MUTED chip per muted
  channel, and an overflow button. It is always visible and is the "glance" surface.
- **Stacked cards:** RX summary, TX1 card, TX2 card. Each card has a horizontal meter, a large mute
  button and two quick controls (NC and gain). "Settings" opens a bottom sheet.
- **Bottom tab bar (64 px plus safe area):** Overview, Device, Presets, More (Console, App settings,
  About).
- **Bottom sheets:** snap points at 55% and 92% height. Close by dragging down, pressing Esc, tapping
  the scrim or pressing Done. Focus is trapped and returns to the trigger on close. The sheet header
  repeats the channel badge and offers a TX1 | TX2 switch, so users can compare channels without
  closing it.

**Keyboard (desktop):** `1`, `2` and `R` select TX1, TX2 and RX in the inspector. `M` toggles mute on
the selected TX and shows an undo toast. `[` and `]` step gain down and up. The backtick key toggles
the console, `?` opens the shortcut sheet and `Esc` closes the top layer. Shortcuts are ignored while
focus is in a text field and are disabled in Lock mode.

### 2.4 Connection state machine (what the UI shows)

```
          +-------------+  no navigator.hid   +--------------------+
  load -->| detect      |-------------------->| UNSUPPORTED        |
          +------+------+                     +--------------------+
                 | supported
                 v
          +-------------+  getDevices() has one  +-----------------+
          | IDLE        |----------------------->| RECONNECTING    |---+
          | (Connect)   |<---- user cancels -----| (auto, silent)  |   |
          +------+------+                        +-----------------+   |
                 | click Connect                                        |
                 v                                                      |
          +-------------+  NotFoundError /       +-----------------+   |
          | CHOOSER     |  empty selection ----->| NO DEVICE PICKED|   |
          +------+------+                        | (help panel)    |   |
                 | device chosen                 +-----------------+   |
                 v                                                      |
          +-------------+  open() fails          +-----------------+   |
          | OPENING     |----------------------->| BUSY / ERROR    |   |
          | HANDSHAKE   |  wrong product ------->| WRONG DEVICE    |   |
          +------+------+                        +-----------------+   |
                 | ok, capabilities read                               |
                 v                                                      |
          +-------------+  hid "disconnect"      +-----------------+   |
          | READY       |----------------------->| LOST            |---+
          | (Overview)  |                        | banner, values  |
          +-------------+                        | frozen + dimmed |
                                                 +-----------------+
```

In LOST, the dashboard keeps the last known values, dimmed, with "Last updated 12:04:31". Controls
are disabled. A full-width banner offers **Reconnect**. The app auto-reconnects on a matching
`connect` event.

### 2.5 Wireframes

Plain ASCII, not to scale. `[ ]` is a button, `[a|b|c]` a segmented control, `(o)` a radio or
indicator, `[on ]` a switch and `###` a battery or signal glyph.

#### W1. Connect: desktop (ready state)

```
+--------------------------------------------------------------------------------------------+
| (o) Mic Console   unofficial                                       Help    Theme    About  |
+--------------------------------------------------------------------------------------------+
|                                                                                            |
|   +-------------------------------------------+   +------------------------------------+   |
|   | Connect your receiver                     |   |                                    |   |
|   |                                           |   |    [RX]  . . . . . .  [TX1]        |   |
|   | 1  Plug the receiver into this computer   |   |          . . . . . .  [TX2]        |   |
|   |    (USB-C, data cable)                    |   |                                    |   |
|   | 2  Switch on TX1 and TX2                  |   |    Waiting for a receiver...       |   |
|   | 3  Press Connect and pick the receiver    |   |    (dots drift; static when        |   |
|   |    in the browser's device list           |   |     reduced motion is on)          |   |
|   |                                           |   |                                    |   |
|   | [ Connect receiver ]    Try demo mode ->  |   +------------------------------------+   |
|   |                                           |                                            |
|   | (i) Works in Chrome, Edge and Opera on    |   Previously used: M2 receiver             |
|   |     desktop. Settings never leave this    |   [ Reconnect ]                            |
|   |     computer.                             |                                            |
|   +-------------------------------------------+                                            |
|                                                                                            |
|   Independent project. Not affiliated with or endorsed by the device manufacturer.         |
+--------------------------------------------------------------------------------------------+
```

#### W1b. Connect: problem states (same card, content swapped)

```
+-------------------------------------------------------------+
| (!) No receiver selected                                    |
|                                                             |
| The device list closed without a choice. If the receiver    |
| was not in the list:                                        |
|  - unplug and re-plug it, try another port or cable         |
|  - quit other apps that may be using it                     |
|  - Linux: allow hidraw access (udev rule) -> show me how    |
|  - ChromeOS/Windows: make sure it shows up as a USB device  |
|                                                             |
| [ Try again ]   Troubleshooting ->                          |
+-------------------------------------------------------------+

+-------------------------------------------------------------+
| (x) Couldn't open the receiver                              |
| Another tab or app may be using it. Close it and retry.     |
| Details: NotAllowedError: Failed to open the device.  [copy]|
| [ Retry ]   [ Choose another device ]                       |
+-------------------------------------------------------------+
```

#### W1c. Unsupported browser: mobile (360 px)

```
+--------------------------------------+
| (o) Mic Console                 Help |
+--------------------------------------+
|                                      |
|  (!) This browser can't connect      |
|      to USB receivers                |
|                                      |
|  The control panel uses WebHID,      |
|  which works in Chrome, Edge and     |
|  Opera on a desktop or laptop        |
|  (Windows, macOS, Linux, ChromeOS).  |
|                                      |
|  [ Copy link for your computer ]     |
|  [ Explore demo mode           ]     |
|                                      |
|  Why doesn't my phone work? ->       |
+--------------------------------------+
```

#### W2. Overview: desktop (1280 px and up, TX1 selected)

```
+----------------------------------------------------------------------------------------------------+
| (o) Mic Console  Overview  Device  Presets  Console    (*) M2 receiver . connected  [Lock] [..] [x]|
+----------------------------------------------------------------------------------------------------+
| RECEIVER  Output Stereo | Monitor 8/15 | Power USB | TX1 linked  TX2 linked | FW 1.2.3  Settings > |
+---------------------------------+---------------------------------+--------------------------------+
|=== cyan ========================|=== coral =======================| [TX1] Interview A          [x] |
| [TX1] Interview A     84% ###   | [TX2] Guest        (!) 18% #..  | [ TX1 | TX2 | RX ]  Link [  o] |
| Linked  Signal ####  Charging   | Linked  Signal ##..  Low batt.  |--------------------------------|
|                                 |                                 | Noise cancellation             |
|   0 |    Noise cancellation     |   0 |    Noise cancellation     | [ Off | Low | Mid | High ]     |
|  -6 |=   [Off|Low|Mid|High]     |  -6 |    [Off|Low|Mid|High]     | Lowers steady background       |
| -12 |=                          | -12 |                           | noise. Higher levels can make  |
| -20 |=   Gain                   | -20 |    Gain                   | voices sound thinner.          |
| -40 |=   [-]   0 dB   [+]       | -40 |=   [-]  -6 dB   [+]       |                                |
| -60 |=                          | -60 |=                          | Input gain                     |
|      pk -9 dB                   |      pk -31 dB                  | [-] ------|------ [+]   0 dB   |
|                                 |                                 |                                |
| [    MUTE    ]   Low cut [on ]  | [   MUTED    ]   Low cut [off]  | Low-cut filter          [on ]  |
|                                 |  (solid red latch)              | Voice tone        Natural   >  |
| All TX1 settings >              | All TX2 settings >              |                                |
+---------------------------------+---------------------------------+ Reset TX1 to defaults          |
|                                                                   |                                |
|                                          +----------------------+ |                                |
|                                          | (v) TX1 gain: 0 dB   | |                                |
|                                          +----------------------+ |                                |
+-------------------------------------------------------------------+--------------------------------+
```

Notes:
- The meter is a vertical segmented bar in the dark well, with a dBFS scale, a peak-hold tick and a
  clip latch at the top (click to clear). The strip switches to a horizontal meter when its container
  is narrower than 340 px (container query).
- The selected strip gets a 2 px outline in its channel colour. Unselected strips have none.
- On a TX that is "Not linked" (off or out of range), the strip collapses to a single row: glyph,
  "TX2 not linked", last seen time and a "Pair" link. Its quick controls are hidden.

#### W3. Overview: mobile (360 px)

```
+--------------------------------------+
| (*) RX  TX1 84%  TX2 (!)18%  MUTED2 :|  <- sticky status bar
+--------------------------------------+
| Receiver                Stereo    >  |
| Monitor 8/15 . USB power . FW 1.2.3  |
+--------------------------------------+
|=== cyan =============================|
| [TX1] Interview A        84% ###     |
| Linked  ####           Charging      |
| [#############.......|..]   -9 dB    |  <- horizontal meter in dark well
| [   MUTE   ]  [ NC Mid  ]  [ 0 dB ]  |  <- 48 px targets
| Settings                          >  |
+--------------------------------------+
|=== coral ============================|
| [TX2] Guest          (!) 18% #..     |
| Linked  ##..         Low battery     |
| [####................|..]  -31 dB    |  (dimmed while muted)
| [  MUTED   ]  [ NC Off  ]  [-6 dB ]  |
| Settings                          >  |
+--------------------------------------+
|  Overview   Device   Presets   More  |  <- bottom tab bar
+--------------------------------------+
```

Tapping "NC Mid" or "0 dB" opens the settings sheet scrolled to that control. A long press on Mute
does nothing special; mute is always a single tap with an undo toast.

#### W4. TX settings: mobile bottom sheet (TX1, half snap expanded)

```
+--------------------------------------+
|               ------                 |  <- drag handle
| [TX1] Interview A            [Done]  |
| [ TX1 | TX2 ]        Link TX1+TX2 [o]|
|--------------------------------------|
| Noise cancellation                   |
| [ Off | Low | Mid | High ]           |
| Lowers steady background noise.      |
|                                      |
| Input gain                    0 dB   |
| [ - ] --------|--------- [ + ]       |
| -12                          +12     |
|                                      |
| Low-cut filter               [on ]   |
| Reduces rumble from wind and         |
| handling.                            |
|                                      |
| Voice tone                           |
| (o) Natural                          |
| ( ) Bright  - clearer speech         |
| ( ) Warm    - fuller low end         |
|                                      |
| Mute                         [off]   |
|--------------------------------------|
| Reset TX1 settings                   |
+--------------------------------------+
```

On desktop the same content renders inside the inspector (see W2). With **Link TX1+TX2** on, the
header shows both badges, and every change is sent to both transmitters. A control whose values
differ between the two shows a "Mixed" state until it is set.

#### W5. RX settings: desktop inspector (RX tab)

```
+--------------------------------+
| Receiver                   [x] |
| [ TX1 | TX2 | RX ]             |
|--------------------------------|
| Output mode                    |
| [ Mono | Stereo | Safety ]     |
| Stereo: TX1 left, TX2 right.   |
|                                |
| Headphone monitor       8 / 15 |
| [-] ==========------- [+]      |
|                                |
| Auto power-off                 |
| [ Off | 15m | 30m | 60m ]      |
|                                |
| Indicator brightness           |
| [ Low | Medium | High ]        |
|                                |
| -- Transmitters -------------- |
| TX1  linked  ####   Re-pair >  |
| TX2  linked  ##..   Re-pair >  |
|                                |
| -- Danger zone --------------- |
| [ Factory reset...           ] |
+--------------------------------+
```

Option labels are placeholders until the protocol inventory confirms them. If a model offers more
than 4 options, or any label is longer than 8 characters, the segmented control becomes a radio list
(on mobile) or a select menu (in the desktop inspector).

#### W6. Device info and firmware update (Device tab, desktop)

```
+----------------------------------------------------------------------------------------------+
| Device                               [ Info | Firmware | Maintenance ]                       |
+----------------------------------------------------------------------------------------------+
| +----------------------------+ +----------------------------+ +----------------------------+ |
| | [RX] Receiver              | | [TX1] Transmitter 1        | | [TX2] Transmitter 2        | |
| | Model     LARK M2 RX       | | Model     LARK M2 TX       | | Model     LARK M2 TX       | |
| | Firmware  1.2.3  latest    | | Firmware  1.2.0  (update)  | | Firmware  1.2.0  (update)  | |
| | Serial    ....4F2A [copy]  | | Serial    ....9C10 [copy]  | | Serial    ....71B3 [copy]  | |
| | Power     USB              | | Battery   84%  charging    | | Battery   18%  (!) low     | |
| +----------------------------+ +----------------------------+ +----------------------------+ |
|                                                                                              |
| Firmware                                                                                     |
| +------------------------------------------------------------------------------------------+ |
| | Transmitter 1   1.2.0 -> 1.3.0                                    [ Update TX1... ]      | |
| | Transmitter 2   1.2.0 -> 1.3.0   (!) Charge to 50% first           [ Update TX2 ] (off)  | |
| | Receiver        1.2.3            Up to date                                              | |
| | Source: firmware file you choose   [ Choose file... ]   What's in this update? ->        | |
| +------------------------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------+

Update flow (modal, cannot be dismissed while transferring):

+--------------------------------------------------+
| Update TX1 firmware   1.2.0 -> 1.3.0             |
|                                                  |
| Before you start                                 |
| [v] TX1 battery 84% (needs 50%)                  |
| [v] TX1 linked, signal good                      |
| [v] Receiver connected by USB                    |
| [ ] I won't unplug or close this tab             |
|                                                  |
|                 [ Cancel ]  [ Start update ]     |
+--------------------------------------------------+
                        |
                        v
+--------------------------------------------------+
| Updating TX1 ...                                 |
|                                                  |
|  (v) Preparing device                            |
|  (>) Transferring                     62%        |
|      [===================............]           |
|      About 1 min left                            |
|  ( ) Verifying                                   |
|  ( ) Restarting                                  |
|                                                  |
| (!) Keep this tab open, the receiver plugged in  |
|     and TX1 close to the receiver.               |
|     Screen will stay awake.                      |
+--------------------------------------------------+
                        |
            +-----------+-----------+
            v                       v
  (v) TX1 updated to 1.3.0     (x) Update stopped at 62%
  [ Done ]                     Device is safe to retry.
                               [ Retry ]  [ Copy log ]  Recovery steps ->
```

Implementation hooks: call `navigator.wakeLock.request('screen')` during transfer and add a
`beforeunload` guard. Disable other writes and polling-driven UI changes for that device. Show
"Updating" in the status bar chip. Dim the device's strip with an "Updating, controls locked" overlay.

#### W7. Factory reset confirmation (modal; full-screen sheet on mobile)

```
+--------------------------------------------------------+
| (!) Factory reset                                  [x] |
|                                                        |
| This restores factory settings on:                     |
|   [ Whole kit (RX + TX1 + TX2) | Receiver only ]       |
|                                                        |
| What happens                                           |
|  - All channel and receiver settings go to defaults    |
|  - Transmitters may need to be paired again            |
|  - Presets saved in this browser are kept              |
|                                                        |
| Type RESET to confirm                                  |
| [ ____________________ ]                               |
|                                                        |
|                       [ Cancel ]  [ Reset kit ]        |
|                                    ^ danger, disabled  |
|                                      until text match  |
+--------------------------------------------------------+
```

Rules: focus starts on Cancel. The confirm word is shown in a mono chip with a copy button. Matching
ignores case and surrounding whitespace. After success the app re-reads all settings, shows a toast
"Kit reset. Re-pair transmitters if they show 'Not linked'." and opens the pairing helper if any TX
is unlinked. The consequence bullets come from the protocol inventory; the text above is a
placeholder.

#### W8. Debug console: desktop bottom drawer

```
+-------------------------------------------------------------------------------------------------------+
| == drag ==                                                                                            |
| Console  (*) Capturing  1,204 frames     [Pause] [Clear] [Copy] [Export .jsonl]                       |
| Show [All|Out|In]   [Errors only]   [Hide levels]   Filter [ ...................... ]                 |
+--------------+-----+------+-----+-------------------------------------+-------------------------+-----+
| Time         | Dir | Rep  | Len | Bytes (hex, illustrative)           | Decoded                 |     |
+--------------+-----+------+-----+-------------------------------------+-------------------------+-----+
| 12:04:01.231 | OUT | 0x02 |  64 | 01 0a 00 00 00 00 ...               | Get battery (all)       |  >  |
| 12:04:01.262 | IN  | 0x01 |  64 | 81 0a 64 54 12 00 ...               | RX USB TX1 84 TX2 18    |  >  |
| 12:04:01.501 | IN  | 0x01 |  64 | 85 20 f7 e1 ...           x24       | Levels (collapsed)      |  >  |
|!12:04:02.010 | OUT | 0x02 |  64 | 01 31 01 02 ...                     | Set NC TX1=Mid  TIMEOUT |  >  |
+--------------+-----+------+-----+-------------------------------------+-------------------------+-----+
| Raw send (developer mode)  [ 01 0a 00 ...                                  ]  [Send]                  |
| (!) Raw writes can change device settings. Every send is logged as 'manual'.                          |
+-------------------------------------------------------------------------------------------------------+
```

- A row's left rule is coloured by status: neutral, success, warning (retry) or danger (NACK or
  timeout). Direction appears as text (OUT/IN) as well as colour.
- Selecting a row opens a detail pane on the right (or replaces the list on mobile) with a byte table
  (offset, hex, decoded field), the raw JSON and "Copy as hex" or "Copy as JS array".
- High-rate frames such as level polling are collapsed with a repeat counter, and "Hide levels" is on
  by default.
- **Raw send** only appears when Developer mode is on and "Allow raw writes" is enabled in App
  settings. Every raw send is logged with a "manual" tag.
- On mobile the console is a full-screen page: toolbar items move into an overflow menu, rows wrap to
  two lines (time and direction on line 1, decoded text on line 2) and hex shows in the detail view.

#### W9. Re-pair a transmitter (sheet or modal)

```
+--------------------------------------------+
| Pair transmitter 2                    [x]  |
| Step 2 of 3                                |
|                                            |
|  1 (v) Receiver ready to pair              |
|  2 (>) Put TX2 into pairing mode           |
|        (see the device's pairing gesture)  |
|        Not seeing the pairing light? ->    |
|  3 ( ) Confirm link                        |
|                                            |
|      [RX]  . . . . . . . .  [TX2]          |
|      Searching ... 0:12 / 1:00             |
|                                            |
|                  [ Cancel ]                |
+--------------------------------------------+
```

On timeout: "TX2 wasn't found" with **Try again** and tips. On success: a check, "TX2 linked" and a
signal readout. The sheet then closes back to the strip.

#### W10. Presets (tab)

```
+---------------------------------------------------------------+
| Presets                                   [ Save current... ] |
+---------------------------------------------------------------+
| (*) Interview, two people              Active . modified (.)  |
|     Stereo . NC Mid/Mid . Gain 0/-3 . Low cut on              |
|     [ Apply ]  [ Update from current ]  [ ... ]               |
|---------------------------------------------------------------|
|     Run and gun, windy                                        |
|     Safety . NC High/High . Gain -6/-6 . Low cut on           |
|     [ Apply ]  [ ... ]                                        |
+---------------------------------------------------------------+

Apply -> "This will change 4 settings" (diff list) -> [ Apply ] -> per-setting progress.
```

Presets are stored in the browser (IndexedDB), with JSON import and export. If the device has
on-board scenes, they appear in their own "On device" section.

### 2.6 Interaction rules

| Rule | Detail |
|---|---|
| **Write lifecycle** | idle, pending, confirmed or failed. The control updates optimistically and the changed element shows a 12 px spinner or `aria-busy`. When the device confirms, a 600 ms check flash plays. On NACK or timeout the control rolls back, shows an inline error under it, and an error toast offers **Retry**. Writes to the same setting are debounced and coalesced (sliders send on release, plus at most every 150 ms while dragging if the protocol allows). |
| **External changes** | If a value changes on the hardware (for example a button press on a TX), the control updates with a 1 s highlight and a polite live-region announcement ("TX2 muted on device"). |
| **Link TX1 + TX2** | Mirrors writes to both transmitters. Mixed values show as "Mixed". Unlinking keeps current values. |
| **Lock mode** | Makes every control read-only and enlarges readouts ("shoot mode"). A lock icon appears in the status bar. Unlock is a deliberate tap on the header toggle (or press and hold for 600 ms on mobile). |
| **Disabled vs hidden** | Hidden: the model doesn't support it. Disabled with a reason: temporarily impossible (TX not linked, firmware updating, Lock mode). The reason appears in a tooltip on desktop and as helper text on mobile. |
| **Units and values** | Always visible beside the control. Gain in dB with a sign; volume as "n / max"; time in minutes. |
| **Undo** | Mute, preset apply and "reset channel" toasts offer Undo for 6 s. Factory reset and firmware do not. |

---

## 3. Component inventory

Each component lists its anatomy, variants, states and accessibility notes. "Pending" and "failed"
refer to the write lifecycle in 2.6.

### 3.1 App shell

| Component | Anatomy and variants | States | Notes |
|---|---|---|---|
| **Header** | Wordmark, tabs, connection chip, Lock, app menu, Disconnect | default, scrolled (adds border), Lock on | `<header>`. Tabs use `role="tablist"`. Shrinks to the mobile status bar under 768 px. |
| **Connection chip** | Dot, device name, state text | disconnected (neutral), connecting (spinner), connected (success dot), lost (warning), error (danger), updating (accent, progress ring) | The text always states the condition; the dot is decorative. Clicking opens a popover with device details and Disconnect. |
| **Mobile status bar** | Connection dot, TX1 and TX2 battery mini-glyphs, MUTED chips, overflow | normal, alert (low battery or lost: warning or danger tint) | Sticky, 48 px. `aria-label="Kit status"`. Each item has a text alternative. |
| **Bottom tab bar** | 4 items, icon over label | default, selected, with badge (for example a firmware update dot) | 64 px plus `env(safe-area-inset-bottom)`. Labels are always shown. |
| **Banner** (inline, persistent) | Icon, message, action, dismiss (optional) | info, success, warning, danger | Used for: Lost connection, Unsupported, Firmware available, Demo mode active. Uses `role="status"`, or `role="alert"` for Lost. |

### 3.2 Device and channel

| Component | Anatomy and variants | States | Notes |
|---|---|---|---|
| **Channel strip (TX)** | Channel rule; header (badge, name, battery, signal, status chips); meter; mute latch; 2 to 3 quick controls; "All settings" link. Variants: *strip* (desktop, vertical meter), *card* (mobile, horizontal meter), *compact row* (not linked). | linked, muted, not linked, low battery (20% or less), critical (10% or less), charging, selected (outline), pending write, error (rolled back), updating (locked overlay), skeleton | Container-query driven. `<section aria-labelledby>`. The name may be user-editable (stored locally) and falls back to "Transmitter 1". |
| **RX summary** | Bar (desktop) or card (mobile): output mode, monitor volume, power, per-TX link, firmware | normal, warning (TX unlinked), lost, skeleton | Clicking opens the RX inspector. From 1600 px it becomes a full strip. |
| **Channel badge** | Rounded 6 px tag with "TX1", "TX2" or "RX". Fill uses the channel colour; text uses `--on-tx*` | default, small (status bar) | The text label is always present, so identity does not rely on colour. |
| **Battery indicator** | Glyph with 4 bars (or a continuous fill when % is known), % text, optional bolt | unknown (`--`), normal, low (warning colour, "!" glyph), critical (danger), charging (bolt, gentle fill animation, static under reduced motion), full and charging ("Charged") | `aria-label="TX1 battery 84 percent, charging"`. If the device only reports steps, show steps with no fake % value. |
| **Signal indicator** | 4 ascending bars and an optional text label | strong (4), good (3), fair (2), weak (1, warning), lost (0, dashed outline, "Not linked"), unknown | Bars differ by height and fill, not only colour. Text alternative: "Signal good". |
| **Level meter** | Dark well; segments (desktop: 30 vertical; mobile: 24 horizontal) or a continuous bar; scale ticks (0, -6, -12, -20, -40, -60 dBFS); peak-hold tick; clip latch; numeric peak readout | idle (no signal: unlit), active, hot (-12 to -6), near clip (above -6), clipped (latch lit until clicked or 3 s), muted (40% opacity and "MUTED" label), not linked (hatched well), paused (tab hidden) | Draw on `<canvas>` or a single CSS `transform: scaleY()` element per channel at rAF rate. Do not re-render Svelte per frame. Accessibility: the moving graphic is `aria-hidden`. A visually hidden text label "TX1 level -18 dB, peak -9 dB" updates at most once per second (not a live region), and the meter is focusable to read it. Pause drawing when `document.hidden`. |
| **Mute latch** | Large button, full width in cards. Label "Mute" or "MUTED" | off (secondary style), on (solid danger and "MUTED"), pending, disabled (Lock mode or not linked) | `aria-pressed`. Keyboard: Space and Enter; `M` shortcut. 48 px tall on touch. |
| **Status chip** | Small pill: MUTED, CHARGING, LOW, NOT LINKED, UPDATING, SAFETY | semantic colours, using soft fill and strong text | Never interactive. Short uppercase labels with 0.06em tracking. |

### 3.3 Inputs

| Component | Anatomy and variants | States | Notes |
|---|---|---|---|
| **Segmented control** | Track, 2 to 4 options and a sliding selection pill. Sizes sm (32), md (40), lg (48 on touch). Variant with icons and labels. | default, hover, focus-visible, selected, pending (spinner replaces label in the target segment), disabled (whole control or one option), mixed (Link mode: no selection, "Mixed" hint), error | `role="radiogroup"` with `role="radio"` children. Arrow keys move and select, Home and End are supported. The selection pill moves in 140 ms (instant under reduced motion). Falls back to a radio list or select for more than 4 options or long labels. |
| **Stepper** | Minus button, value with unit, plus button. Optional slider below with detents. | default, at min or max (button disabled), pending, error, mixed, disabled | The value is `role="spinbutton"` with `aria-valuetext="minus 6 decibels"`. Arrow keys step, PageUp and PageDown take big steps. Holding a button repeats after 400 ms, then every 80 ms. |
| **Slider** | Track, fill, thumb, optional ticks, value bubble while dragging, min and max labels | default, hover, focus, dragging, pending (after release), disabled, error | A native `<input type="range">` styled through tokens. The thumb is 20 px visually with a 44 px hit area. On touch, the value bubble sits above the thumb so the finger doesn't cover it. |
| **Toggle row** | Label, optional description, switch on the right; the whole row is clickable | off, on, pending (switch shows a spinner knob), disabled with reason, error | `role="switch"` with `aria-checked`. The switch boundary meets 3:1 contrast (`--border-control`). |
| **Option card / radio list** | Radio, title, description, optional tag (for example "Recommended") | default, hover, selected (accent border and check), pending, disabled | For noise cancellation level explanations and voice tone presets. `role="radiogroup"`. |
| **Select menu** | Button showing the current value, plus a popover listbox | closed, open, focus, disabled | Used in the desktop inspector for long enums. Built on the Popover API with an anchored listbox. |
| **Text field** | Label, input, help or error text | default, focus, invalid, disabled | Used for preset names, the reset confirm word, the console filter and raw hex. Hex fields use the mono font and auto-group bytes. |
| **Button** | primary, secondary, ghost, danger, danger-outline; sizes sm, md, lg; icon-only (needs `aria-label`) | default, hover, active, focus-visible, loading (spinner and label kept for width), disabled | At most one primary per view. Danger buttons appear only inside confirmations and Danger zones. |

### 3.4 Containers and feedback

| Component | Anatomy and variants | States | Notes |
|---|---|---|---|
| **Inspector panel** (desktop) | Header (badge, title, close), TX1/TX2/RX switcher, Link toggle, scrollable body, sticky footer for reset | open, collapsed rail, loading, empty ("Select a channel") | `<aside aria-label="Channel settings">`. Non-modal, so focus is not trapped. Width 360 px. |
| **Bottom sheet** (mobile and tablet) | Handle, header, body, optional sticky footer | closed, half (55%), full (92%), dragging, closing | `<dialog>` with a modal scrim. Focus is trapped and restored on close. Esc and a downward drag close it. Animates with `translateY` (fade under reduced motion). |
| **Modal confirm** | Icon, title, body, optional typed confirm, actions | neutral, destructive, blocking (no close during an operation) | `<dialog>`. Initial focus on the least destructive action. `aria-describedby` points to the consequence list. |
| **Toast** | Icon, message, optional action (Undo or Retry), close | info, success, warning, error; auto-dismiss after 4 s (6 s with an action; errors stay until dismissed) | Bottom right on desktop; on mobile, above the tab bar. Stacks up to 3. `role="status"`, or `role="alert"` for errors. Pauses on hover or focus. |
| **Progress** | Linear determinate, linear indeterminate, multi-step list (firmware), 12 px spinner (pending writes), ring in the status chip | running, paused, success, failed | `role="progressbar"` with `aria-valuenow`. The time-remaining text updates at most every 5 s. |
| **Key/value row** | Label, value (mono for serial and firmware), optional copy button and status tag | default, copied (check for 1.2 s), unknown (`--`) | Serials are masked by default ("....4F2A") with a reveal toggle, so screenshots are safer. |
| **Preset card** | Name, active marker, modified dot, summary chips, actions | default, active, active-modified, applying (progress), error | Apply shows a diff preview first. |
| **Console row** | Time, direction, report ID, length, hex, decoded, status rule | normal, selected, error, warning, collapsed (repeat counter), manual (raw send tag) | Uses the mono font and tabular numbers. Virtualised list. Retains 5,000 frames, then a ring buffer. |

### 3.5 Page-level states

| State | Where | Content |
|---|---|---|
| **Unsupported** | Connect | W1c. Explains WebHID, offers "Copy link" and "Demo mode". Never shows a dead Connect button. |
| **Idle / empty** | Connect | W1. Steps, Connect, Demo, Reconnect to the last device. |
| **Permission or no-device help** | Connect | W1b. Platform tips (Linux udev, other apps holding the device, cables), Try again. |
| **Wrong device** | Connect | "This looks like a different device (VID:PID 0x.... / 0x....)." Offers "Choose another device". |
| **Connecting / handshake** | Connect, then Overview | The connect card shows step text ("Opening...", "Reading settings..."), then a skeleton dashboard. |
| **Skeleton loading** | Overview, Device | Strip silhouettes: badge block, two text lines, an empty meter well, 3 control placeholders. The shimmer is replaced with a static tint under reduced motion. Shown for at most 3 s before a "Still reading the device..." hint. |
| **Disconnected / lost** | Any | A danger banner across the top, all values frozen and dimmed with a "Last updated" stamp, controls disabled, Reconnect button, auto-reconnect when the device returns. |
| **TX not linked** | Strip or card | Compact row, last seen time, "Pair" link, quick controls hidden. |
| **Error (generic)** | Any | Plain-language cause, what the user can do, a "Copy details" button that includes the last 50 console frames, and Retry. |
| **Demo mode** | Any | Persistent info banner "Demo: simulated kit, nothing is sent". Uses a simulated device with plausible meters and battery drain. Also used for development and screenshots. |

---

## 4. Design tokens and foundations

Put the tokens in `src/styles/tokens.css` and import them once from `main.ts`. Dark is the default.
Light applies when the OS prefers it and the user hasn't forced dark, or when `data-theme="light"` is
set on `<html>`. The theme picker offers System, Dark and Light, and the choice is stored in
`localStorage` (wrapped in try/catch).

### 4.1 Tokens (CSS custom properties)

```css
/* ============================================================
   Mic Console design tokens. Dark is the default theme.
   ============================================================ */
:root {
  color-scheme: dark;

  /* ---- Surfaces ---- */
  --color-bg:            #0B0D10;   /* page */
  --color-surface-1:     #13161B;   /* cards, strips, header */
  --color-surface-2:     #1A1E24;   /* raised: inspector, sheet, popover */
  --color-surface-3:     #232830;   /* inset: segmented track, inputs, hover */
  --color-scrim:         rgb(5 6 8 / 0.64);

  /* ---- Borders ---- */
  --color-border:         #262B33;  /* hairline between surfaces (decorative) */
  --color-border-strong:  #3A414B;  /* dividers needing visibility */
  --color-border-control: #646D7A;  /* input/switch/segment outlines, >= 3:1 on surface-1/2 */

  /* ---- Text ---- */
  --color-text:          #ECEEF1;   /* 15.6:1 on surface-1 */
  --color-text-muted:    #A6AFBB;   /*  8.2:1 on surface-1 */
  --color-text-subtle:   #818B98;   /*  5.3:1 on surface-1 (hints, timestamps) */
  --color-text-disabled: #5A626E;   /* disabled only (exempt from contrast) */

  /* ---- Interactive accent (UI, focus, selection) ---- */
  --color-accent:        #8E9CFF;   /* 7.2:1 on surface-1 */
  --color-accent-hover:  #A5B0FF;
  --color-on-accent:     #0B0D10;   /* 7.7:1 on accent */
  --color-accent-soft:   color-mix(in oklab, var(--color-accent) 16%, transparent);
  --color-focus:         #8E9CFF;

  /* ---- Channel identity ---- */
  --color-tx1:           #4CC9F0;   /* cyan  - 9.4:1 on surface-1 */
  --color-on-tx1:        #0B0D10;
  --color-tx1-soft:      color-mix(in oklab, var(--color-tx1) 14%, transparent);
  --color-tx2:           #FF9166;   /* coral - 8.2:1 on surface-1 */
  --color-on-tx2:        #0B0D10;
  --color-tx2-soft:      color-mix(in oklab, var(--color-tx2) 14%, transparent);
  --color-rx:            #C3CBD6;   /* neutral silver */
  --color-on-rx:         #0B0D10;

  /* ---- Semantic ---- */
  --color-success:       #4ADE8A;
  --color-warning:       #F5C451;
  --color-danger:        #FF6B6B;
  --color-on-danger:     #0B0D10;   /* 7.0:1 */
  --color-info:          var(--color-accent);
  --color-success-soft:  color-mix(in oklab, var(--color-success) 14%, transparent);
  --color-warning-soft:  color-mix(in oklab, var(--color-warning) 14%, transparent);
  --color-danger-soft:   color-mix(in oklab, var(--color-danger) 16%, transparent);

  /* ---- Meter (same in both themes: the meter well is always dark) ---- */
  --meter-well:          #15181D;
  --meter-off:           #2A3038;   /* unlit segment */
  --meter-ok:            #4ADE8A;   /* <= -12 dBFS */
  --meter-hot:           #F5C451;   /* -12 .. -6 dBFS */
  --meter-clip:          #FF6B6B;   /* > -6 dBFS and clip latch */
  --meter-peak:          #ECEEF1;   /* peak-hold tick */
  --meter-scale:         #818B98;   /* scale labels inside well */

  /* ---- Typography ---- */
  --font-sans: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo,
               Consolas, "Liberation Mono", monospace;

  --text-2xs: 0.6875rem; --leading-2xs: 1rem;      /* 11px  meter scale, overlines */
  --text-xs:  0.75rem;   --leading-xs:  1rem;      /* 12px  chips, captions */
  --text-sm:  0.8125rem; --leading-sm:  1.25rem;   /* 13px  secondary, console */
  --text-md:  0.9375rem; --leading-md:  1.375rem;  /* 15px  body (desktop) */
  --text-lg:  1.0625rem; --leading-lg:  1.5rem;    /* 17px  body (touch), row titles */
  --text-xl:  1.25rem;   --leading-xl:  1.75rem;   /* 20px  section titles */
  --text-2xl: 1.625rem;  --leading-2xl: 2rem;      /* 26px  page titles */
  --text-3xl: 2.25rem;   --leading-3xl: 2.5rem;    /* 36px  hero readouts (fw %, battery) */

  --weight-regular: 400;
  --weight-medium:  500;
  --weight-semibold: 600;
  --tracking-caps:  0.06em;     /* uppercase labels/chips */
  --tracking-tight: -0.01em;    /* >= 20px headings */
  --numeric: tabular-nums slashed-zero;   /* use with font-variant-numeric */

  /* ---- Spacing (4px base) ---- */
  --space-0-5: 2px;  --space-1: 4px;   --space-2: 8px;   --space-3: 12px;
  --space-4: 16px;   --space-5: 20px;  --space-6: 24px;  --space-8: 32px;
  --space-10: 40px;  --space-12: 48px; --space-16: 64px;

  /* ---- Radii ---- */
  --radius-xs: 4px;    /* meter segments, chips */
  --radius-sm: 6px;    /* small buttons, badges, inputs */
  --radius-md: 10px;   /* buttons, segmented track */
  --radius-lg: 14px;   /* strips, cards, inspector sections */
  --radius-xl: 20px;   /* sheets, modals */
  --radius-full: 999px;

  /* ---- Elevation (dark: mostly surface steps; shadows are subtle) ---- */
  --shadow-1: 0 1px 0 rgb(255 255 255 / 0.04) inset, 0 1px 2px rgb(0 0 0 / 0.40);
  --shadow-2: 0 8px 24px rgb(0 0 0 / 0.45);
  --shadow-3: 0 24px 64px rgb(0 0 0 / 0.55);
  --meter-inset: inset 0 1px 2px rgb(0 0 0 / 0.6);

  /* ---- Motion ---- */
  --dur-instant: 80ms;    /* press feedback */
  --dur-fast:    140ms;   /* hover, segmented pill, toggles */
  --dur-base:    220ms;   /* popovers, toasts, drawer */
  --dur-slow:    320ms;   /* sheets, modals */
  --dur-confirm: 600ms;   /* write-confirmed check flash */
  --meter-peak-hold: 1500ms;
  --meter-release-db-per-s: 20;   /* JS constant mirrored here for docs */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter:    cubic-bezier(0.05, 0.7, 0.1, 1);
  --ease-exit:     cubic-bezier(0.3, 0, 0.8, 0.15);

  /* ---- Layout ---- */
  --header-h: 56px;
  --statusbar-h: 48px;
  --tabbar-h: 64px;
  --inspector-w: 360px;
  --console-h: 280px;
  --content-max: 1600px;
  --gutter: 16px;          /* 24px >= 768, 32px >= 1280 (set in media queries) */

  /* ---- Controls & targets ---- */
  --control-h-sm: 32px;
  --control-h-md: 40px;
  --control-h-lg: 48px;
  --hit-min: 44px;
  --focus-width: 2px;
  --focus-offset: 2px;

  /* ---- Layers ---- */
  --z-sticky: 10; --z-drawer: 30; --z-sheet: 40; --z-modal: 50; --z-toast: 60; --z-tooltip: 70;
}

/* ---------------- Light theme ---------------- */
:root[data-theme="light"] {
  color-scheme: light;
  --color-bg:            #F5F6F8;
  --color-surface-1:     #FFFFFF;
  --color-surface-2:     #FFFFFF;
  --color-surface-3:     #EEF0F3;
  --color-scrim:         rgb(17 21 26 / 0.40);

  --color-border:         #DDE1E7;
  --color-border-strong:  #C5CBD3;
  --color-border-control: #7A8390;  /* 3.8:1 on white, 3.4:1 on surface-3 */

  --color-text:          #11151A;   /* 18.3:1 on white */
  --color-text-muted:    #4B5563;   /*  7.6:1 */
  --color-text-subtle:   #606A76;   /*  5.5:1 */
  --color-text-disabled: #A3AAB4;

  --color-accent:        #3F4FD8;   /*  6.3:1 on white */
  --color-accent-hover:  #3241C2;
  --color-on-accent:     #FFFFFF;   /*  6.3:1 */
  --color-focus:         #3F4FD8;

  --color-tx1:           #076F90;   /*  5.7:1 on white */
  --color-on-tx1:        #FFFFFF;
  --color-tx2:           #B04317;   /*  5.7:1 on white */
  --color-on-tx2:        #FFFFFF;
  --color-rx:            #3B4450;
  --color-on-rx:         #FFFFFF;

  --color-success:       #14773A;   /* 5.6:1 */
  --color-warning:       #9A5B00;   /* 5.4:1 */
  --color-danger:        #C62828;   /* 5.6:1 */
  --color-on-danger:     #FFFFFF;   /* 5.6:1 */

  --shadow-1: 0 1px 2px rgb(16 24 40 / 0.06), 0 1px 1px rgb(16 24 40 / 0.04);
  --shadow-2: 0 8px 24px rgb(16 24 40 / 0.10);
  --shadow-3: 0 24px 64px rgb(16 24 40 / 0.18);
  /* --meter-* intentionally unchanged: the meter well stays dark */
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    /* repeat the light block above (or generate both from one source in a build step).
       Alternative without duplication: declare each colour once as
       --color-bg: light-dark(#F5F6F8, #0B0D10); and switch only `color-scheme`
       (dark by default; light via this media query or [data-theme="light"]).
       light-dark() is supported in all current engines (Chromium 123+, Safari 17.5+,
       Firefox 120+), so the connect/unsupported screens still render elsewhere. */
  }
}

/* ---------------- Base ---------------- */
html { background: var(--color-bg); color: var(--color-text);
       font: var(--weight-regular) var(--text-md)/var(--leading-md) var(--font-sans);
       -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
@media (pointer: coarse) {
  :root { --hit-min: 48px; }
  html  { font-size: 100%; } /* body uses --text-lg on touch layouts */
}
.readout { font-variant-numeric: var(--numeric); font-feature-settings: "tnum", "zero"; }
.mono    { font-family: var(--font-mono); font-variant-numeric: var(--numeric); }

:focus-visible {
  outline: var(--focus-width) solid var(--color-focus);
  outline-offset: var(--focus-offset);
  border-radius: inherit;
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; --dur-confirm: 0ms; }
  *, *::before, *::after { animation-iteration-count: 1 !important; scroll-behavior: auto !important; }
}

@media (forced-colors: active) {
  :focus-visible { outline-color: Highlight; }
  .meter-segment[data-lit] { forced-color-adjust: none; } /* keep meter readable; add text value */
}
```

Fonts: Geist and Geist Mono are SIL OFL and available on Google Fonts. **Self-host** the variable
woff2 files (Fontsource or the `geist` npm package; check the package name when installing) so the app
works offline and makes no third-party requests. Preload only the sans regular and medium axes. If
the team prefers zero web fonts, the system stack in `--font-sans` is acceptable; check that
`tabular-nums` works on Windows (Segoe UI does support it).

Icons: an open-source line icon set (for example Lucide, ISC licence) at 1.5 px stroke and 20 px.
Device glyphs (RX, TX) and the meter are custom SVG, drawn from scratch rather than traced from
product imagery.

### 4.2 Typography usage

| Role | Token | Weight | Example |
|---|---|---|---|
| Page title | `--text-2xl` | 600, tracking tight | "Device" |
| Section / inspector title | `--text-xl` | 600 | "Noise cancellation" group |
| Row title, strip name | `--text-md` (desktop), `--text-lg` (touch) | 500 | "Input gain" |
| Body / description | `--text-sm` (desktop), `--text-md` (touch) | 400, muted | "Lowers steady background noise." |
| Overline / chip | `--text-2xs` or `--text-xs`, uppercase, `--tracking-caps` | 600 | "RECEIVER", "MUTED" |
| Readout (battery %, dB) | `--text-lg` to `--text-3xl`, `.readout` | 500 | **84**% , **-9** dB |
| Console, hex, serial | `--text-sm`, `.mono` | 400 | `01 0a 00 ...` |

### 4.3 Breakpoints and layout

Media queries cannot use custom properties, so these are documented values (mirror them in a TS
`breakpoints.ts` for JS use).

| Name | Min width | Layout |
|---|---|---|
| `xs` | 0 | Single column, sticky status bar, bottom tabs, settings in bottom sheets. Gutter 16. |
| `sm` | 480 | Same; cards gain a 3-up quick-control row; sheets max-width 560 centred. |
| `md` | 768 | Top tabs replace bottom tabs; RX bar; TX1 and TX2 side by side; inspector as overlay drawer (or sheet when portrait). Gutter 24. |
| `lg` | 1024 | Inspector becomes a docked, non-modal 360 px panel; console available as a bottom drawer. |
| `xl` | 1280 | Comfortable spacing; strips use vertical meters (container width 340 px or more). Gutter 32. |
| `2xl` | 1600 | RX promoted to its own strip: RX, TX1, TX2 and the inspector. Content max 1600, centred. |

Components use **container queries** (`container-type: inline-size` on strips, cards and inspector
sections), so the same Svelte component adapts in any slot. Respect
`env(safe-area-inset-*)` on mobile bars and sheets.

### 4.4 Touch targets and density

- Minimum hit area is 44 x 44 CSS px (48 x 48 on `pointer: coarse`). Small visuals (20 px switch thumb,
  16 px icon buttons) get an invisible `::before` hit-area extension.
- Keep at least 8 px between adjacent targets. Segmented options are at least 64 px wide on touch.
- Desktop density is "comfortable" by default. An optional "compact" density (`data-density="compact"`)
  reduces row padding and uses `--control-h-sm` for power users. Touch layouts ignore it.

### 4.5 Focus

- `:focus-visible` only: a 2 px solid `--color-focus` outline with a 2 px offset that follows the
  element's radius. In dark mode, the accent outline is 7.7:1 against the page.
- In segmented controls and radio lists, focus moves with the arrow keys and the ring wraps the
  focused option rather than the track.
- Sheets and modals move focus to the first meaningful control (the least destructive one in
  confirmations) and restore it to the trigger on close.
- In forced-colors (Windows High Contrast), outlines use `Highlight`. The meter keeps its colours,
  and its numeric readout ensures the information survives.

### 4.6 Contrast (WCAG 2.2 AA), measured

These ratios were computed for the token values above using the WCAG relative-luminance formula.

| Pair | Dark | Light | Requirement |
|---|---|---|---|
| text on surface-1 | 15.60 | 18.32 | 4.5 (text) |
| text-muted on surface-1 / surface-3 | 8.18 / 6.68 | 7.56 / 6.08 | 4.5 |
| text-subtle on surface-1 / surface-2 | 5.25 / 4.84 | 5.50 / 4.81 | 4.5 |
| accent on surface-1 | 7.21 | 6.32 | 4.5 (link text) |
| on-accent on accent (primary button) | 7.74 | 6.32 | 4.5 |
| tx1 on surface-1 / surface-2 | 9.43 / 8.70 | 5.70 / 4.99 | 4.5 (badge text in colour) |
| tx2 on surface-1 / surface-2 | 8.20 / 7.56 | 5.74 / 5.02 | 4.5 |
| on-tx1 / on-tx2 on channel fill | 10.12 / 8.80 | 5.70 / 5.74 | 4.5 |
| success / warning / danger on surface-1 | 10.45 / 11.13 / 6.53 | 5.63 / 5.43 / 5.62 | 4.5 (status text) |
| on-danger on danger (mute latch, danger button) | 7.01 | 5.62 | 4.5 |
| border-control on surface-1 / surface-2 | 3.46 / 3.20 | 3.83 / 3.55 (bg) | 3.0 (UI component) |
| meter-ok / hot / clip on meter-well | 10.26 / 10.93 / 6.41 | same (well stays dark) | 3.0 (graphics) |
| lit vs unlit segment (ok / hot / clip vs meter-off) | 7.67 / 8.17 / 4.79 | same | 3.0 |
| focus ring on page | 7.74 | 6.32 | 3.0 |

Notes:
- `--color-border` (hairlines) is decorative and intentionally low contrast. Any border that is the
  *only* indicator of a control's boundary must use `--color-border-control`.
- **Do not use `--color-text-subtle` on surface-3** in light mode (about 4.3:1). Use `--color-text-muted`
  there.
- TX1 and TX2 have similar luminance, so they are told apart by **hue** (blue against orange, which
  stays distinct under protanopia, deuteranopia and tritanopia simulations) **and by their text
  labels**. Never encode a channel by colour alone.
- If the team rejects the "always-dark meter well" in light mode, use these light-safe meter colours
  on a `#E3E7EC` track: ok `#138A4A` (3.55:1), hot `#A86E00` (3.45:1), clip `#C62828` (4.53:1).

### 4.7 Colour usage rules

1. One interactive accent (indigo), used for primary buttons, selection, focus, links and progress.
2. Channel colours are for identity only: badge, top rule, selection outline and inspector switcher
   segment.
3. Semantic colours carry status: success (linked, confirmed), warning (low battery, weak signal,
   retrying), danger (muted latch, lost connection, errors, destructive actions).
4. Meters use their own scale tokens and never take on channel colours, so "hot" and "clip" mean the
   same thing on every channel.
5. Soft tints (`*-soft`) sit behind chips and banners. Text on a tint uses the strong colour.

### 4.8 Motion and reduced motion

| Element | Default | `prefers-reduced-motion: reduce` |
|---|---|---|
| Level meter | rAF, attack instant, release about 20 dB/s, peak hold 1.5 s | Still live (it is data) but capped at 10 fps, no release smoothing, peak hold kept as a static tick |
| Segmented pill, switches | 140 ms slide, `--ease-standard` | Instant |
| Sheet and drawer | 320 ms `translateY` or `translateX`, `--ease-enter` in, `--ease-exit` out | 120 ms opacity fade only |
| Toast | 220 ms fade and 8 px rise | Fade only |
| Confirm flash | 600 ms check fade | Static check for 600 ms |
| Skeleton | 1.2 s shimmer | Static tint |
| Connect "waiting" dots | Slow drift | Static dots |
| Charging bolt or fill | Gentle 2 s fill loop | Static bolt |

Never animate layout on meter updates. Use `transform` and `opacity` only. Pause meter drawing when
the tab is hidden.

### 4.9 Writing style (microcopy)

- Use device words as nouns: "Receiver", "Transmitter 1" (short form "TX1" in tight spaces). Avoid
  internal codes.
- Write status as a fact ("Low battery: 18%") and errors with an action ("Couldn't change gain. The
  transmitter didn't respond. Retry").
- Name destructive buttons after the action ("Reset kit", "Update TX1"), never "OK" or "Yes".

---

## 5. References (Mobbin)

All items are saved in the Mobbin collection **"Hollyland Web UI"**
(<https://mobbin.com/collections/d8f2e6df-09f7-4c5f-a0ce-180c325f1e26/mobile/screens?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp>).
Every pattern below is borrowed at the level of interaction and layout. No visual assets are copied.

Coverage note: Mobbin returned **no first-party audio-hardware companion apps** (RØDE, DJI Mimo,
Shure, Sennheiser, Sony, Bose, Nothing X, Elgato, Logitech G HUB, Focusrite, Teenage Engineering).
Searches by app name returned unrelated apps, so the closest available analogues were used: device
companion apps (Sonos, Meta Quest, WHOOP, Oura, Ultrahuman, LARQ), voice and audio settings (Discord,
Quo, OpenAI Platform, VEED) and developer tooling (Stripe, Supabase, Railway). If direct audio-hardware
references matter, capture RØDE Central, RØDE Capture, DJI Mimo and Focusrite Control manually.

| # | App, screen or flow | Platform | Link | What we borrow |
|---|---|---|---|---|
| 1 | **Meta Quest**: device overview with headset and L/R controller batteries | iOS | [screen](https://mobbin.com/screens/d2f52711-5793-472e-9ee0-0e21747aa467?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A compact multi-device battery cluster (one main unit and two satellites), which maps directly to RX, TX1 and TX2 in the status bar and RX bar. |
| 2 | **WHOOP**: Device settings, Status tab | iOS | [screen](https://mobbin.com/screens/d035bbaf-7ac5-489f-9c8d-2610e2d58b63?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | "CONNECTED TO" label with device ID and last sync, a large battery % with a vertical gauge, and Status/Advanced tabs that separate daily from risky settings. |
| 3 | **WHOOP**: Checking firmware | iOS | [flow](https://mobbin.com/flows/ef1aa612-6fb2-4d85-8393-893d3cbb58c0?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Maintenance as full-width action rows (Firmware check, Reboot, Erase), each with a one-line consequence, plus a "No new updates" outcome. Used for the Device > Maintenance tab. |
| 4 | **WHOOP**: Pairing a device | iOS | [flow](https://mobbin.com/flows/381a9375-b5c7-45fa-b2de-bf0872f17b6f?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A "Check for pairing mode" step that explains the LED, a "Not seeing the light?" escape hatch, and a dotted link animation between two devices. Used for W9 and the connect illustration. |
| 5 | **Oura**: Charging case details | iOS | [screen](https://mobbin.com/screens/5c682ab5-6e7f-4865-b07c-42563e21b74c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Device detail structure: battery header, an action list (soft reset, factory reset, remove in red) and key/value info (model, firmware, serial). Used for W6. |
| 6 | **Ultrahuman**: My Ring | iOS | [screen](https://mobbin.com/screens/c7ea9cdb-3ac6-418a-8d09-ad00f1202000?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | "Status: Connected" with a dot and last sync, a mode row showing "CURRENT: ..." under its label, and toggle rows with explanatory descriptions. |
| 7 | **Ultrahuman**: Battery usage modes | iOS | [screen](https://mobbin.com/screens/eafa6547-68b6-43ca-89da-9c644f48ee73?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Option cards with a tag and plain-language trade-off. Used to explain noise cancellation levels and voice tone presets. |
| 8 | **Waymo**: In-car announcements | iOS | [screen](https://mobbin.com/screens/41f499d7-7742-40de-acff-6790799a95b4?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A quiet radio list with title, description and check. The fallback for enums with more than 4 options or long labels. |
| 9 | **Discord**: Voice processing and noise suppression | iOS | [screen](https://mobbin.com/screens/cef12edc-ef56-4cdf-a274-d9b6efa244af?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Grouped audio settings: a noise suppression level as a radio group and processing toggles with one-line explanations. Model for TX settings grouping. |
| 10 | **Discord**: Voice and Video settings | Web | [screen](https://mobbin.com/screens/dbb26083-0d44-4d90-9498-c07ee9df7a21?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Mic test meter beside volume sliders, a sensitivity slider with a threshold colour split, and a separate **Debugging** tab. This confirms tucking the console away. |
| 11 | **Sonos**: EQ sheet | iOS | [screen](https://mobbin.com/screens/94dc4c87-2132-43f2-9e96-b0a3467426de?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Minus / slider / plus rows with the numeric value top right, grouped in one card, with a Reset row at the bottom. The exact pattern for gain and monitor volume. |
| 12 | **Sonos**: Updating a speaker | iOS | [flow](https://mobbin.com/flows/5991a939-8df2-4e9b-bca3-e88dc10e682c?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A blocking update sheet that states it "must be completed before you can use it", with an honest duration. Tone for the firmware pre-flight. |
| 13 | **Sonos**: Checking for updates | iOS | [flow](https://mobbin.com/flows/80d8b760-ad8e-4a7e-96b5-19c2ce9b7175?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Update automatically / Scheduled / Check for updates rows, then a "Checking..." sheet, then "Up to date" with Done. A minimal, calm state sequence. |
| 14 | **Meta AI (glasses)**: Installing update | iOS | [flow](https://mobbin.com/flows/746b4d27-beba-47d6-a115-70faeea36c0a?tab=screens&utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | An "Update available" CTA on the device card, a full-screen "Updating... keep the app open and device close" with progress and time remaining, and a success screen. Used for W6. |
| 15 | **LARQ**: PureVis power settings | iOS | [screen](https://mobbin.com/screens/9bcb5d7d-fda0-4971-875b-3c8a5a8762ea?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A three-stop slider with labelled detents (Power Saving / Normal / Max). The touch alternative for NC levels when a segmented control is too cramped. |
| 16 | **Gentler Streak**: Preferences sheet | iOS | [screen](https://mobbin.com/screens/1faa484d-a427-468b-9799-935b67163f31?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Label on the left with a compact segmented control on the right inside a sheet. A dense mobile pattern for several enums. |
| 17 | **Fuse**: Slippage sheet | iOS | [screen](https://mobbin.com/screens/136cb060-10ba-4bf2-ac58-1111e738f949?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A big stepper (minus, value, plus) with a Manual/Dynamic segmented control and explanation above. The stepper anatomy and value emphasis. |
| 18 | **Polestar**: Home | iOS | [screen](https://mobbin.com/screens/2a951757-674c-4479-95a8-5fa820009c05?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Stark graphite with a single accent, a large numeric battery with a segmented bar and status words in the accent. Calibrates the "calm but technical" mood. |
| 19 | **Riveo**: Audio volume and ramp controls | iOS | [screen](https://mobbin.com/screens/060151ed-70d4-4477-9fcf-6800e7c1a2bb?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A tick-ruler slider with a numeric readout on the right, a pro-tool feel without skeuomorphism. Inspiration for the gain slider detents. |
| 20 | **OpenAI Platform**: Audio playground inspector | Web | [screen](https://mobbin.com/screens/bb0ea9be-97d2-4c70-a50a-178e5e919d96?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A right-hand inspector with a segmented control (Normal/Semantic/Disabled) and labelled sliders with value and unit right-aligned. The model for the desktop inspector. |
| 21 | **VEED**: Edit audio panel | Web | [screen](https://mobbin.com/screens/cf8456a3-34cf-4130-96f8-1dd014d3e86b?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A compact segmented control with many options, a slider paired with a numeric box, and a toggle revealing nested controls. Density reference for the compact mode. |
| 22 | **Quo**: Audio settings | Web | [screen](https://mobbin.com/screens/f99800d4-e789-47a8-8d2f-2a2aa8d75365?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A pill-segment level meter under the mic picker: simple, legible and accessible. A reference for the mobile horizontal meter. |
| 23 | **Supabase**: Realtime inspector | Web | [screen](https://mobbin.com/screens/89c8f8ca-09a4-496a-87e4-5a735367449c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A "Listening" status with Stop listening, a timestamped message list with payload, a message-type filter popover and a detail pane. The closest analogue to raw HID capture. |
| 24 | **Stripe**: Workbench logs | Web | [screen](https://mobbin.com/screens/19e7f5ce-a94b-43a4-addc-dd88fb128182?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | List and detail split, a status glyph per row, filter chips and a shell input with a "Read only" badge. The model for the gated raw-send input. |
| 25 | **Railway**: Logs | Web | [screen](https://mobbin.com/screens/7b2a7c2d-d2af-4473-a8fd-7a4436fd316a?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Severity as a coloured left rule, dense mono rows and a histogram strip. Console row styling. |
| 26 | **Cloudflare**: Delete Worker modal | Web | [screen](https://mobbin.com/screens/aa928ac1-4a1d-4b8c-9ccb-be35211cdca8?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Type-to-confirm with a copyable token chip, and a red action disabled until the text matches. Used for W7. |
| 27 | **Railway**: Destructive changes modal | Web | [screen](https://mobbin.com/screens/0ab1b8cb-1532-4cdb-82fa-59bbd466ced5?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A dark-mode destructive modal with a warning icon and the dangerous verb in red. The dark-theme treatment for W7. |
| 28 | **Resend**: Delete account modal and toast | Web | [screen](https://mobbin.com/screens/778f011b-60b4-4584-b317-1e2353024e0c?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | A minimal dark modal with a bottom-right success toast afterwards. Toast placement and tone. |
| 29 | **Tailscale**: Add your first device | Web | [screen](https://mobbin.com/screens/6cf86c73-db70-47eb-b101-b628b11943fc?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Split connect layout: steps on the left, a live "Waiting for your first device" panel on the right, and an OS chooser. The structure for W1. |
| 30 | **Twingate**: Connector details | Web | [screen](https://mobbin.com/screens/63275f9d-787b-482d-b12b-e233f3370988?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | Status rows with dot badges (Controller connected, Relay connected), a version with "Up to date" and a key/value metadata column. Used for the Device > Info cards. |
| 31 | **Google Meet**: Something went wrong | Web | [screen](https://mobbin.com/screens/e5069b49-767a-4c2f-a3f2-6676a13f7b54?utm_source=claude-code&utm_medium=ai-assistant&utm_source_platform=mcp) | An error card that names a physical cause ("Make sure Bluetooth is on...") with Try again and Try another way. The tone for W1b. |

---

## 6. Open questions for the team and other agents

1. **Feature truth:** which settings exist on A2 versus M2? What are the exact option sets for NC
   levels, gain steps (range and step size), voice tone or EQ, output modes, auto power-off times and
   brightness? Where does "safety track" live? The schema-driven UI absorbs this, but labels and
   defaults are needed.
2. **Telemetry rate:** can the RX stream live input levels (and at what rate and resolution), or only
   on-demand values? This decides whether meters are real-time or "last level" sparklines.
3. **Battery granularity:** % or steps? Is RX battery reported, or is the RX bus-powered only?
4. **Write acknowledgements:** does every set command get an ACK, and what timeout is appropriate?
   This drives the pending and failed UI.
5. **Firmware:** is updating over HID feasible and safe? Where do images come from (user-supplied file
   only, to avoid redistributing vendor binaries)? What are the per-device minimum battery and the
   recovery procedure if an update fails?
6. **Factory reset scope:** does it clear pairing, and can RX and TX be reset separately?
7. **Concurrency:** can the official app and this page hold the device at the same time? This affects
   the "Busy" error copy.
8. **Product name and disclaimer wording** for the third-party app (placeholder: "Mic Console").
9. **Mobile reality:** WebHID is unavailable on phones today. Should the mobile layout be a full
   priority or a "good enough" tier, alongside a strong demo mode and unsupported screen?
