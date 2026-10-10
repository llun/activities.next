import {
  ENHANCE_MAX_EXPOSURE,
  ENHANCE_MAX_STEP,
  ENHANCE_MAX_WARMTH
} from './enhanceSchema'

// The prompts for AI enhance. The model is asked for JSON only; whatever it
// answers is parsed strictly by `parseEnhanceAnswer` and never trusted.

const SHARED_KEYS = [
  `"exposure" (EV, a number from -${ENHANCE_MAX_EXPOSURE} to ${ENHANCE_MAX_EXPOSURE}, two decimals at most)`,
  `"contrast", "highlights", "shadows", "whites", "blacks", "vibrance", "saturation", "texture", "clarity" (whole numbers from -${ENHANCE_MAX_STEP} to ${ENHANCE_MAX_STEP})`,
  `"temperature", "tint" (whole numbers from -${ENHANCE_MAX_WARMTH} to ${ENHANCE_MAX_WARMTH}; positive temperature is warmer, positive tint is more magenta)`
]

export const ENHANCE_SYSTEM_PROMPT = [
  'You are a careful photo editor. You look at one photograph and suggest slider changes that improve it, in three styles: "natural" (subtle and faithful to the scene), "vivid" (richer colour and contrast) and "dramatic" (strong tonal contrast and mood).',
  'Answer with a single JSON object and nothing else: no prose, no markdown, no code fence.',
  'The object has exactly three keys, "natural", "vivid" and "dramatic". Each is an object with exactly three keys:',
  '"global": the changes for the whole photo;',
  '"subject": the changes for the main subject only, or null when the photo has no distinct subject;',
  '"background": the changes for everything except the main subject, or null when the photo has no distinct subject.',
  `Each of those holds only the keys it changes, from this list: ${SHARED_KEYS.join('; ')}. Leave out a key to leave that slider alone. Never use any other key.`,
  'Be conservative: fix what is wrong (exposure, white balance, flat contrast) and keep the look of the scene. A value of 0 or a missing key means no change.'
].join('\n')

export const ENHANCE_USER_PROMPT =
  'Suggest slider changes for this photo in the three styles, as the JSON object described.'

export const ENHANCE_MAX_TOKENS = 600
