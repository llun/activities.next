import type {
  AiMaskAdjustments,
  AiStyle
} from '@/lib/services/medias/edit/enhanceSchema'
import type {
  Adjustments,
  MaskAdjustments,
  Recipe
} from '@/lib/services/medias/edit/recipe'

import { ADJUSTMENT_CONTROLS } from './adjustmentControls'
import { getBackgroundOf } from './masks/maskRecipe'

/** The global sliders AI enhance sets: light, colour and detail (no vignette). */
export const ENHANCE_GLOBAL_KEYS = ADJUSTMENT_CONTROLS.filter(
  (control) => control.group !== 'effects'
).map((control) => control.key)

export const DEFAULT_ENHANCE_STRENGTH = 80

/**
 * A suggested value scaled by Strength (0..100). Exposure keeps its 0.01 step;
 * every other slider is a whole number. 0 means "no change" and is dropped by
 * the callers.
 */
export const scaleEnhanceValue = (
  key: string,
  value: number,
  strength: number
): number => {
  const scaled = (value * strength) / 100
  const rounded =
    key === 'exposure' ? Math.round(scaled * 100) / 100 : Math.round(scaled)
  // `-0` would read as a change.
  return rounded === 0 ? 0 : rounded
}

const scaleAll = <T extends Adjustments | MaskAdjustments>(
  source: AiMaskAdjustments,
  keys: ReadonlyArray<string>,
  strength: number
): T => {
  const out: Record<string, number> = {}
  for (const key of keys) {
    const value = source[key as keyof AiMaskAdjustments]
    if (value === undefined) continue
    const scaled = scaleEnhanceValue(key, value, strength)
    if (scaled !== 0) out[key] = scaled
  }
  return out as T
}

/** The first subject mask, which is where the subject values go. */
export const getEnhanceSubject = (recipe: Recipe) =>
  recipe.masks.find((mask) => mask.kind === 'subject')

/**
 * The recipe with one suggested style applied at `strength`.
 *
 * The global light, colour and detail sliders are replaced by the scaled
 * values (the keys the style leaves out go back to neutral); Effects
 * (vignette) and the geometry are left alone. Subject and background values
 * apply only when the recipe already has a subject mask: the subject values to
 * that mask, the background values to the background mask that follows it, when
 * there is one. A style that has no values for a mask (null) leaves it as it
 * is. No mask is ever created here.
 */
export const applyEnhance = (
  recipe: Recipe,
  style: AiStyle,
  strength: number
): Recipe => {
  const adjustments: Adjustments = { ...recipe.adjustments }
  for (const key of ENHANCE_GLOBAL_KEYS) delete adjustments[key]
  Object.assign(
    adjustments,
    scaleAll<Adjustments>(style.global, ENHANCE_GLOBAL_KEYS, strength)
  )

  const subject = getEnhanceSubject(recipe)
  const background = subject ? getBackgroundOf(recipe, subject.id) : undefined
  const maskKeys = ENHANCE_GLOBAL_KEYS
  const masks = recipe.masks.map((mask) => {
    if (subject && mask.id === subject.id && style.subject) {
      return {
        ...mask,
        adjustments: scaleAll<MaskAdjustments>(
          style.subject,
          maskKeys,
          strength
        )
      }
    }
    if (background && mask.id === background.id && style.background) {
      return {
        ...mask,
        adjustments: scaleAll<MaskAdjustments>(
          style.background,
          maskKeys,
          strength
        )
      }
    }
    return mask
  })

  return { ...recipe, adjustments, masks }
}

/** Whether a style has subject or background values to apply. */
export const hasMaskValues = (style: AiStyle): boolean =>
  Boolean(
    (style.subject && Object.keys(style.subject).length > 0) ||
    (style.background && Object.keys(style.background).length > 0)
  )
