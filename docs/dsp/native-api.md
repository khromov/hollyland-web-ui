# HollyAudio DSP library: native API and parity harness

The official app's voice effects run in a small C library: `cmsis_api_ios.framework`
on iOS and `libmeisheng.so` on Android (same sources, `api/cmsis_api.c`,
`src/compress/Compress_HL.c`, `src/de_esser/De_esser_HL.c`, ...). This page covers
how to call it and the harness in `tools/dsp-harness/`, which runs it next to the
TypeScript port in `src/lib/dsp/` and diffs them. The algorithms are in
[algorithms.md](algorithms.md) and the measured results in
[parity-report.md](parity-report.md).

The prototypes and memory layouts are reconstructed in
`tools/dsp-harness/native/cmsis_api.h`. They are only valid for the build with the
sha256 given there (larkSound 3.1.0).

## Running it

```sh
npm run dsp:prepare        # once, or after an app update
npm run dsp:compare        # all stages, presets and signals; rewrites docs/dsp/parity-report.md
npm run dsp:compare -- --only full:,eq:clean --signals speech_default,sweep
npm run dsp:compare -- --input ~/my-take.wav --wav all
npm run dsp:native -- render --preset /Applications/larkSound.app/Wrapper/larkSound.app/rich_texture_9.json in.wav out.wav
npm run dsp:browser        # the AudioWorklet in headless Chrome vs Node and the native library
```

`dsp:prepare` needs an Apple Silicon Mac with larkSound/HollyAudio installed from the
App Store and the Xcode command line tools. It copies the iOS library, retags its
`LC_BUILD_VERSION` as macOS (`vtool`), ad-hoc signs it (`codesign -s -`) and builds
`cmsis-runner` and `libm-tables`, all into `.dsp-native/` (gitignored). The library only imports
`libSystem`, so on arm64 macOS it loads with `dlopen()` unchanged. Nothing proprietary
is ever committed: the library, the app's speech samples and every rendered WAV stay
in `.dsp-native/`. Set `LARKSOUND_APP` if the app lives elsewhere.

`dsp:compare` options: `--only <id prefixes>`, `--signals <names>`,
`--input <file.wav>` (repeatable, local only; any rate, channel 0 is used),
`--speech-seconds <s>` (default 10), `--wav listen|all|none`, `--random-bands <n>`,
`--jobs <n>`, `--note "<text>"` (adds a changelog entry to the report) and
`--no-report`. Partial runs (`--only` / `--signals`) write
`.dsp-native/out/parity-report.partial.md` instead of the committed report.
Listening files go to `.dsp-native/out/<scenario>/<signal>.{native,ts,diff}.wav`
(the diff only when it is not all zeros), and inputs to `.dsp-native/out/input/`.

### cmsis-runner

`cmsis-runner [--lib <dylib>] [--libm apple|cr] info | script | render ...`

- `script` reads one command per line on stdin and answers `ok <cmd> <ret> [...]` or
  `err <cmd> <message>`: `init <root>`, `deinit`, `default`, `reload`, `pipe`, `eq`,
  `comp`, `esser`, `dist`, `lufs` (the setters, same argument order as the C API),
  `preset <json> [ios|preset|<dB>]`, `esser_range peek|<dB>`, `coeffs`,
  `process <in.f32> <outA.f32> [outB.f32|-] [startFrame frames]`, `wav <in> <out>`,
  `lufs_stage <in.f32> <out.f32> <time> <scale> <alpha> <target>` and
  `libm <fn> <in.f32> <out.f32>` (this Mac's own libm: `sinf cosf expf logf log10f`,
  `pow10f`, `sqf`, `cubef`, or `powf` on interleaved (x, y) pairs). Raw `.f32` files are
  little-endian float32 mono.
- `render` applies an app template JSON the way the iOS app does and renders a 48 kHz
  WAV through `cmsis_process_frame` (channel 0, tail padded to a whole frame, float32
  mono out).
- `--libm cr` is a diagnostic: after `dlopen` it rewrites the library's `__got` slots
  for `powf sinf cosf tanf expf logf log10f` to wrappers that evaluate the double
  function and round once. The DSP code is untouched; only the float libm rounding
  changes, to what the TS port computes after `setLibm('cr')`. By default the port
  emulates Apple's float libm instead (`src/lib/dsp/applelibm.ts`).
- The internals (`esser_range`, `lufs_stage`, the iOS range pin in `preset`/`render`)
  are refused when the exported symbol offsets do not match the expected build.
- The vendor build has LLVM coverage instrumentation; the runner sets
  `LLVM_PROFILE_FILE=/dev/null` so it does not drop `default.profraw` files.

### libm-tables

`.dsp-native/bin/libm-tables` (`tools/dsp-harness/native/libm_tables.c`) decodes the
ADRP/ADD, ADR and LDR-literal instructions through which Apple's `powf`, `expf`,
`logf`, `log10f`, `sinf` and `cosf` load their tables, checks a few of the FMA
instructions the port mirrors, and prints `src/lib/dsp/applelibm-data.ts` from the
running libsystem_m. `dsp:compare` runs it and reports whether the committed file still
matches; if Apple changes a routine it refuses to print and the emulation in
`applelibm.ts` has to be re-derived from the new disassembly.

## In the browser: the voice-FX AudioWorklet

The web app runs the port in an AudioWorklet:

- `src/lib/dsp/stream.ts`: `VoiceStream` regroups blocks of any size into the
  library's 240-sample frames. The frames start at the first sample the stream
  sees, so the processor gets exactly the frames `cmsis_process_frame` would get
  from the same stream. Each frame is processed when its last sample arrives.
  The output is the processed stream delayed by `240 − gcd(block, 240)` samples,
  the smallest delay at which the output never runs dry. For Web Audio's
  128-sample render quantum that is **224 samples, 4.67 ms at 48 kHz**
  (`VOICE_STREAM_LATENCY`).
  - A preset change applies from the next frame boundary, like a setter called
    between two `cmsis_process_frame` calls. It reconfigures the same
    `VoiceProcessor` (`cmsis_default_configs` and then the setters), as the app
    does with its single library instance.
  - A channel without a preset is copied through with the same delay.
- `src/lib/audio/voice-fx.worklet.ts`: the processor (`hollyland-voice-fx`), with
  one `VoiceStream` per channel. Presets arrive as template objects in
  `processorOptions` or as `set` messages on its port, and it acknowledges each
  `set` with the number of input samples consumed so far. It reads the render
  quantum from the `renderQuantumSize` global where that exists, and assumes 128
  otherwise.
- `src/lib/audio/voicefx.ts`: `loadVoiceFx(ctx)` adds the module, which Vite
  bundles from `voice-fx.worklet.ts?worker&url`. `vite build` emits it as a
  self-contained IIFE, `assets/voice-fx.worklet-<hash>.js`; the dev server serves
  it as ES modules. `new VoiceFx(ctx, presets)` wraps the node, and
  `VOICE_PRESETS` (id, name, nameZh, description) comes from
  `src/lib/dsp/presets.ts`.
- `src/lib/audio/engine.ts`: one 2-channel `VoiceFx` sits between the input bus
  and the processed bus while at least one channel has a preset. Both channels
  are then delayed by 224 samples, so they stay aligned. With no preset on
  either channel the node is removed, and the processed bus is the input with
  no delay.

### browser-check

`npm run dsp:browser` (`tools/dsp-harness/browser-check.ts`) starts a temporary
Vite server for `tools/dsp-harness/browser/`. It launches the installed Google
Chrome headless through `puppeteer-core` (set `CHROME_PATH` or `--chrome` to use
another) and renders every harness signal through the worklet in an
`OfflineAudioContext`. Each signal goes through these renders:

- The 8 presets, two per 2-channel render.
- A bypass channel next to Clean Voice.
- Live preset switches, posted while the context is suspended at render-quantum
  boundaries.

Each channel output must start with exactly 224 zero samples. After that it
must match two references bit for bit:

- The same TS code run in Node on 240-sample frames.
- The native library on the same timeline, when `.dsp-native/` exists: one
  runner process per channel, with `process <in> <out> - <start> <frames>` for
  each preset segment.

`--mode dev|build|both` (default both) chooses whether the worklet is served by
the dev server or built by `vite build` and served by `vite preview`. Afterwards
the app's `AudioEngine` runs in a real-time `AudioContext` on Chrome's fake
microphone, as a smoke test of the graph. A full run rewrites the Browser
section of [parity-report.md](parity-report.md), which `dsp:compare` keeps.
Partial runs (`--signals`, `--input`, a single `--mode`) write
`.dsp-native/out/browser-report.partial.md` instead. Other options:

- `--speech-seconds <s>`
- `--concurrency <n>`
- `--no-native`
- `--no-engine`
- `--no-report`
- `--headful`

The signals are the harness set plus `subnormal`, which checks that Chrome's
audio thread does not flush float32 subnormals to zero (it does not, on Chrome 156
for arm64 macOS).

## C API

All functions return 0 on success, −1 for a bad argument, −2 for file I/O and −3 when
the library is not initialised. Frames are 240 mono float32 samples at 48 kHz; the
sample rate is hard-coded.

| function | notes |
|---|---|
| `cmsis_init(root)` | Zeroes the context, copies `root`, mallocs every state block **without initialising it**, then `params_init` + `IIR_coef_init`. Reads no files. Calling it again leaks the previous blocks. |
| `cmsis_default_configs()` | Must follow `cmsis_init`: sets every stage to its defaults and initialises its state (see algorithms.md). Allocates the LUFS state. |
| `cmsis_reload_configs()` | Reads `<root>/src/config/*.ini`; the apps never call it. |
| `cmsis_set_pipe_params(levelDb, enable)` | Output gain `10^(levelDb/20)`; `enable = 0` makes `process_frame` output zeros. |
| `cmsis_set_eq_band(i, en, type, gain, f0, q)` | Band `i` of 10; fs is forced to 48000; re-designs all bands but keeps the filter state. |
| `cmsis_set_compressor(...)` | Each field only changes when it moves by more than a fixed step (0.001 linear, 1 sample). |
| `cmsis_set_esser(en, fL, fH, thr, range)` | **iOS build: `range` is not stored**, so the de-esser uses whatever the uninitialised field holds (0 in practice). Android stores it. |
| `cmsis_set_distortion(en, inG, outG, type, airWet, gruWet)` | `inG`/`outG` ignored. Type 0 = GRU, 1 = airfresh, 2 = copy (the Java constant names are swapped). `distInit` runs only on the first call per library load. |
| `cmsis_set_lufs(en, target)` | Stores two fields nothing reads. |
| `cmsis_process_frame(in, outA, outB)` | EQ (in place on `in`), compressor, de-esser, exciter, output gain; writes the same samples to both outputs. Returns −3 before `cmsis_init`. |
| `cmsis_process_wav(in, out)` | Offline render: LUFS/AGC pre-gain, the chain, divide by the frame's last gain; drops the last frame; writes stereo float32. Its WAV writer reuses the first call's length for later calls in the same process. Relative paths resolve against `root`. |
| `cmsis_get_eq_coefficients(c, &n)` | `[b0 b1 b2 a1 a2]` per enabled band (textbook signs), the values the app sends to the M3. |
| `cmsis_set_eq_coef_callback(cb, user)` | Fires now and after every `set_eq_band`. |

How each app maps a template JSON onto these calls is in algorithms.md
("Setters, defaults and the apps' call order"); the runner's `preset` command and
`src/lib/dsp/presets.ts` both implement the iOS mapping.
