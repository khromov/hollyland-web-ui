# Hollyland Web UI, Direction A: "Instrument"

## Concept

Hollyland Web UI is drawn as the front panel of a piece of audio equipment: one light aluminium faceplate, divided by hairline rules rather than stacked into cards. Information sits in dark, recessed display windows where the purple and yellow channel LEDs light up. The level meters are the largest element on the screen. Every control is a physical-feeling key, slide switch or detent fader. Each one carries a printed legend and its value in tabular mono numerals, so you can read the panel at a glance mid-shoot.

Colour has one job: identity. Purple means Mic 1 and yellow means Mic 2, matching the LEDs on the transmitters. Everything else is ink on aluminium. The interface has no accent colour, gradients or glows.

## Files

| What | Path |
|---|---|
| Mockup (all frames, one file) | `mockup.html` (`?frame=desk-overview\|phone-overview\|phone-writeonly\|desk-audio\|desk-connect&theme=light\|dark&full=1`) |
| Render script | `render.mjs` (`node render.mjs [filter]`) |
| Contrast checker | `contrast.mjs` (`node contrast.mjs RRGGBB:RRGGBB:label …`) |
| (a) Desktop overview, light (primary) | `a-desktop-overview-light-1440x900.png` |
| (a) Desktop overview, dark | `a-desktop-overview-dark-1440x900.png` |
| (b) Phone overview, light, first viewport / full page | `b-phone-overview-light-390x844.png`, `b-phone-overview-light-390-full.png` |
| (b) Phone overview, dark | `b-phone-overview-dark-390x844.png` |
| (c) Desktop Audio page | `c-desktop-audio-light-1440x900.png` |
| (c) Desktop Connect page (superseded by the single-column page under "Connect screen") | `c-desktop-connect-light-1440x900.png` |
| (d) Phone send-only state (macOS) | `d-phone-sendonly-light-390x844.png`, `d-phone-sendonly-light-390-full.png` |
| Earlier iterations | `iter1/`, `iter2/`; current UI for reference: `current/` |

## Layout system

**Desktop (≥1280 px).** The page has a 64 px header, a body and a 36 px mono status line.

- **Body grid:** a 168 px left rail holds the section name and a one-line explanation, written like the label column of a spec sheet. The content sits to the right of it.
- **Rules instead of cards:** sections are separated by full-width 1 px rules, and modules within a section by vertical 1 px rules. Nothing is boxed except display windows and keys.
- **Overview:**
  - The *Transmitters* row takes all free height (`1fr`), so the meters grow on taller screens.
  - The *Receiver* row is a single horizontal strip of five modules, read left to right like a mixer's control row: Noise cancellation, Receiver volume, Channel mode, Bel canto, Indicator light (with Mic recognition nested under it).
- **Status line:** a persistent mono line at the bottom. It shows link type and direction ("WebHID · two-way"), the time since the last reply, and firmware for RX, TX1 and TX2. Link state lives here and in the header, never in banners.

**Phone (<600 px).**

- **Header:** a 56 px header with the device lamp and name.
- **Status band:** a 32 px mono band under the header.
- **Content:** the two channel modules come first, then *Receiver* as full-width rows separated by rules.
- **Tab bar:** a sticky 4-tab text bar (56 px tall plus an 18 px safe area). The active tab is ink with a 4 px bar above the label. There are no icons, because they would add nothing.

## Type system

Families (Google Fonts):

- **Archivo** (variable `wdth` 62–125, `wght` 100–900) for all language. Headings use a slightly expanded width (`font-stretch:108%`), which gives the engraved-panel feel without resorting to all caps.
- **Martian Mono** (variable `wdth` 75–112.5) at `font-stretch:87.5%`, with `tabular-nums slashed-zero`, for every number and every hardware legend: dBFS, battery, steps, firmware, timecodes, TX IDs and the status line.

| Role | Family / size / line / weight | Notes |
|---|---|---|
| Meter readout (desktop) | Mono 40/1 · 450 | Decimals at 22 px (`−18.4`), set in the channel colour inside the window |
| Meter readout (phone) | Mono 28/1 · 450 | Decimals at 16 px |
| Recorder timecode | Mono 44/1 · 420 | Hundredths at 24 px in ink-3 |
| Page title (Connect) | Archivo 30/1.1 · 680 · wdth 108 | Only on pages with no live data |
| Channel name (editable) | Archivo 26/1 · 660 · wdth 108 (phone 22) | |
| Wordmark | Archivo 16 · 720 · wdth 118 | Next to a 26 px "window" glyph with purple and yellow bars |
| Rail / section title | Archivo 15/1.3 · 680 · wdth 108 (phone 18) | |
| Control title | Archivo 15/1.25 · 660 (phone 16) | |
| Body / description | Archivo 13–14/1.45 · 400 | |
| Footnote | Archivo 12/1.45 · 400 · ink-3 | |
| Value at module head | Mono 24 · 500 (`6/6`, `/6` in ink-3) | |
| Legends, scales, status line | Mono 10–11 · 500 | Lowercase or sentence case. Uppercase only for the three lamp legends (CLIP, RECORDING, SEND-ONLY LINK). |

## Colour tokens

Purple and yellow are fixed across themes. They are LED colours, and they always sit either inside a dark window or inside a dark LED bezel. That is how a 1.22:1 yellow stays legible on a light panel.

### Light: "Aluminium" (primary)

| Token | Value | Use |
|---|---|---|
| `--chassis` | `#E8E7E2` | Page / faceplate |
| `--chassis-2` | `#DCDBD5` | Recessed tracks (switch track, fader slot) |
| `--key` | `#F6F5F1` | Key face |
| `--key-edge` | `#7E7C73` | Key and switch outlines |
| `--rule` / `--rule-soft` | `#BDBBB3` / `#D3D1CA` | Hairline dividers (decorative) |
| `--ink` / `--ink-2` / `--ink-3` | `#16161A` / `#4A4A50` / `#5E5E64` | Text, primary to tertiary |
| `--sel` / `--sel-ink` | `#16161A` / `#F2F1EC` | Selected key: pressed and backlit |
| `--window` | `#111113` | Display windows (meters, notices, code) |
| `--w-ink` / `--w-ink-2` | `#E9E8E3` / `#8A8A90` | Text inside windows |
| `--mic1` (LED) / `--mic1-ink` (text) | `#9D6BFF` / `#6B3FD0` | Mic 1 identity |
| `--mic2` (LED) / `--mic2-ink` (text) | `#FFCC1A` / `#7A5A00` | Mic 2 identity |
| `--live` | `#168043` | Link lamp |
| `--rec` / `--hot` | `#C42B21` / `#F0544A` | Record, clip, top 6 dB of the meter |
| `--bezel` | `#16161A` | Ring around every LED |
| `--focus` | `#16161A` | 2 px outline, 3 px offset |

### Dark: "Graphite"

| Token | Value |
|---|---|
| `--chassis` / `--chassis-2` | `#141416` / `#0D0D0F` |
| `--key` / `--key-edge` | `#1F1F22` / `#72727A` |
| `--rule` / `--rule-soft` | `#2E2E33` / `#232327` |
| `--ink` / `--ink-2` / `--ink-3` | `#ECEBE6` / `#A3A3A8` / `#8A8A90` |
| `--sel` / `--sel-ink` | `#ECEBE6` / `#141416` (the selected key inverts to paper) |
| `--window` / window edge | `#0A0A0B` / `#2E2E33` |
| `--mic1-ink` / `--mic2-ink` | `#B99AFF` / `#FFCC1A` |
| `--live` / `--rec` | `#4CC27A` / `#F0544A` |
| `--focus` | `#ECEBE6` |

### Contrast (WCAG 2.x, computed with `contrast.mjs`)

| Pair | Light | Dark | Requirement |
|---|---|---|---|
| ink on chassis | 14.57 | 15.41 | text 4.5 ✓ |
| ink-2 on chassis | 7.11 | 7.33 | text 4.5 ✓ |
| ink-3 on chassis | 5.20 | 5.36 | text 4.5 ✓ |
| ink-3 on key face (disabled labels) | 5.90 | 4.79 | text 4.5 ✓ |
| ink on key face | 16.54 | 13.77 | ✓ |
| sel-ink on sel (selected key) | 15.96 | 15.41 | ✓ |
| key-edge on chassis (control boundary) | 3.38 | 3.86 | non-text 3.0 ✓ |
| focus ring on chassis | 14.57 | 15.41 | non-text 3.0 ✓ |
| **Mic 1 purple LED `#9D6BFF` on window** | 5.37 | 5.64 | non-text 3.0 ✓ (also passes text) |
| **Mic 1 purple text `#B99AFF` on window** (readouts) | 8.20 | 8.00 (on chassis) | text 4.5 ✓ |
| **Mic 1 purple as text on light `#6B3FD0`** | 5.22 | — | text 4.5 ✓ |
| Mic 1 LED `#9D6BFF` directly on light chassis | 2.84 ✗ | — | Never used bare: always inside a bezel |
| Mic 1 LED inside bezel (`#9D6BFF` on `#16161A`) | 5.14 | 5.14 | ✓; bezel on chassis 14.57 |
| **Mic 2 yellow LED `#FFCC1A` on window** | 12.49 | 13.10 | ✓ |
| **Mic 2 yellow as text on light `#7A5A00`** | 5.15 | — | text 4.5 ✓ |
| Mic 2 yellow as text on dark chassis | — | 12.18 | ✓ |
| Mic 2 LED `#FFCC1A` directly on light chassis | 1.22 ✗ | — | Never used bare: always inside a bezel or window |
| Mic 2 LED inside bezel / ink on yellow fill | 11.95 | 11.95 | ✓ |
| Window legend `#8A8A90` on window | 5.50 | 5.77 | text 4.5 ✓ |
| Window ink on window | 15.37 | — | ✓ |
| rec on chassis ("RECORDING · TAKE 3") | 4.57 | 5.32 | text 4.5 ✓ (tight in light: keep it ≥11 px semibold) |
| live lamp on chassis | 4.04 | 8.15 | ✓ |
| Dark window edge on chassis | — | 1.36 | Decorative; windows also get an inset shadow. Content inside carries the information. |

Rules that follow from the table:

1. Purple and yellow never touch the light chassis directly. They live in a **window** or a **bezel**, the way real LEDs sit in a housing.
2. The interface has no accent colour, and selection is ink. Red is reserved for record, clip and the top 6 dB of the meter.
3. Warnings may never be yellow, because yellow already means Mic 2. The send-only state uses a dark window with an arrow glyph and ink.

## Spacing, radius, elevation

- **Spacing** on a 4 px base: 6 (gap between keys), 8, 10, 12, 14, 16, 20, 24, 28, 32. Desktop gutters are 32. Module padding is 20 (receiver) and 28 (channel). The phone gutter is 16.
- **Radius**, only four values: windows 4, keys and switch tracks 6, knobs and fader caps 3–4, small plates (TX1 tag, battery body) 3. LEDs are round. Nothing is larger than 6.
- **Elevation**, three physical levels and no blur:
  - *Recessed:* windows, fader slot and switch track use `inset 0 1px 3px` plus a 1 px light lip below on the light theme.
  - *Flush:* the chassis.
  - *Raised:* keys and fader caps use a 1 px top highlight plus a 1 px hard bottom shadow.
  - When selected, a key loses the raised shadow and takes an inset one, so it reads as pressed.
- **Rules:** 1 px `--rule` between sections and modules. A 1.5 px ink rule is used only for strong structure: the phone tab bar top and the takes table head.

## Component inventory

**Lamp (LED).** A 14 / 20 / 12 px dark bezel with an 8 / 12 / 6 px lens.

| State | Look |
|---|---|
| On | Lens in the LED colour with a tiny specular dot |
| Off | Lens at 18 % tint |
| Hollow | Empty ring: unknown, not read |

Lamps are used for channel identity (purple, yellow), the link (green), the mute flag and CLIP (red).

**Channel module (Mic 1 / Mic 2).**

- **Head:** a large lamp in the channel colour, the editable name (26 px) with a 36 px rename key (44 px hit area), a TX1/TX2 outline plate and an Online lamp.
- **Display window:**
  - *Level history:* the last 10 s, bottom-anchored on the same −60…0 dBFS scale, with dashed gridlines at −6 (red tint), −12, −24, −36 and −48.
  - *Segmented bar meter:* 40 segments on desktop, 28 on phone. RMS segments are fully lit, the two segments below the RMS level fade out to show decay, and the peak-hold segment is lit on its own. Unlit segments are a 15 % tint of the channel colour, and the top 6 dB get a red tint.
  - *dB scale.*
  - *Right column:* a CLIP lamp at the top and the RMS readout with peak below it at the bottom.
- **Stats row:**
  - *Battery:* a 10-cell gauge plus "91%", with a bolt and "Charging" on Mic 2.
  - *Mute:* a lamp plus "Off · set on the mic". It is read-only, so it is styled as an indicator and never as a button.
  - *Output:* L or R, derived from Channel mode.

**Key.** Minimum 44 px tall, 6 px radius, raised.

| State | Look |
|---|---|
| Selected | Ink fill with paper text (inverted in dark) |
| Disabled | Dashed outline, ink-3 label, no face |
| Sent (send-only) | 2 px ink outline over a 135° hatch |
| Primary | The selected style at 52 px |
| Quiet | No face |

**Key row (segmented control).** Separate keys with a 6 px gap, not a pill track. `role="radiogroup"`, with arrow-key navigation. Channel mode keys are tall (74 px) and carry a **routing glyph**: a tiny window showing what lands on L and R.

| Mode | L | R |
|---|---|---|
| Mono | purple + yellow | purple + yellow |
| Stereo | purple | yellow |
| SafeTr | purple + yellow | shorter bars, the −6 dB copy |

**Slide switch.** A 62×30 track holding a 22 px knob with grip lines. The legend (ON / OFF) is engraved inside the track, on the side opposite the knob, so state never depends on colour alone and no external label pushes headings to wrap. When on, the track is ink. In the unknown state the track is dashed, has no knob and reads "– –". `role="switch"`.

**Detent fader (RX volume).** A recessed slot with an ink fill up to the value, six detents numbered 1–6 (the current one bold) and a mixer-style cap with a centre line. The value repeats large at the module head ("6/6").

- Arrow keys step through the detents, and Home and End jump to the ends.
- On touch, −/+ keys (46 px) flank the fader, and + is disabled at 6/6.
- Desktop detent hit areas are 32×66 px, and they widen to ≥44 px under `pointer: coarse`.
- The focus ring is shown on the cap in frame (a).

**Nested control.** Mic recognition sits under Indicator light, with a 1 px rule on its left, because it only works when the light is on. It shows a live LED preview: "● Mic 1 glows purple", "● Mic 2 glows yellow".

**Preset bank (Audio).** Eight keys in a 4×2 bank, like a hardware preset bank. Each key shows its slot number (01–08), the profile name and a small tonal curve drawn against a dashed flat line, so the profiles are comparable at a glance. The selected key is inverted.

**Recorder.**

- **Transport:** a round 76 px key that is a red stop square while recording. Next to it sit a red REC lamp with "RECORDING · TAKE 3", a mono timecode, and the effect and size.
- **Take timeline window:** two lanes coloured by channel (L purple, R yellow), a red playhead with the time and a mono ruler.
- **Takes table:** mono columns for start, length and size, with Play and Save keys.

**List rows (Settings and Device, not mocked).** These follow the receiver row grammar: title and description on the left, the control on the right, rules between rows and no boxes.

- *Settings:* Smart battery life (switch), Mic auto power-off (switch, footnote "Shut down after 15 minutes of inactivity"), and External speaker without unplugging (switch). The last one opens a confirm step, because changing it restarts the receiver. During the restart, the header lamp blinks and the status line reads "restarting · reconnecting".
- *Device:* a spec-sheet table with a left label column and hairline rows. Firmware `3.0.2.008` appears on RX, Mic 1 and Mic 2 in mono. Serials are masked (`•••• •••• 7F3A`) with a reveal key. Paired devices are list rows with a quiet "Remove pairing" key.
- *Factory reset:* sits alone at the bottom, separated by a 1.5 px ink rule. It uses a red outline key and a typed-confirmation dialog.

**Connect screen.** One centred column (680 px max), read top to bottom, in plain page type. It replaces the first mockup's three panes, Chrome-chooser preview, "Full control on a Mac" column and "How it connects" schematic (frame (c) Desktop Connect in `mockup.html` is superseded).

- **Title:** "Control your Hollyland USB microphone from your computer", with one subtitle line naming the supported receivers and saying settings go straight to the receiver over USB.
- **Steps:** three numbered steps (plug in the receiver, switch on the mics, press Connect receiver and pick the receiver in the browser's list). The chooser is described in words; nothing imitates browser UI. No LED colours: purple/yellow only hold for the LARK A2 with Mic Recognition on.
- **Connect receiver:** the primary key, plus "Reconnect …" when the browser already has permission for a receiver. Connection errors appear as a banner right under it. While a bridge connection runs or has just failed (e.g. `npx hollyland-web-ui` opens the page with `?bridge=auto`), a status line with a lamp sits under the key with "Show details", which opens and scrolls to the bridge disclosure.
- **Platform note:** one short paragraph: Linux and ChromeOS get full control; macOS and Windows can send settings but can't read the receiver's status back. A link to the Audio page, which works without connecting.
- **Disclosures** (native `<details>`, closed by default, between hairline rules):
  - *Full control on a Mac (local bridge):* **macOS only**; on other systems it is not shown unless a bridge connection is under way or has failed. The bridge command in a code window with Copy, a "Connect through local bridge" key, the address it expects, and short facts (Chrome's local-network prompt on the hosted site, Ctrl+C to stop, what origins the bridge accepts). Opens by itself while a bridge connection runs or fails.
  - *Receiver not in the list?:* re-plug or try another port, close HollyAudio, the Linux udev rule in a code window, and the Windows Sound settings check.
- **Disclaimer:** "Independent project · not affiliated with Hollyland" at the bottom of the column, until the status line has room to carry it (1200 px).
- **Without WebHID** (Safari, Firefox, phones): the reason in one paragraph and a "Copy link" key instead of the steps.

### Send-only (write-only) state: confidence language

macOS drops the receiver's replies, so the page can send but cannot read. The panel shows how much it knows about each value with three consistent marks:

| Mark | Meaning | Look |
|---|---|---|
| Solid | Read back from the receiver | Ink-filled key or switch, lit lamp, numbers |
| Hatched | Last sent from this browser, not confirmed | 2 px ink outline over a 135° hatch, plus "Last sent 17:42 · not confirmed" |
| Dashed | Unknown, never sent from this browser | Dashed outline, "– –", hollow lamp, plus "Not sent from this browser yet · tap to set" |

What the user sees in this state:

- **Header:** a hollow lamp next to LARK A2.
- **Notice:** directly under the header, a dark window. "→ SEND-ONLY LINK" is followed by one sentence of explanation, a "Connect through local bridge" key and "Why?". It is not a yellow banner, because yellow means Mic 2.
- **Meters stay live,** because they come from USB audio rather than HID.
- **Battery** shows a hatched, dashed-outline gauge with "– –". Mute shows a hollow lamp. The TX status reads "Not read".

## Responsive rules

| Width | Layout |
|---|---|
| ≥1280 | As frame (a): 168 px rail, two channels side by side, 5-module receiver strip, status line. Meter windows absorb spare height. |
| 960–1279 | The rail becomes an inline section heading row. Channels stay side by side. The receiver strip wraps 3 + 2 with rules preserved. |
| 600–959 | Channels stack full-width (history shrinks to 64 px). Receiver modules go 2 per row. The header tabs remain. |
| <600 | As frame (b): single column, the status band replaces the status line, −/+ keys flank the fader, the history shrinks to 36 px, and the bottom tab bar replaces the header tabs. Meters use 28 segments and fewer scale marks (−60, −36, −18, −6, 0). |

- With `pointer: coarse`, every target is at least 44 px: fader detents, rename (via `::after`) and table actions.
- Reduced motion: meters update without decay animation, and lamps never blink. The restart state uses text instead.

## Accessibility notes

- **Focus:** a visible 2 px ink outline at 3 px offset (paper on dark). It is never removed.
- **State without colour:**
  - Switches carry ON/OFF text.
  - Selected keys invert, rather than only changing colour.
  - Channels are named everywhere ("Mic 1", "L"), not only coloured.
  - Send-only marks use pattern (hatch versus dash) plus text.
- **Meters:** each meter is `role="meter"` with `aria-valuenow` in dBFS and a polite live region that announces only clipping.
- **Mute** is an indicator (`role="status"`) and not a control, with the hint "set on the mic".
- **Disabled options** (Bel canto off) keep 5.2:1 contrast and explain why: "Switch on to choose a tone".

## Deliberately avoided (versus the current UI)

- Uniform rounded cards with 1 px borders. Rules are used instead.
- Coloured top borders on cards. Identity is an LED.
- A blue accent. Selection is ink.
- Uppercase overlines on every group. Uppercase is limited to three lamp legends.
- "Audio not enabled" empty bars. The meters are the hero.
- Geist. Archivo plus Martian Mono have a reason: engraved panel plus instrument readout.
- Pill chips, gradients, glows, glass, illustrations and emoji.

## Mobbin references

| # | App · screen | Link | What I took |
|---|---|---|---|
| 1 | Kino (iOS) · camera | https://mobbin.com/screens/4effc95b-ba06-4ee7-b1d4-5ad971cab066 | Segmented L/R LED meter in a dark readout, with mono legends ("4K · 30 · P3 · H.264"). This became the meter construction and the mono status line. |
| 2 | Untitled stems player (iOS) · stem mixer | https://mobbin.com/screens/996916cd-2a7f-4d0c-ad28-d699736f8ee5 | Channel strips with tick ladders, mono channel labels and a small coloured dot as identity. Channel colour became a lamp, not a coloured card. |
| 3 | Untitled "Waves" recorder (iOS) · new recording | https://mobbin.com/screens/bb04ae1a-9ea3-44ea-90cf-d11ef8d06726 | Mono dB readout and timecode. Tabular mono numerals throughout, with smaller decimals. |
| 4 | Riveo (iOS) · volume / ramp controls | https://mobbin.com/screens/060151ed-70d4-4477-9fcf-6800e7c1a2bb | Tick-ruler controls with a right-aligned numeric value. Led to the detent fader and the value at the module head ("6/6"). |
| 5 | Pi (iOS) · voice settings | https://mobbin.com/screens/4cdd3d9e-61b8-4d32-8b5b-6bd944b9d76c | A stepped scale with every stop labelled and the current one emphasised. Applied to the fader's numbered detents. |
| 6 | Deezer (iOS) · equalizer | https://mobbin.com/screens/f0bedc78-d898-46b2-9968-5c71c1fbf75c | LED-bar cells, lit against dim. Unlit meter segments became a tint of the channel colour, not grey. |
| 7 | WHOOP (iOS) · device settings | https://mobbin.com/screens/d035bbaf-7ac5-489f-9c8d-2610e2d58b63 | "Connected to / last sync" status with a big numeric battery beside a gauge. Led to "last reply 0.4 s" and the battery cells plus %. |
| 8 | Oura (iOS) · charging case details | https://mobbin.com/screens/5c682ab5-6e7f-4865-b07c-42563e21b74c | Firmware and serial as a key/value list, with destructive actions grouped apart. This is the Device page pattern (Remove pairing, Factory reset). |
| 9 | Twingate (web) · device details | https://mobbin.com/screens/66d04258-ac9b-4a85-b384-02f26229b5f5 | A key/value column next to a ✓/✕ capability list. Became the platform capability lines on Connect (read & write / send only). |
| 10 | Fabric (web) · Sources | https://mobbin.com/screens/162f77fe-5b3a-4c52-a051-9a9847f6646a | "→ 1-way sync (read only)" against "↔ 2-way sync". The send-only state is expressed as link direction (→ glyph, "two-way" in the status line). |
| 11 | Stripe (web) · Workbench / Health | https://mobbin.com/screens/ce2f0b29-60dd-4d06-b49e-b6583c6dbee2 | A "Read only" mode tag living in a persistent bottom bar. Became the desktop mono status line for link state instead of banners. |
| 12 | Google Meet (web) · HID device chooser | https://mobbin.com/screens/b123e134-fe60-40fa-8ce3-bf0153e99516 | Chrome's native "wants to connect to a HID device" chooser. The first mockup previewed that chooser on the Connect screen; the shipped page describes it in words instead. |
| 13 | Dialpad (web) · hardware settings | https://mobbin.com/screens/f672a5ee-aa70-4709-be44-4cb2b65da073 | A mini level meter next to the microphone it measures. Meters live inside each channel module, not only on the Audio page. |
| 14 | Sonos (iOS) · settings, Hardware group | https://mobbin.com/screens/f2eeb985-af5b-4267-8606-d958534c9101 | "Status Light" grouped under Hardware. Indicator light and Mic recognition are grouped as one hardware function. |
| 15 | Sonos (iOS) · EQ | https://mobbin.com/screens/94dc4c87-2132-43f2-9e96-b0a3467426de | The value printed at the right of each control (+2, 0) on a light grey panel. Gave the value-at-head and the aluminium tone. |
| 16 | Kino (iOS) · Grades | https://mobbin.com/screens/3ec90e7e-9a8e-47f6-9593-3dc416417fbc | Presets shown as printed "labels" with their own mark. Became numbered preset keys with a tonal-curve mark per profile. |
| 17 | Halide Mark III (iOS) · camera | https://mobbin.com/screens/e643f55e-f044-4268-b741-c68b125c3bdf | Thin outlined mode badges (RAW, AF). TX1 and TX2 became outline plates instead of filled pills. |
| 18 | ElevenLabs (web) · Dubbing studio | https://mobbin.com/screens/fcaeb035-69da-48a0-aaaf-759f1ecd45fe | Speaker colour dots carried into timeline lanes. Recorder lanes are coloured by channel identity (L purple, R yellow). |
| 19 | In Common With (web section) · Tech specs | https://mobbin.com/sites/sections/6c5ddd6d-bd8e-4cbf-9616-8016064f2bdc | A hairline-ruled spec table with a label column on warm paper. Became the left rail plus rules instead of boxed cards, and the Device spec table. |
| — | Shopify (web) · "Store access is restricted" banner (anti-reference) | https://mobbin.com/screens/67e6e0a6-1ef6-4eab-aa93-1844f2e40822 | Why the send-only notice is *not* a yellow banner: yellow is Mic 2's identity here. |
