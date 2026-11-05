/*
 * Reconstructed C API of HollyAudio's voice-effect DSP library
 * (iOS: cmsis_api_ios.framework, Android: libmeisheng.so).
 *
 * Source of truth: arm64 disassembly of cmsis_api_ios 1.0 (larkSound 3.1.0,
 * SHA-256 below), the iOS Objective-C wrapper FX6303DSPWrapper and its Swift
 * caller, and the Android JNI declarations in com.example.meisheng.CMSISManager.
 * The library is an -O0 build with LLVM coverage instrumentation, and its
 * coverage map names the original sources (api/cmsis_api.c,
 * src/compress/Compress_HL.c, src/de_esser/De_esser_HL.c, ...).
 *
 * Nothing here is copied from the vendor; these are prototypes and memory
 * layouts recovered from the binary so the harness can call it. The struct
 * layouts and the private symbol offsets are only valid for the build whose
 * hash is CMSIS_EXPECTED_SHA256. The runner checks the hash and refuses to
 * poke internals on any other build.
 *
 * See docs/dsp/native-api.md for semantics, quirks and the pipeline.
 */
#ifndef CMSIS_API_H
#define CMSIS_API_H

#include <stdint.h>

#define CMSIS_EXPECTED_SHA256 "5cc3283858bee6e35e8eaed9b526a7b1543c00d77c283ae338e7d877e1398389"
#define CMSIS_FRAME_LEN   240     /* hard-coded in every *Process / process_frame */
#define CMSIS_SAMPLE_RATE 48000   /* hard-coded (48000.0 literals), fs fields are ignored */
#define CMSIS_EQ_BANDS    10
#define CMSIS_EQ_MAX_STAGES 24    /* IIR_coef_init allocates 24 stages */

/* EQ filter types (int16 in the band struct). Anything else = identity. */
enum { CMSIS_LOWSHELF = 1, CMSIS_HIGHSHELF = 2, CMSIS_PEAKING = 3, CMSIS_NOTCH = 4,
       CMSIS_LOWPASS = 5, CMSIS_HIGHPASS = 6, CMSIS_BANDPASS = 7 };

/* Distortion type as the C code switches on it (NOT what CMSISConstants.java says):
 * 0 = gru (uses gruWet), 1 = airfresh (uses airfreshWet), 2 = plain copy, other = untouched output. */
enum { CMSIS_DIST_GRU = 0, CMSIS_DIST_AIRFRESH = 1, CMSIS_DIST_COPY = 2 };

/* ---------------- public API (all return 0 on success) ------------------- */
/* -1 = bad argument, -2 = file I/O (process_wav), -3 = not initialised / alloc failure */

typedef void (*cmsis_eq_coef_cb)(int band_index, const float coeffs5[5], void *user);

typedef struct {
    int  (*init)(const char *project_root);           /* stores root (<=511 chars), mallocs state; reads no files */
    void (*deinit)(void);                              /* frees everything, zeroes g_ctx */
    int  (*reload_configs)(void);                      /* reads <root>/src/config/ .ini files (crashes if one is missing) */
    int  (*default_configs)(void);                     /* hard-coded defaults + re-init of every stage */
    int  (*set_pipe_params)(float vocal_level_db, int channel_enable);
    int  (*set_eq_band)(int index, int enable, int filter_type, float gain_db, float f0_hz, float q);
    int  (*set_compressor)(int enable, float threshold_db, float ratio, int attack_ms, int release_ms,
                           float gain_db, float knee, float hold_ms, float range_db);
    int  (*set_esser)(int enable, float freq_l, float freq_h, float threshold_db, float range_db_ignored);
    int  (*set_distortion)(int enable, float input_gain_db_ignored, float output_gain_db_ignored,
                           int type, float airfresh_wet, float gru_wet);
    int  (*set_lufs)(int enable, float target_db);    /* writes two fields nothing reads: a no-op */
    int  (*process_frame)(float *in240, float *out_a240, float *out_b240); /* in240 is modified (EQ runs in place) */
    int  (*process_wav)(const char *in_path, const char *out_path);         /* relative paths resolve against root */
    int  (*get_eq_coefficients)(float *coeffs, uint8_t *num_stages);       /* coeffs: 5*num_stages floats */
    int  (*set_eq_coef_callback)(cmsis_eq_coef_cb cb, void *user);         /* fires now and after every set_eq_band */
} cmsis_api_t;

/* ---------------- recovered memory layouts (this build only) ------------- */

typedef struct { float level_lin; int32_t channel_enable; } cmsis_pipe_t;                  /* 8 */

typedef struct { int16_t enable; int16_t type; float gain_db, f0, fs, q; } cmsis_eq_band_t; /* 20 */

typedef struct { uint8_t num_stages; float *state; float *coeffs; } cmsis_biquad_df2t_t;   /* 24, = arm_biquad_cascade_df2T_instance_f32 */

typedef struct {                                                                          /* 36 */
    int32_t enable; float threshold_db, ratio; int32_t attack_ms, release_ms;
    float gain_db, knee, hold_ms, range_db;
} cmsis_user_comp_t;

typedef struct {                                                                          /* 72 */
    float  *out;                /* 0x00 240 floats, CompressProcess output */
    float   thr_lin;            /* 0x08 */
    float   inv_ratio;          /* 0x0c */
    int32_t attack_n;           /* 0x10 samples */
    float   attack_coef;        /* 0x14 expf(-logf(9)/attack_n) */
    int32_t release_n;          /* 0x18 */
    float   release_coef;       /* 0x1c */
    int32_t hold_n;             /* 0x20 */
    int32_t hold_cnt;           /* 0x24 */
    float   knee;               /* 0x28 linear, not dB */
    float  *gain_buf;           /* 0x30 240 per-sample gains */
    float   prev_gain;          /* 0x38 */
    float   makeup_lin;         /* 0x3c */
    float   range_lin;          /* 0x40 gain floor */
} cmsis_comp_t;

typedef struct { int32_t enable; float freq_l, freq_h, threshold_db, range_db; } cmsis_user_esser_t; /* 20 */

typedef struct {                /* Peaking.c, direct form I, 64 bytes */
    float b0, b1, b2, a0, a1, a2;   /* normalised, a0 = 1 */
    float *x_hist, *y_hist;         /* [0] = n-1, [1] = n-2 */
    float last_in, last_out;
    float f0, q, gain_db;
} cmsis_peak_t;

typedef struct {                /* Lowpass.c / Highpass.c, direct form I, 56 bytes */
    float *b, *a;                   /* 3 each, a[0] = 1 after update */
    float *x_hist, *y_hist;
    float last_in, last_out;
    float fc, q;
    int32_t order;                  /* 2 = RBJ biquad, <=1 = bilinear 1st order */
} cmsis_lphp_t;

typedef struct {                                                                          /* 216 */
    int32_t enable_flag;        /* 0x00 set to 1 by EsserInit; EsserProcess only filters when == 1 */
    float  *out;                /* 0x08 240 floats */
    float   threshold_db;       /* 0x10 */
    float   level;              /* 0x14 smoothed band/total RMS ratio (linear) */
    float   range_db;           /* 0x18 copied from user_esser.range_db by EsserUpdate */
    float   _pad;
    cmsis_peak_t peak;          /* 0x20 the actual de-essing filter */
    cmsis_lphp_t lp;            /* 0x60 detector LP at freq_l */
    cmsis_lphp_t hp;            /* 0x98 detector HP at freq_h */
    float   freq_l;             /* 0xd0 */
    float   freq_h;             /* 0xd4 */
} cmsis_esser_t;

typedef struct { int32_t enable, type; float airfresh_wet, gru_wet; } cmsis_user_dist_t; /* 16 */

typedef struct { float wz, wh, uz, uh, bz, h; } cmsis_gru_t;                              /* 24 */

typedef struct {                                                                          /* 48 */
    float clip;                 /* 0.7: dist() clamp level */
    float gain_db;              /* 16 */
    float q;                    /* 1.7 */
    int32_t freq;               /* 7000 */
    float s1, s2;               /* DF2T states */
    float a0, a1, a2, b0, b1, b2;
} cmsis_air_t;

typedef struct {                                                                          /* 84 */
    float airfresh_wet, gru_wet;
    int32_t type;
    cmsis_gru_t gru;
    cmsis_air_t air;
} cmsis_dist_t;

typedef struct { float time, scale, alpha, target_db; } cmsis_lufs_params_t;              /* 16 */

typedef struct {                                                                          /* 40 */
    float target_db, alpha;
    float gain;                 /* smoothed AGC gain (process_wav divides by it) */
    float sumsq;
    float _unused10;
    float smooth_gain;
    int32_t win, idx;
    float *buf;
} cmsis_lufs_state_t;

typedef struct {                                                                          /* 624, private "g_ctx" */
    char                 root[512];
    cmsis_pipe_t        *pipe;          /* 0x200 */
    cmsis_eq_band_t     *eq_params;     /* 0x208 [10] */
    cmsis_biquad_df2t_t *eq_state;      /* 0x210 */
    cmsis_eq_coef_cb     coef_cb;       /* 0x218 */
    void                *coef_cb_user;  /* 0x220 */
    cmsis_user_comp_t   *user_comp;     /* 0x228 */
    cmsis_comp_t        *comp;          /* 0x230 */
    cmsis_user_esser_t  *user_esser;    /* 0x238 */
    cmsis_esser_t       *esser;         /* 0x240 */
    cmsis_user_dist_t   *user_dist;     /* 0x248 */
    cmsis_dist_t        *dist;          /* 0x250 */
    int32_t              lufs_enable;   /* 0x258 write-only */
    float                lufs_target;   /* 0x25c write-only */
    cmsis_lufs_params_t *lufs_params;   /* 0x260 allocated by default/reload_configs only */
    cmsis_lufs_state_t  *lufs_state;    /* 0x268 */
} cmsis_ctx_t;

/* Private globals, as offsets from the image base (vmaddr 0) of this build. */
#define CMSIS_OFF_G_RCOEFFS        0x24000  /* float*  "real" coeffs {b0,b1,b2,a1,a2}, a's in textbook sign */
#define CMSIS_OFF_G_RCOEFFS_MAX    0x24008  /* uint8_t */
#define CMSIS_OFF_G_RCOEFFS_NUM    0x24009  /* uint8_t */
#define CMSIS_OFF_G_CTX            0x24030  /* cmsis_ctx_t */
#define CMSIS_OFF_DIST_INIT_FLAG   0x242a0  /* static int in cmsis_set_distortion */

/* Exported internals (all plain C, arm64 AAPCS: ints/pointers x0.., floats s0..). */
typedef struct {
    void  (*CompressInit)(cmsis_comp_t *);
    void  (*CompressUpdate)(cmsis_comp_t *, const cmsis_user_comp_t *);
    void  (*CompressProcess)(cmsis_comp_t *, const float *in240);          /* -> comp->out */
    void  (*EsserInit)(cmsis_esser_t *);
    void  (*EsserUpdate)(cmsis_esser_t *, const cmsis_user_esser_t *);
    void  (*EsserProcess)(cmsis_esser_t *, const float *in240);            /* -> esser->out */
    void  (*distInit)(cmsis_dist_t *);
    void  (*distUpdate)(cmsis_dist_t *, const cmsis_user_dist_t *);
    void  (*distProcess)(cmsis_dist_t *, const float *in, float *out, int n);
    void  (*IIR_coef_init)(cmsis_biquad_df2t_t *, const cmsis_eq_band_t bands[10]);  /* fresh zeroed state */
    void  (*IIR_coef_update)(cmsis_biquad_df2t_t *, const cmsis_eq_band_t bands[10]);/* keeps state */
    float*(*IIR_coef_get_rCoeffs)(uint8_t *num_stages);
    void  (*arm_biquad_cascade_df2T_f32)(const cmsis_biquad_df2t_t *, const float *src, float *dst, uint32_t n);
    void  (*params_init)(cmsis_eq_band_t *, int n);
    void  (*lufs_init)(cmsis_lufs_state_t *, const cmsis_lufs_params_t *);
    float (*dsp_integrated_loudness)(cmsis_lufs_state_t *, float x);
    float (*dB2line)(float);                                   /* powf(10, x*0.05f) */
    float (*line2dB)(float);                                   /* 20*log10f(x) */
    float (*magCompute)(const float *in240, int mode);         /* 1: mean |x|, 0: max |x| */
    void  (*vec_gain)(float *, float g, int n);
} cmsis_internal_t;

#endif
