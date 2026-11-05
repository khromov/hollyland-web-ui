<script lang="ts">
  /**
   * Same API as before the redesign; renders a compact MeterWindow (dark window, segmented bar,
   * peak hold 1500 ms, CLIP lamp). `inactive` shows a sentence instead of an empty window.
   * New code uses MeterWindow directly (channel / strip variants, states, history, tone).
   */
  import type { ChannelTone } from './types'
  import MeterWindow from './MeterWindow.svelte'

  interface Props {
    read: () => { rmsDb: number; peakDb: number } | null
    label: string
    /** Kept for compatibility; the Instrument meter is horizontal. */
    orientation?: 'horizontal' | 'vertical'
    segments?: number
    muted?: boolean
    inactive?: boolean
    showScale?: boolean
    tone?: ChannelTone
  }

  let { read, label, segments, muted = false, inactive = false, tone = 'neutral' }: Props = $props()
</script>

<MeterWindow
  {read}
  {label}
  {tone}
  {muted}
  variant="compact"
  segments={segments ?? 'auto'}
  state={inactive ? 'nodevice' : 'live'}
  message={inactive ? (muted ? 'Muted on the mic.' : 'No signal from this mic.') : undefined}
/>
