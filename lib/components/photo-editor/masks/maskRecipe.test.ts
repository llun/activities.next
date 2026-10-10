import {
  MAX_MASKS,
  NEUTRAL_RECIPE,
  type Recipe,
  RecipeSchema
} from '@/lib/services/medias/edit/recipe'

import { createRaster, getRasters, withRaster } from './maskRaster'
import {
  DEFAULT_FEATHER,
  addBackgroundMask,
  addBrushMask,
  addSubjectMask,
  canAddMask,
  canAddPoint,
  describeMask,
  getBackgroundOf,
  getMaskName,
  getSubjectWithoutBackground,
  newMaskId,
  removeMask,
  resetMaskAdjustments,
  setMaskAdjustment,
  setMaskFeather,
  setSubjectPoints
} from './maskRecipe'

const point = { x: 0.4, y: 0.6, label: 1 as const }

const withSubject = (id = 'aaaaaaaa'): Recipe =>
  withRaster(
    addSubjectMask(NEUTRAL_RECIPE, id, point),
    id,
    createRaster({ width: 2, height: 2 })
  )

describe('creating masks', () => {
  it('makes recipes the schema accepts', () => {
    let recipe = withSubject()
    recipe = addBackgroundMask(recipe, 'bbbbbbbb', 'aaaaaaaa')
    recipe = addBrushMask(recipe, 'cccccccc')
    expect(RecipeSchema.safeParse(recipe).success).toBe(true)
    expect(recipe.masks.map((mask) => mask.kind)).toEqual([
      'subject',
      'background',
      'brush'
    ])
    expect(recipe.masks.every((m) => m.feather === DEFAULT_FEATHER)).toBe(true)
  })

  it('generates 8 character ids that avoid the ones taken', () => {
    const id = newMaskId(['aaaaaaaa'])
    expect(id).toMatch(/^[a-z0-9]{8}$/)
    expect(id).not.toBe('aaaaaaaa')
  })

  it('stops at the mask limit', () => {
    let recipe = NEUTRAL_RECIPE
    for (let i = 0; i < MAX_MASKS; i += 1) {
      expect(canAddMask(recipe)).toBe(true)
      recipe = addBrushMask(recipe, `brush00${i}`)
    }
    expect(canAddMask(recipe)).toBe(false)
  })

  it('keeps the rasters when it appends a mask', () => {
    const recipe = addBrushMask(withSubject(), 'bbbbbbbb')
    expect(Object.keys(getRasters(recipe))).toEqual(['aaaaaaaa'])
  })
})

describe('backgrounds', () => {
  it('finds the subject that still needs a background', () => {
    const recipe = addBackgroundMask(withSubject(), 'bbbbbbbb', 'aaaaaaaa')
    expect(getBackgroundOf(recipe, 'aaaaaaaa')?.id).toBe('bbbbbbbb')
    expect(getSubjectWithoutBackground(recipe)).toBeUndefined()
    const two = addSubjectMask(recipe, 'dddddddd', point)
    expect(getSubjectWithoutBackground(two)?.id).toBe('dddddddd')
  })

  it('prefers the selected subject when there are several', () => {
    let recipe = addSubjectMask(withSubject(), 'dddddddd', point)
    expect(getSubjectWithoutBackground(recipe)?.id).toBe('aaaaaaaa')
    expect(getSubjectWithoutBackground(recipe, 'dddddddd')?.id).toBe('dddddddd')
    recipe = addBackgroundMask(recipe, 'bbbbbbbb', 'dddddddd')
    expect(getSubjectWithoutBackground(recipe, 'dddddddd')?.id).toBe('aaaaaaaa')
  })

  it('goes away with its subject, and the pixels go too', () => {
    let recipe = addBackgroundMask(withSubject(), 'bbbbbbbb', 'aaaaaaaa')
    recipe = addBrushMask(recipe, 'cccccccc')
    const next = removeMask(recipe, 'aaaaaaaa')
    expect(next.masks.map((mask) => mask.id)).toEqual(['cccccccc'])
    expect(Object.keys(getRasters(next))).toEqual([])
    expect(RecipeSchema.safeParse(next).success).toBe(true)
  })

  it('can be removed on its own', () => {
    const recipe = addBackgroundMask(withSubject(), 'bbbbbbbb', 'aaaaaaaa')
    const next = removeMask(recipe, 'bbbbbbbb')
    expect(next.masks.map((mask) => mask.id)).toEqual(['aaaaaaaa'])
    expect(Object.keys(getRasters(next))).toEqual(['aaaaaaaa'])
  })
})

describe('editing a mask', () => {
  it('sets, clears and resets sliders', () => {
    let recipe = withSubject()
    recipe = setMaskAdjustment(recipe, 'aaaaaaaa', 'exposure', 0.4)
    recipe = setMaskAdjustment(recipe, 'aaaaaaaa', 'texture', 24)
    expect(recipe.masks[0].adjustments).toEqual({ exposure: 0.4, texture: 24 })
    recipe = setMaskAdjustment(recipe, 'aaaaaaaa', 'texture', 0)
    expect(recipe.masks[0].adjustments).toEqual({ exposure: 0.4 })
    recipe = resetMaskAdjustments(recipe, 'aaaaaaaa', ['exposure'])
    expect(recipe.masks[0].adjustments).toEqual({})
  })

  it('does not touch the other masks', () => {
    const recipe = setMaskAdjustment(
      addBrushMask(withSubject(), 'bbbbbbbb'),
      'aaaaaaaa',
      'exposure',
      1
    )
    expect(recipe.masks[1].adjustments).toEqual({})
  })

  it('rounds and clamps feather', () => {
    const recipe = withSubject()
    expect(setMaskFeather(recipe, 'aaaaaaaa', 12.6).masks[0].feather).toBe(13)
    expect(setMaskFeather(recipe, 'aaaaaaaa', 400).masks[0].feather).toBe(100)
    expect(setMaskFeather(recipe, 'aaaaaaaa', -3).masks[0].feather).toBe(0)
  })

  it('caps the points at 32', () => {
    const many = Array.from({ length: 40 }, () => point)
    const recipe = setSubjectPoints(withSubject(), 'aaaaaaaa', many)
    expect(recipe.masks[0].points).toHaveLength(32)
    expect(canAddPoint(recipe.masks[0])).toBe(false)
    expect(canAddPoint(withSubject().masks[0])).toBe(true)
  })
})

describe('naming', () => {
  it('numbers masks only when a kind repeats', () => {
    let recipe = addBackgroundMask(withSubject(), 'bbbbbbbb', 'aaaaaaaa')
    expect(getMaskName(recipe, 'aaaaaaaa')).toBe('Subject')
    expect(getMaskName(recipe, 'bbbbbbbb')).toBe('Background')
    recipe = addSubjectMask(recipe, 'dddddddd', point)
    expect(getMaskName(recipe, 'aaaaaaaa')).toBe('Subject 1')
    expect(getMaskName(recipe, 'dddddddd')).toBe('Subject 2')
    expect(getMaskName(recipe, 'zzzzzzzz')).toBe('')
  })

  it('describes the changes of a mask and what a background follows', () => {
    let recipe = addBackgroundMask(withSubject(), 'bbbbbbbb', 'aaaaaaaa')
    expect(describeMask(recipe, recipe.masks[0])).toBe('No changes')
    expect(describeMask(recipe, recipe.masks[1])).toBe(
      'Inverse of Subject · No changes'
    )
    recipe = setMaskAdjustment(recipe, 'aaaaaaaa', 'exposure', 0.4)
    recipe = setMaskAdjustment(recipe, 'aaaaaaaa', 'tint', 4)
    recipe = setMaskAdjustment(recipe, 'bbbbbbbb', 'tint', 4)
    expect(describeMask(recipe, recipe.masks[0])).toBe('2 changes')
    expect(describeMask(recipe, recipe.masks[1])).toBe(
      'Inverse of Subject · 1 change'
    )
  })
})
