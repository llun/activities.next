import {
  MAX_MASKS,
  MAX_MASK_POINTS,
  type Mask,
  type MaskAdjustments,
  type MaskPoint,
  type Recipe,
  countChangedAdjustments
} from '@/lib/services/medias/edit/recipe'

import { getRasters, withRasters } from './maskRaster'

/** Feather a new mask starts with: a little, so the model's edge is not hard. */
export const DEFAULT_FEATHER = 8

export type MaskKind = Mask['kind']

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** A new mask id: 8 characters of [a-z0-9] not used by the recipe. */
export const newMaskId = (taken: ReadonlyArray<string>): string => {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    const id = Array.from(
      bytes,
      (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]
    ).join('')
    if (!taken.includes(id)) return id
  }
}

export const canAddMask = (recipe: Recipe): boolean =>
  recipe.masks.length < MAX_MASKS

export const getMask = (recipe: Recipe, id: string | null): Mask | undefined =>
  id ? recipe.masks.find((mask) => mask.id === id) : undefined

/** The background mask that follows a subject, if there is one. */
export const getBackgroundOf = (
  recipe: Recipe,
  subjectId: string
): Mask | undefined =>
  recipe.masks.find(
    (mask) => mask.kind === 'background' && mask.of === subjectId
  )

/** A subject that has no background mask yet (the first one, in order). */
export const getSubjectWithoutBackground = (
  recipe: Recipe,
  preferred?: string | null
): Mask | undefined => {
  const free = recipe.masks.filter(
    (mask) => mask.kind === 'subject' && !getBackgroundOf(recipe, mask.id)
  )
  return free.find((mask) => mask.id === preferred) ?? free[0]
}

const replaceMask = (
  recipe: Recipe,
  id: string,
  next: (mask: Mask) => Mask
): Recipe => ({
  ...recipe,
  masks: recipe.masks.map((mask) => (mask.id === id ? next(mask) : mask))
})

/** Appends a mask; the rasters the recipe carries are kept. */
const appendMask = (recipe: Recipe, mask: Mask): Recipe => ({
  ...recipe,
  masks: [...recipe.masks, mask]
})

export const addSubjectMask = (
  recipe: Recipe,
  id: string,
  point: MaskPoint
): Recipe =>
  appendMask(recipe, {
    id,
    kind: 'subject',
    points: [point],
    feather: DEFAULT_FEATHER,
    adjustments: {}
  })

export const addBackgroundMask = (
  recipe: Recipe,
  id: string,
  subjectId: string
): Recipe =>
  appendMask(recipe, {
    id,
    kind: 'background',
    of: subjectId,
    points: [],
    feather: DEFAULT_FEATHER,
    adjustments: {}
  })

export const addBrushMask = (recipe: Recipe, id: string): Recipe =>
  appendMask(recipe, {
    id,
    kind: 'brush',
    points: [],
    feather: DEFAULT_FEATHER,
    adjustments: {}
  })

/** A subject's points, replacing the old ones (at most 32 are kept). */
export const setSubjectPoints = (
  recipe: Recipe,
  id: string,
  points: MaskPoint[]
): Recipe =>
  replaceMask(recipe, id, (mask) => ({
    ...mask,
    points: points.slice(0, MAX_MASK_POINTS)
  }))

export const canAddPoint = (mask: Mask): boolean =>
  mask.kind === 'subject' && mask.points.length < MAX_MASK_POINTS

export const setMaskFeather = (
  recipe: Recipe,
  id: string,
  feather: number
): Recipe =>
  replaceMask(recipe, id, (mask) => ({
    ...mask,
    feather: Math.min(100, Math.max(0, Math.round(feather)))
  }))

/** Sets one of a mask's sliders; 0 removes the key. */
export const setMaskAdjustment = (
  recipe: Recipe,
  id: string,
  key: keyof MaskAdjustments,
  value: number
): Recipe =>
  replaceMask(recipe, id, (mask) => {
    const adjustments = { ...mask.adjustments }
    if (value === 0) delete adjustments[key]
    else adjustments[key] = value
    return { ...mask, adjustments }
  })

/** Clears the listed sliders of a mask. */
export const resetMaskAdjustments = (
  recipe: Recipe,
  id: string,
  keys: ReadonlyArray<keyof MaskAdjustments>
): Recipe =>
  replaceMask(recipe, id, (mask) => {
    const adjustments = { ...mask.adjustments }
    for (const key of keys) delete adjustments[key]
    return { ...mask, adjustments }
  })

/**
 * Removes a mask. A subject takes the background that follows it along (a
 * background must name a subject in the recipe), and the pixels of every
 * removed mask go too.
 */
export const removeMask = (recipe: Recipe, id: string): Recipe => {
  const removed = new Set(
    recipe.masks
      .filter((mask) => mask.id === id || mask.of === id)
      .map((mask) => mask.id)
  )
  const rasters = { ...getRasters(recipe) }
  for (const key of removed) delete rasters[key]
  return withRasters(
    { ...recipe, masks: recipe.masks.filter((mask) => !removed.has(mask.id)) },
    rasters
  )
}

const KIND_NAMES: Record<MaskKind, string> = {
  subject: 'Subject',
  background: 'Background',
  brush: 'Brush'
}

/** "Subject", "Subject 2", "Background", "Brush 3": numbered when repeated. */
export const getMaskName = (recipe: Recipe, id: string): string => {
  const mask = getMask(recipe, id)
  if (!mask) return ''
  const same = recipe.masks.filter((other) => other.kind === mask.kind)
  const base = KIND_NAMES[mask.kind]
  return same.length > 1 ? `${base} ${same.indexOf(mask) + 1}` : base
}

/** "3 changes", "1 change" or "No changes". */
export const describeMaskChanges = (mask: Mask): string => {
  const count = countChangedAdjustments(mask.adjustments)
  if (count === 0) return 'No changes'
  return `${count} ${count === 1 ? 'change' : 'changes'}`
}

/** The second line of a mask's row in the list. */
export const describeMask = (recipe: Recipe, mask: Mask): string => {
  const changes = describeMaskChanges(mask)
  if (mask.kind === 'background') {
    const subject = mask.of ? getMaskName(recipe, mask.of) : 'Subject'
    return `Inverse of ${subject} · ${changes}`
  }
  return changes
}
