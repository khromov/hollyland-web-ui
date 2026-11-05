/**
 * Shared Moma codec (docs/FAMILIES.md §3.5) for LARK M3 (6303), LARK MAX 2 (6701) and MELO P1 (6201):
 *
 *  - codec.ts     envelope encode / decode, control byte, lenient checksum, MomaFrameAssembler (streaming)
 *  - profiles.ts  MOMA_6303, MOMA_6701_USB(_CAMERA), MOMA_6701_BLE, MOMA_6201_USB / _BLE / _IOS
 *  - spec.ts      MomaRequest / MomaMessage, MomaAssembler, createMomaSpecBase() for FamilyDevice
 *  - sim.ts       simulator helpers: request reader, replies, fault knobs
 *
 * Exported from the library index as the `moma` namespace (`import { moma } from '$lib/protocol'`).
 * Golden vectors from the three research docs: moma/__tests__/vectors.ts (test data; family agents copy
 * or import them in their own tests). Nothing here was run against hardware.
 */
export * from './codec'
export * from './profiles'
export * from './spec'
export * from './sim'
