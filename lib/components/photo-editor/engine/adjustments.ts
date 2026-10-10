import type { Adjustments } from '@/lib/services/medias/edit/recipe'

import {
  BLACKS_RANGE,
  CLARITY_GAIN,
  MIN_LUMA,
  type Rgb,
  TEXTURE_GAIN,
  TONE_HIGHLIGHT_EDGE,
  TONE_SHADOW_EDGE,
  TONE_STRENGTH,
  VIGNETTE_END,
  VIGNETTE_START,
  VIGNETTE_STRENGTH,
  WB_TEMPERATURE_GAIN,
  WB_TINT_GAIN,
  WHITES_RANGE,
  clamp,
  linearToSrgb,
  luma,
  smoothstep,
  srgbToLinear
} from './colour'

/**
 * What the shader reads around a pixel. The CPU reference takes the same
 * values so a test can check it against the GLSL by construction.
 */
export interface PixelContext {
  /** Wide blur of the perceptual luma (sRGB encoded): highlights / shadows. */
  tone: number
  /** Mid blur of the perceptual luma (sRGB encoded): clarity. */
  mid: number
  /** Gaussian 5x5 average of the raw sRGB neighbourhood: texture. */
  fine: Rgb
  /** Output position, 0..1 on both axes, for the vignette. */
  uv: [number, number]
}

interface Normalized {
  temperature: number
  tint: number
  exposure: number
  whites: number
  blacks: number
  shadows: number
  highlights: number
  contrast: number
  texture: number
  clarity: number
  saturation: number
  vibrance: number
  vignette: number
}

const normalize = (adjustments: Adjustments): Normalized => ({
  temperature: (adjustments.temperature ?? 0) / 100,
  tint: (adjustments.tint ?? 0) / 100,
  exposure: adjustments.exposure ?? 0,
  whites: (adjustments.whites ?? 0) / 100,
  blacks: (adjustments.blacks ?? 0) / 100,
  shadows: (adjustments.shadows ?? 0) / 100,
  highlights: (adjustments.highlights ?? 0) / 100,
  contrast: (adjustments.contrast ?? 0) / 100,
  texture: (adjustments.texture ?? 0) / 100,
  clarity: (adjustments.clarity ?? 0) / 100,
  saturation: (adjustments.saturation ?? 0) / 100,
  vibrance: (adjustments.vibrance ?? 0) / 100,
  vignette: (adjustments.vignette ?? 0) / 100
})

const lumaOf = (p: Rgb) => luma(p[0], p[1], p[2])

/**
 * Scales a colour so its luma becomes `y`, keeping hue. The largest channel
 * may not exceed max(1, the largest channel before).
 */
const scaleLuma = (p: Rgb, y: number): Rgb => {
  const scale = Math.max(y, 0) / Math.max(lumaOf(p), MIN_LUMA)
  const scaled: Rgb = [p[0] * scale, p[1] * scale, p[2] * scale]
  const cap = Math.max(1, p[0], p[1], p[2])
  const largest = Math.max(scaled[0], scaled[1], scaled[2])
  if (largest > cap) {
    const k = cap / largest
    return [scaled[0] * k, scaled[1] * k, scaled[2] * k]
  }
  return scaled
}

/** Levels end points (step 5). */
const levels = (n: Normalized) => {
  const wp = 1 - WHITES_RANGE * n.whites
  const bp = -BLACKS_RANGE * n.blacks
  return { wp, bp }
}

/** The tone blur sample put through steps 2-5 on its luma. */
export const toneSample = (tone: number, adjustments: Adjustments): number => {
  const n = normalize(adjustments)
  const { wp, bp } = levels(n)
  // White balance leaves a grey's luma alone, so only exposure and levels act.
  const p = linearToSrgb(srgbToLinear(tone) * Math.pow(2, n.exposure))
  return (p - bp) / (wp - bp)
}

/** Steps 1-7: white balance, exposure, levels, tone, contrast. */
const toStep7 = (rgb: Rgb, n: Normalized, T: number): Rgb => {
  // 2. White balance, brightness held.
  let gR = 1 + WB_TEMPERATURE_GAIN * n.temperature
  let gG = 1 - WB_TINT_GAIN * n.tint
  let gB = 1 - WB_TEMPERATURE_GAIN * n.temperature
  const gain = luma(gR, gG, gB)
  gR /= gain
  gG /= gain
  gB /= gain
  // 1, 3, 4. Linear light, exposure, back to sRGB without an upper clamp.
  const exposure = Math.pow(2, n.exposure)
  let p: Rgb = [
    linearToSrgb(srgbToLinear(rgb[0]) * gR * exposure),
    linearToSrgb(srgbToLinear(rgb[1]) * gG * exposure),
    linearToSrgb(srgbToLinear(rgb[2]) * gB * exposure)
  ]
  // 5. Levels.
  const { wp, bp } = levels(n)
  p = [
    (p[0] - bp) / (wp - bp),
    (p[1] - bp) / (wp - bp),
    (p[2] - bp) / (wp - bp)
  ]
  // 6. Tone.
  const ws = 1 - smoothstep(0, TONE_SHADOW_EDGE, T)
  const wh = smoothstep(TONE_HIGHLIGHT_EDGE, 1, T)
  const Y = lumaOf(p)
  const y1 =
    Y +
    TONE_STRENGTH * n.shadows * ws * (n.shadows > 0 ? clamp(1 - Y, 0, 1) : Y)
  const y2 =
    y1 +
    TONE_STRENGTH *
      n.highlights *
      wh *
      (n.highlights > 0 ? clamp(1 - y1, 0, 1) : y1)
  p = scaleLuma(p, y2)
  // 7. Clamp, then contrast around the S curve.
  p = [clamp(p[0], 0, 1), clamp(p[1], 0, 1), clamp(p[2], 0, 1)]
  const curve = (x: number) => x * x * (3 - 2 * x)
  const c = n.contrast
  const mixed = (x: number) =>
    c >= 0 ? x + (curve(x) - x) * c : x + (2 * x - curve(x) - x) * -c
  return [mixed(p[0]), mixed(p[1]), mixed(p[2])]
}

/**
 * CPU reference of the shader (§2.3) for one pixel. `rgb` is sRGB in 0..1;
 * the result is sRGB clamped to 0..1.
 */
export const applyAdjustments = (
  rgb: Rgb,
  adjustments: Adjustments,
  context: PixelContext
): Rgb => {
  const n = normalize(adjustments)
  const T = toneSample(context.tone, adjustments)

  // Steps 1-7 on the pixel, on its fine neighbourhood and on the mid blur.
  let p = toStep7(rgb, n, T)
  const fine = toStep7(context.fine, n, T)
  const mid = toStep7([context.mid, context.mid, context.mid], n, T)

  // 8. Detail.
  const Y = lumaOf(p)
  const detailFine = Y - lumaOf(fine)
  const detailMid = Y - lumaOf(mid)
  const d =
    TEXTURE_GAIN * n.texture * detailFine +
    CLARITY_GAIN * n.clarity * detailMid * (1 - (2 * Y - 1) * (2 * Y - 1))
  p = scaleLuma(p, Y + d)

  // 9. Saturation, then vibrance.
  const Ys = lumaOf(p)
  p = [
    Ys + (p[0] - Ys) * (1 + n.saturation),
    Ys + (p[1] - Ys) * (1 + n.saturation),
    Ys + (p[2] - Ys) * (1 + n.saturation)
  ]
  const chroma = Math.max(...p) - Math.min(...p)
  const amount = n.vibrance > 0 ? n.vibrance * (1 - chroma) : n.vibrance
  const Yv = lumaOf(p)
  p = [
    Yv + (p[0] - Yv) * (1 + amount),
    Yv + (p[1] - Yv) * (1 + amount),
    Yv + (p[2] - Yv) * (1 + amount)
  ]

  // 10. Vignette, in linear light.
  const dx = (context.uv[0] - 0.5) / 0.5
  const dy = (context.uv[1] - 0.5) / 0.5
  const r = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2
  const v = smoothstep(VIGNETTE_START, VIGNETTE_END, r)
  const vignette = Math.pow(2, VIGNETTE_STRENGTH * n.vignette * v)
  if (vignette !== 1) {
    p = [
      linearToSrgb(srgbToLinear(p[0]) * vignette),
      linearToSrgb(srgbToLinear(p[1]) * vignette),
      linearToSrgb(srgbToLinear(p[2]) * vignette)
    ]
  }

  // 11. Clamp.
  return [clamp(p[0], 0, 1), clamp(p[1], 0, 1), clamp(p[2], 0, 1)]
}
