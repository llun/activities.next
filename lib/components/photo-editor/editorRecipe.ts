import {
  type Adjustments,
  type Geometry,
  NEUTRAL_RECIPE,
  type Recipe,
  isNeutralRecipe,
  normalizeRecipe
} from '@/lib/services/medias/edit/recipe'

/** Key order independent JSON, so two equal recipes compare equal. */
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const recipesEqual = (a: Recipe, b: Recipe): boolean =>
  stable(normalizeRecipe(a)) === stable(normalizeRecipe(b))

/**
 * True when two recipes render the same pixels. The aspect label (and its
 * orientation) is UI state: picking 1:1 and then Original leaves the crop
 * alone, so it is not a change to save.
 */
export const recipesRenderEqual = (a: Recipe, b: Recipe): boolean => {
  const strip = (recipe: Recipe): Recipe => {
    const {
      aspectPortrait: _portrait,
      aspect: _aspect,
      ...geometry
    } = normalizeRecipe(recipe).geometry
    return {
      ...normalizeRecipe(recipe),
      geometry: { ...geometry, aspect: 'original' }
    }
  }
  return stable(strip(a)) === stable(strip(b))
}

export const withAdjustments = (
  recipe: Recipe,
  adjustments: Adjustments
): Recipe => ({ ...recipe, adjustments })

export const withGeometry = (recipe: Recipe, geometry: Geometry): Recipe => ({
  ...recipe,
  geometry
})

/** Sets one slider; 0 removes the key (a missing key and 0 are the same). */
export const setAdjustment = (
  recipe: Recipe,
  key: keyof Adjustments,
  value: number
): Recipe => {
  const adjustments = { ...recipe.adjustments }
  if (value === 0) delete adjustments[key]
  else adjustments[key] = value
  return withAdjustments(recipe, adjustments)
}

export const geometryChanged = (geometry: Geometry): boolean =>
  stable(geometry) !== stable(NEUTRAL_RECIPE.geometry)

export { isNeutralRecipe }
