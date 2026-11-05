/* WAV reader/writer for the harness (independent of the vendor's wavio.c). */
#ifndef WAVFILE_H
#define WAVFILE_H

#include <stddef.h>
#include <stdint.h>

typedef struct {
    int format;          /* 1 = PCM int, 3 = IEEE float (WAVE_FORMAT_EXTENSIBLE is resolved) */
    int channels;
    int sample_rate;
    int bits;
    size_t frames;
    float *data;         /* interleaved, converted to float (see wav_read for scaling) */
} wav_t;

/*
 * Reads PCM 8/16/24/32-bit, float32 or float64. Integer samples are scaled by
 * exactly 1/2^(bits-1) (int16: s / 32768.0f), float32 is copied bit-for-bit,
 * float64 is rounded to float. Returns 0 on success.
 */
int  wav_read(const char *path, wav_t *out, char *err, size_t errlen);
void wav_free(wav_t *w);

/* Writes IEEE float32 WAV, interleaved `channels`, bit-exact. Returns 0 on success. */
int  wav_write_f32(const char *path, const float *data, size_t frames, int channels, int sample_rate);

#endif
