/** Minimal PCM WAV encoder (16-bit or 24-bit integer, or 32-bit float). */

export type WavBitDepth = 16 | 24 | 32

/**
 * Encode planar float channels (each -1..1) into a RIFF/WAVE Blob.
 * `channels` must all have the same length.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, bitDepth: WavBitDepth = 24): Blob {
  const numCh = channels.length
  if (numCh === 0) throw new Error('encodeWav: no channels')
  const frames = channels[0].length
  const isFloat = bitDepth === 32
  const bytesPerSample = bitDepth / 8
  const blockAlign = numCh * bytesPerSample
  const dataBytes = frames * blockAlign
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, isFloat ? 3 : 1, true) // 1 = PCM, 3 = IEEE float
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  let off = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = channels[c][i]
      if (s > 1) s = 1
      else if (s < -1) s = -1
      if (isFloat) {
        view.setFloat32(off, s, true)
      } else if (bitDepth === 16) {
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      } else {
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff)
        view.setUint8(off, v & 0xff)
        view.setUint8(off + 1, (v >> 8) & 0xff)
        view.setUint8(off + 2, (v >> 16) & 0xff)
      }
      off += bytesPerSample
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Concatenate recorded chunks of one channel. */
export function concatChunks(chunks: Float32Array[]): Float32Array {
  let len = 0
  for (const c of chunks) len += c.length
  const out = new Float32Array(len)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}
