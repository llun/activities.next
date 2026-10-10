import { z } from 'zod'

// What the vision model may answer for AI enhance, and the limits that keep a
// suggestion from wrecking a photo. Only zod is imported, so the browser and
// the route share these definitions.

export const ENHANCE_STYLES = ['natural', 'vivid', 'dramatic'] as const
export type EnhanceStyle = (typeof ENHANCE_STYLES)[number]

export const ENHANCE_MAX_EXPOSURE = 1.5
export const ENHANCE_MAX_STEP = 60
export const ENHANCE_MAX_WARMTH = 30

const step = () =>
  z.number().int().min(-ENHANCE_MAX_STEP).max(ENHANCE_MAX_STEP).optional()
const warmth = () =>
  z.number().int().min(-ENHANCE_MAX_WARMTH).max(ENHANCE_MAX_WARMTH).optional()

// No style has a vignette: a mask has none, and the prompt never asks for one
// globally (the editor leaves Effects to the person), so an answer that
// carries one fails the strict parse like any other unknown key.
const MaskAiAdjustments = z.strictObject({
  exposure: z
    .number()
    .min(-ENHANCE_MAX_EXPOSURE)
    .max(ENHANCE_MAX_EXPOSURE)
    .optional(),
  contrast: step(),
  highlights: step(),
  shadows: step(),
  whites: step(),
  blacks: step(),
  temperature: warmth(),
  tint: warmth(),
  vibrance: step(),
  saturation: step(),
  texture: step(),
  clarity: step()
})
export type AiMaskAdjustments = z.infer<typeof MaskAiAdjustments>

export const AiAdjustments = MaskAiAdjustments
export type AiAdjustments = z.infer<typeof AiAdjustments>

export const AiStyle = z.strictObject({
  global: AiAdjustments,
  subject: MaskAiAdjustments.nullable(),
  background: MaskAiAdjustments.nullable()
})
export type AiStyle = z.infer<typeof AiStyle>

export const AiSuggestion = z.strictObject({
  natural: AiStyle,
  vivid: AiStyle,
  dramatic: AiStyle
})
export type AiSuggestion = z.infer<typeof AiSuggestion>

/** The 200 answer of `POST /api/v1/media/:id/edit/enhance`. */
export type EnhanceResponse = AiSuggestion & { model: string }

const FENCE = /^```[a-zA-Z0-9]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/

/**
 * Reads the model's answer strictly: one optional json code fence is removed,
 * the rest must be a JSON object with exactly the three styles and the keys
 * above, each inside its range. Anything else (chatter, an extra key, a value
 * out of range) is null; a suggestion is applied whole or not at all.
 */
export const parseEnhanceAnswer = (text: string): AiSuggestion | null => {
  const trimmed = text.trim()
  const fenced = FENCE.exec(trimmed)
  let json: unknown
  try {
    json = JSON.parse(fenced ? fenced[1].trim() : trimmed)
  } catch {
    return null
  }
  const parsed = AiSuggestion.safeParse(json)
  return parsed.success ? parsed.data : null
}
