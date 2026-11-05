/*
 * libm-tables: prints src/lib/dsp/applelibm-data.ts from this Mac's own
 * libsystem_m (the float libm the HollyAudio DSP library calls on arm64).
 *
 * Apple's powf, expf, logf, log10f, sinf and cosf load their tables and
 * polynomial coefficients through ADRP+ADD, ADR and LDR (literal)
 * instructions at fixed places in each routine. This program decodes those
 * instructions in the running library and dumps the doubles they point at.
 * Every instruction it relies on is checked first; if Apple changes a routine
 * it exits with an error instead of printing a wrong table, and
 * src/lib/dsp/applelibm.ts has to be re-derived from the new disassembly.
 *
 * Usage: libm-tables            (TS module on stdout)
 * Built by tools/dsp-harness/prepare.sh into .dsp-native/bin/libm-tables.
 */
#include <dlfcn.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int g_bad = 0;

static uint32_t insn_at(uintptr_t fn, unsigned off) {
    uint32_t w;
    memcpy(&w, (const void *)(fn + off), 4);
    return w;
}

static int64_t sext(uint64_t v, int bits) { return (int64_t)(v << (64 - bits)) >> (64 - bits); }

static void fail(const char *fn, unsigned off, const char *what, uint32_t w) {
    fprintf(stderr, "libm-tables: %s+0x%x is 0x%08x, expected %s\n", fn, off, w, what);
    g_bad = 1;
}

/* ADRP xd at off, ADD xd, xd, #imm at off2 -> target address. */
static uintptr_t adrp_add(const char *name, uintptr_t fn, unsigned off, unsigned off2) {
    uint32_t a = insn_at(fn, off), b = insn_at(fn, off2);
    if ((a & 0x9f000000u) != 0x90000000u) { fail(name, off, "ADRP", a); return 0; }
    if ((b & 0xffc00000u) != 0x91000000u) { fail(name, off2, "ADD (immediate)", b); return 0; }
    uint64_t imm = ((a >> 29) & 3u) | (((uint64_t)(a >> 5) & 0x7ffffu) << 2);
    uintptr_t page = ((fn + off) & ~(uintptr_t)0xfff) + (uintptr_t)(sext(imm, 21) << 12);
    return page + ((b >> 10) & 0xfffu);
}

/* ADR xd at off -> target address. */
static uintptr_t adr(const char *name, uintptr_t fn, unsigned off) {
    uint32_t a = insn_at(fn, off);
    if ((a & 0x9f000000u) != 0x10000000u) { fail(name, off, "ADR", a); return 0; }
    uint64_t imm = ((a >> 29) & 3u) | (((uint64_t)(a >> 5) & 0x7ffffu) << 2);
    return fn + off + (uintptr_t)sext(imm, 21);
}

/* LDR dt, <literal> (64-bit FP) at off -> target address. */
static uintptr_t ldr_d(const char *name, uintptr_t fn, unsigned off) {
    uint32_t a = insn_at(fn, off);
    if ((a & 0xff000000u) != 0x5c000000u) { fail(name, off, "LDR (literal, D)", a); return 0; }
    return fn + off + (uintptr_t)(sext((a >> 5) & 0x7ffffu, 19) << 2);
}

static void expect(const char *name, uintptr_t fn, unsigned off, uint32_t want) {
    uint32_t w = insn_at(fn, off);
    if (w != want) {
        char buf[32];
        snprintf(buf, sizeof buf, "0x%08x", want);
        fail(name, off, buf, w);
    }
}

static void table(const char *name, const char *doc, uintptr_t p, int n, int per) {
    printf("/** %s */\nexport const %s = new Float64Array([\n", doc, name);
    for (int i = 0; i < n; i++) {
        double d;
        memcpy(&d, (const void *)(p + 8 * (size_t)i), 8);
        printf("%s%.17g,%s", i % per ? " " : "  ", d, (i % per == per - 1 || i == n - 1) ? "\n" : "");
    }
    printf("])\n\n");
}

static double load_d(uintptr_t p) {
    double d;
    memcpy(&d, (const void *)p, 8);
    return d;
}

int main(void) {
    void *h = dlopen("/usr/lib/libSystem.B.dylib", RTLD_NOW);
    if (!h) { fprintf(stderr, "libm-tables: %s\n", dlerror()); return 1; }
    uintptr_t powf_ = (uintptr_t)dlsym(h, "powf"), expf_ = (uintptr_t)dlsym(h, "expf"), logf_ = (uintptr_t)dlsym(h, "logf"),
              log10f_ = (uintptr_t)dlsym(h, "log10f"), sinf_ = (uintptr_t)dlsym(h, "sinf"), cosf_ = (uintptr_t)dlsym(h, "cosf");
    if (!powf_ || !expf_ || !logf_ || !log10f_ || !sinf_ || !cosf_) { fprintf(stderr, "libm-tables: missing libm symbol\n"); return 1; }

    /* powf: log2 table (ADRP+ADD at 0x68/0x6c, coefficients at -0x20), exp2 table (0xd4/0xd8, coefficients at -0x10),
       clamp constants (ADR at 0xb4); spot-check the FMA sequence the port mirrors. */
    expect("powf", powf_, 0x84, 0x1f608c40); /* fnmsub d0, d2, d0, d3 */
    expect("powf", powf_, 0xa8, 0x1f401c60); /* fmadd d0, d3, d0, d7 */
    expect("powf", powf_, 0xf4, 0x1f430c00); /* fmadd d0, d0, d3, d3 */
    uintptr_t plog = adrp_add("powf", powf_, 0x68, 0x6c), pexp = adrp_add("powf", powf_, 0xd4, 0xd8), pclamp = adr("powf", powf_, 0xb4);
    /* expf: 128/ln2 (LDR at 0x1c), shift (LDR at 0x20), same exp2 table (ADRP+ADD at 0x34/0x38). */
    uintptr_t einv = ldr_d("expf", expf_, 0x1c), eshift = ldr_d("expf", expf_, 0x20), eexp = adrp_add("expf", expf_, 0x34, 0x38);
    /* logf: coefficients then table (ADRP+ADD at 0x38/0x3c). */
    uintptr_t ltab = adrp_add("logf", logf_, 0x38, 0x3c);
    /* log10f: coefficients then table (ADR at 0x44), log10(2) (LDR at 0x68). */
    uintptr_t gtab = adr("log10f", log10f_, 0x44), glog2 = ldr_d("log10f", log10f_, 0x68);
    /* sinf: 2/pi (LDR 0x30), pi/2 (LDR 0x40), cos poly (ADR 0x58), sin poly (ADR 0x94), large table (ADR 0xe4),
       large-argument poly (ADR 0x114); cosf: pi/2 lo (LDR 0x74). */
    uintptr_t s2pi = ldr_d("sinf", sinf_, 0x30), spio2 = ldr_d("sinf", sinf_, 0x40), scos = adr("sinf", sinf_, 0x58),
              ssin = adr("sinf", sinf_, 0x94), stab = adr("sinf", sinf_, 0xe4), sbig = adr("sinf", sinf_, 0x114),
              cpio2lo = ldr_d("cosf", cosf_, 0x74);
    if (!g_bad && eexp != pexp) { fprintf(stderr, "libm-tables: expf and powf no longer share the exp2 table\n"); g_bad = 1; }
    if (!g_bad && (load_d(pclamp) != 32768.0 || load_d(pclamp + 8) != -32768.0)) { fprintf(stderr, "libm-tables: powf clamp is not +-32768\n"); g_bad = 1; }
    if (!g_bad && load_d(eshift) != 6755399441055744.0) { fprintf(stderr, "libm-tables: expf shift is not 0x1.8p52\n"); g_bad = 1; }
    if (g_bad) return 1;

    printf("/**\n"
           " * Numeric tables of Apple's arm64 float libm (libsystem_m), used by\n"
           " * applelibm.ts to reproduce powf, expf, logf, log10f, sinf and cosf bit for bit.\n"
           " *\n"
           " * Generated by .dsp-native/bin/libm-tables (tools/dsp-harness/native/libm_tables.c),\n"
           " * which reads them out of this Mac's running libsystem_m; `npm run dsp:compare`\n"
           " * regenerates them and reports whether they still match. Each value is the\n"
           " * double the library loads. Most are mathematical constants (1/c and log(c)\n"
           " * for table centres c, 2^(i/128), 2^k/pi) or minimax polynomial coefficients.\n"
           " * Do not edit by hand.\n"
           " */\n\n");
    table("POWF_LOG2_POLY", "powf: log2 polynomial C0..C3, scaled by 128.", plog - 0x20, 4, 4);
    table("POWF_LOG2_TAB", "powf: 128 x [1/c, 128*log2(c)], c = centre of the i-th of 128 subintervals of [0x1.67p-1, 0x1.67p0).", plog, 256, 4);
    table("EXP2_POLY", "expf/powf: exp2 polynomial (C0, C1), r in units of 1/128.", pexp - 0x10, 2, 2);
    table("EXP2_TAB", "expf/powf: 128 x asdouble(asuint64(2^(i/128)) - (i << 45)).", pexp, 128, 4);
    table("LOGF_POLY", "logf: C0, C1, C2, ln 2.", ltab, 4, 4);
    table("LOGF_TAB", "logf: 129 x [1/c, log(c)], c = 1 + i/128 (minus ln 2 from i = 64).", ltab + 0x20, 258, 4);
    table("LOG10F_POLY", "log10f: C0..C3.", gtab, 4, 4);
    table("LOG10F_TAB", "log10f: 65 x [invc, logc].", gtab + 0x20, 130, 4);
    double consts[15] = {load_d(s2pi), load_d(spio2), load_d(cpio2lo)};
    for (int i = 0; i < 4; i++) consts[3 + i] = load_d(scos + 8 * (uintptr_t)i);
    for (int i = 0; i < 3; i++) consts[7 + i] = load_d(ssin + 8 * (uintptr_t)i);
    for (int i = 0; i < 5; i++) consts[10 + i] = load_d(sbig + 8 * (uintptr_t)i);
    table("TRIGF_CONSTS", "sinf/cosf: 2/pi, pi/2, pi/2 lo, cos poly C0..C3, sin poly S0..S2, large-argument poly T0..T4.", (uintptr_t)consts, 15, 3);
    table("TRIGF_TAB", "sinf/cosf: 64 x [hi, lo] of 2^k/pi for the large-argument reduction, indexed by (|x| bits >> 24) - 0x40.", stab, 128, 4);
    printf("export const LOG10F_LOG10_2 = %.17g\n", load_d(glog2));
    printf("export const EXPF_INVLN2N = %.17g\n", load_d(einv));
    return 0;
}
