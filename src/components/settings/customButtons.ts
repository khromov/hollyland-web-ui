/**
 * LARK M2S "Custom Functions" model (features.md §16.1).
 *
 * Source: Android usbmic/data/DeviceBtnCustom (BtnOperation, ClickOperation, BtnFunction,
 * CameraBtnFunction, MobileBtnFunction, KeyOperation, LightColor) and
 * larkc1/ui/custom/CustomFunctionActivity + adapter/CustomFunctionAdapter + ClickOptionAdapter.
 *
 * The receiver has two slots (functionIndex 1 and 2, heartbeat bytes 11/12). Each slot holds one
 * function and one key operation (= button + click type). At most two functions can be active.
 */

export type ButtonId = 'mobilePower' | 'cameraPower' | 'cameraNoise' | 'txPower'
export type ClickId = 'single' | 'double' | 'triple'

export const CLICK_LABEL: Record<ClickId, string> = {
  single: 'Single Click',
  double: 'Double Click',
  triple: 'Triple Click',
}

export interface ButtonDef {
  id: ButtonId
  label: string
  clicks: { click: ClickId; keyOp: number }[]
}

/** KeyOperation codes: 0 not set, 1..7 below (DeviceBtnCustom.KeyOperation). */
export const BUTTONS: Record<ButtonId, ButtonDef> = {
  mobilePower: {
    id: 'mobilePower',
    label: 'Mobile RX Power Button',
    clicks: [
      { click: 'double', keyOp: 1 },
      { click: 'triple', keyOp: 2 },
    ],
  },
  cameraPower: {
    id: 'cameraPower',
    label: 'Camera RX Power Button',
    clicks: [
      { click: 'single', keyOp: 3 },
      { click: 'double', keyOp: 4 },
    ],
  },
  cameraNoise: {
    id: 'cameraNoise',
    label: 'Camera RX Noise Cancellation Button',
    clicks: [{ click: 'double', keyOp: 5 }],
  },
  txPower: {
    id: 'txPower',
    label: 'TX Power Button',
    clicks: [
      { click: 'double', keyOp: 6 },
      { click: 'triple', keyOp: 7 },
    ],
  },
}

export interface FunctionDef {
  func: number
  label: string
  description: string
  /** Buttons this function can be assigned to on the camera receiver (PID 1030). */
  camera: ButtonId[]
  /** Buttons on the mobile receiver (PID 1029); null = not offered there. */
  mobile: ButtonId[] | null
}

/** BtnFunction codes: 0 not set, 1 RX self-lock, 2 mute all, 3 mute this TX, 4 TX identify. */
export const FUNCTIONS: FunctionDef[] = [
  {
    func: 1,
    label: 'RX Self-Locking',
    description: "Locks the receiver's controls.",
    camera: ['cameraPower', 'cameraNoise'],
    mobile: null,
  },
  {
    func: 2,
    label: 'Mic Muted (Simultaneous)',
    description: 'Mutes or unmutes both mics at once.',
    camera: ['cameraPower', 'cameraNoise'],
    mobile: ['mobilePower'],
  },
  {
    func: 3,
    label: 'Mic Muted (Individual)',
    description: 'Mutes or unmutes a single mic.',
    camera: ['cameraPower', 'cameraNoise', 'txPower'],
    mobile: ['mobilePower', 'txPower'],
  },
  {
    func: 4,
    label: 'Mic Recognition',
    description: 'Lights each mic in its own colour so you can tell them apart.',
    camera: ['cameraPower', 'cameraNoise', 'txPower'],
    mobile: ['mobilePower', 'txPower'],
  },
]

export const FUNC_IDENTIFY = 4

/** DeviceBtnCustom.LightColor. */
export const LIGHT_COLORS = [
  { value: 1, label: 'Purple' },
  { value: 2, label: 'Yellow' },
] as const

export function functionsFor(camera: boolean): (FunctionDef & { buttons: ButtonId[] })[] {
  return FUNCTIONS.flatMap((f) => {
    const buttons = camera ? f.camera : f.mobile
    return buttons ? [{ ...f, buttons }] : []
  })
}

export function functionLabel(func: number): string {
  return FUNCTIONS.find((f) => f.func === func)?.label ?? `Function ${func}`
}

/** "Mobile RX Power Button (Double Click)", or null for "not set". */
export function keyOpLabel(keyOp: number): string | null {
  for (const b of Object.values(BUTTONS)) {
    const c = b.clicks.find((x) => x.keyOp === keyOp)
    if (c) return `${b.label} (${CLICK_LABEL[c.click]})`
  }
  return null
}
