import { linearToSrgb, luma, srgbToLinear } from './colour'

/** Statistics Auto reads. All luma values are perceptual (sRGB encoded). */
export interface ImageStats {
  /** Mean luma in linear light. */
  meanLinear: number
  /** Luma percentiles. */
  p005: number
  p995: number
  /** Standard deviation of the perceptual luma. */
  sd: number
  /** Fraction of pixels with luma >= 0.92 / <= 0.08. */
  fractionHigh: number
  fractionLow: number
  /** Mean sRGB channels of the midtones (0.2 <= luma <= 0.8). */
  midtone: { r: number; g: number; b: number }
  /** Mean of max(rgb) - min(rgb), sRGB. */
  meanChroma: number
}

export interface Histogram {
  bins: number
  r: number[]
  g: number[]
  b: number[]
  luma: number[]
}

const LINEAR_LUT = (() => {
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i += 1) lut[i] = srgbToLinear(i / 255)
  return lut
})()

const PERCENTILE_BINS = 4096

const perceptual = (r: number, g: number, b: number) =>
  Math.min(
    1,
    Math.max(0, linearToSrgb(luma(LINEAR_LUT[r], LINEAR_LUT[g], LINEAR_LUT[b])))
  )

const percentile = (bins: Uint32Array, total: number, fraction: number) => {
  const target = fraction * total
  let seen = 0
  for (let i = 0; i < bins.length; i += 1) {
    seen += bins[i]
    if (seen >= target) return (i + 0.5) / bins.length
  }
  return 1
}

/** Statistics over RGBA8 pixels (alpha is ignored). */
export const computeStats = (
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): ImageStats => {
  const count = width * height
  const bins = new Uint32Array(PERCENTILE_BINS)
  let sumLinear = 0
  let sumY = 0
  let sumYSquared = 0
  let high = 0
  let low = 0
  let midCount = 0
  let midR = 0
  let midG = 0
  let midB = 0
  let chroma = 0

  for (let i = 0; i < count; i += 1) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    sumLinear += luma(LINEAR_LUT[r], LINEAR_LUT[g], LINEAR_LUT[b])
    const y = perceptual(r, g, b)
    bins[Math.min(PERCENTILE_BINS - 1, Math.floor(y * PERCENTILE_BINS))] += 1
    sumY += y
    sumYSquared += y * y
    if (y >= 0.92) high += 1
    if (y <= 0.08) low += 1
    if (y >= 0.2 && y <= 0.8) {
      midCount += 1
      midR += r
      midG += g
      midB += b
    }
    chroma += Math.max(r, g, b) - Math.min(r, g, b)
  }

  if (count === 0) {
    return {
      meanLinear: 0,
      p005: 0,
      p995: 0,
      sd: 0,
      fractionHigh: 0,
      fractionLow: 0,
      midtone: { r: 0, g: 0, b: 0 },
      meanChroma: 0
    }
  }

  const meanY = sumY / count
  const variance = Math.max(0, sumYSquared / count - meanY * meanY)
  const midDivisor = midCount > 0 ? midCount * 255 : 1
  return {
    meanLinear: sumLinear / count,
    p005: percentile(bins, count, 0.005),
    p995: percentile(bins, count, 0.995),
    sd: Math.sqrt(variance),
    fractionHigh: high / count,
    fractionLow: low / count,
    midtone: {
      r: midR / midDivisor,
      g: midG / midDivisor,
      b: midB / midDivisor
    },
    meanChroma: chroma / count / 255
  }
}

/** Per channel and luma counts over `bins` buckets (default 64). */
export const computeHistogram = (
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  bins = 64
): Histogram => {
  const result: Histogram = {
    bins,
    r: new Array<number>(bins).fill(0),
    g: new Array<number>(bins).fill(0),
    b: new Array<number>(bins).fill(0),
    luma: new Array<number>(bins).fill(0)
  }
  const scale = bins / 256
  const count = width * height
  for (let i = 0; i < count; i += 1) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    result.r[Math.floor(r * scale)] += 1
    result.g[Math.floor(g * scale)] += 1
    result.b[Math.floor(b * scale)] += 1
    const y = perceptual(r, g, b)
    result.luma[Math.min(bins - 1, Math.floor(y * bins))] += 1
  }
  return result
}
