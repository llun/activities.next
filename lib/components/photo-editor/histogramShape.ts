import type { Histogram } from './engine/histogram'
import {
  CLIP_DIM_LEVEL,
  CLIP_OFF_COLOUR,
  CLIP_ON_LEVEL
} from './histogramPalette'

export const HISTOGRAM_WIDTH = 256
export const HISTOGRAM_HEIGHT = 80

/** A channel counts as clipped when more than this fraction of pixels is 0 or 255. */
export const CLIP_THRESHOLD = 0.001

export type ClipChannels = { r: boolean; g: boolean; b: boolean }

/** Light [1,2,1] smoothing; the first and last bin stay raw so clipping is not smeared. */
export const smoothBins = (bins: number[]): number[] =>
  bins.map((value, index) =>
    index === 0 || index === bins.length - 1
      ? value
      : (bins[index - 1] + 2 * value + bins[index + 1]) / 4
  )

/** Tallest inner (non end) bin across the series, at least 1. */
export const innerPeak = (series: number[][]): number =>
  Math.max(1, ...series.flatMap((bins) => bins.slice(1, -1)))

/** Square-root scale to 0..1; values above the peak saturate. */
export const sqrtScale = (value: number, peak: number): number =>
  Math.sqrt(Math.min(1, Math.max(0, value) / peak))

const points = (bins: number[], peak: number) => {
  const step = HISTOGRAM_WIDTH / bins.length
  return bins.map((value, index) => {
    const y = HISTOGRAM_HEIGHT - sqrtScale(value, peak) * (HISTOGRAM_HEIGHT - 2)
    return `${((index + 0.5) * step).toFixed(1)} ${y.toFixed(1)}`
  })
}

/** Closed area through the bin centres, anchored at the bottom corners. */
export const buildAreaPath = (bins: number[], peak: number): string =>
  `M0 ${HISTOGRAM_HEIGHT} L${points(bins, peak).join(' L')} L${HISTOGRAM_WIDTH} ${HISTOGRAM_HEIGHT} Z`

/** Open polyline through the bin centres. */
export const buildLinePath = (bins: number[], peak: number): string =>
  `M${points(bins, peak).join(' L')}`

export interface HistogramShape {
  r: string
  g: string
  b: string
  luma: string
}

export const buildHistogramShape = (data: Histogram): HistogramShape => {
  const r = smoothBins(data.r)
  const g = smoothBins(data.g)
  const b = smoothBins(data.b)
  const luma = smoothBins(data.luma)
  const peak = innerPeak([r, g, b, luma])
  return {
    r: buildAreaPath(r, peak),
    g: buildAreaPath(g, peak),
    b: buildAreaPath(b, peak),
    luma: buildLinePath(luma, peak)
  }
}

export const clippedChannels = (
  counts: { r: number; g: number; b: number },
  total: number
): ClipChannels => ({
  r: total > 0 && counts.r / total > CLIP_THRESHOLD,
  g: total > 0 && counts.g / total > CLIP_THRESHOLD,
  b: total > 0 && counts.b / total > CLIP_THRESHOLD
})

/** Additive colour of the clipping channels, or the dim grey when none clip. */
export const clipColour = (channels: ClipChannels): string => {
  if (!channels.r && !channels.g && !channels.b) return CLIP_OFF_COLOUR
  const level = (on: boolean) => (on ? CLIP_ON_LEVEL : CLIP_DIM_LEVEL)
  return `rgb(${level(channels.r)}, ${level(channels.g)}, ${level(channels.b)})`
}
