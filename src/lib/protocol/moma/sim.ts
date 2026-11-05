/**
 * Helpers for Moma family simulators (FAMILIES.md §3.8 "simulator must model"): read host frames
 * (chunked BLE writes, report id, padding), build device replies in the profile's framing, apply the
 * shared fault knobs. The reply bytes the real devices send are partly unknown [?]: source byte, item
 * type of acks and data, padding. The defaults follow the research docs' illustrative replies
 * (m3-6303.md §3.3, max2-6701.md §3.3, melo-6201.md §3.4): source = the replying unit, target 6 (app),
 * the request's control byte, type 2 for acks and 3 for data, M3 replies padded like requests.
 */
import { chunkBytes } from '../core/bytes'
import type { SimFaults } from '../core/types'
import { encodeMomaFrame, MomaFrameAssembler, MOMA_ID, MOMA_TYPE, type MomaFrame, type MomaItemInput } from './codec'
import type { MomaProfile } from './profiles'

/** Set acknowledgement item: `[code]`, 0 = success (A DeviceControlConstant.SetResult). */
export function momaAck(cmd: number, code = 0): MomaItemInput {
  return { cmd, type: MOMA_TYPE.EXEC_RESP, payload: [code] }
}

/** GET reply item (type 3, A BleMicCommUtil.GET_CMD_RESPONSE). */
export function momaData(cmd: number, payload: ArrayLike<number>): MomaItemInput {
  return { cmd, type: MOMA_TYPE.DATA, payload }
}

/** Device push item (type 0). */
export function momaNotify(cmd: number, payload: ArrayLike<number>): MomaItemInput {
  return { cmd, type: MOMA_TYPE.NOTIFY, payload }
}

export interface MomaReplyOptions {
  /** Replying unit (default 1, phone RX). */
  source?: number
  /** Default MOMA_ID.PHONE_APP (6). */
  target?: number
  /** Default the profile's control byte (start/end markers and XOR as in the requests). */
  control?: number
}

/** One BB DD frame in the profile's framing (report id and padding included for the 6303). */
export function encodeMomaReply(profile: MomaProfile, items: readonly MomaItemInput[], o: MomaReplyOptions = {}): Uint8Array {
  return encodeMomaFrame(items, {
    head: 'up',
    source: o.source ?? MOMA_ID.PHONE_RX,
    target: o.target ?? MOMA_ID.PHONE_APP,
    control: o.control ?? profile.control,
    reportId: profile.reportId,
    padTo: profile.padTo,
  })
}

/**
 * Simulator-side reader of host frames: feed every packet the host writes, get the complete request
 * frames (BLE writes may be split, the 6303 prefixes report id 8 and pads).
 */
export class MomaRequestReader {
  private readonly frames: MomaFrameAssembler

  constructor(profile: MomaProfile) {
    this.frames = new MomaFrameAssembler({ reportId: profile.reportId, heads: 'down' })
  }

  push(packet: Uint8Array): MomaFrame[] {
    return this.frames.push(packet)
  }

  reset(): void {
    this.frames.reset()
  }
}

/** Apply the shared fault knobs to reply packets: drop, duplicate, split into chunks (BLE MTU, HID reports). */
export function applyMomaFaults(packets: readonly Uint8Array[], faults: SimFaults): Uint8Array[] {
  if (faults.dropReplies) return []
  const out = faults.duplicateReplies ? packets.flatMap((p) => [p, p.slice()]) : [...packets]
  const n = faults.chunkSize
  return n ? out.flatMap((p) => chunkBytes(p, n)) : out
}
