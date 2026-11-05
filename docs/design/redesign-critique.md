# Mic Console redesign: art-director review

I reviewed the three directions: A "Instrument", B "Editorial calm" and C "Device-first / The Bench".

**What I looked at:**
- Every top-level PNG in each direction folder, in light, dark and write-only, on phone and desktop.
- All three `spec.md` files.
- The current UI.
- The repo's protocol and UI code, to check each mockup against what the hardware can actually do.

**Missing input.** The `ui-shots/final-*.png` files named in the brief don't exist. For the current UI I used the captures the designers made (`?mock=a2` and `?mock=blind`, in each `current/` folder).

**Close-up crops** I made for checking detail:
- <scratchpad>/critique-crops/inst-meter.png
- <scratchpad>/critique-crops/prod-strip.png

## Baseline: what is wrong with the current UI

The current UI is the textbook version of the slop the user is reacting to:
- A blue-black dashboard of identical 1 px bordered rounded cards.
- Coloured top borders on the cards.
- Uppercase overlines ("LEVEL", "UNMUTED", "RECEIVER").
- Pill chips and a sky-blue accent on switches and the volume bar.
- Grey-on-grey hierarchy, Geist with no intent, and a "Live levels and recording" empty card with an icon tile.

Two concrete defects as well:
- The meters show "AUDIO NOT ENABLED" bars, so the most hardware-like element is dead on arrival.
- On phone the bottom tab bar overlaps the receiver card.

All three directions fix the surface problems. The question is which one is a real tool rather than another style.

---

## Direction A: "Instrument"

### What is genuinely good

- **It looks like it controls hardware.**
  - Keys have depth and press in when selected.
  - Switches print ON/OFF inside the track.
  - Values sit at the head of each module ("6/6").
  - The receiver strip reads left to right like a mixer row: NC, Volume, Channel mode, Bel canto, Lights.
  - Of the three, this is the only one that a sound person would recognise as theirs.
- **The identity rule is the smartest colour decision in the set.** Purple and yellow appear only inside dark display windows or LED bezels. That solves yellow's 1.22:1 contrast on light without banning yellow, and identity reads instantly in the meters and readouts on both themes.
- **The channel-mode keys carry routing glyphs** (L/R bars per mode). This is the single best piece of explanatory UI in all three directions: SafeTr's "−6 dB copy" becomes visible instead of a footnote.
- **The send-only confidence vocabulary is the most rigorous.**
  - Solid means read back.
  - Hatched means sent but not confirmed, with "Last sent 17:42 · not confirmed".
  - Dashed means unknown.
  - The battery gauge is hatched with "– –", and the TX status reads "Not read".
- **The meters keep working in send-only.** This is correct: they come from USB audio, not HID.
- **The phone layout is the strongest of the three.**
  - Sensible order and full-width keys.
  - The volume fader has −/+ flanks, and + is disabled at 6/6.
  - The text-only tab bar is a deliberate choice, not an icon row.
  - NC is visible at the bottom of the first viewport.
- **The Audio page works well.**
  - Two-channel meter window.
  - The recorder has a take timeline with channel-coloured lanes and a proper takes table.
  - The tone curves on the eight presets are not fiction: `src/lib/dsp/presets.ts` holds real EQ parameters, so the curves can be computed.
- **The status line is useful.** "WebHID · two-way · last reply 0.4 s · RX/TX firmware" puts link state in one place instead of banners.

### Slop tells and weaknesses

- **The meters swallow the Overview (a, light and dark).**
  - The two display windows take about 60 % of a 1440×900 screen, mostly for a 10-second history graph.
  - The page's job is "check levels, change settings". History is a nice-to-have, and it belongs on Audio.
  - The receiver controls, which are the actual work, are squeezed into the bottom 330 px.
  - At 1280×720, a common laptop size, they will be largely below the fold.
- **Two different x-axes are stacked in one window (a; see inst-meter.png).**
  - The history graph's x-axis is time, but the −60 … 0 dB scale printed under the segmented bar meter sits directly beneath it.
  - At a glance the dB labels read as the graph's x-axis. That is a real data-visualisation error, not a nitpick.
- **There is a rendering collision (a).** The y-axis labels −24, −36 and −48 punch background-coloured holes into the first four history bars. That is visible and sloppy.
- **The right column of each meter window is a dead zone.** CLIP is pinned top-right, the readout bottom-right, and about 200×350 px of black sits between them.
- **It leans on the "TE-core" pastiche.** Grey aluminium, black windows, Martian Mono everywhere and 01–08 numbered keys are now the house style of AI-generated "hardware" concepts. The mono is overused:
  - The rail captions "History 10 s / Peak hold 2 s" and "Confirmed by the receiver within 1 s" are mono filler. The code's peak hold is 1500 ms, so the copy is also wrong.
  - Also mono: "last 10 s", "RMS dBFS", "Chrome then asks which HID device to connect", and the whole footer.
  - Mono should mean "measured value or hardware ID", and nothing else.
- **The 168 px left rail is spec-sheet theatre.** It holds three lines of explanation per section on every page and costs width the meters and strip need.
- **Specular highlight dots on the LEDs** are a small skeuomorphic kitsch tell. Drop them.
- **"Mute · ● Off · set on the mic" is ambiguous.** A dark lamp next to "Off" reads as "mic off". Editorial's word "Unmuted" is clearer.
- **The detent fader is the wrong control for six discrete steps.**
  - It implies a continuous value and needs −/+ buttons on touch.
  - Its desktop detents are only 32 px wide.
  - Six direct-hit steps are simpler and faster.
- **The same visual means two things.** Dashed outlines mean "disabled" (Bel canto tones while it's off, in (a)) and also "unknown / never sent" in send-only (d). The spec defines both. This must be split.
- **Copy and accuracy problems on Connect (c):**
  - "macOS, Windows: send only" overclaims. `webhid.ts` says Windows is unverified.
  - The diagram says "USB audio · available now" next to a receiver labelled "plug in to start". Both can't be true.
  - The "Chrome chooser preview" imitates browser chrome ("Wireless Microphone · pick this"). Users will try to click it. Describe the chooser in text; don't fake it.

### Hierarchy and usability

- **Changing NC level fast:**
  - Desktop: yes. It is the first module, and one click on Weak, Medium or Strong.
  - Phone: yes, at the fold.
  - Catch: if NC is off, the level keys presumably go to the same disabled state as Bel canto, so changing level means two actions.
- **Write-only:**
  - Honest overall, and the vocabulary is the best.
  - **But it breaks the protocol.** The NC switch is shown as a dashed "– –" switch with "Not sent from this browser yet · tap to set". NC on/off is a toggle-only command. `device.ts:643` refuses it when the receiver can't reply ("noise on/off is a toggle and needs a known current state"). Offering it is a lie.
  - The send-only notice's primary action is "Connect through local bridge" without saying that on macOS the bridge pauses USB audio. The user would trade live meters for control without knowing it.
  - Mic recognition silently disappears in send-only.
- **Identity:** excellent in the windows. Purple and yellow read instantly, even in the takes timeline.

### Responsive quality (phone)

**8/10.** The order is correct, controls are full-width and 44+ px, and the meters scale down sensibly (28 segments, short history). Weaknesses:
- "Output: L" with no other text is cryptic.
- The mono status band under the header adds another strip of 10–11 px text.

### Accessibility risks

- 10–11 px mono legends throughout, and the ON/OFF text inside switches is about 10 px.
- "RECORDING" in red is only 4.57:1.
- Text over the 135° hatch on "sent" keys needs to be checked, because a hatch behind the label lowers effective contrast.
- The focus ring (2 px ink outline) and the "sent" style (2 px ink outline plus hatch) are close relatives.
- The dark window edge on dark chassis is 1.36:1. It is decorative, so this is acceptable.

### Scores

| Distinctiveness | Clarity / usability | Craft / polish | Fit for audio hardware | Feasibility (Svelte, existing kit) |
|---|---|---|---|---|
| 8 | 7 | 7 | 9 | 6 |

**Why feasibility is 6:**
- New pieces are needed: a level-history buffer and canvas, the detent fader, the slide-switch variant, routing-glyph keys, EQ magnitude curves, and a recording waveform for the timeline.
- `SegmentedControl`, `Switch`, `LevelMeter`, `Battery` and `SettingRow` can be restyled, but several of them need new variants.

---

## Direction B: "Editorial calm"

### What is genuinely good

- **The receiver list is the clearest settings UI in the set.**
  - Each row is a sentence, "Noise cancellation · *Medium*", with a short description and the control on the right on desktop or full width on phone.
  - You can scan the receiver's whole state down one column.
- **Off as a segment** ("Off | Weak | Medium | Strong", "Off | Bright | Low | Balance") is the best interaction decision across all three directions.
  - It removes a control per row and makes any NC change one click.
  - It matches the hardware: on M2-family receivers, "NC enabled" is literally `noiseLevel > 0`, and `setVoicePreset(enabled, preset)` sends both values together.
- **It is the only direction that handles write-only NC correctly.** Off is hatched and disabled with a one-line reason, and the levels stay sendable. That is the protocol truth.
- **The write-only copy is the best of the three:**
  - "This Mac can send settings, not read them."
  - "Levels are live; everything else on this page is what you last sent."
  - "Forget sent values" is a thoughtful action.
- **Mute is a word** ("Unmuted"; "Muted" in red), not a widget. It is read-only, and it looks read-only.
- **The Audio page's per-mic radio table maps exactly to the real feature.** `audio.fxLinked` in AudioPage.svelte, with "Same profile for both mics" collapsing the columns. "Monitor on this computer" is correctly described.
- **The spec has a "Mapping onto the existing code" section** (tokens, SettingRow `val` slot, SegmentedControl `disabled`/`unset`, StepBar numerals). It is the only direction that reads as implementable next week.

### Slop tells and weaknesses

- **The style itself is the 2025 "tasteful AI default".** Warm cream paper (#F6F5F1), a Newsreader serif display, italic serif accents and hairline rules are what generated landing pages look like right now. It swaps one recognisable template for another.
- **It doesn't fit an audio tool.** Serif mic names, serif battery figures and a serif "−18" next to a mono "dBFS" read as a magazine, not a console.
- **The 80 px "LARK A2" headline is decoration that costs about 300 px on every page** (a, b, d), plus a giant "Audio" title on (c).
  - The lede under it repeats the header status ("Receiver connected over USB. Both mics are online and in range.").
  - The "Mute is set with the button on each mic …" footnote is permanent filler.
- **Purple and yellow barely exist.** The brief says the UI must use them as channel identity. Here:
  - Identity is an 8 px light slit inside a black capsule plus a coloured peak tick.
  - The meters are monochrome ink "barcodes". Mic 1 and Mic 2 meters are indistinguishable at a glance, and that is the one place identity matters most during a shoot.
- **The inline capsule glyphs in "Channel mode · Mic 1 on the left channel, Mic 2 on the right" are clumsy,** especially on phone, where they become big black lozenges inside a sentence.
- **The ink switches are stock iOS toggles.**
- **The volume staircase bars are tiny on phone.** Step 1 is drawn about 14 px tall. The spec gives 46×64 hit areas, but visually it reads as a chart, not as buttons.
- **The two-column top edges don't align on desktop (a).** "LARK A2" starts at y≈170 and "Receiver" at y≈270. It's intentional per the spec ("the asymmetry"), but it reads as a misalignment rather than a choice.
- **The Connect page (c2) is a big serif hero, "Connect your receiver.", with an illustration on the right.** It is close to the "hero with illustration" the brief bans. It is saved by the schematic actually teaching the light colours.

### Hierarchy and usability

- **Changing NC level fast:**
  - Desktop: the best of the three. First row, top right, one click from any state, including Off.
  - Phone: needs a scroll. NC starts about 940 px down in live mode and about 1180 px down in write-only, because the headline, lede, footnote and the "Receiver" serif title all come first.
- **Write-only:**
  - Clearest in words.
  - **But the visual says the opposite.** Last-sent values ("Medium", "6 of 6", Indicator light On) use the same solid ink fill as confirmed values. Only an orange "Last sent 14:02." line separates fact from memory, so at a glance the page claims knowledge it doesn't have.
  - "Status unknown" (no channel claimed because channel mode is unknown) is correct. But the meters are still drawn under "Mic 1" and "Mic 2" with purple and yellow peak ticks, which is the same unknown mapping.
  - On desktop write-only, Mic recognition falls below the fold.
- **Identity:** weak. This fails the brief's explicit requirement.

### Responsive quality (phone)

**6/10.** It is cleanly typeset, and controls go full width at 44 px. But:
- The first screen (b, d) contains no receiver controls at all.
- In write-only the first screen is band, headline and one and a half mics.
- Too much scroll for the most common task.

### Accessibility risks

- Identity depends on an 8 px coloured slit; colour is carried by tiny marks only.
- Unlit ticks are 1.30:1. This is decorative, and the level is also in text.
- Terracotta for write-only and red for clip/danger are close hues for protan/deutan users.
- The off switch's ink-3 knob is low-salience.
- Contrast numbers are otherwise solid: ink 16:1, ink-2 6.9:1, edge 3.29:1.

### Scores

| Distinctiveness | Clarity / usability | Craft / polish | Fit for audio hardware | Feasibility (Svelte, existing kit) |
|---|---|---|---|---|
| 5 | 7 | 8 | 5 | 9 |

---

## Direction C: "Device-first" (The Bench)

### What is genuinely good

- **It is the most distinctive and the most memorable.** Identity is unmistakable: Mic 1 *is* purple and Mic 2 *is* yellow. The 96 px battery numerals in wide Archivo can be read from across a room, which is a real on-set benefit.
- **The phone first viewport is the best of the three (b).** Both mics with battery, mute and level, then the Receiver heading and NC with its levels, all without scrolling.
- **Write-only is the most visually honest at the hero level (d):**
  - The device drawings ghost to dashed outlines, LEDs go hollow, and the link dots disappear.
  - The batteries read "--% Not readable".
  - Meters are relabelled "Level · USB".
  - Selections turn to outlines under the line "Showing what this browser last sent, today 14:02".
  - Binary settings become "Off | On" send pairs with a dot on the last value sent.
  - NC offers levels only, with "Turning it off needs a live connection" (protocol-correct).
  - RX volume reads "Current step unknown. Last sent: 6." with hatched steps.
  - This is the best per-control write-only treatment.
- **Meter labels follow channel mode in the spec:** "Left channel" in Stereo, "Mono mix", "Main track / Safety track −6 dB". It is the only direction that understood the meters measure USB channels, not mics.
- **The Audio page's profile matrix is excellent** ("1" and "2" toggles per profile that fill with the mic's colour). The profile descriptions are real copy from `presets.ts`.
- **The channel-mode tile glyphs** (diagonal purple/yellow split for Mono, separate L and R in Stereo, a short R in SafeTr) are clear.

### Slop tells and weaknesses

- **The colour-blocked hero with a product drawing and a giant numeral is the "Dribbble smart-home concept" trope.** The references are Polestar, Rivian, Tesla and Dyson, and it shows: this is a consumer-app pastiche, not a pro tool.
- **The stage takes half the desktop viewport (a) to show two numbers and two thin meters.** Everything the user came to change is pushed into a 200 px strip, where:
  - Text is 13–14 px.
  - Descriptions wrap awkwardly ("On-receiver voice / tone.", "The mics' status / lights.").
  - The RX volume steps are about 21 px wide, although the spec claims 44 px everywhere.
- **The device drawings are close to the real LARK A2 transmitter:** a rounded slab with a dot-grid grille, an LED pill and a side button. The brief says not to copy Hollyland's product, and this is trade-dress territory.
  - The sound rings duplicate the meter.
  - The receiver straddling the seam is a gimmick. It creates an awkward overlap, dead space on both sides, and a centred "Receiver / Every control here applies to both mics" heading floating under it.
- **Dark mode isn't dark.** About 700×450 px of #FFD21F at full saturation in a dark room on set is glare, and the spec deliberately keeps the fields identical in both themes.
- **One look means three things.** A 2 px ink outline means:
  - "parked" (the Bel canto tone while off, with a caption needed to explain it: "Outlined: the tone it uses when you switch it on."),
  - "sent, not confirmed" (write-only),
  - and it is also nearly the same as the keyboard focus ring (2 px ink outline at 3 px offset).
  - A control that needs a caption to explain its own styling is a design failure.
- **The segmented controls sit in a grey rounded "well" track.** That is the iOS-default segmented look, and the closest of the three to the current UI's component style.
- **The Connect page (c) is a split hero with a 60 %-width illustration.** That is what the brief bans, even if the "plug into this computer" art is charming.
  - There is no route to Audio from Connect, even though Audio works without the control link.
  - "LARK A2 or M2" drops M2S, which the app supports.
- **"Status hidden" is the wrong word.** Nothing is hidden; it can't be read.
- **Coverage gaps:** the tablet layout (720–1100 px) is specified but not drawn, and desktop frames were rendered at 1x, so fine detail wasn't reviewed at the density the others were.

### Hierarchy and usability

- **Changing NC level fast:** yes on both. It is the first column on desktop, though small, and on the first phone screen. One click when NC is on.
- **Write-only:** the most consistent and the most protocol-correct of the three. But the full-saturation stage still dominates, and the most important information (what you can still change) starts below it.
- **Identity:** maximal. If anything it overwhelms. Every other element competes with two giant colour fields.

### Responsive quality (phone)

**8/10.** The halves stay side by side at about 179 px each and still work. Controls get bigger on phone (52 px segments, 56 px steps, 88 px tiles), which is correct. The two drawings consume about 300 px of the first screen, but NC is still visible.

### Accessibility risks

- The purple LED on the dark device body is 2.70:1. The designer accepts this as decorative.
- Small 13 px text on the purple field is fine at 5.15:1, but tight on 1x desktop.
- Unlit meter segments on yellow at 18–26 % ink are low-salience.
- Desktop volume steps are about 21 px wide. That passes WCAG 2.5.8 only through the spacing exception, and fails the spec's own 44 px promise.
- The focus ring and the "parked/sent" outline are confusable.
- Large saturated fields cause glare in dark mode.

### Scores

| Distinctiveness | Clarity / usability | Craft / polish | Fit for audio hardware | Feasibility (Svelte, existing kit) |
|---|---|---|---|---|
| 9 | 7 | 7 | 6 | 5 |

**Why feasibility is 5:**
- Every child component needs on-purple and on-yellow variants.
- The SVG drawings need live and ghost states.
- The overlapping receiver layout is fragile across breakpoints.
- The tablet layout is undrawn.

---

## Problems none of the three solved

These must be designed before implementation, whichever direction wins.

1. **Live levels need permission first.**
   - Meters exist only after the user clicks "Enable audio" (microphone permission; see `AudioStartCard.svelte`).
   - All three mockups show meters already live.
   - Instrument's spec even lists the "Audio not enabled" state under things it "deliberately avoided".
   - With meters as the hero (A and C), the first-run Overview is a giant empty black or coloured box. The "Enable live levels" state has to live *inside* the meter area as a single obvious action.
2. **The bridge takes USB audio away on macOS.** While the local bridge runs, USB audio is paused (`audioHeldByBridge`). So on a Mac the user gets either send-only with meters, or full control without meters. Nobody drew the "full control, meters paused" Overview, and only A and B mention it on Connect.
3. **Meters measure USB channels, not mics.**
   - Stereo: L = Mic 1, R = Mic 2.
   - Mono: both channels carry the mix.
   - SafeTr: R is a −6 dB copy.
   - Painting a meter purple or yellow is only true in Stereo. In write-only the mode is unknown, so the mapping is unknown too, and all three still attribute meters to mics.
   - Only C's spec handles the labels, and even C keeps the colour fields.
4. **Precondition-blocked states.** Several controls refuse in certain conditions:
   - NC on/off needs a mic online and, on A2, not all mics muted.
   - Mic recognition needs the LED on and a mic online.
   - Custom buttons need both mics online.

   No mockup shows a control blocked with its reason, though the current code has `Blockable.svelte` for exactly this.
5. **Identity colours are state, not constants.** On M2S the TX identify colours can be swapped (`setButtonColors`, pairs (1,2) or (2,1)). The `--mic1`/`--mic2` tokens must be driven by the device state.
6. **Viewport.** Everything was judged at 1440×900. The common creator laptop is 1280×800 or 1280×720, where every desktop Overview here pushes receiver controls below the fold.

---

## Score summary

| Direction | Distinct. | Clarity | Craft | Fit | Feasible | Total /50 |
|---|---|---|---|---|---|---|
| A Instrument | 8 | 7 | 7 | 9 | 6 | **37** |
| B Editorial | 5 | 7 | 8 | 5 | 9 | 34 |
| C Device-first | 9 | 7 | 7 | 6 | 5 | 34 |

## Recommendation: a hybrid with Instrument as the base

I recommend **Instrument's chassis, Editorial's control grammar, and Device-first's write-only rules and colour courage.**

A is the only direction that looks like it belongs to audio hardware, its controls are the most obviously operable, and its identity rule (colour lives in windows and bezels) is the right answer to yellow-on-light. Its failures are proportion and noise, and both can be fixed. B's style is the wrong genre and C's stage is a concept-art move, but each has interaction ideas A lacks.

**Take from A (Instrument):**
- Aluminium (light, primary) and Graphite (dark) tokens.
- Dark display windows, used only for meters, the recorder timeline and code.
- The LED-in-bezel identity rule.
- Raised keys that press in when selected, and switches with ON/OFF printed in the track.
- Channel-mode keys with routing glyphs.
- Header and status line, trimmed.
- The phone layout order.
- Audio page structure: meter window, recorder with take timeline, takes table.
- The Connect "two USB links" schematic, fixed.
- The solid / hatched / dashed confidence vocabulary.

**Take from B (Editorial):**
- Off as a segment for NC and Bel canto.
- The value written as a word at each module head ("Noise cancellation · Medium"), in Archivo, not italic serif.
- Mute as a word ("Unmuted" / "Muted").
- The write-only band copy and the "Forget sent values" action.
- The per-mic voice-effect table logic tied to `fxLinked`.
- Its token and component mapping approach: restyle `SettingRow`, `SegmentedControl`, `StepBar`, `Switch`, `LevelMeter` and `Battery` rather than writing new ones.

**Take from C (Device-first):**
- The rising volume staircase as six direct-hit keys.
- Channel-mode-aware meter labels.
- The per-control write-only rules:
  - NC levels only.
  - "Off | On" send pairs with a last-sent dot.
  - "Current step unknown. Last sent: 6."
  - "--% Not readable" batteries and hollow lamps.
- The Audio profile matrix with 1/2 cells filled in the channel colour.
- The Connect step copy "Switch on both mics. Mic 1 lights purple, Mic 2 lights yellow."

**Drop:**
- From A: the 10 s history on Overview, the left rail captions, the specular LED dots, the fake Chrome chooser, and the detent fader.
- From B: the serif and cream genre, the 80 px headline, and lede and footnote filler.
- From C: the colour-field stage, the device drawings, the straddling receiver, and the illustrated-hero Connect page.

## The 10 most important changes while implementing

1. **Rebalance the Overview so controls lead.**
   - Each channel window becomes a compact horizontal segmented meter, readout, peak and CLIP, about 120–160 px tall on desktop. Move the 10 s history to Audio, or make it an optional 48 px strip.
   - Fill the meter window's empty right column or remove it, and never stack a time axis over a dB axis.
   - Acceptance test: at 1280×720 the full receiver strip (NC through Indicator light) is visible without scrolling.
2. **Design the real meter states inside the meter window:**
   - "Show live levels", one primary key that triggers the mic permission, as first run.
   - Permission denied, with how to fix it.
   - "USB audio paused while the local bridge runs" (macOS bridge).
   - No USB audio device.
   - Clipping.
   - A black window is never empty without a sentence saying why.
3. **Label meters by what they measure.**
   - Stereo: Mic 1 (L) purple, Mic 2 (R) yellow.
   - Mono: "Mix · L" / "Mix · R" in neutral ink.
   - SafeTr: "Main" / "Safety −6 dB".
   - Write-only: neutral "L" / "R" with "channel mode last sent: Stereo" until confirmed.
   - Purple or yellow only when the channel truly carries that mic.
   - Drive `--mic1`/`--mic2` from device state (M2S colour swap), not constants.
4. **One unambiguous confidence vocabulary, with no overloaded styles:**
   - Solid ink fill means read back from the receiver.
   - 2 px outline plus hatch, with "Last sent 14:02", means sent but not confirmed.
   - A dashed outline with "Not read" means unknown.
   - Disabled gets its own look: flat face, ink-3 label and an inline reason, never dashed.
   - Keyboard focus must be visibly different from all of these, for example a 3 px offset ring in a distinct shape (rounded rect around the whole key group member) plus a slight lift.
   - Put a one-line legend in the write-only band.
5. **Make write-only controls protocol-true.**
   - NC: Off is disabled with "Turning noise cancellation off needs a live connection". It is toggle-only, and `device.ts` refuses it blind. Never show a "tap to set" NC switch.
   - Bel canto, Indicator light and Mic recognition become "Off | On" send pairs with a last-sent dot. Mic recognition stays available rather than vanishing.
   - Volume shows "Unknown · last sent 6".
   - Battery shows "– – Not readable".
   - When the band offers "Connect through local bridge" on macOS, it must say that live levels pause while the bridge runs.
6. **Merge the on/off switch and level into one segmented key row** for NC (Off | Weak | Medium | Strong) and Bel canto (Off | Bright | Low | Balance).
   - Any NC change is then one click from any state.
   - This deletes the disabled-tones state and the "parked" caption.
   - It maps to `setNoiseCancellation` + `setNoiseLevel` and `setVoicePreset(enabled, preset)`.
   - Keys are at least 44 px tall and wide on all pointers, desktop included.
7. **Replace the detent fader with six direct-hit volume keys** in a rising staircase.
   - Each key is at least 44×44 px and numbered 1–6. "6/6" stays at the module head.
   - It is a `radiogroup` with arrow keys and Home/End.
   - No −/+ buttons are needed.
8. **Strip the pastiche tells:**
   - Mono only for measured values and hardware IDs (dBFS, timecode, firmware, TX1/TX2, serials). Rail captions, explanations, step numbers and the "01–08" preset numbering go to Archivo or are deleted.
   - Uppercase only for the CLIP and REC lamp legends.
   - No specular dots.
   - Remove the 168 px Overview rail; section names become inline headings.
   - Delete filler copy: "History 10 s", "Confirmed by the receiver within 1 s", the "Mute is set with the button…" footnote.
   - Fix the axis-label collisions in the meter window.
9. **Show precondition blocks and restarts in place.** Use the existing `Blockable` pattern with the reason on the control:
   - NC needs a mic online and, on A2, not all mics muted.
   - Mic recognition needs the light on and a mic online.
   - External speaker passthrough restarts the receiver: confirm first, then the header lamp and status line show "Restarting · reconnecting".
10. **Fix the Connect page and ship both themes with an accessibility pass.**
    - **Connect page:**
      - Keep the two-links schematic, but make it state-true: no "USB audio available now" before plug-in.
      - Describe Chrome's chooser in words instead of faking it.
      - Say "macOS: send only; Windows: unverified".
      - List A2, M2 and M2S.
      - Keep Audio reachable from Connect.
    - **Both themes and accessibility:**
      - Re-run contrast for every state, including text over hatching (at least 4.5:1) and dashed and outlined boundaries (at least 3:1).
      - Raise legends to at least 12 px.
      - Give meters `role="meter"` with `aria-valuetext` ("Mic 1, −18 dBFS, peak −12"), and a polite live region for clipping only.
      - Respect reduced motion: no decay animation, no blinking lamps.
      - Check 320 px width with no horizontal scroll.
