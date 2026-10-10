// Colour maths shared by the CPU reference (`adjustments.ts`) and the GLSL
// (`shaders.ts`). Every tuning constant is a named export here and the shader
// source is built from `SHADER_CONSTANTS`, so the two cannot drift apart.
// This module has no DOM imports.

export type Rgb = [number, number, number]

// Rec. 709 luma weights, applied to linear light.
export const LUMA_R = 0.2126
export const LUMA_G = 0.7152
export const LUMA_B = 0.0722

// White balance: gain per unit of temperature / tint (slider / 100).
export const WB_TEMPERATURE_GAIN = 0.2
export const WB_TINT_GAIN = 0.15

// Levels: how far a full whites / blacks slider moves the end points.
export const WHITES_RANGE = 0.25
export const BLACKS_RANGE = 0.1

// Highlights and shadows: strength at slider = 100, and the smoothstep edges
// of the masks built from the wide blur.
export const TONE_STRENGTH = 0.5
export const TONE_SHADOW_EDGE = 0.5
export const TONE_HIGHLIGHT_EDGE = 0.5

// Detail: texture works on the fine neighbourhood, clarity on the mid blur.
export const TEXTURE_GAIN = 0.6
export const CLARITY_GAIN = 0.5

// Vignette: stops in stops of exposure at slider = 100, and the radius
// (0 at the centre, 1 at the corners) where it starts.
export const VIGNETTE_STRENGTH = 1.5
export const VIGNETTE_START = 0.3
export const VIGNETTE_END = 1

// Floor under a luma divisor.
export const MIN_LUMA = 1e-4

// Blur sigmas, as a fraction of the long edge of the low resolution frame.
export const CLARITY_BLUR_SIGMA = 0.008
export const TONE_BLUR_SIGMA = 0.03
// Long edge of the low resolution frame the blurs run on.
export const BLUR_MAX_EDGE = 1024
// Sigma, in output pixels, of the 5x5 fine detail neighbourhood.
export const FINE_DETAIL_SIGMA = 1.5

/** Constants interpolated into the GLSL as `const float NAME = value;`. */
export const SHADER_CONSTANTS = {
  LUMA_R,
  LUMA_G,
  LUMA_B,
  WB_TEMPERATURE_GAIN,
  WB_TINT_GAIN,
  WHITES_RANGE,
  BLACKS_RANGE,
  TONE_STRENGTH,
  TONE_SHADOW_EDGE,
  TONE_HIGHLIGHT_EDGE,
  TEXTURE_GAIN,
  CLARITY_GAIN,
  VIGNETTE_STRENGTH,
  VIGNETTE_START,
  VIGNETTE_END,
  MIN_LUMA,
  FINE_DETAIL_SIGMA
} as const

export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)

/** No upper clamp: values above 1 are kept so highlights can be recovered. */
export const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

/** Rec. 709 luma of the given values (linear light gives relative luminance). */
export const luma = (r: number, g: number, b: number): number =>
  LUMA_R * r + LUMA_G * g + LUMA_B * b

/** Perceptual luma of an sRGB colour: luma in linear light, sRGB encoded. */
export const perceptualLuma = (r: number, g: number, b: number): number =>
  linearToSrgb(luma(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)))

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The 5 gaussian weights of the fine detail kernel (offsets -2..2). */
export const FINE_KERNEL_1D: number[] = (() => {
  const weights = [-2, -1, 0, 1, 2].map((i) =>
    Math.exp(-(i * i) / (2 * FINE_DETAIL_SIGMA * FINE_DETAIL_SIGMA))
  )
  const total = weights.reduce((sum, w) => sum + w, 0)
  return weights.map((w) => w / total)
})()
