/**
 * AudioWorklet processors, shipped as source strings and loaded through a Blob
 * URL. That keeps them independent of the bundler's worker handling.
 */

/**
 * `capture-processor`: forwards copies of each input channel to the main
 * thread in ~100 ms batches while `recording` is true.
 */
const CAPTURE_SRC = /* js */ `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.batch = [];
    this.batchFrames = 0;
    this.flushFrames = Math.round(sampleRate / 10);
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.recording = true; }
      else if (e.data === 'stop') { this.flush(); this.recording = false; this.port.postMessage({ type: 'stopped' }); }
    };
  }
  flush() {
    if (!this.batch.length) return;
    const chCount = this.batch[0].length;
    const out = [];
    for (let c = 0; c < chCount; c++) {
      const buf = new Float32Array(this.batchFrames);
      let o = 0;
      for (const block of this.batch) { buf.set(block[c], o); o += block[c].length; }
      out.push(buf);
    }
    this.port.postMessage({ type: 'data', channels: out }, out.map((b) => b.buffer));
    this.batch = [];
    this.batchFrames = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (this.recording && input && input.length) {
      this.batch.push(input.map((ch) => ch.slice()));
      this.batchFrames += input[0].length;
      if (this.batchFrames >= this.flushFrames) this.flush();
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()

export function loadWorklets(ctx: BaseAudioContext): Promise<void> {
  let p = loaded.get(ctx)
  if (!p) {
    const url = URL.createObjectURL(new Blob([CAPTURE_SRC], { type: 'application/javascript' }))
    p = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url))
    loaded.set(ctx, p)
  }
  return p
}
