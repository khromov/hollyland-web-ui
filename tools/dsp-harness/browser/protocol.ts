/** Job and result shapes shared by browser-check.ts (Node) and the test page (main.ts). Types only. */

/** A preset change posted to the worklet while the offline context is suspended at sample `at` (a render-quantum boundary). */
export interface BrowserSwitch {
  at: number
  channel: number
  preset: string | null
}

export interface BrowserJob {
  id: string
  signal: string
  /** Initial preset per channel (null: pass through). The node has one channel per entry. */
  presets: (string | null)[]
  switches: BrowserSwitch[]
}

export interface BrowserJobResult {
  id: string
  /** Wall-clock render time in ms. */
  ms: number
  /** Latency and render quantum the processor reported (null if its message did not arrive). */
  latency: number | null
  blockSize: number | null
  /** Per switch: input samples the channel had consumed when the change applied. */
  applied: { at: number; channel: number; consumed: number }[]
  /** Rendered length per channel (input length + assumed latency). */
  length: number
  channels: number
  error?: string
}

export type RunJobs = (jobs: BrowserJob[], mode: string, concurrency: number) => Promise<BrowserJobResult[]>

/** Real-time AudioEngine smoke test (fake microphone): every step with its outcome. */
export interface EngineSmokeResult {
  ok: boolean
  steps: { step: string; ok: boolean; detail: string }[]
}

export type EngineSmoke = () => Promise<EngineSmokeResult>
