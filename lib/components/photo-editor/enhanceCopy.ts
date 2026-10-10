/** The strings of the AI tab, in one place so the panels and tests agree. */
export const ENHANCE_COPY = {
  tab: 'AI',
  intro: 'Get a suggested edit for this photo, in three styles.',
  enhance: 'Enhance',
  enhancing: 'Enhancing…',
  again: 'Enhance again',
  style: 'Style',
  strength: 'Strength',
  suggestedBy: (model: string) => `Suggested by ${model}`,
  needSubject:
    'Subject and background changes apply once you select a subject in Masks.',
  needBackground:
    'Background changes apply once you add a background in Masks.',
  notApplied: 'Not applied. Pick a style to apply it again.',
  gettingSuggestion: 'Getting a suggestion',
  applied: (style: string) => `${style} suggestion applied`,
  failed: "Couldn't get a suggestion.",
  off: 'AI enhance is turned off.',
  notSetUp: "AI enhance isn't set up on this server.",
  tooMany: 'Too many suggestions. Try again later.'
} as const

export const ENHANCE_STYLE_LABELS = {
  natural: 'Natural',
  vivid: 'Vivid',
  dramatic: 'Dramatic'
} as const
