/**
 * The eight HollyAudio voice templates, as data in the shape of the bundled
 * JSON files (pure_vocals_0.json, ...), plus the mapping the iOS app applies
 * before calling the cmsis_* setters (HL6303SmileSoundTemplateViewModel,
 * function at 0x1003f778c in larkSound):
 *
 *   cmsis_default_configs()
 *   cmsis_set_compressor(...)        (clamped, attack/release lroundf)
 *   cmsis_set_distortion(...)        (in/out gain 0; type 2 disables)
 *   cmsis_set_eq_band(i, ...) x N    (clamped)
 *   cmsis_set_esser(...)             (range is dropped by the iOS library)
 *   cmsis_set_pipe_params(0, 1)
 *   cmsis_set_lufs(0, targetLoud)    (only used by cmsis_process_wav)
 *
 * Android (CantoUtil.canto) calls the same setters in a different order and
 * passes the esser range, which the newer Android library honours.
 */

export interface PresetEqBand {
  enable: boolean
  filterType: number
  gain: number
  f0: number
  fs: number
  qVal: number
}

export interface PresetTemplate {
  id: string
  /** English name shown in the official app. */
  name: string
  /** Original Chinese label (JSON `comment`). */
  nameZh: string
  /** One-line description for the UI (ours; the app has none). */
  description: string
  file: string
  compress: { enable: boolean; threshold: number; ratio: number; attack: number; release: number; gain: number; knee: number; hold: number; range: number }
  exciter: { enable: boolean; type: number; airfreshWet: number; gruWet: number }
  eqBands: PresetEqBand[]
  esser: { enable: boolean; freqL: number; freqH: number; threshold: number; range: number }
  lufs: { time: number; scale: number; alpha: number; targetLoud: number }
}

const COMPRESS = { enable: true, threshold: -12, ratio: 4, attack: 3, release: 10, gain: 0, knee: 0.5, hold: 0, range: -45 }
const EXCITER = { enable: true, type: 1, airfreshWet: 0, gruWet: 0 }
const ESSER = { enable: true, freqL: 6500, freqH: 4500, threshold: -45, range: -15 }
const LUFS = { time: 3, scale: 3, alpha: 0.7, targetLoud: 0 }

type Row = [number, number, number, number, number]
const bands = (rows: Row[]): PresetEqBand[] =>
  rows.map(([en, t, g, f0, q]) => ({ enable: en === 1, filterType: t, gain: g, f0, fs: 48000, qVal: q }))
const NEUTRAL: Row[] = [[1, 1, 0, 200, 0.7], [1, 3, 0, 3200, 0.8], [1, 2, 0, 10000, 0.8]]

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: 'clean', name: 'Clean Voice', nameZh: '纯净人声', description: 'Removes boxiness and mud for a neutral, clear voice.',
    file: 'pure_vocals_0.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 123, 1], [1, 3, -5.1, 221, 1.3], [1, 3, -5.7, 627, 2], [1, 3, 2.7, 1575, 2], [1, 3, -4.7, 3405, 2], [1, 3, 2.1, 6750, 4], [1, 5, 4, 10000, 1]]),
  },
  {
    id: 'boost', name: 'Vocal Boost', nameZh: '人声增强', description: 'Lifts presence and intelligibility for speech in noisy mixes.',
    file: 'vocal_enhancement_1.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 90, 1], [1, 3, 7, 1874, 2.2], [1, 3, 4, 220, 0.7], [1, 3, 7, 3900, 3], [1, 3, -4, 600, 2.6], [1, 3, -7.4, 5200, 4], [1, 2, 3, 180, 0.6]]),
  },
  {
    id: 'warm-solid', name: 'Warm & Solid', nameZh: '浑厚扎实', description: 'Fuller low-mids with a forward upper range.',
    file: 'deep_resonant_2.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 80, 1], [1, 3, 6, 810, 2], [1, 3, 3, 220, 1], [1, 3, -5, 460, 2], [1, 3, 9, 2600, 2], [1, 2, 7, 6500, 0.6], [1, 5, 4, 10000, 1]]),
  },
  {
    id: 'warm-resonant', name: 'Warm & Resonant', nameZh: '质感磁性', description: 'Adds chest resonance and air for a "radio" voice.',
    file: 'textured_magnetic_3.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 1, 2, 420, 0.7], [1, 3, 3.6, 88, 2], [1, 3, 7, 280, 2], [1, 3, 7, 2100, 2], [1, 3, 3.3, 6660, 2], [1, 3, 1.5, 11000, 2], [1, 2, 3, 15000, 0.6]]),
  },
  {
    id: 'bright-youthful', name: 'Bright Youthful', nameZh: '清亮少年', description: 'Lighter low end with a bright, crisp top.',
    file: 'bright_eyed_boy_5.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 100, 1], [1, 3, -4, 145, 1], [1, 3, 4, 920, 2.5], [1, 3, 5, 2850, 2], [1, 3, 3, 10000, 2], [1, 2, 5, 13000, 0.6], [0, 3, 1, 20000, 0.7]]),
  },
  {
    id: 'mellow-full', name: 'Mellow & Full-bodied', nameZh: '圆润饱满', description: 'Rounded and smooth with gentle presence.',
    file: 'sweet_and_adorable_6.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 80, 1], [1, 3, 8, 1300, 2], [1, 3, 3, 220, 1], [1, 3, -3, 514, 2], [1, 3, 6, 2400, 2], [1, 2, 5.5, 6341, 0.6], [1, 5, 4, 10000, 1]]),
  },
  {
    id: 'bright-energetic', name: 'Bright & Energetic', nameZh: '清亮元气', description: 'Punchy lows and a lively mid range; de-esser off.',
    file: 'clear_and_vibrant_8.json',
    compress: COMPRESS, exciter: EXCITER, esser: { ...ESSER, enable: false }, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 2, 8, 150, 0.7], [1, 3, -6.2, 391, 3], [1, 3, -5, 1243, 2], [1, 3, 2, 130, 0.7], [1, 3, 4, 2825, 1], [1, 5, 8, 8000, 1], [0, 3, 1, 20000, 0.7]]),
  },
  {
    id: 'rich-full', name: 'Rich & Full', nameZh: '质感醇厚', description: 'Deep, rich low end with a darker top.',
    file: 'rich_texture_9.json',
    compress: COMPRESS, exciter: EXCITER, esser: ESSER, lufs: LUFS,
    eqBands: bands([...NEUTRAL, [1, 6, 4, 80, 1], [1, 3, 8, 258, 2], [1, 3, 10, 101, 0.5], [1, 3, -8.1, 380, 1], [1, 3, -7, 4600, 2], [1, 5, 4, 10000, 1], [0, 3, 1, 20000, 0.7]]),
  },
]

export function findTemplate(id: string | null | undefined): PresetTemplate | undefined {
  return id ? PRESET_TEMPLATES.find((p) => p.id === id) : undefined
}

// ---------------------------------------------------------------------------
// The setter arguments the iOS app derives from a template.

const clamp = (x: number, lo: number, hi: number) => Math.max(Math.min(x, hi), lo)
const F = Math.fround
/** C lroundf: round half away from zero. */
const lroundf = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x))

export interface SetterCalls {
  compressor: [enable: boolean, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, gainDb: number, knee: number, holdMs: number, rangeDb: number]
  distortion: [enable: boolean, inputGainDb: number, outputGainDb: number, type: number, airfreshWet: number, gruWet: number]
  eqBands: [index: number, enable: boolean, filterType: number, gainDb: number, f0Hz: number, q: number][]
  esser: [enable: boolean, freqL: number, freqH: number, thresholdDb: number, range: number]
  pipe: [vocalLevelDb: number, channelEnable: boolean]
  lufs: [enable: boolean, targetLoudDb: number]
}

/** Mirrors the clamps in larkSound 0x1003f778c. All floats are float32. */
export function iosSetterCalls(t: PresetTemplate): SetterCalls {
  const c = t.compress
  const knee = Math.min(F(c.knee), 24)
  const compressor: SetterCalls['compressor'] = [
    c.enable,
    clamp(F(c.threshold), -120, 0),
    clamp(F(c.ratio), 1, 30),
    Math.max(0, lroundf(F(c.attack))),
    Math.max(0, lroundf(F(c.release))),
    clamp(F(c.gain), -24, 24),
    knee >= 0 ? knee : 0,
    F(c.hold) >= 0 ? F(c.hold) : 0,
    clamp(F(c.range), -120, 0),
  ]
  const x = t.exciter
  let type = x.type | 0
  const wet = (v: number) => (v >= 1 ? 1 : v >= 0 ? F(v) : 0)
  if (type > 2) type = 2
  const distortion: SetterCalls['distortion'] = [x.enable && type !== 2, 0, 0, type, wet(x.airfreshWet), wet(x.gruWet)]
  const eqBands: SetterCalls['eqBands'] = []
  t.eqBands.slice(0, 10).forEach((b, i) => {
    const fs = F(b.fs)
    const nyq = Math.max(fs > 0 ? F(F(fs * 0.5) - 1) : 23999, 20)
    const f0 = Math.max(F(b.f0) < nyq ? F(b.f0) : nyq, 20)
    eqBands.push([i, b.enable, b.filterType | 0, clamp(F(b.gain), -24, 24), f0, clamp(F(b.qVal), 0.1, 20)])
  })
  const e = t.esser
  const esser: SetterCalls['esser'] = [e.enable, clamp(F(e.freqL), 20, 24000), clamp(F(e.freqH), 20, 24000), clamp(F(e.threshold), -120, 0), F(e.range)]
  return { compressor, distortion, eqBands, esser, pipe: [0, true], lufs: [false, F(t.lufs.targetLoud)] }
}
