/**
 * The LARK MAX 2 FamilyDriver (W7): BLE charging case first, then the USB RX, on the shared Moma codec and the
 * generic engine. Registered since Phase 3 (W9): index.ts exports `createMax2Driver()` on the registry rows as `driver`;
 * runtime.ts is the same driver without the simulator (what the app loads).
 *
 *   const d = createMax2Driver()
 *   const t = await WebBluetoothTransport.request({ products: d.products })      // BOX 101
 *   const mic = d.createDevice(t!, t!.product!)
 */
import { CONTROL } from '../../core/controls'
import type { FamilyDriver, MockPreset } from '../../core/types'
import { createMax2Runtime, type Max2DriverOptions } from './runtime'
import { Max2Simulator } from './sim'

export { max2CommandOfFrame, type Max2DriverOptions } from './runtime'

/** `?mock=<id>` presets (FAMILIES.md §4.3). Ids are unique across drivers. */
export const MAX2_MOCK_PRESETS: readonly MockPreset[] = [
  { id: 'max2', label: 'LARK MAX 2 mobile RX (USB, simulated)', family: '6701', productId: 1026 },
  { id: 'max2-4mic', label: 'LARK MAX 2 mobile RX, 4 Mic & 1 RX (USB, simulated)', family: '6701', productId: 1026, sim: { profile: '4mic' } },
  {
    id: 'max2-ows', label: 'LARK MAX 2 mobile RX, wireless monitoring with OWS earphones (USB, simulated)', family: '6701', productId: 1026,
    sim: { params: { wireless: true, earphones: 3 } },
  },
  {
    id: 'max2-oldfw', label: 'LARK MAX 2 mobile RX, firmware 3.0.0.40 (short heartbeat, simulated)', family: '6701', productId: 1026,
    sim: { rxVersion: '3.0.0.40', params: { heartbeatLength: 33 } },
  },
  { id: 'max2-blind', label: 'LARK MAX 2 mobile RX, replies dropped (macOS/Windows HID filtering, simulated)', family: '6701', productId: 1026, sim: { dropReplies: true } },
  { id: 'max2cam', label: 'LARK MAX 2 camera RX (USB, simulated)', family: '6701', productId: 1027 },
  { id: 'max2cam-tc', label: 'LARK MAX 2 camera RX, timecode on in Mode 1 (USB, simulated)', family: '6701', productId: 1027, sim: { params: { tc: true, tcMode: 0 } } },
  { id: 'max2box', label: 'LARK MAX 2 charging case (Web Bluetooth, MTU 23, simulated)', family: '6701', productId: 101 },
  { id: 'max2box-mtu185', label: 'LARK MAX 2 charging case (Web Bluetooth, MTU 185, simulated)', family: '6701', productId: 101, sim: { params: { mtu: 185 } } },
]

export function createMax2Driver(o: Max2DriverOptions = {}): FamilyDriver {
  return { ...createMax2Runtime(o), createSimulator: (product, sim) => new Max2Simulator(product, sim), mockPresets: MAX2_MOCK_PRESETS }
}

/** Canonical ids the MAX 2 shares with other families (for the UI's bespoke modules). */
export const MAX2_CANONICAL_CONTROLS = [CONTROL.NOISE_ENABLED, CONTROL.MIC_GAIN, CONTROL.CHANNEL_MODE, CONTROL.SPEAKER, CONTROL.MIC_RECOGNITION] as const
