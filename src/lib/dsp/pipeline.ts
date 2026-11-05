/**
 * Emulation of the cmsis_api global state and the real-time pipeline in
 * cmsis_process_frame (0xf204):
 *
 *   if (!pipe.channelEnable) { outL = outR = 0; return }
 *   if (eq.numStages)   EQ in place on the input
 *   if (comp.enable)    x = CompressProcess(x)
 *   if (esser.enable)   x = EsserProcess(x)
 *   if (dist.enable)    distProcess(x -> outR); x = outR
 *   x *= pipe.gain      (vocalLevelDb as linear gain, in place)
 *   outL = outR = x
 *
 * Pure TypeScript, no DOM/Web Audio, so it runs in Node and in an
 * AudioWorkletGlobalScope.
 */
import { Compressor, FRAME, dB2line, type CompressorParams } from './compressor'
import { Deesser, type DeesserParams } from './deesser'
import { EQ_MAX_BANDS, Equalizer, type EqBandParams } from './eq'
import { Distortion, type DistortionParams } from './exciter'
import { f } from './f32'
import { Loudness, type LufsParams } from './loudness'
import { iosSetterCalls, type PresetTemplate } from './presets'

export { FRAME }

export interface ConfigureOptions {
  /**
   * De-esser range. 'ios' reproduces cmsis_api_ios, whose set_esser drops the
   * range argument (the params block keeps 0, so the stage is a near-identity
   * peaking filter). 'preset' uses the template's range like the Android
   * library. A number forces that range in dB.
   */
  esserRange?: 'ios' | 'preset' | number
}

/** Low-level emulation of one cmsis_api instance. Method names follow the C API. */
export class CmsisEmulator {
  pipeGain = 1
  channelEnable = true
  readonly eq = new Equalizer()
  compParams: CompressorParams = { enable: false, thresholdDb: 0, ratio: 1, attackMs: 0, releaseMs: 0, gainDb: 0, knee: 0, holdMs: 0, rangeDb: 0 }
  readonly comp = new Compressor()
  esserParams: DeesserParams = { enable: false, freqL: 0, freqH: 0, thresholdDb: 0, range: 0 }
  readonly esser = new Deesser()
  distParams: DistortionParams = { enable: false, type: 0, airfreshWet: 0, gruWet: 0 }
  readonly dist = new Distortion()
  /**
   * cmsis_set_distortion's `static int dist_init_flag` (bss 0x242a0): distInit
   * runs on the first call per library load only. It sits just past the
   * context that cmsis_init/cmsis_deinit zero, so neither resets it; one
   * emulator instance stands for one library load.
   */
  private distInitDone = false
  lufsEnable = false
  lufsTarget = 0
  lufsParams: LufsParams = { time: 3, scale: 3, alpha: f(0.7), targetLoud: -6 }
  readonly lufs = new Loudness()
  /** If false (iOS), setEsser ignores its range argument. */
  storeEsserRange = false

  private readonly work = new Float32Array(FRAME)
  private readonly outR = new Float32Array(FRAME)

  constructor() {
    this.init()
  }

  /** cmsis_init: params_init + IIR_coef_init. Stage states are set up by the setters. */
  init(): void {
    this.eq.paramsInit()
    this.eq.init()
  }

  /** cmsis_default_configs (0xdd28). Resets every stage. */
  defaultConfigs(): void {
    this.pipeGain = dB2line(0)
    this.channelEnable = true
    this.eq.paramsInit()
    const b = (enable: boolean, filterType: number, gain: number, f0: number, q: number): EqBandParams => ({ enable, filterType, gain: f(gain), f0: f(f0), q: f(q) })
    const bands = [
      b(true, 2, 2, 300, 1),
      b(false, 4, 2, 5220, 1),
      b(false, 1, -2.9, 1136.6, 2),
      b(true, 5, -2, 1200, 1),
      b(false, 6, 1, 3200, 1),
      b(false, 7, 1, 6400, 1),
      b(false, 2, 1, 12800, 1),
    ]
    for (let i = 0; i < EQ_MAX_BANDS; i++) this.eq.bands[i] = bands[i] ?? b(false, 6, 1, 20000, 0.7)
    this.eq.init()
    this.compParams = { enable: true, thresholdDb: -30, ratio: 4, attackMs: 1, releaseMs: 1, gainDb: 0, knee: 0, holdMs: 0, rangeDb: -60 }
    this.comp.init()
    this.comp.update(this.compParams)
    // range (params offset 0x10) is not written here
    this.esserParams = { ...this.esserParams, enable: true, freqL: f(8128.5), freqH: 5500, thresholdDb: -40 }
    this.esser.init()
    this.esser.update(this.esserParams)
    this.distParams = { enable: true, type: 1, airfreshWet: 0.5, gruWet: 0.5 }
    this.dist.init()
    this.dist.update(this.distParams)
    this.lufsParams = { time: 3, scale: 3, alpha: f(0.7), targetLoud: -6 }
    this.lufs.init(this.lufsParams)
    this.lufsEnable = false
  }

  setPipeParams(vocalLevelDb: number, channelEnable: boolean): void {
    this.pipeGain = dB2line(vocalLevelDb)
    this.channelEnable = !!channelEnable
  }

  setEqBand(index: number, enable: boolean, filterType: number, gainDb: number, f0Hz: number, q: number): void {
    this.eq.setBand(index, { enable, filterType, gain: gainDb, f0: f0Hz, q })
  }

  setCompressor(enable: boolean, thresholdDb: number, ratio: number, attackMs: number, releaseMs: number, gainDb: number, knee: number, holdMs: number, rangeDb: number): void {
    this.compParams = { enable: !!enable, thresholdDb: f(thresholdDb), ratio: f(ratio), attackMs: attackMs | 0, releaseMs: releaseMs | 0, gainDb: f(gainDb), knee: f(knee), holdMs: f(holdMs), rangeDb: f(rangeDb) }
    this.comp.update(this.compParams)
  }

  setEsser(enable: boolean, freqL: number, freqH: number, thresholdDb: number, range: number): void {
    this.esserParams = {
      enable: !!enable,
      freqL: f(freqL),
      freqH: f(freqH),
      thresholdDb: f(thresholdDb),
      range: this.storeEsserRange ? f(range) : this.esserParams.range,
    }
    this.esser.update(this.esserParams)
  }

  /** Writes the params block's range field directly (what the iOS API cannot do). */
  setEsserParamRange(range: number): void {
    this.esserParams = { ...this.esserParams, range: f(range) }
    this.esser.update(this.esserParams)
  }

  setDistortion(enable: boolean, _inputGainDb: number, _outputGainDb: number, type: number, airfreshWet: number, gruWet: number): void {
    if (!this.distInitDone) {
      this.dist.init()
      this.distInitDone = true
    }
    this.distParams = { enable: !!enable, type: type | 0, airfreshWet: f(airfreshWet), gruWet: f(gruWet) }
    this.dist.update(this.distParams)
  }

  setLufs(enable: boolean, targetLoudDb: number): void {
    this.lufsEnable = !!enable
    this.lufsTarget = f(targetLoudDb)
  }

  /** cmsis_get_eq_coefficients: b0 b1 b2 a1 a2 per enabled band, plus the stage count. */
  getEqCoefficients(): { numStages: number; coeffs: Float32Array } {
    return { numStages: this.eq.numStages, coeffs: this.eq.rCoeffs.slice(0, this.eq.numStages * 5) }
  }

  /** cmsis_process_frame. `input` is not modified (the native EQ works in place on it). */
  processFrame(input: Float32Array, outL: Float32Array, outR?: Float32Array): void {
    if (!this.channelEnable) {
      outL.fill(0, 0, FRAME)
      outR?.fill(0, 0, FRAME)
      return
    }
    const w = this.work
    w.set(input.subarray(0, FRAME))
    this.chain(w, outL, outR)
  }

  private chain(w: Float32Array, outL: Float32Array, outR?: Float32Array): void {
    let x: Float32Array = w
    if (this.eq.numStages) this.eq.process(w, FRAME)
    if (this.compParams.enable) x = this.comp.process(x)
    if (this.esserParams.enable) x = this.esser.process(x)
    if (this.distParams.enable) {
      this.dist.process(x, this.outR, FRAME)
      x = this.outR
    }
    const g = this.pipeGain
    for (let i = 0; i < FRAME; i++) x[i] = f(x[i] * g)
    outL.set(x.subarray(0, FRAME))
    if (outR && outR !== x) outR.set(x.subarray(0, FRAME))
  }

  /**
   * cmsis_process_wav's sample loop (0xe4d8) on already-decoded mono samples:
   * whole 240-sample frames only (the tail is dropped), LUFS pre-gain before
   * the chain and division by the frame's last gain after it. Returns
   * interleaved stereo. WAV parsing and int16 conversion are not emulated.
   */
  processWavSamples(input: Float32Array): Float32Array {
    const frames = input.length > FRAME ? Math.floor((input.length - FRAME - 1) / FRAME) + 1 : 0
    const out = new Float32Array(Math.max(0, input.length) * 2)
    const L = new Float32Array(FRAME)
    const R = new Float32Array(FRAME)
    for (let k = 0; k < frames; k++) {
      const start = k * FRAME
      if (this.channelEnable) {
        this.eq.update()
        this.comp.update(this.compParams)
        this.esser.update(this.esserParams)
        this.dist.update(this.distParams)
        const w = this.work
        for (let i = 0; i < FRAME; i++) w[i] = this.lufs.step(input[start + i])
        this.chain(w, L, R)
      }
      for (let i = 0; i < FRAME; i++) {
        let l = L[i], r = R[i]
        const norm = this.lufs.gainOut > f(1e-8) ? this.lufs.gainOut : 1
        if (norm > f(1e-8)) {
          l = f(l / norm)
          r = f(r / norm)
        }
        out[2 * (start + i)] = l
        out[2 * (start + i) + 1] = r
      }
    }
    return out
  }
}

/**
 * High-level processor used by the web app: configure with a template the
 * way the iOS app does, then feed 240-sample mono frames.
 */
export class VoiceProcessor {
  readonly native = new CmsisEmulator()
  private template: PresetTemplate | null = null
  private options: ConfigureOptions = {}
  private readonly scratchR = new Float32Array(FRAME)

  static readonly FRAME = FRAME

  configure(template: PresetTemplate, options: ConfigureOptions = {}): void {
    this.template = template
    this.options = options
    const n = this.native
    const calls = iosSetterCalls(template)
    n.defaultConfigs()
    n.setCompressor(...calls.compressor)
    n.setDistortion(...calls.distortion)
    for (const b of calls.eqBands) n.setEqBand(...b)
    const range = options.esserRange ?? 'ios'
    // The params block's range field as a fresh iOS process has it (0), the
    // template's value (Android behaviour) or a forced value. EsserUpdate
    // copies it into the de-esser state during setEsser.
    n.esserParams.range = f(range === 'ios' ? 0 : range === 'preset' ? calls.esser[4] : range)
    n.setEsser(...calls.esser)
    n.setPipeParams(...calls.pipe)
    n.setLufs(...calls.lufs)
  }

  /** Clears all filter/dynamics state by re-applying the current template. */
  reset(): void {
    if (this.template) this.configure(this.template, this.options)
    else this.native.defaultConfigs()
  }

  processFrame(input: Float32Array, output: Float32Array): void {
    this.native.processFrame(input, output, this.scratchR)
  }
}
