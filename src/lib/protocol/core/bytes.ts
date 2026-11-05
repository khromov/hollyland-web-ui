/**
 * Byte helpers for family codecs (FAMILIES.md §3.2). Moma payloads are little-endian
 * (generated `*Serializer` classes use `ByteOrder.LITTLE_ENDIAN`, FAMILIES.md §1.3), with a few
 * big-endian fields (MAX 2 system time BE64, max2-6701.md §3.1) and big-endian command ids.
 *
 * Readers never throw: a read past the end returns `undefined` (the `…Or` variants return a
 * default), because the apps read missing bytes as 0 or skip the field; callers decide which.
 * Writers throw RangeError for out-of-range values.
 */

export type Endian = 'le' | 'be'

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)
const fits = (b: Uint8Array, off: number, n: number) => Number.isInteger(off) && off >= 0 && off + n <= b.length

export function u8(b: Uint8Array, off: number): number | undefined {
  return fits(b, off, 1) ? b[off] : undefined
}
export function i8(b: Uint8Array, off: number): number | undefined {
  return fits(b, off, 1) ? view(b).getInt8(off) : undefined
}
export function u16(b: Uint8Array, off: number, e: Endian = 'le'): number | undefined {
  return fits(b, off, 2) ? view(b).getUint16(off, e === 'le') : undefined
}
export function i16(b: Uint8Array, off: number, e: Endian = 'le'): number | undefined {
  return fits(b, off, 2) ? view(b).getInt16(off, e === 'le') : undefined
}
export function u32(b: Uint8Array, off: number, e: Endian = 'le'): number | undefined {
  return fits(b, off, 4) ? view(b).getUint32(off, e === 'le') : undefined
}
export function i32(b: Uint8Array, off: number, e: Endian = 'le'): number | undefined {
  return fits(b, off, 4) ? view(b).getInt32(off, e === 'le') : undefined
}
export function f32(b: Uint8Array, off: number, e: Endian = 'le'): number | undefined {
  return fits(b, off, 4) ? view(b).getFloat32(off, e === 'le') : undefined
}
/** 64-bit unsigned as bigint (MAX 2 system time). */
export function u64(b: Uint8Array, off: number, e: Endian = 'le'): bigint | undefined {
  return fits(b, off, 8) ? view(b).getBigUint64(off, e === 'le') : undefined
}

/** Value or a default when the bytes are missing (the Android "missing reads as 0" rule). */
export function or<T>(v: T | undefined, d: T): T {
  return v === undefined ? d : v
}

/** ASCII / Latin-1 string of `len` bytes, cut at the first NUL. Missing bytes are ignored. */
export function ascii(b: Uint8Array, off: number, len: number): string {
  let s = ''
  for (let i = off; i < Math.min(b.length, off + len); i++) {
    if (b[i] === 0) break
    s += String.fromCharCode(b[i])
  }
  return s
}

/** UTF-8 string of `len` bytes, cut at the first NUL (fatal: false, bad bytes become U+FFFD). */
export function utf8(b: Uint8Array, off: number, len: number): string {
  const end = Math.min(b.length, off + len)
  let stop = off
  while (stop < end && b[stop] !== 0) stop++
  return new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(off, stop))
}

function checkInt(name: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new RangeError(`${name} must be an integer in ${min}..${max}, got ${v}`)
  return v
}

/**
 * Little builder for payloads:
 *   new ByteWriter().u8(1).u16(0x1234).bytes([1, 2]).ascii('SN', 11).toBytes()
 */
export class ByteWriter {
  private buf: number[] = []

  get length(): number {
    return this.buf.length
  }

  u8(v: number): this {
    this.buf.push(checkInt('u8', v, 0, 0xff))
    return this
  }
  i8(v: number): this {
    this.buf.push(checkInt('i8', v, -0x80, 0x7f) & 0xff)
    return this
  }
  u16(v: number, e: Endian = 'le'): this {
    checkInt('u16', v, 0, 0xffff)
    return this.raw(2, (d) => d.setUint16(0, v, e === 'le'))
  }
  i16(v: number, e: Endian = 'le'): this {
    checkInt('i16', v, -0x8000, 0x7fff)
    return this.raw(2, (d) => d.setInt16(0, v, e === 'le'))
  }
  u32(v: number, e: Endian = 'le'): this {
    checkInt('u32', v, 0, 0xffffffff)
    return this.raw(4, (d) => d.setUint32(0, v, e === 'le'))
  }
  i32(v: number, e: Endian = 'le'): this {
    checkInt('i32', v, -0x80000000, 0x7fffffff)
    return this.raw(4, (d) => d.setInt32(0, v, e === 'le'))
  }
  f32(v: number, e: Endian = 'le'): this {
    if (!Number.isFinite(v)) throw new RangeError(`f32 must be finite, got ${v}`)
    return this.raw(4, (d) => d.setFloat32(0, v, e === 'le'))
  }
  u64(v: bigint, e: Endian = 'le'): this {
    if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError(`u64 out of range: ${v}`)
    return this.raw(8, (d) => d.setBigUint64(0, v, e === 'le'))
  }
  bytes(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.u8(b[i])
    return this
  }
  /** Fixed-width ASCII field, NUL padded (truncates longer strings). */
  ascii(s: string, width: number): this {
    for (let i = 0; i < width; i++) {
      const c = i < s.length ? s.charCodeAt(i) : 0
      this.u8(c > 0xff ? 0x3f : c)
    }
    return this
  }
  /** Zero bytes. */
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.buf.push(0)
    return this
  }
  toBytes(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.buf)
  }

  private raw(n: number, write: (d: DataView) => void): this {
    const tmp = new Uint8Array(n)
    write(new DataView(tmp.buffer))
    for (const x of tmp) this.buf.push(x)
    return this
  }
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: readonly ArrayLike<number>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of parts) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** Copy of `b` zero padded to `size` (unchanged copy when already longer or equal). */
export function padBytes(b: ArrayLike<number>, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(Math.max(size, b.length))
  out.set(b)
  return out
}

/** Split into chunks of at most `size` bytes (transport chunking, simulator chunk faults). */
export function chunkBytes(b: Uint8Array, size: number): Uint8Array[] {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`)
  const out: Uint8Array[] = []
  for (let i = 0; i < b.length; i += size) out.push(b.slice(i, i + size))
  return out
}

export function bytesEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** XOR of bytes[start..end) (Moma 6201/6701 checksum, iOS -[NSData getOrData:] @0x10027a6f8). */
export function xor8(bytes: ArrayLike<number>, start = 0, end = bytes.length): number {
  let acc = 0
  for (let i = start; i < end; i++) acc ^= bytes[i] & 0xff
  return acc
}

/** "0x600B" style id label. */
export function hex16(n: number): string {
  return '0x' + (n & 0xffff).toString(16).padStart(4, '0').toUpperCase()
}
