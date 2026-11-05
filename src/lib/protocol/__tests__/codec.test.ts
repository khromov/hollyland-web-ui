import { describe, expect, it } from 'vitest'
import {
  decodeFrame, encodeOtaDataPacket, encodeRequest, FrameAssembler, fromHex, isKnownSourceAddress, otaPacketCount, responseAddressToTarget,
  Target, targetToRequestAddress, toHex, xorChecksum, PACKET_SIZE, CodecError,
} from '../codec'

const head = (b: Uint8Array, n: number) => toHex(b.subarray(0, n))

describe('encodeRequest (Android LegacyUsb6118ProtocolCodec.buildPacket)', () => {
  it('builds a zero-padded 64-byte heartbeat', () => {
    const p = encodeRequest({ cmd: 0x10, target: Target.RX })
    expect(p.length).toBe(PACKET_SIZE)
    expect(head(p, 6)).toBe('aa dd 10 40 00 00')
    expect(p.subarray(6).every((b) => b === 0)).toBe(true)
  })

  it.each([
    ['version TX1', 0x41, Target.TX1, [], 'aa dd 41 41 00 00 00'],
    ['serial TX2', 0x15, Target.TX2, [], 'aa dd 15 42 00 00 00'],
    ['noise strong', 0x06, Target.RX, [3], 'aa dd 06 40 00 01 03 00'],
    ['noise toggle', 0x19, Target.RX, [2], 'aa dd 19 40 00 01 02 00'],
    ['volume 4', 0x05, Target.RX, [4], 'aa dd 05 40 00 01 04 00'],
    ['preset on, Low', 0x3a, Target.RX, [1, 1], 'aa dd 3a 40 00 02 01 01 00'],
    ['device id TX1', 0x08, Target.TX1, [1], 'aa dd 08 41 00 01 01 00'],
  ] as const)('%s', (_n, cmd, target, payload, expected) => {
    const p = encodeRequest({ cmd, target, payload: [...payload] })
    expect(head(p, expected.split(' ').length)).toBe(expected)
  })

  it('writes the length big-endian and counts only the payload', () => {
    const payload = Array.from({ length: 58 }, (_, i) => i)
    const p = encodeRequest({ cmd: 0x37, target: Target.RX, payload })
    expect(p[4]).toBe(0x00)
    expect(p[5]).toBe(58)
    expect(p[63]).toBe(57)
  })

  it('rejects payloads that would need fragmentation', () => {
    expect(() => encodeRequest({ cmd: 0x37, target: Target.RX, payload: new Array(59).fill(0) })).toThrow(CodecError)
    expect(() => encodeRequest({ cmd: 0x37, target: Target.RX, payload: new Array(58).fill(0) }, { appendXor: true })).toThrow(CodecError)
  })

  it('rejects bad command/target/payload values', () => {
    expect(() => encodeRequest({ cmd: 0x100, target: Target.RX })).toThrow(CodecError)
    expect(() => encodeRequest({ cmd: 0x10, target: 3 as Target })).toThrow(CodecError)
    expect(() => encodeRequest({ cmd: 0x05, target: Target.RX, payload: [256] })).toThrow(CodecError)
  })

  it('can produce the unpadded form', () => {
    expect(toHex(encodeRequest({ cmd: 0x10, target: Target.RX }, { pad: false }))).toBe('aa dd 10 40 00 00')
  })
})

describe('XOR checksum (iOS -[NSData getOrData:] @0x10027a6f8)', () => {
  // Vectors from docs/research/ios-protocol.md §5, computed from headerWithCommand:payload:andType:.
  it.each([
    [0x10, Target.RX, [], 'aa dd 10 40 00 00 27'],
    [0x16, Target.RX, [], 'aa dd 16 40 00 00 21'],
    [0x41, Target.RX, [], 'aa dd 41 40 00 00 76'],
    [0x41, Target.TX1, [], 'aa dd 41 41 00 00 77'],
    [0x41, Target.TX2, [], 'aa dd 41 42 00 00 74'],
    [0x03, Target.RX, [], 'aa dd 03 40 00 00 34'],
    [0x15, Target.RX, [], 'aa dd 15 40 00 00 22'],
    [0x15, Target.TX1, [], 'aa dd 15 41 00 00 23'],
    [0x15, Target.TX2, [], 'aa dd 15 42 00 00 20'],
    [0x11, Target.RX, [], 'aa dd 11 40 00 00 26'],
    [0x06, Target.RX, [2], 'aa dd 06 40 00 01 02 32'],
    [0x19, Target.RX, [2], 'aa dd 19 40 00 01 02 2d'],
    [0x3a, Target.RX, [1, 2], 'aa dd 3a 40 00 02 01 02 0c'],
    [0x05, Target.RX, [2], 'aa dd 05 40 00 01 02 31'],
    [0x18, Target.RX, [1], 'aa dd 18 40 00 01 01 2f'],
    [0x39, Target.RX, [0], 'aa dd 39 40 00 01 00 0f'],
    [0x39, Target.RX, [1], 'aa dd 39 40 00 01 01 0e'],
    [0x3c, Target.RX, [], 'aa dd 3c 40 00 00 0b'],
    [0x3e, Target.RX, [], 'aa dd 3e 40 00 00 09'],
    [0x36, Target.RX, [0], 'aa dd 36 40 00 01 00 00'],
    [0x34, Target.RX, [1], 'aa dd 34 40 00 01 01 03'],
    [0x0c, Target.RX, [], 'aa dd 0c 40 00 00 3b'],
    [0x3f, Target.RX, [1], 'aa dd 3f 40 00 01 01 08'],
    [0x40, Target.RX, [], 'aa dd 40 40 00 00 77'],
  ] as const)('cmd 0x%s', (cmd, target, payload, expected) => {
    const p = encodeRequest({ cmd, target, payload: [...payload] }, { appendXor: true, pad: false })
    expect(toHex(p)).toBe(expected)
    expect(xorChecksum(p)).toBe(0) // XOR over frame + checksum is zero
  })

  it('padded XOR frame keeps the checksum inside the zero padding', () => {
    const p = encodeRequest({ cmd: 0x10, target: Target.RX }, { appendXor: true })
    expect(p.length).toBe(64)
    expect(p[6]).toBe(0x27)
    expect(p.subarray(7).every((b) => b === 0)).toBe(true)
  })
})

describe('addresses', () => {
  it('maps targets to request addresses', () => {
    expect([Target.RX, Target.TX1, Target.TX2].map(targetToRequestAddress)).toEqual([0x40, 0x41, 0x42])
  })
  it('maps response sources like Android (LegacyUsb6118ProtocolCodec.mapResponseDeviceType)', () => {
    expect(responseAddressToTarget(0x80)).toBe(Target.RX)
    expect(responseAddressToTarget(0x81)).toBe(Target.TX1)
    expect(responseAddressToTarget(0x82)).toBe(Target.TX2)
    // iOS-only low values (judgeCurrentDevTypeWithData) are not TX on the HID path
    expect(responseAddressToTarget(0x01)).toBe(Target.RX)
    expect(responseAddressToTarget(0x02)).toBe(Target.RX)
    expect(responseAddressToTarget(0x03)).toBe(Target.RX)
    expect(responseAddressToTarget(0x77)).toBe(Target.RX)
    expect([0x80, 0x81, 0x82, 0x02, 0x00].map(isKnownSourceAddress)).toEqual([true, true, true, false, false])
  })
})

describe('decodeFrame (LegacyUsb6118ProtocolCodec.parseValidatedPacket)', () => {
  const pad = (hex: string) => {
    const b = new Uint8Array(64)
    b.set(fromHex(hex))
    return b
  }

  it('decodes a heartbeat reply', () => {
    const f = decodeFrame(pad('bb dd 10 80 00 11 01 01 55 3c 00 00 02 03 00 01 00 00 00 00 03 04 00'))!
    expect(f.direction).toBe('response')
    expect(f.cmd).toBe(0x10)
    expect(f.address).toBe(0x80)
    expect(f.target).toBe(Target.RX)
    expect(f.length).toBe(17)
    expect(f.payload.length).toBe(17)
    expect(f.truncated).toBe(false)
    expect(f.trailer).toBe(0)
  })

  it('attributes TX replies by source byte', () => {
    const f = decodeFrame(pad('bb dd 41 81 00 06 01 00 00 00 01 02'))!
    expect(f.target).toBe(Target.TX1)
    expect(toHex(f.payload)).toBe('01 00 00 00 01 02')
  })

  it('truncates a payload that claims more bytes than the packet holds', () => {
    const f = decodeFrame(fromHex('bb dd 15 80 00 10 41 42'))!
    expect(f.truncated).toBe(true)
    expect(toHex(f.payload)).toBe('41 42')
  })

  it('flags an XOR trailer', () => {
    const f = decodeFrame(fromHex('bb dd 06 80 00 01 01 ' + (0xbb ^ 0xdd ^ 0x06 ^ 0x80 ^ 0x01 ^ 0x01).toString(16)))!
    expect(f.trailerIsXor).toBe(true)
  })

  it('decodes requests too and rejects non-frames', () => {
    expect(decodeFrame(encodeRequest({ cmd: 0x10, target: Target.TX2 }))!.target).toBe(Target.TX2)
    expect(decodeFrame(fromHex('00 ff 00 00 00 00'))).toBeNull()
    expect(decodeFrame(fromHex('bb dd 10'))).toBeNull()
  })
})

describe('FrameAssembler', () => {
  const reply = (hex: string) => {
    const b = new Uint8Array(64)
    b.set(fromHex(hex))
    return b
  }

  it('passes complete 64-byte packets straight through', () => {
    const a = new FrameAssembler()
    const out = a.push(reply('bb dd 3c 80 00 01 01'))
    expect(out).toHaveLength(1)
    expect(out[0].cmd).toBe(0x3c)
    expect(a.pending).toBe(0)
  })

  it('reassembles a frame split across chunks (stream mode)', () => {
    const a = new FrameAssembler('stream')
    const frame = fromHex('bb dd 15 80 00 0c 52 58 53 45 52 49 41 4c 30 30 31 42')
    expect(a.push(frame.subarray(0, 4))).toHaveLength(0)
    expect(a.push(frame.subarray(4, 10))).toHaveLength(0)
    const out = a.push(frame.subarray(10))
    expect(out).toHaveLength(1)
    expect(String.fromCharCode(...out[0].payload)).toBe('RXSERIAL001B')
  })

  it('splits several frames in one chunk and drops garbage (stream mode)', () => {
    const a = new FrameAssembler('stream')
    const garbage: Uint8Array[] = []
    a.onGarbage = (g) => garbage.push(g)
    const out = a.push(fromHex('12 34 bb dd 04 80 00 01 03 bb dd 13 80 00 01 00 bb'))
    expect(out.map((f) => f.cmd)).toEqual([0x04, 0x13])
    expect(garbage.map((g) => toHex(g))).toEqual(['12 34'])
    expect(a.pending).toBe(1) // trailing 0xBB kept as a possible magic start
    expect(a.push(fromHex('dd 10 80 00 00'))[0].cmd).toBe(0x10)
  })

  it('packet mode does not resync: a packet that does not start with BB DD is garbage (Protocol6118Provider.checkDataComplete)', () => {
    const a = new FrameAssembler('packet')
    const garbage: string[] = []
    a.onGarbage = (g) => garbage.push(toHex(g.subarray(0, 4)))
    expect(a.push(reply('12 34 bb dd 04 80 00 01 03'))).toHaveLength(0)
    expect(garbage).toEqual(['12 34 bb dd'])
    expect(a.pending).toBe(0)
    expect(a.push(reply('bb dd 04 80 00 01 03'))[0].payload[0]).toBe(3)
  })

  it('reassembles in packet mode when the reply spans two packets', () => {
    const a = new FrameAssembler('packet')
    const big = new Uint8Array(6 + 70)
    big.set(fromHex('bb dd 99 80 00 46'))
    expect(a.push(big.subarray(0, 64))).toHaveLength(0)
    expect(a.push(big.subarray(64))).toHaveLength(1)
  })
})

describe('OTA data packet (FileUtils.getDataWithIndex) — builder only', () => {
  it('prefixes 0x55 and zero-pads the last chunk', () => {
    const img = Uint8Array.from({ length: 100 }, (_, i) => i + 1)
    const p0 = encodeOtaDataPacket(img, 0)
    const p1 = encodeOtaDataPacket(img, 1)
    expect(p0[0]).toBe(0x55)
    expect(p0[1]).toBe(1)
    expect(p0[63]).toBe(63)
    expect(p1[1]).toBe(64)
    expect(p1[37]).toBe(100)
    expect(p1[38]).toBe(0)
    expect(otaPacketCount(100)).toBe(2)
    expect(otaPacketCount(126)).toBe(2)
    expect(otaPacketCount(127)).toBe(3)
  })
})
