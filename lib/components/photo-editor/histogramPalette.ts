// Fixed colours for the photo editor histogram. The channels must stay true
// red, green and blue in both themes, and the frame must stay dark for the
// additive `screen` blending to read the standard way, so none of these come
// from the theme tokens. The surface-kit guard
// (`lib/components/surface/surfaceKitUsage.test.ts`) skips exactly this file.

/** The frame, as a background utility. */
export const HISTOGRAM_FRAME_CLASS = 'bg-neutral-900'

export const CHANNEL_COLOURS = {
  r: 'rgb(235, 64, 64)',
  g: 'rgb(64, 214, 96)',
  b: 'rgb(64, 128, 255)'
} as const

export const CHANNEL_FILL_OPACITY = 0.75
export const LUMA_STROKE = 'rgba(255, 255, 255, 0.6)'
export const GUIDE_STROKE = 'rgba(255, 255, 255, 0.08)'

export const CLIP_OFF_COLOUR = 'rgba(255, 255, 255, 0.2)'
export const CLIP_ON_LEVEL = 240
export const CLIP_DIM_LEVEL = 32
