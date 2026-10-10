import { z } from 'zod'

export const RECIPE_VERSION = 1
export const MAX_MASKS = 4
export const MAX_MASK_POINTS = 32
export const MAX_OUTPUT_LONG_EDGE = 4000
export const MAX_SOURCE_PIXELS = 50_000_000
export const MAX_RECIPE_BYTES = 16 * 1024

const unit = z.number().finite().min(0).max(1)
const signed100 = z.number().int().min(-100).max(100)
const maskId = z.string().regex(/^[a-z0-9]{8}$/)

export const AspectSchema = z.enum([
  'original',
  'free',
  '1:1',
  '4:5',
  '3:2',
  '16:9'
])
export type Aspect = z.infer<typeof AspectSchema>

export const CropRectSchema = z
  .strictObject({
    x: unit,
    y: unit,
    width: z.number().finite().gt(0).max(1),
    height: z.number().finite().gt(0).max(1)
  })
  .refine((r) => r.x + r.width <= 1 + 1e-6 && r.y + r.height <= 1 + 1e-6, {
    message: 'Crop must stay inside the image'
  })
export type CropRect = z.infer<typeof CropRectSchema>

export const GeometrySchema = z.strictObject({
  // Clockwise quarter turns
  rotate90: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  flipH: z.boolean(),
  // Degrees, step 0.1, positive is clockwise
  straighten: z.number().finite().min(-45).max(45),
  // Normalized, in the oriented frame
  crop: CropRectSchema,
  aspect: AspectSchema,
  // Swaps w:h for fixed ratios
  aspectPortrait: z.boolean().optional()
})
export type Geometry = z.infer<typeof GeometrySchema>

export const AdjustmentsSchema = z.strictObject({
  // EV, step 0.01
  exposure: z.number().finite().min(-5).max(5).optional(),
  contrast: signed100.optional(),
  highlights: signed100.optional(),
  shadows: signed100.optional(),
  whites: signed100.optional(),
  blacks: signed100.optional(),
  temperature: signed100.optional(),
  tint: signed100.optional(),
  vibrance: signed100.optional(),
  saturation: signed100.optional(),
  texture: signed100.optional(),
  clarity: signed100.optional(),
  vignette: signed100.optional()
})
export type Adjustments = z.infer<typeof AdjustmentsSchema>
export type AdjustmentKey = keyof Adjustments

export const MaskAdjustmentsSchema = AdjustmentsSchema.omit({ vignette: true })
export type MaskAdjustments = z.infer<typeof MaskAdjustmentsSchema>

export const MaskPointSchema = z.strictObject({
  x: unit,
  y: unit,
  label: z.union([z.literal(0), z.literal(1)])
})
export type MaskPoint = z.infer<typeof MaskPointSchema>

export const MaskSchema = z.strictObject({
  id: maskId,
  kind: z.enum(['subject', 'background', 'brush']),
  // Required when kind is background
  of: maskId.optional(),
  // Original source space, 0..1
  points: z.array(MaskPointSchema).max(MAX_MASK_POINTS),
  feather: z.number().int().min(0).max(100),
  adjustments: MaskAdjustmentsSchema
})
export type Mask = z.infer<typeof MaskSchema>

const utf8Length = (value: string) => new TextEncoder().encode(value).length

export const RecipeSchema = z
  .strictObject({
    v: z.literal(RECIPE_VERSION),
    geometry: GeometrySchema,
    adjustments: AdjustmentsSchema,
    masks: z.array(MaskSchema).max(MAX_MASKS)
  })
  .superRefine((recipe, ctx) => {
    const seen = new Set<string>()
    const subjectIds = new Set(
      recipe.masks.filter((m) => m.kind === 'subject').map((m) => m.id)
    )
    recipe.masks.forEach((mask, index) => {
      if (seen.has(mask.id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Mask ids must be unique',
          path: ['masks', index, 'id']
        })
      }
      seen.add(mask.id)

      if (mask.kind === 'background') {
        if (!mask.of || !subjectIds.has(mask.of)) {
          ctx.addIssue({
            code: 'custom',
            message: 'A background mask must reference a subject mask',
            path: ['masks', index, 'of']
          })
        }
      } else if (mask.of !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only a background mask can set "of"',
          path: ['masks', index, 'of']
        })
      }

      if (mask.kind === 'subject') {
        if (!mask.points.some((point) => point.label === 1)) {
          ctx.addIssue({
            code: 'custom',
            message: 'A subject mask needs at least one positive point',
            path: ['masks', index, 'points']
          })
        }
      } else if (mask.points.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only a subject mask has points',
          path: ['masks', index, 'points']
        })
      }
    })

    if (utf8Length(JSON.stringify(recipe)) > MAX_RECIPE_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Recipe is larger than ${MAX_RECIPE_BYTES} bytes`
      })
    }
  })
export type Recipe = z.infer<typeof RecipeSchema>

export const NEUTRAL_RECIPE: Recipe = {
  v: RECIPE_VERSION,
  geometry: {
    rotate90: 0,
    flipH: false,
    straighten: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    aspect: 'original'
  },
  adjustments: {},
  masks: []
}

const roundTo = (value: number, step: number) => {
  const rounded = Math.round(value / step) * step
  // Trim float noise (0.30000000000000004) and avoid -0
  return Number(rounded.toFixed(6)) + 0
}

const normalizeAdjustments = <T extends Adjustments>(adjustments: T): T => {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(adjustments)) {
    if (typeof value !== 'number') continue
    const next = key === 'exposure' ? roundTo(value, 0.01) : value
    if (next !== 0) result[key] = next
  }
  return result as T
}

/**
 * Canonical form of a recipe: zero adjustments are removed (a missing key and
 * 0 both mean neutral), `exposure` is rounded to 0.01, `straighten` to 0.1,
 * and `aspectPortrait: false` is dropped. Returns a new object. The client
 * normalizes before it sends a recipe and before it compares two recipes.
 */
export const normalizeRecipe = (recipe: Recipe): Recipe => {
  const { aspectPortrait, ...geometry } = recipe.geometry
  return {
    v: recipe.v,
    geometry: {
      ...geometry,
      straighten: roundTo(recipe.geometry.straighten, 0.1),
      ...(aspectPortrait ? { aspectPortrait } : {})
    },
    adjustments: normalizeAdjustments(recipe.adjustments),
    masks: recipe.masks.map((mask) => ({
      ...mask,
      adjustments: normalizeAdjustments(mask.adjustments)
    }))
  }
}

/** Number of non-neutral sliders in an adjustments object. */
export const countChangedAdjustments = (adjustments: Adjustments): number =>
  Object.keys(normalizeAdjustments(adjustments)).length

const EPSILON = 1e-6

/**
 * True when rendering the recipe would reproduce the source pixels: no
 * rotation, flip, straighten or crop, and no non-zero adjustment on the
 * image or on any mask. `aspect` is UI state and does not count.
 */
export const isNeutralRecipe = (recipe: Recipe): boolean => {
  const { geometry, adjustments, masks } = normalizeRecipe(recipe)
  const { crop } = geometry
  return (
    geometry.rotate90 === 0 &&
    !geometry.flipH &&
    geometry.straighten === 0 &&
    crop.x <= EPSILON &&
    crop.y <= EPSILON &&
    crop.width >= 1 - EPSILON &&
    crop.height >= 1 - EPSILON &&
    countChangedAdjustments(adjustments) === 0 &&
    masks.every((mask) => countChangedAdjustments(mask.adjustments) === 0)
  )
}

// The recipe without its UI-only aspect state, in canonical form.
const getPixelRecipe = (recipe: Recipe) => {
  const { geometry, ...rest } = normalizeRecipe(recipe)
  const { aspect: _aspect, aspectPortrait: _portrait, ...pixels } = geometry
  return { ...rest, geometry: pixels }
}

const isSameValue = (left: unknown, right: unknown): boolean => {
  if (left === right) return true
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false
  }
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) =>
      isSameValue(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key]
      )
    )
  )
}

/**
 * True when two recipes render the same pixels from the same source: they
 * are equal once normalized, ignoring `aspect` and `aspectPortrait`, which
 * only say which preset the crop box follows (choosing 1:1 and then Original
 * again, or a preset whose crop is the full frame, changes no pixel).
 */
export const isSameRender = (left: Recipe, right: Recipe): boolean =>
  isSameValue(getPixelRecipe(left), getPixelRecipe(right))

export type ParseRecipeResult =
  { ok: true; recipe: Recipe } | { ok: false; error: string }

/**
 * Parse and validate a recipe from its JSON string. It never throws: the
 * result is `{ ok: true, recipe }` or `{ ok: false, error }`, so a route can
 * answer 422 with the reason (the 16 KiB cap is checked before parsing).
 *
 * `allowMasks` defaults to false (phase 1): a recipe with masks is rejected.
 * To read a stored recipe use `parseStoredRecipe`, which yields `null`.
 */
export const parseRecipe = (
  json: string,
  { allowMasks = false }: { allowMasks?: boolean } = {}
): ParseRecipeResult => {
  if (utf8Length(json) > MAX_RECIPE_BYTES) {
    return {
      ok: false,
      error: `Recipe is larger than ${MAX_RECIPE_BYTES} bytes`
    }
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Recipe is not valid JSON' }
  }

  const parsed = RecipeSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.')
    return {
      ok: false,
      error: path ? `${path}: ${issue.message}` : (issue?.message ?? 'Invalid')
    }
  }
  if (!allowMasks && parsed.data.masks.length > 0) {
    return { ok: false, error: 'Masks are not supported' }
  }
  return { ok: true, recipe: parsed.data }
}

/**
 * Read a recipe stored in the database. Returns `null` when the stored value
 * is missing or cannot be parsed, so the editor falls back to
 * `NEUTRAL_RECIPE` on top of the original. The caller logs the failure
 * (`logger.warn`); this module has no logger so it stays client-safe.
 */
export const parseStoredRecipe = (
  json: string | null | undefined
): Recipe | null => {
  if (!json) return null
  const result = parseRecipe(json, { allowMasks: true })
  return result.ok ? result.recipe : null
}
