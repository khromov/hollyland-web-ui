/*
 * cmsis-runner: drives HollyAudio's own voice-effect DSP library (the iOS
 * cmsis_api_ios dylib, retagged for macOS by tools/dsp-harness/prepare.sh)
 * so tools/dsp-harness/compare.ts can diff it against the TypeScript port.
 *
 * Nothing of the vendor library is linked or embedded here: it is dlopen()ed
 * at run time from .dsp-native/lib/, which prepare.sh regenerates from the
 * user's installed app and which is gitignored.
 *
 * Usage
 *   cmsis-runner [--lib <dylib>] [--libm apple|cr] info
 *   cmsis-runner [--lib <dylib>] [--libm apple|cr] script     commands on stdin (below)
 *   cmsis-runner [--lib <dylib>] [--libm apple|cr] render --preset <app preset .json>
 *                [--esser-range ios|preset|<dB>] [--vocal-db <dB>]
 *                <in.wav> <out.wav>
 *
 * --libm cr (diagnostic) rebinds the library's imports of the float libm
 * functions (powf sinf cosf tanf expf logf log10f) to correctly rounded
 * wrappers around the double functions, by rewriting its __got slots after
 * dlopen. The DSP code itself is untouched; this isolates how much of a
 * difference comes from Apple's float libm rounding alone. Default: apple.
 *
 * render reads any PCM/float WAV, uses channel 0, requires 48 kHz, pads the
 * tail to a whole 240-sample frame and writes mono float32.
 *
 * Script commands (one per line, '#' starts a comment). Floats are parsed
 * with strtof, so 9 significant digits round-trip float32 exactly. Every
 * command prints "ok <cmd> <ret> [extra]" or "err <cmd> <message>".
 *   init <root>                 cmsis_init (root is only used by process_wav/reload)
 *   deinit | default | reload   cmsis_deinit / cmsis_default_configs / cmsis_reload_configs
 *   pipe <db> <en>              cmsis_set_pipe_params
 *   eq <i> <en> <type> <gain> <f0> <q>
 *   comp <en> <thr> <ratio> <attack:int> <release:int> <gain> <knee> <hold> <range>
 *   esser <en> <freqL> <freqH> <thr> <range>
 *   dist <en> <inGain> <outGain> <type> <airWet> <gruWet>
 *   lufs <en> <target>
 *   preset <json> [ios|preset|<dB>] apply an app template the way the iOS app does
 *   esser_range peek|<dB>       read / write the de-esser params block's range
 *                               field (internals; cmsis_set_esser on iOS drops it)
 *   coeffs                      prints "ok coeffs 0 <n> <hex bits of 5n floats>"
 *   process <in.f32> <outA.f32> [outB.f32] [startFrame frames]
 *                               raw little-endian float32 mono; whole 240-sample
 *                               frames only; input is copied per frame because
 *                               cmsis_process_frame runs the EQ in place on it.
 *                               With a range, only frames [start, start+frames)
 *                               of the input are processed and written
 *                               (frames < 0: to the end).
 *   wav <in.wav> <out.wav>      cmsis_process_wav (offline render incl. LUFS gain)
 *   libm <fn> <in.f32> <out.f32>
 *                               evaluates this machine's own float libm (not the
 *                               vendor library) on raw float32 inputs; fn is one
 *                               of sinf cosf expf logf log10f pow10f sqf cubef
 *                               powf, the calls the DSP makes (pow10f =
 *                               powf(10, x), sqf = powf(x, 2), cubef =
 *                               powf(x, 3)); for powf the input holds (x, y)
 *                               pairs and the output one result per pair
 *   lufs_stage <in.f32> <out.f32> <time> <scale> <alpha> <target>
 *                               the LUFS/AGC stage alone: lufs_init + one
 *                               dsp_integrated_loudness call per sample (internals)
 */
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <mach-o/getsect.h>
#include <mach-o/loader.h>
#include <math.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cmsis_api.h"
#include "minijson.h"
#include "wavfile.h"

typedef int (*fn_init)(const char *);
typedef int (*fn_void)(void);
typedef void (*fn_deinit)(void);
typedef int (*fn_pipe)(float, int);
typedef int (*fn_eq)(int, int, int, float, float, float);
typedef int (*fn_comp)(int, float, float, int, int, float, float, float, float);
typedef int (*fn_esser)(int, float, float, float, float);
typedef int (*fn_dist)(int, float, float, int, float, float);
typedef int (*fn_lufs)(int, float);
typedef int (*fn_frame)(float *, float *, float *);
typedef int (*fn_wav)(const char *, const char *);
typedef int (*fn_coef)(float *, uint8_t *);
typedef void (*fn_lufs_init)(void *, const cmsis_lufs_params_t *);
typedef float (*fn_loud)(void *, float);

static void *g_lib;
static uint8_t *g_base;
static int g_internals_ok;

/* Exported symbol offsets of the build the struct layouts were recovered from. */
static const struct { const char *name; uintptr_t off; } FINGERPRINT[] = {
    { "cmsis_init", 0xca20 },          { "cmsis_process_frame", 0xf204 }, { "EsserUpdate", 0x43dc },
    { "distInit", 0x1087c },           { "lufs_init", 0x4ca8 },           { "dsp_integrated_loudness", 0x4f84 },
};

static void *sym(const char *name) {
    void *p = dlsym(g_lib, name);
    if (!p) {
        fprintf(stderr, "cmsis-runner: symbol %s not found in library\n", name);
        exit(2);
    }
    return p;
}

static void default_lib_path(char *out, size_t n) {
    const char *env = getenv("CMSIS_LIB");
    if (env && *env) { snprintf(out, n, "%s", env); return; }
    char exe[PATH_MAX], real[PATH_MAX];
    uint32_t sz = sizeof exe;
    if (_NSGetExecutablePath(exe, &sz) == 0 && realpath(exe, real)) {
        char *slash = strrchr(real, '/');
        if (slash) *slash = 0;
        snprintf(out, n, "%s/../lib/libcmsis_macos.dylib", real);
        return;
    }
    snprintf(out, n, ".dsp-native/lib/libcmsis_macos.dylib");
}

static int load_library(const char *path) {
    /* The vendor build carries LLVM coverage instrumentation that would drop a
       default.profraw into the working directory at exit. */
    setenv("LLVM_PROFILE_FILE", "/dev/null", 0);
    g_lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!g_lib) {
        fprintf(stderr, "cmsis-runner: dlopen(%s): %s\nRun `npm run dsp:prepare` first.\n", path, dlerror());
        return -1;
    }
    Dl_info di;
    if (!dladdr(sym("cmsis_init"), &di)) return -1;
    g_base = (uint8_t *)di.dli_fbase;
    g_internals_ok = 1;
    for (size_t i = 0; i < sizeof FINGERPRINT / sizeof FINGERPRINT[0]; i++) {
        void *p = dlsym(g_lib, FINGERPRINT[i].name);
        if (!p || (uintptr_t)((uint8_t *)p - g_base) != FINGERPRINT[i].off) g_internals_ok = 0;
    }
    return 0;
}

/* Correctly rounded float libm (double evaluation, one rounding). */
static float cr_powf(float x, float y) { return (float)pow((double)x, (double)y); }
static float cr_sinf(float x) { return (float)sin((double)x); }
static float cr_cosf(float x) { return (float)cos((double)x); }
static float cr_tanf(float x) { return (float)tan((double)x); }
static float cr_expf(float x) { return (float)exp((double)x); }
static float cr_logf(float x) { return (float)log((double)x); }
static float cr_log10f(float x) { return (float)log10((double)x); }

/* Rewrites the library's __got slots that point at Apple's float libm. Returns the number of slots changed. */
static int rebind_libm_cr(char *what, size_t n) {
    static const struct { const char *name; void *repl; } R[] = {
        { "powf", (void *)cr_powf }, { "sinf", (void *)cr_sinf }, { "cosf", (void *)cr_cosf }, { "tanf", (void *)cr_tanf },
        { "expf", (void *)cr_expf }, { "logf", (void *)cr_logf }, { "log10f", (void *)cr_log10f },
    };
    unsigned long size = 0;
    uint8_t *got = getsectiondata((const struct mach_header_64 *)g_base, "__DATA_CONST", "__got", &size);
    if (!got || !size) return -1;
    uintptr_t pg = (uintptr_t)getpagesize();
    uintptr_t lo = (uintptr_t)got & ~(pg - 1), hi = ((uintptr_t)got + size + pg - 1) & ~(pg - 1);
    if (mprotect((void *)lo, hi - lo, PROT_READ | PROT_WRITE)) return -1;
    void **slot = (void **)got;
    int changed = 0;
    size_t len = 0;
    what[0] = 0;
    for (size_t r = 0; r < sizeof R / sizeof R[0]; r++) {
        void *orig = dlsym(RTLD_DEFAULT, R[r].name);
        for (size_t i = 0; i < size / sizeof(void *); i++) {
            if (orig && slot[i] == orig) {
                slot[i] = R[r].repl;
                changed++;
                len += (size_t)snprintf(what + len, len < n ? n - len : 0, "%s%s", len ? "," : "", R[r].name);
            }
        }
    }
    mprotect((void *)lo, hi - lo, PROT_READ);
    return changed;
}

static cmsis_ctx_t *ctx(void) { return (cmsis_ctx_t *)(g_base + CMSIS_OFF_G_CTX); }

static int need_internals(const char *cmd) {
    if (g_internals_ok) return 1;
    printf("err %s library build differs from %s; internals disabled\n", cmd, CMSIS_EXPECTED_SHA256);
    return 0;
}

/* ------------------------------------------------------------------------ */
/* raw float32 files */

static float *read_f32(const char *path, long *n) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    float *b = malloc((size_t)sz + 4);
    if (b && fread(b, 1, (size_t)sz, f) != (size_t)sz) { free(b); b = NULL; }
    fclose(f);
    *n = sz / 4;
    return b;
}

static int write_f32(const char *path, const float *b, long n) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    size_t w = fwrite(b, 4, (size_t)n, f);
    return (fclose(f) == 0 && w == (size_t)n) ? 0 : -1;
}

/* ------------------------------------------------------------------------ */
/* iOS template mapping (larkSound 3.1.0, function at 0x1003f778c): clamps,
   lroundf for attack/release, in/out gain 0, type 2 disables the exciter,
   default_configs first, pipe (0, 1), lufs (0, target). */

static float clampf(float x, float lo, float hi) { return fmaxf(fminf(x, hi), lo); }
static float jnum(const mj_node *o, const char *k, float fb) { return (float)mj_num(mj_get(o, k), fb); }

/* esser_mode: 0 = iOS (range field left as is), 1 = preset range (Android), 2 = forced value */
static int apply_preset(const char *path, int esser_mode, float forced_range, char *err, size_t errlen) {
    mj_node *root = mj_parse_file(path, err, errlen);
    if (!root) return -1;
    const mj_node *c = mj_get(root, "compress"), *x = mj_get(root, "exciter"), *bands = mj_get(root, "eqBands"),
                  *e = mj_get(root, "esser"), *l = mj_get(root, "lufs");
    if (!c || !x || !bands || !e) { snprintf(err, errlen, "%s: missing compress/exciter/eqBands/esser", path); mj_free(root); return -1; }

    ((fn_void)sym("cmsis_default_configs"))();

    float knee = fminf(jnum(c, "knee", 0), 24.0f);
    float hold = jnum(c, "hold", 0);
    ((fn_comp)sym("cmsis_set_compressor"))(mj_bool(mj_get(c, "enable"), 0), clampf(jnum(c, "threshold", 0), -120, 0),
                                          clampf(jnum(c, "ratio", 1), 1, 30), (int)fmaxf(0, (float)lroundf(jnum(c, "attack", 0))),
                                          (int)fmaxf(0, (float)lroundf(jnum(c, "release", 0))), clampf(jnum(c, "gain", 0), -24, 24),
                                          knee >= 0 ? knee : 0, hold >= 0 ? hold : 0, clampf(jnum(c, "range", 0), -120, 0));

    int type = (int)mj_num(mj_get(x, "type"), 0);
    if (type > 2) type = 2;
    float aw = jnum(x, "airfreshWet", 0), gw = jnum(x, "gruWet", 0);
    aw = aw >= 1 ? 1 : aw >= 0 ? aw : 0;
    gw = gw >= 1 ? 1 : gw >= 0 ? gw : 0;
    ((fn_dist)sym("cmsis_set_distortion"))(mj_bool(mj_get(x, "enable"), 0) && type != 2, 0, 0, type, aw, gw);

    int nb = mj_len(bands);
    for (int i = 0; i < nb && i < CMSIS_EQ_BANDS; i++) {
        const mj_node *b = mj_at(bands, i);
        float fs = jnum(b, "fs", 48000);
        float nyq = fmaxf(fs > 0 ? fs * 0.5f - 1.0f : 23999.0f, 20.0f);
        float f0 = jnum(b, "f0", 1000);
        f0 = fmaxf(f0 < nyq ? f0 : nyq, 20.0f);
        ((fn_eq)sym("cmsis_set_eq_band"))(i, mj_bool(mj_get(b, "enable"), 0), (int)mj_num(mj_get(b, "filterType"), 0),
                                         clampf(jnum(b, "gain", 0), -24, 24), f0, clampf(jnum(b, "qVal", 0.7f), 0.1f, 20));
    }

    float range = jnum(e, "range", 0);
    if (esser_mode != 0) {
        if (!need_internals("preset")) { mj_free(root); return -1; }
        ctx()->user_esser->range_db = esser_mode == 1 ? range : forced_range;
    }
    ((fn_esser)sym("cmsis_set_esser"))(mj_bool(mj_get(e, "enable"), 0), clampf(jnum(e, "freqL", 6500), 20, 24000),
                                      clampf(jnum(e, "freqH", 4500), 20, 24000), clampf(jnum(e, "threshold", 0), -120, 0), range);
    ((fn_pipe)sym("cmsis_set_pipe_params"))(0, 1);
    ((fn_lufs)sym("cmsis_set_lufs"))(0, l ? jnum(l, "targetLoud", 0) : 0);
    mj_free(root);
    return 0;
}

static int parse_esser_mode(const char *s, float *forced) {
    if (!s || !strcmp(s, "ios")) return 0;
    if (!strcmp(s, "preset")) return 1;
    *forced = strtof(s, NULL);
    return 2;
}

/* ------------------------------------------------------------------------ */

static int process_frames(const float *x, long n, float *a, float *b) {
    fn_frame pf = (fn_frame)sym("cmsis_process_frame");
    float buf[CMSIS_FRAME_LEN], scratch[CMSIS_FRAME_LEN];
    for (long k = 0; k + CMSIS_FRAME_LEN <= n; k += CMSIS_FRAME_LEN) {
        memcpy(buf, x + k, sizeof buf);
        int r = pf(buf, a + k, b ? b + k : scratch);
        if (r) return r;
    }
    return 0;
}

static int cmd_script(void) {
    char line[8192];
    while (fgets(line, sizeof line, stdin)) {
        char cmd[64] = { 0 };
        if (sscanf(line, "%63s", cmd) != 1 || cmd[0] == '#') continue;
        const char *a = line + strspn(line, " \t") + strlen(cmd);
        int r = 0;
        char extra[4096] = { 0 };
        if (!strcmp(cmd, "init")) {
            char p[2048] = ".";
            sscanf(a, "%2047s", p);
            r = ((fn_init)sym("cmsis_init"))(p);
            if (!r && g_internals_ok && ctx()->user_esser) {
                uint32_t u;
                memcpy(&u, &ctx()->user_esser->range_db, 4);
                snprintf(extra, sizeof extra, "esser_range_after_init=0x%08x", u);
            }
        } else if (!strcmp(cmd, "deinit")) {
            ((fn_deinit)sym("cmsis_deinit"))();
        } else if (!strcmp(cmd, "default")) {
            r = ((fn_void)sym("cmsis_default_configs"))();
        } else if (!strcmp(cmd, "reload")) {
            r = ((fn_void)sym("cmsis_reload_configs"))();
        } else if (!strcmp(cmd, "pipe")) {
            float db; int en;
            if (sscanf(a, "%f %d", &db, &en) != 2) goto bad;
            r = ((fn_pipe)sym("cmsis_set_pipe_params"))(db, en);
        } else if (!strcmp(cmd, "eq")) {
            int i, en, t; float g, f0, q;
            if (sscanf(a, "%d %d %d %f %f %f", &i, &en, &t, &g, &f0, &q) != 6) goto bad;
            r = ((fn_eq)sym("cmsis_set_eq_band"))(i, en, t, g, f0, q);
        } else if (!strcmp(cmd, "comp")) {
            int en, at, rl; float th, ra, g, k, h, rg;
            if (sscanf(a, "%d %f %f %d %d %f %f %f %f", &en, &th, &ra, &at, &rl, &g, &k, &h, &rg) != 9) goto bad;
            r = ((fn_comp)sym("cmsis_set_compressor"))(en, th, ra, at, rl, g, k, h, rg);
        } else if (!strcmp(cmd, "esser")) {
            int en; float fl, fh, th, rg;
            if (sscanf(a, "%d %f %f %f %f", &en, &fl, &fh, &th, &rg) != 5) goto bad;
            r = ((fn_esser)sym("cmsis_set_esser"))(en, fl, fh, th, rg);
        } else if (!strcmp(cmd, "dist")) {
            int en, t; float ig, og, aw, gw;
            if (sscanf(a, "%d %f %f %d %f %f", &en, &ig, &og, &t, &aw, &gw) != 6) goto bad;
            r = ((fn_dist)sym("cmsis_set_distortion"))(en, ig, og, t, aw, gw);
        } else if (!strcmp(cmd, "lufs")) {
            int en; float t;
            if (sscanf(a, "%d %f", &en, &t) != 2) goto bad;
            r = ((fn_lufs)sym("cmsis_set_lufs"))(en, t);
        } else if (!strcmp(cmd, "preset")) {
            char p[2048], mode[64] = "ios";
            if (sscanf(a, "%2047s %63s", p, mode) < 1) goto bad;
            float forced = 0;
            char err[512] = { 0 };
            if (apply_preset(p, parse_esser_mode(mode, &forced), forced, err, sizeof err)) {
                printf("err preset %s\n", err);
                fflush(stdout);
                continue;
            }
        } else if (!strcmp(cmd, "esser_range")) {
            char v[64];
            if (sscanf(a, "%63s", v) != 1) goto bad;
            if (!need_internals(cmd)) { fflush(stdout); continue; }
            cmsis_user_esser_t *ue = ctx()->user_esser;
            if (!ue) { printf("err esser_range not initialised\n"); fflush(stdout); continue; }
            if (strcmp(v, "peek")) ue->range_db = strtof(v, NULL);
            uint32_t u;
            memcpy(&u, &ue->range_db, 4);
            snprintf(extra, sizeof extra, "%.9g 0x%08x", ue->range_db, u);
        } else if (!strcmp(cmd, "coeffs")) {
            float c[CMSIS_EQ_MAX_STAGES * 5 + 8];
            uint8_t ns = 0;
            memset(c, 0, sizeof c);
            r = ((fn_coef)sym("cmsis_get_eq_coefficients"))(c, &ns);
            int len = snprintf(extra, sizeof extra, "%u", ns);
            for (int i = 0; i < ns * 5 && len < (int)sizeof extra - 12; i++) {
                uint32_t u;
                memcpy(&u, &c[i], 4);
                len += snprintf(extra + len, sizeof extra - (size_t)len, " %08x", u);
            }
        } else if (!strcmp(cmd, "process")) {
            char in[2048], oa[2048], ob[2048] = { 0 };
            long start = 0, count = -1;
            int got = sscanf(a, "%2047s %2047s %2047s %ld %ld", in, oa, ob, &start, &count);
            if (got < 2 || got == 4) goto bad;
            if (got >= 3 && !strcmp(ob, "-")) ob[0] = 0;
            long n;
            float *x = read_f32(in, &n);
            if (!x) { printf("err process cannot read %s\n", in); fflush(stdout); continue; }
            long total = n / CMSIS_FRAME_LEN;
            if (start < 0 || start > total) start = total;
            if (count < 0 || start + count > total) count = total - start;
            long nf = count * CMSIS_FRAME_LEN;
            const float *src = x + start * CMSIS_FRAME_LEN;
            float *A = calloc((size_t)nf + 1, 4), *B = ob[0] ? calloc((size_t)nf + 1, 4) : NULL;
            r = process_frames(src, nf, A, B);
            if (write_f32(oa, A, nf) || (B && write_f32(ob, B, nf))) { printf("err process cannot write output\n"); r = -100; }
            snprintf(extra, sizeof extra, "%ld", nf);
            free(x); free(A); free(B);
        } else if (!strcmp(cmd, "wav")) {
            char in[2048], out[2048];
            if (sscanf(a, "%2047s %2047s", in, out) != 2) goto bad;
            r = ((fn_wav)sym("cmsis_process_wav"))(in, out);
        } else if (!strcmp(cmd, "libm")) {
            char fn[32], in[2048], out[2048];
            if (sscanf(a, "%31s %2047s %2047s", fn, in, out) != 3) goto bad;
            long n;
            float *x = read_f32(in, &n);
            if (!x) { printf("err libm cannot read %s\n", in); fflush(stdout); continue; }
            /* volatile function pointers keep clang from folding or inlining the calls */
            float (*volatile f1)(float) = !strcmp(fn, "sinf") ? sinf : !strcmp(fn, "cosf") ? cosf : !strcmp(fn, "expf") ? expf
                                        : !strcmp(fn, "logf") ? logf : !strcmp(fn, "log10f") ? log10f : NULL;
            float (*volatile f2)(float, float) = powf;
            float *y = calloc((size_t)n + 1, 4);
            int known = 1;
            if (!strcmp(fn, "powf")) n /= 2;
            for (long i = 0; i < n && known; i++) {
                if (f1) y[i] = f1(x[i]);
                else if (!strcmp(fn, "powf")) y[i] = f2(x[2 * i], x[2 * i + 1]);
                else if (!strcmp(fn, "pow10f")) y[i] = f2(10.0f, x[i]);
                else if (!strcmp(fn, "sqf")) y[i] = f2(x[i], 2.0f);
                else if (!strcmp(fn, "cubef")) y[i] = f2(x[i], 3.0f);
                else known = 0;
            }
            if (!known) { printf("err libm unknown function %s\n", fn); free(x); free(y); fflush(stdout); continue; }
            if (write_f32(out, y, n)) r = -100;
            free(x); free(y);
        } else if (!strcmp(cmd, "lufs_stage")) {
            char in[2048], out[2048];
            cmsis_lufs_params_t p;
            if (sscanf(a, "%2047s %2047s %f %f %f %f", in, out, &p.time, &p.scale, &p.alpha, &p.target_db) != 6) goto bad;
            if (!need_internals(cmd)) { fflush(stdout); continue; }
            long n;
            float *x = read_f32(in, &n);
            if (!x) { printf("err lufs_stage cannot read %s\n", in); fflush(stdout); continue; }
            cmsis_lufs_state_t *st = calloc(1, 64);
            ((fn_lufs_init)sym("lufs_init"))(st, &p);
            fn_loud step = (fn_loud)sym("dsp_integrated_loudness");
            float *y = calloc((size_t)n + 1, 4);
            for (long i = 0; i < n; i++) y[i] = step(st, x[i]);
            if (write_f32(out, y, n)) r = -100;
            snprintf(extra, sizeof extra, "win=%d", st->win);
            free(st->buf); free(st); free(x); free(y);
        } else {
            printf("err %s unknown command\n", cmd);
            fflush(stdout);
            continue;
        }
        printf("ok %s %d%s%s\n", cmd, r, extra[0] ? " " : "", extra);
        fflush(stdout);
        continue;
    bad:
        printf("err %s bad arguments\n", cmd);
        fflush(stdout);
    }
    return 0;
}

static int cmd_render(int argc, char **argv) {
    const char *preset = NULL, *range = "ios", *in = NULL, *out = NULL;
    float vocal = 0;
    for (int i = 0; i < argc; i++) {
        if (!strcmp(argv[i], "--preset") && i + 1 < argc) preset = argv[++i];
        else if (!strcmp(argv[i], "--esser-range") && i + 1 < argc) range = argv[++i];
        else if (!strcmp(argv[i], "--vocal-db") && i + 1 < argc) vocal = strtof(argv[++i], NULL);
        else if (!in) in = argv[i];
        else if (!out) out = argv[i];
    }
    if (!preset || !in || !out) {
        fprintf(stderr, "usage: cmsis-runner render --preset <json> [--esser-range ios|preset|<dB>] [--vocal-db <dB>] in.wav out.wav\n");
        return 64;
    }
    char err[512] = { 0 };
    wav_t w;
    if (wav_read(in, &w, err, sizeof err)) { fprintf(stderr, "%s\n", err); return 1; }
    if (w.sample_rate != CMSIS_SAMPLE_RATE) {
        fprintf(stderr, "%s is %d Hz; the library only runs at 48000 Hz (resample first)\n", in, w.sample_rate);
        return 1;
    }
    long n = (long)((w.frames + CMSIS_FRAME_LEN - 1) / CMSIS_FRAME_LEN * CMSIS_FRAME_LEN);
    float *x = calloc((size_t)n + 1, 4), *y = calloc((size_t)n + 1, 4);
    for (size_t i = 0; i < w.frames; i++) x[i] = w.data[i * (size_t)w.channels];
    if (((fn_init)sym("cmsis_init"))(".")) { fprintf(stderr, "cmsis_init failed\n"); return 1; }
    float forced = 0;
    int mode = parse_esser_mode(range, &forced);
    if (mode == 0 && g_internals_ok) ctx()->user_esser->range_db = 0; /* malloc'd, never initialised: pin to 0 */
    if (apply_preset(preset, mode, forced, err, sizeof err)) { fprintf(stderr, "%s\n", err); return 1; }
    if (vocal != 0) ((fn_pipe)sym("cmsis_set_pipe_params"))(vocal, 1);
    int r = process_frames(x, n, y, NULL);
    if (r) { fprintf(stderr, "cmsis_process_frame returned %d\n", r); return 1; }
    if (wav_write_f32(out, y, (size_t)n, 1, CMSIS_SAMPLE_RATE)) { fprintf(stderr, "cannot write %s\n", out); return 1; }
    fprintf(stderr, "rendered %ld samples (%d channel(s) in, channel 0 used) -> %s\n", n, w.channels, out);
    ((fn_deinit)sym("cmsis_deinit"))();
    wav_free(&w);
    free(x); free(y);
    return 0;
}

int main(int argc, char **argv) {
    char lib[PATH_MAX];
    default_lib_path(lib, sizeof lib);
    int i = 1;
    const char *libm = getenv("CMSIS_LIBM") ? getenv("CMSIS_LIBM") : "apple";
    for (;;) {
        if (i + 1 < argc && !strcmp(argv[i], "--lib")) { snprintf(lib, sizeof lib, "%s", argv[i + 1]); i += 2; }
        else if (i + 1 < argc && !strcmp(argv[i], "--libm")) { libm = argv[i + 1]; i += 2; }
        else break;
    }
    const char *sub = i < argc ? argv[i++] : "script";
    if (!strcmp(sub, "-h") || !strcmp(sub, "--help")) {
        fprintf(stderr, "usage: cmsis-runner [--lib <dylib>] [--libm apple|cr] info | script | render --preset <json> [--esser-range ios|preset|<dB>] [--vocal-db <dB>] in.wav out.wav\n");
        return 0;
    }
    if (load_library(lib)) return 1;
    char rebound[256] = "none (Apple libm)";
    if (!strcmp(libm, "cr")) {
        int k = rebind_libm_cr(rebound, sizeof rebound);
        if (k <= 0) { fprintf(stderr, "cmsis-runner: could not rebind libm imports\n"); return 1; }
    } else if (strcmp(libm, "apple")) {
        fprintf(stderr, "cmsis-runner: --libm must be apple or cr\n");
        return 64;
    }
    if (!strcmp(sub, "info")) {
        printf("library %s\nbase %p\ninternals %s\nlibm rebound %s\nframe %d\nsample_rate %d\n", lib, (void *)g_base,
               g_internals_ok ? "ok (fingerprint matches)" : "disabled (unknown build)", rebound, CMSIS_FRAME_LEN, CMSIS_SAMPLE_RATE);
        return 0;
    }
    if (!strcmp(sub, "script")) return cmd_script();
    if (!strcmp(sub, "render")) return cmd_render(argc - i, argv + i);
    fprintf(stderr, "unknown subcommand %s\n", sub);
    return 64;
}
