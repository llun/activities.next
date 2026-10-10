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
  // Rounded on the magnitude so +x and -x scale to opposite values;
  // Math.round alone sends -2.5 to -2 but 2.5 to 3.
  const scaled = (Math.abs(value) * strength) / 100
  const magnitude =
    key === 'exposure' ? Math.round(scaled * 100) / 100 : Math.round(scaled)
  const rounded = Math.sign(value) * magnitude
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

/** A mask's own adjustments from before a suggestion, by mask id. */
export type EnhanceBase = Record<string, MaskAdjustments>

/**
 * The adjustments of the masks a suggestion can change (the first subject and
 * its background) as they are now. A style with nothing for a mask puts these
 * back, so switching style never leaves the previous style's mask values on
 * the photo.
 */
export const getEnhanceBase = (recipe: Recipe): EnhanceBase => {
  const base: EnhanceBase = {}
  const subject = getEnhanceSubject(recipe)
  if (!subject) return base
  base[subject.id] = { ...subject.adjustments }
  const background = getBackgroundOf(recipe, subject.id)
  if (background) base[background.id] = { ...background.adjustments }
  return base
}

/**
 * The recipe with one suggested style applied at `strength`.
 *
 * The global light, colour and detail sliders are replaced by the scaled
 * values (the keys the style leaves out go back to neutral); Effects
 * (vignette) and the geometry are left alone. Subject and background values
 * apply only when the recipe already has a subject mask: the subject values to
 * that mask, the background values to the background mask that follows it, when
 * there is one. A style that has no values for a mask (null) puts back what
 * the mask had in `base` (taken before the suggestion), or leaves it as it is
 * without a base. No mask is ever created here.
 */
export const applyEnhance = (
  recipe: Recipe,
  style: AiStyle,
  strength: number,
  base?: EnhanceBase
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
  const forMask = (
    mask: Recipe['masks'][number],
    values: AiMaskAdjustments | null
  ) => {
    if (values) {
      return {
        ...mask,
        adjustments: scaleAll<MaskAdjustments>(values, maskKeys, strength)
      }
    }
    const before = base?.[mask.id]
    return before ? { ...mask, adjustments: { ...before } } : mask
  }
  const masks = recipe.masks.map((mask) => {
    if (subject && mask.id === subject.id) return forMask(mask, style.subject)
    if (background && mask.id === background.id) {
      return forMask(mask, style.background)
    }
    return mask
  })

  return { ...recipe, adjustments, masks }
}

const hasValues = (values: AiMaskAdjustments | null) =>
  Boolean(values && Object.keys(values).length > 0)

/** Whether a style has background values to apply. */
export const hasBackgroundValues = (style: AiStyle): boolean =>
  hasValues(style.background)

/** Whether a style has subject or background values to apply. */
export const hasMaskValues = (style: AiStyle): boolean =>
  hasValues(style.subject) || hasValues(style.background)
