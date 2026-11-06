/**
 * MELO P1 control ids and the level-stream check the app needs before (or without) loading the driver: no runtime
 * imports beyond core/controls.ts, so the app's main chunk carries these lines and not the MELO P1 driver, which the
 * registry loads with import() (core/loader.ts). controls.ts and device.ts re-export them.
 */
import { CONTROL } from '../../core/controls'
import type { MeloDevice } from './device'

export type { MeloLevels } from './status'

export const MELO_CONTROL = {
  NC_ENABLED: CONTROL.NOISE_ENABLED,
  /** dB slider 5..25; not CONTROL.NOISE_LEVEL, which is a choice of levels in the other families. */
  NC_DEPTH: 'melo.noise.depth',
  NOISE_GATE_ENABLED: 'melo.noiseGate.enabled',
  NOISE_GATE_THRESHOLD: 'melo.noiseGate.threshold',
  /** Shared "Mic Gain" Near / Mid / Far (RX firmware < 3.0.7.9). */
  MIC_GAIN_PRESET: 'melo.mic.gainPreset',
  /** Per-mic gain in dB (RX firmware >= 3.0.7.9), perUnit tx1 / tx2. */
  MIC_GAIN: CONTROL.MIC_GAIN,
  MIC_BIT_DEPTH: 'melo.mic.bitDepth',
  OUTPUT_BIT_DEPTH: 'melo.output.bitDepth',
  AUTO_SPEAKER: 'melo.autoSpeaker',
  JACK_MODE: 'melo.jack.mode',
  /** LED on / off, perUnit rx (mixer) / tx1 / tx2. */
  LED: CONTROL.LED,
  LED_BRIGHTNESS: 'melo.led.brightness',
  WORK_MODE: 'melo.workMode',
  /** Mic track faders (0x130A tracks 0 / 1), perUnit tx1 / tx2. */
  MIC_VOLUME: 'melo.mic.volume',
  /** Mic track mute (0x130A), perUnit tx1 / tx2. */
  MIC_MUTE: CONTROL.MIC_MUTE,
  INSTRUMENT_VOLUME: 'melo.instrument.volume',
  INSTRUMENT_MUTE: 'melo.instrument.mute',
  BGM_VOLUME: 'melo.bgm.volume',
  BGM_MUTE: 'melo.bgm.mute',
  /** 0x1308 outputs: 2.4 G monitor (earphones), wired monitor (3.5 mm out), USB upstream. */
  WIRELESS_OUT_VOLUME: 'melo.out.wireless.volume',
  WIRELESS_OUT_MUTE: 'melo.out.wireless.mute',
  WIRED_OUT_VOLUME: 'melo.out.wired.volume',
  WIRED_OUT_MUTE: 'melo.out.wired.mute',
  USB_OUT_VOLUME: 'melo.out.usb.volume',
  USB_OUT_MUTE: 'melo.out.usb.mute',
} as const

/**
 * Whether a MicDevice carries the MELO P1 level stream (for UI code that only holds a MicDevice). Checked by family and
 * methods rather than `instanceof MeloDevice`, so the check does not load the driver.
 */
export function hasMeloLevels(d: unknown): d is MeloDevice {
  const m = d as Partial<MeloDevice> | null | undefined
  return !!m && typeof m === 'object' && m.family === '6201' && typeof m.startLevels === 'function' && typeof m.onLevels === 'function'
}
