import type { PresetId } from './presets'

/** The strings of the Presets tab, in one place so the panels and tests agree. */
export const ENHANCE_COPY = {
  tab: 'Presets',
  intro: 'Choose a look preset to enhance this photo.',
  enhance: 'Enhance',
  again: 'Enhance again',
  reset: 'Reset look',
  style: 'Style',
  strength: 'Strength',
  suggestedBy: (model: string) => `Suggested by ${model}`,
  needSubject:
    'Subject and background changes apply once you select a subject in Masks.',
  needBackground:
    'Background changes apply once you add a background in Masks.',
  notApplied: 'Not applied. Pick a style to apply it again.',
  applied: (style: string) => `${style} suggestion applied`
} as const

export const ENHANCE_STYLE_LABELS: Record<PresetId, string> = {
  natural: 'Natural',
  vivid: 'Vivid',
  dramatic: 'Dramatic',
  warm: 'Warm',
  cool: 'Cool',
  mono: 'B&W'
} as const
