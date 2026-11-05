#include "wavfile.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | p[1] << 8); }
static uint32_t rd32(const uint8_t *p) { return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }

int wav_read(const char *path, wav_t *out, char *err, size_t errlen) {
    memset(out, 0, sizeof *out);
    FILE *f = fopen(path, "rb");
    if (!f) { snprintf(err, errlen, "cannot open %s", path); return -1; }
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc((size_t)sz);
    if (!buf || fread(buf, 1, (size_t)sz, f) != (size_t)sz) { fclose(f); free(buf); snprintf(err, errlen, "read failed"); return -1; }
    fclose(f);
    if (sz < 12 || memcmp(buf, "RIFF", 4) || memcmp(buf + 8, "WAVE", 4)) { free(buf); snprintf(err, errlen, "%s is not a RIFF/WAVE file", path); return -1; }

    const uint8_t *fmt = NULL, *data = NULL;
    uint32_t data_len = 0;
    long pos = 12;
    while (pos + 8 <= sz) {
        uint32_t len = rd32(buf + pos + 4);
        const uint8_t *body = buf + pos + 8;
        if (!memcmp(buf + pos, "fmt ", 4)) fmt = body;
        else if (!memcmp(buf + pos, "data", 4)) {
            data = body;
            data_len = len;
            if (pos + 8 + (long)data_len > sz) data_len = (uint32_t)(sz - pos - 8);   /* tolerate truncated files */
        }
        pos += 8 + (long)len + (len & 1);
    }
    if (!fmt || !data) { free(buf); snprintf(err, errlen, "missing fmt or data chunk"); return -1; }

    int format = rd16(fmt);
    int channels = rd16(fmt + 2);
    int rate = (int)rd32(fmt + 4);
    int bits = rd16(fmt + 14);
    if (format == 0xFFFE) format = rd16(fmt + 24);     /* WAVE_FORMAT_EXTENSIBLE sub-format GUID starts with the tag */
    if (channels < 1 || (format != 1 && format != 3) || (format == 3 && bits != 32 && bits != 64) ||
        (format == 1 && bits != 8 && bits != 16 && bits != 24 && bits != 32)) {
        free(buf);
        snprintf(err, errlen, "unsupported WAV format tag=%d bits=%d channels=%d", format, bits, channels);
        return -1;
    }
    size_t bps = (size_t)bits / 8;
    size_t frames = data_len / (bps * (size_t)channels);
    float *samples = malloc(frames * (size_t)channels * sizeof(float) + 1);
    if (!samples) { free(buf); snprintf(err, errlen, "out of memory"); return -1; }
    size_t n = frames * (size_t)channels;
    for (size_t i = 0; i < n; i++) {
        const uint8_t *p = data + i * bps;
        float v;
        if (format == 3 && bits == 32) { uint32_t u = rd32(p); memcpy(&v, &u, 4); }
        else if (format == 3) { uint64_t u = (uint64_t)rd32(p) | (uint64_t)rd32(p + 4) << 32; double d; memcpy(&d, &u, 8); v = (float)d; }
        else if (bits == 8) v = (float)((int)p[0] - 128) / 128.0f;
        else if (bits == 16) v = (float)(int16_t)rd16(p) / 32768.0f;
        else if (bits == 24) { int32_t s = (int32_t)((uint32_t)p[0] << 8 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 24) >> 8; v = (float)s / 8388608.0f; }
        else v = (float)((double)(int32_t)rd32(p) / 2147483648.0);
        samples[i] = v;
    }
    free(buf);
    out->format = format;
    out->channels = channels;
    out->sample_rate = rate;
    out->bits = bits;
    out->frames = frames;
    out->data = samples;
    return 0;
}

void wav_free(wav_t *w) { free(w->data); w->data = NULL; }

static void wr16(FILE *f, uint16_t v) { uint8_t b[2] = { (uint8_t)v, (uint8_t)(v >> 8) }; fwrite(b, 1, 2, f); }
static void wr32(FILE *f, uint32_t v) { uint8_t b[4] = { (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24) }; fwrite(b, 1, 4, f); }

int wav_write_f32(const char *path, const float *data, size_t frames, int channels, int sample_rate) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    uint32_t bytes = (uint32_t)(frames * (size_t)channels * 4);
    fwrite("RIFF", 1, 4, f); wr32(f, 4 + 8 + 16 + 8 + bytes);
    fwrite("WAVE", 1, 4, f);
    fwrite("fmt ", 1, 4, f); wr32(f, 16);
    wr16(f, 3); wr16(f, (uint16_t)channels); wr32(f, (uint32_t)sample_rate);
    wr32(f, (uint32_t)(sample_rate * channels * 4)); wr16(f, (uint16_t)(channels * 4)); wr16(f, 32);
    fwrite("data", 1, 4, f); wr32(f, bytes);
    for (size_t i = 0; i < frames * (size_t)channels; i++) { uint32_t u; memcpy(&u, &data[i], 4); wr32(f, u); }
    int ok = ferror(f) == 0;
    ok &= fclose(f) == 0;
    return ok ? 0 : -1;
}
