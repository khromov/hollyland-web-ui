# HollyAudio voice DSP (cmsis_api) — reconstructed algorithms

Source: `cmsis_api_ios.framework/cmsis_api_ios` from larkSound.app (arm64,
iOS 14+, project `cmsis_dsp_lib_test_FX6303-1`). It is built with LLVM coverage
instrumentation at roughly -O0 with FP contraction on, so most `a*b + c`
expressions are fused `fmadd`/`fmsub`. Addresses below are file offsets in that
dylib. The Android `libmeisheng.so` (armeabi-v7a) has the same structure and
was used as a cross-check; differences are noted.

The TypeScript port is in `src/lib/dsp/`. Every formula below is implemented
there in the same operation order, with exact float32 FMA (`fma32`) and exact
float64 FMA (`fma64`) where the native code fuses.

## Pipeline: `cmsis_process_frame` (0xf204)

Fixed frame of 240 mono float32 samples at 48 kHz; outputs two identical
channels.

1. If `pipe.channelEnable == 0`, both outputs are zeroed.
2. EQ, if `numStages > 0`: `arm_biquad_cascade_df2T_f32` **in place on the
   caller's input buffer**.
3. Compressor, if enabled → its own output buffer.
4. De-esser, if enabled → its own output buffer.
5. Distortion/exciter, if enabled → written into the second output buffer.
6. `vec_gain` by the pipe gain (in place), then copied to both outputs.

LUFS is **not** part of the real-time path (see below).

Global state is a struct at `g_rCoeffs+0x30` (bss 0x24030): 0x200 pipe,
0x208 EQ band table, 0x210 `arm_biquad_casd_df2T_inst_f32`, 0x218/0x220 EQ
coefficient callback + context, 0x228/0x230 compressor params/state,
0x238/0x240 de-esser params/state, 0x248/0x250 distortion params/state,
0x258/0x25c LUFS enable/target, 0x260/0x268 LUFS params/state.

## Pipe params: `cmsis_set_pipe_params` (0xd3e0)

`gain = dB2line(vocalLevelDb) = powf(10, vocalLevelDb * 0.05f)` (0x9044),
`channelEnable = (arg != 0)`. Both apps always pass `(0, true)`.

## EQ

### Coefficient design: `IIR_coef_compute` (0x7a4c)

Band struct (20 bytes): `int16 enable, int16 type, float gain, float f0,
float fs, float Q`. `cmsis_set_eq_band` (0xd4a4) always stores fs = 48000.
All maths is float32:

```
w0 = ((f0 * 2) * PI_f) / fs          PI_f = 0x40490fdb
A  = powf(10, gain / 40)
sn = sinf(w0); cs = cosf(w0)
alpha = sn / (2 * Q)                 Q form for every type, shelves included
```

RBJ cookbook formulas (with fusions as built):

| type | b0 | b1 | b2 | a0 | a1 | a2 |
|---|---|---|---|---|---|---|
| 1 low shelf | A((A+1)−(A−1)cs+2√Aα) | 2A((A−1)−(A+1)cs) | A((A+1)−(A−1)cs−2√Aα) | (A+1)+(A−1)cs+2√Aα | −2((A−1)+(A+1)cs) | (A+1)+(A−1)cs−2√Aα |
| 2 high shelf | A((A+1)+(A−1)cs+2√Aα) | −2A((A−1)+(A+1)cs) | A((A+1)+(A−1)cs−2√Aα) | (A+1)−(A−1)cs+2√Aα | 2((A−1)−(A+1)cs) | (A+1)−(A−1)cs−2√Aα |
| 3 peaking | 1+αA | −2cs | 1−αA | 1+α/A | −2cs | 1−α/A |
| 4 notch | 1 | −2cs | 1 | 1+α | −2cs | 1−α |
| 5 low pass | (1−cs)/2 | 1−cs | (1−cs)/2 | 1+α | −2cs | 1−α |
| 6 high pass | (1+cs)/2 | −1−cs | (1+cs)/2 | 1+α | −2cs | 1−α |
| 7 band pass (0 dB peak) | α | 0 | −α | 1+α | −2cs | 1−α |
| other | 1 | 0 | 0 | 1 | 0 | 0 |

Gain is ignored for types 4–7. Output, when a0 ≠ 0:
`[b0/a0, b1/a0, b2/a0, (−a1)/a0, (−a2)/a0]` (CMSIS sign convention).

### Cascade setup: `IIR_coef_init` (0x75bc), `IIR_coef_update` (0x81e4)

Max 24 stages. Each enabled band (in index order) becomes the next stage.
`update` recomputes all coefficients and `numStages` but **never clears the
filter state**; `init` (called from `cmsis_init`/`cmsis_default_configs`) zeroes
state and coefficients. A parallel `rCoeffs` array holds `[b0 b1 b2 a1 a2]`
with standard signs; `cmsis_get_eq_coefficients` (0xf928) returns those, and the
optional callback (`cmsis_set_eq_coef_callback`, 0xf6d4) receives them per
enabled band, for programming the LARK M3.

### `arm_biquad_cascade_df2T_f32` (0x8924)

Generic CMSIS C version (no unrolling), per stage, per sample:

```
y  = fma(b0, x, d1)
d1 = fma(a1n, y, fma(b1, x, d2))     a1n, a2n = stored (negated) feedback
d2 = fma(a2n, y, b2 * x)
```

State is 2 floats per stage. It is a do/while loop, so `numStages == 0` would
run ~2^32 times; `cmsis_process_frame` guards against it.

## Compressor (`Compress_HL.c`)

Params (0x24 bytes): enable, threshold dB, ratio, attack ms (int), release ms
(int), makeup dB, knee, hold ms, range dB.

`CompressInit` (0x6510): thr 0.8, 1/ratio 1, attack/release 48 samples with
coefficient `expf(-logf(9)/48)` (10–90 % rise time definition), knee 0.1,
hold 48, prev gain 1, makeup 1, range 0.

`CompressUpdate` (0x66c0) applies each parameter **only if it moved by more
than a step** compared with the stored state: |Δ| > 0.001 in the linear domain
for threshold (`dB2line`), range (`dB2line`), 1/ratio, knee and makeup
(`dB2line`); |Δ| > 1 sample for hold, attack and release, where
`samples = (int)((float)(ms * 48000) * 0.001f)` and
`coef = expf(-logf(9) / samples)`.

`CompressProcess` (0x6a78), once per frame:

1. `level = mean(|x|)` (`magCompute` 0x9304 mode 1; float running sum / 240).
   Detector is per frame: no RMS, no look-ahead.
2. `gainCompute` (0x6b8c), linear domain, R = min(1/ratio, 0.999), T = linear
   threshold, K = knee (a fraction of T, not dB):
   - `x > (1+K)T`: `g = R + (1−R)·T/x` (fused)
   - `x < (1−K)T`: `g = 1`
   - otherwise: `g = 1 + (R−1)·powf(x − T(1−K), 2) / (4·K·T·x)`
   - `g = max(g, rangeLinear)`.
3. `gainSmooth` (0x6d80): the direction is chosen once per frame against the
   previous gain p:
   - `p > g` (attack): hold counter = hold; per sample `p = (1−a)g + a·p`.
   - `g > p` (release): if hold counter ≠ 0, the gain is frozen for the whole
     frame and the counter is decremented per sample (it can go negative and
     then stays non-zero until the next attack: a native quirk); else per sample
     `p = (1−r)g + r·p`.
   - equal: hold counter = hold, gain constant.
4. `y = (x · g[i]) · makeup` (two separate multiplies).

`sideCompressProcess` (0x7038) is never called.

## De-esser (`De_esser_HL.c`)

`EsserInit` (0x42f4): LP and HP 2nd order, Q 0.707f; peak filter at 5 kHz;
freqL 8000, freqH 5000, range −14, smoothed level 0.

`EsserUpdate` (0x43dc): copies freqL, freqH, threshold and the params block
range (offset 0x10) into the state, `LpUpdate(freqL)`, `HpUpdate(freqH)`.
`HpUpdate` returns early when `|(int)(old − new)| ≤ 1`; `LpUpdate` has no guard.

Lp/Hp/Peak filters are direct form I biquads (`y = fma(b0,x,b1·x1)`,
`+b2·x2` fused, `−a1·y1` fused, `−a2·y2` fused). Their design uses
`w0 = (float)((double)(f·2) · M_PI / 48000)` with `sinf`/`cosf`; order-1
variants use `tan` in double (unused: order is always 2).

`easyDeesserProcess` (0x4474), per frame:

```
s = HP(LP(x))                        band between freqH and freqL
ratio = sqrt(Σs² / Σx²)              (0 if Σx² = 0; sums are fused)
level = (float)(0.7·level + 0.3·ratio)        in double, fused
lvl   = 20·log10f(level)
gain  = lvl > thr ? range·(1 − lvl/thr) : 0   DeessergainCal 0x46c4 (dB)
f0 = sqrtf(freqL·freqH);  Q = f0 / (freqL − freqH)
PeakUpdate(f0, gain, Q); peak-filter the frame
```

So it is a dynamic peaking EQ whose cut depends on the band-to-total energy
ratio. The presets send freqL = 6500, freqH = 4500 (f0 ≈ 5408 Hz, Q ≈ 2.7).

**iOS quirk:** `cmsis_set_esser` (0xd9d4) stores enable, freqL, freqH and
threshold but drops the 5th argument. The range field is written only by
`read_user_params_esser` (config `.ini` files, which the apps do not ship), so
on iOS it stays as malloc left it: 0 in practice (verified). With range 0 the
peaking gain is 0 dB and the stage is a near-identity filter. The Android
library's `cmsis_set_esser` stores the range, so on Android the presets cut by
up to −15 dB. The port defaults to iOS behaviour (`esserRange: 'ios'`); pass
`'preset'` for Android behaviour.

## Distortion / exciter (`Distortion_HL.c`, `airfresh.c`, `gru.c`)

`cmsis_set_distortion` (0xdbb0) ignores input/output gain; `distInit` runs only
on its first call (static flag) and on every `cmsis_default_configs`.
Native type numbers (the Java constant names are swapped):

- **0, GRU**: one GRU-like cell with fixed weights (0.5, 1, 0.5, 0.5, bias 0):
  `z = 1/(1+exp(0.5x + 0.5h))` (double), `c = x + 0.5·z·h`,
  `h = (1−z)·tanh(c) + z·h` (double fused). Mixed with gruWet.
- **1, airfresh**: fixed RBJ high shelf, +16 dB at 7 kHz, Q 1.7 (`airInit`,
  sin/cos in double), run as transposed DF2 where the feedback uses
  `clip(y − y³/4, ±0.7)` (`dist` 0x59c0, `powf(y,3)`) instead of y. Mixed with
  airfreshWet. `airUpdate`/`updata_gru` are never called, so the parameters
  are fixed.
- **2**: copy. Other values leave the output buffer untouched.

`out = fx(x)·wet + x·(1−wet)` (fused). All eight presets use type 1 with
wet 0, so the exciter state runs but the output equals the input.
The iOS app also forces enable = false for type 2 (and maps types > 2 to 2).

## Loudness ("LUFS", `dsp_lufs.c`)

Not BS.1770: no K-weighting and no gating. `lufs_init` (0x4ca8): window =
time s (×0.1 if ≥ 1; 0.4 if ≤ 0 or > 2) × 48000, clamped to [240, 96000];
alpha in (0,1) else 0.7. `dsp_integrated_loudness` (0x4f84), per sample:
running sum of squares over a circular buffer, `rms = sqrt(sum/N + 1e-10)`
(floor 1e-8), `level = 20·log10(rms) − 0.691`,
`g = 10^((target − level)/20)` clamped [0.1, 10],
`smooth = alpha·smooth + (1−alpha)·g`, returns `x·smooth`.

It is used only by `cmsis_process_wav` (0xe4d8): each 240-sample frame is
pre-scaled by the AGC, run through the same chain, then divided by the gain
after the frame's last sample. The tail shorter than one frame is dropped
(left as zeros). `cmsis_set_lufs` stores enable and target, but **nothing reads
them**: the AGC always uses the target from `cmsis_default_configs` (−6 dB,
time 3 → 0.3 s, alpha 0.7). `easy_integrated_loudness` and `easy_iir_*` /
`easy_create_*_filter` are unused.

## Setters, defaults and the apps' call order

`cmsis_init` (0xca20): mallocs the blocks, `params_init` (all bands disabled),
`IIR_coef_init`. `cmsis_default_configs` (0xdd28) resets every stage:
EQ band 0 high shelf +2 dB 300 Hz Q1, band 3 low pass 1200 Hz Q1 (others off);
compressor on, −30 dB, 4:1, 1/1 ms, knee 0, range −60; de-esser on, 8128.5 /
5500 Hz, −40 dB; distortion on, type 1, wets 0.5; LUFS state as above.

The iOS app (`HL6303SmileSoundTemplateViewModel.refreshRealtimeDSP`) calls,
for every preset change: `cmsis_default_configs`, `set_compressor`,
`set_distortion`, `set_eq_band` ×10, `set_esser`, `set_pipe_params(0, 1)`,
`set_lufs(0, target)`, with clamps (threshold [−120, 0], ratio [1, 30],
attack/release `lroundf`, gain [−24, 24], knee [0, 24], f0 [20, fs/2 − 1],
Q [0.1, 20], esser freqs [20, 24000]). Android (`CantoUtil.canto`) calls
`setEqBands`, `setEsser` (with range), `setCompressor` (attack/release
truncated), `setDistortion`, `setPipeParams(0, true)`, `setLufs(false, …)`.
`presets.ts` reproduces the iOS mapping.

## Fixed-point paths

`S_fixed32_init`, `compute_S_fixed32`, `compute_gain_scale_df2`, `fixed_SOS`,
`fixed_G`, `fixed_Scale`, `sos2freqz`/`freqz`, `max_abs`, `prod_m` and the
`cplx_*` helpers have **no callers** inside the library, are not imported by
the iOS app and are not exported over JNI on Android. They are leftovers for
deriving scaled fixed-point SOS coefficients for the device; nothing at
runtime uses them. The coefficients the app sends to the M3 come from
`cmsis_get_eq_coefficients` (float).

## Numerics and parity

- The native library calls the platform libm for `powf`, `sinf`, `cosf`,
  `expf`, `logf`, `log10f` (float) and `sin`, `cos`, `tan`, `exp`, `tanh`
  (double). Apple's float functions are not correctly rounded: about
  0.6–1.3 % of their results are one ulp away from `fround(Math.fn(x))`.
  Where the DSP calls one per sample (airfresh `powf(y, 3)`, the LUFS gain
  `powf(10, x)`), that one-ulp step decorrelates the float32 rounding noise
  of the high-Q low-frequency EQ sections and grows to the EQ's noise floor
  (74 dB SNR offline, 1.7e-5 on the exciter with correctly rounded libm).
- The port therefore emulates Apple's arm64 float libm bit for bit
  (`src/lib/dsp/applelibm.ts`, see below). `setLibm('cr')` in `f32.ts`
  switches the whole port to correctly rounded `fround(Math.fn(x))`; the
  parity harness uses it, against the library with its libm imports rebound
  to correctly rounded wrappers, to check the DSP arithmetic on its own.
- The GRU feeds the double `tanh` straight into a double FMA, so there the
  double result itself must match. V8's `Math.tanh` is one double ulp off on
  about 30 % of inputs; `tanh64` in `f32.ts` uses the odd Taylor series below
  2^-11 (correctly rounded there, identical to Apple's `tanh` on every tested
  input), which is where decaying GRU tails land on float midpoints. The
  other double functions are V8's.
- `cmsis_set_distortion` runs `distInit` only on its first call per library
  load (`static int` at bss 0x242a0, just past the context that `cmsis_init`
  and `cmsis_deinit` zero). The emulator keeps that flag per instance and
  `init()` leaves it alone.
- Measured parity, per stage, preset and signal, is in
  [parity-report.md](parity-report.md), produced by `npm run dsp:compare`
  (`tools/dsp-harness/`): every row is bit-identical to the shipping library.
- In the browser the port runs in an AudioWorklet. It regroups 128-sample
  render quanta into 240-sample frames at a fixed latency of 224 samples
  (4.67 ms). `npm run dsp:browser` checks it in headless Chrome against Node and
  against the native library. See
  [native-api.md](native-api.md#in-the-browser-the-voice-fx-audioworklet) and the
  Browser section of the parity report.

## Apple arm64 float libm (`libsystem_m`)

Disassembled from the running macOS 27 libsystem_m (the dyld shared cache
copy; offsets below are from each function's entry). All six are short
leaf routines that convert to double, evaluate with `fmadd`/`fnmsub`, and
round to float once with `fcvt s, d`. The tables they load are read out of
the live library by `tools/dsp-harness/native/libm_tables.c` into
`src/lib/dsp/applelibm-data.ts`; `npm run dsp:compare` re-reads them and
evaluates every function on about 14 million inputs against the emulation.

- **exp2 core** (shared by `powf` and `expf`): `k` integer (in units of
  1/128), `r` the remainder; `s = asdouble(T[k & 127] + (k << 45))` with
  `T[i] = asuint64(2^(i/128)) − (i << 45)`;
  result `fma(r·fma(C0, r, C1), s, s)`.
- **`powf(x, y)`** (640 bytes): `x == 1` → 1, `y == 1` → x; special `y`
  (±0, ±inf, NaN) and special `x` (≤ 0, subnormal, inf, NaN) branches follow
  C99 (negative `x` needs an integer `y`, tested on `|y|` clamped to 2^24;
  odd `y` restores the sign; subnormals are normalised as
  `(x | 1.0f) − 1.0f` with the exponent re-biased by −126). Main path:
  `tmp = ix − 0x3f338000`, `i = (tmp >> 16) & 127`,
  `top = tmp & 0xff800000`, `z = asfloat(ix − top)`, `k = top >> 16`;
  `r = fma(z, invc[i], −1)`;
  `l = fma(fma(fma(r, P0, P1), r², fma(r, P2, P3)), r, logc[i] + k)`
  (128·log2 x); `t = clamp(y·l, ±32768)`; `k = round-half-away(t)`,
  exp2 core on `t − k`.
- **`expf(x)`** (180 bytes): `|x| ≥ 128`, inf, NaN: `x·FLT_MAX` for
  `x ≥ 0`/NaN, else +0. Else `kd = fma(128/ln2, x, 0x1.8p52)`, `k` = low
  word of `kd`, `r = fma(128/ln2, x, −(kd − 0x1.8p52))`, exp2 core.
- **`logf(x)`** (232 bytes): specials and subnormals as `powf`.
  `i = ((ix & 0x7fffff) + 0x8000) >> 16` (0..128),
  `z = 1 + m·2^−23`, `r = fma(z, invc[i], −1)`,
  `k = (ix − 0x3f3f8000) >> 23`;
  `fma(r², fma(r, L0, L1), fma(r, L2, fma(k, ln2, logc[i])))`.
  Table centres are `1 + i/128`; from `i = 64` `logc` includes −ln 2
  because `k` already counts the next power of two.
- **`log10f(x)`** (1312 bytes incl. its table): as `logf` with a 65-entry
  table, `i = (m + 0x10000) >> 17`, `k = (ix − 0x3f3f0000) >> 23` and a
  degree-4 Horner polynomial: `fma(r, fma(r, fma(r, fma(r, G0, G1), G2), G3),
  fma(k, log10 2, logc[i]))`.
- **`sinf(x)` / `cosf(x)`**: `|x| < 2^−12`: `sinf = fma(x, 2^26, x)·2^−26`,
  `cosf = (2^26 − x)·2^−26` (both exact results with the inexact flag);
  `|x| < π/4`: odd degree-7 / even degree-8 polynomial directly; `|x| < 120`:
  `n = rint(x·2/π)`, `r = fma(−n, π/2, x)`, then the polynomial chosen by
  `n & 1` (cos for odd) with the sign from bit 1 of `n` (`cosf` uses `n + 1`,
  and below 2^26 also subtracts `n·(π/2)lo`); larger `|x|`: `x/π` reduction
  through a 64-entry table of `2^k/π` (hi, lo) and a factored polynomial for
  `sin(πt)` (`cosf` adds 0.5 to `x/π`).
