/**
 * LARK MAX 2 control and value ids, enums, per-product checks and the channel-mode rule the app needs before (or
 * without) loading the driver: no runtime imports beyond core/controls.ts, so the app's main chunk carries these lines
 * and not the MAX 2 driver, which the registry loads with import() (core/loader.ts). commands.ts, controls.ts and
 * session.ts re-export everything here.
 */
import { CONTROL } from '../../core/controls'
import type { MicState } from '../../core/types'
import type { ProductInfo } from '../../models'
import type { Max2Device } from './session'

/** A DeviceConnectVariable.TcMode MODE_ONE 0, MODE_TWO 1, MODE_THREE 2. */
export const MAX2_TC_MODE = { MODE_1: 0, MODE_2: 1, MODE_3: 2 } as const
/** A DeviceConnectVariable.TimingMode FROM_ZERO 0, REAL_TIME 1, RESET 2. */
export const MAX2_TIMING = { FROM_ZERO: 0, REAL_TIME: 1, RESET: 2 } as const

/** Family-scoped control ids (canonical ids from core/controls.ts CONTROL where the meaning matches). */
export const MAX2_CONTROL = {
  SPEAKER: CONTROL.SPEAKER,
  BIT_DEPTH: 'max2.bitDepth',
  USB_OUTPUT: 'max2.usbOutput',
  MIC_LOCK: 'max2.micLock',
  NOISE_ENABLED: CONTROL.NOISE_ENABLED,
  NOISE_DEPTH: 'max2.nc.depth',
  GAIN_TYPE: 'max2.gain.type',
  GAIN_DYNAMIC: 'max2.gain.dynamic',
  MIC_GAIN: CONTROL.MIC_GAIN,
  CHANNEL_MODE: CONTROL.CHANNEL_MODE,
  TC_ENABLED: 'max2.tc.enabled',
  TC_MODE: 'max2.tc.mode',
  TC_FPS: 'max2.tc.fps',
  TC_TIMING: 'max2.tc.timing',
  MIC_RECOGNITION: CONTROL.MIC_RECOGNITION,
  FOUR_MIC: 'max2.fourMic',
  RX_PAIR: 'max2.rxPair',
  WIRELESS: 'max2.wireless',
  OWS_MONITOR: 'max2.ows.monitor',
  OWS_VOLUME: 'max2.ows.volume',
  OWS_PAIR: 'max2.ows.startPairing',
} as const

/** Values that are not controls (status the UI shows), kept in MicState.values. */
export const MAX2_VALUE = {
  /** OWS earphones paired (GET 0x6017: 0 = unpaired, else paired). */
  OWS_PAIRED: 'max2.ows.paired',
} as const

/** Extra values kept in MicState.values (not controls). */
export const MAX2_STATUS_VALUE = {
  ...MAX2_VALUE,
  /** Live timecode [h, m, s, frame] (GET 0x6014) or [min, sec, frame] from the heartbeat (bytes 34..36). */
  TC_TIME: 'max2.tc.time',
} as const

/** A TimeCodeActivity.confirmReset: R title_reset + msg_reset (same text as I "重置后时间码变为00:00:00:00并开始新录制"). */
export const MAX2_TC_RESET_TEXT = 'Reset: After reset, timecode will be 00:00:00:00 and new recording will start.'

export const isMax2Mobile = (p: ProductInfo): boolean => p.productId === 1026
export const isMax2Camera = (p: ProductInfo): boolean => p.productId === 1027
export const isMax2Box = (p: ProductInfo): boolean => p.productId === 101

/**
 * Why a channel mode is refused (A HLBleDeviceActivity initView lambdas 13/14), or null:
 *  - stereo / safety track while the timecode switch is on and the TC mode is not Mode 3, except on the mobile RX
 *  - safety track except through the charging case (productId 101)
 */
export function max2ChannelRefusal(
  product: ProductInfo,
  mode: number,
  v: MicState['values'],
): { reason: string; message: string } | null {
  if (mode === 0) return null
  const tcOn = v[MAX2_CONTROL.TC_ENABLED] === true
  const tcMode = v[MAX2_CONTROL.TC_MODE]
  if (!isMax2Mobile(product) && tcOn && tcMode !== MAX2_TC_MODE.MODE_3) {
    return { reason: 'timecode-on', message: mode === 1 ? 'Stereo not supported in Timecode Mode' : 'Safety track unavailable in Timecode Mode' }
  }
  if (mode === 2 && !isMax2Box(product)) return { reason: 'box-only', message: 'Supports mono and stereo modes only' }
  return null
}

/**
 * Whether a MicDevice is a Max2Device (timecode reset confirm, `timingNeedsConfirm`). Checked by family and method
 * rather than `instanceof`, so the check does not load the driver.
 */
export function isMax2Device(d: unknown): d is Max2Device {
  const m = d as Partial<Max2Device> | null | undefined
  return !!m && typeof m === 'object' && m.family === '6701' && typeof m.timingNeedsConfirm === 'function'
}
