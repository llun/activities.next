import { describe, expect, it } from 'vitest'

import type { AiStyle } from '@/lib/services/medias/edit/enhanceSchema'
import {
  type Mask,
  NEUTRAL_RECIPE,
  type Recipe
} from '@/lib/services/medias/edit/recipe'

import {
  ENHANCE_GLOBAL_KEYS,
  applyEnhance,
  hasMaskValues,
  scaleEnhanceValue
} from './enhanceApply'

const STYLE: AiStyle = {
  global: {
    exposure: 0.5,
    contrast: 20,
    highlights: -30,
    temperature: 10,
    clarity: 15,
    vignette: 40
  },
  subject: { exposure: 0.3, shadows: 25 },
  background: { saturation: -20, exposure: -0.2 }
}

const subject: Mask = {
  id: 'subj0001',
  kind: 'subject',
  points: [{ x: 0.5, y: 0.5, label: 1 }],
  feather: 8,
  adjustments: { contrast: 5 }
}
const background: Mask = {
  id: 'back0001',
  kind: 'background',
  of: 'subj0001',
  points: [],
  feather: 8,
  adjustments: {}
}
const withMasks = (...masks: Mask[]): Recipe => ({
  ...NEUTRAL_RECIPE,
  masks
})

describe('scaleEnhanceValue', () => {
  it.each([
    ['contrast', 20, 100, 20],
    ['contrast', 20, 80, 16],
    ['contrast', 20, 50, 10],
    ['contrast', 20, 0, 0],
    ['contrast', -33, 50, -16],
    ['contrast', 3, 10, 0],
    ['exposure', 0.5, 80, 0.4],
    ['exposure', 1.5, 33, 0.5],
    ['exposure', -0.37, 100, -0.37],
    ['exposure', -0.5, 0, 0]
  ])('scales %s %d at strength %d to %d', (key, value, strength, expected) => {
    expect(scaleEnhanceValue(key, value, strength)).toBe(expected)
  })

  it('never returns negative zero', () => {
    expect(Object.is(scaleEnhanceValue('contrast', -3, 10), 0)).toBeTrue()
  })
})

describe('applyEnhance', () => {
  it('sets the global light, colour and detail keys, scaled', () => {
    const next = applyEnhance(NEUTRAL_RECIPE, STYLE, 80)
    expect(next.adjustments).toEqual({
      exposure: 0.4,
      contrast: 16,
      highlights: -24,
      temperature: 8,
      clarity: 12
    })
  })

  it('replaces the previous values of those keys', () => {
    const before: Recipe = {
      ...NEUTRAL_RECIPE,
      adjustments: { exposure: -1, saturation: 30, texture: 9, vignette: -15 }
    }
    const next = applyEnhance(before, STYLE, 100)
    // Saturation and texture are not in the style: back to neutral. The
    // vignette is an effect, not light, colour or detail: it is kept.
    expect(next.adjustments).toEqual({
      exposure: 0.5,
      contrast: 20,
      highlights: -30,
      temperature: 10,
      clarity: 15,
      vignette: -15
    })
  })

  it('leaves the geometry alone', () => {
    const before: Recipe = {
      ...NEUTRAL_RECIPE,
      geometry: { ...NEUTRAL_RECIPE.geometry, rotate90: 1, flipH: true }
    }
    expect(applyEnhance(before, STYLE, 80).geometry).toEqual(before.geometry)
  })

  it('does not touch the recipe it is given', () => {
    const before = withMasks(subject, background)
    const snapshot = JSON.stringify(before)
    applyEnhance(before, STYLE, 80)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('drops every value at strength 0', () => {
    const before: Recipe = {
      ...NEUTRAL_RECIPE,
      adjustments: { exposure: 1, contrast: 10 }
    }
    expect(applyEnhance(before, STYLE, 0).adjustments).toEqual({})
  })

  it('ignores subject and background values when there is no subject mask', () => {
    const brush: Mask = {
      id: 'brsh0001',
      kind: 'brush',
      points: [],
      feather: 8,
      adjustments: { exposure: 0.1 }
    }
    const before = withMasks(brush)
    const next = applyEnhance(before, STYLE, 100)
    expect(next.masks).toEqual(before.masks)
    expect(applyEnhance(NEUTRAL_RECIPE, STYLE, 100).masks).toEqual([])
  })

  it('never creates a mask', () => {
    expect(applyEnhance(NEUTRAL_RECIPE, STYLE, 100).masks).toHaveLength(0)
  })

  it('applies the subject values to the subject mask and the background values to its background', () => {
    const next = applyEnhance(withMasks(subject, background), STYLE, 80)
    expect(next.masks).toEqual([
      { ...subject, adjustments: { exposure: 0.24, shadows: 20 } },
      { ...background, adjustments: { saturation: -16, exposure: -0.16 } }
    ])
  })

  it('applies the subject values when the subject has no background mask', () => {
    const next = applyEnhance(withMasks(subject), STYLE, 100)
    expect(next.masks).toEqual([
      { ...subject, adjustments: { exposure: 0.3, shadows: 25 } }
    ])
  })

  it('leaves a mask alone when the style has null for it', () => {
    const style: AiStyle = { ...STYLE, subject: null, background: null }
    const before = withMasks(subject, background)
    expect(applyEnhance(before, style, 100).masks).toEqual(before.masks)
  })

  it('targets the first subject and the background that follows it', () => {
    const second: Mask = { ...subject, id: 'subj0002', adjustments: {} }
    const secondBackground: Mask = {
      ...background,
      id: 'back0002',
      of: 'subj0002'
    }
    const next = applyEnhance(
      withMasks(subject, second, background, secondBackground),
      STYLE,
      100
    )
    expect(next.masks.map((mask) => mask.adjustments)).toEqual([
      { exposure: 0.3, shadows: 25 },
      {},
      { saturation: -20, exposure: -0.2 },
      {}
    ])
  })

  it('only sets keys a mask has', () => {
    const next = applyEnhance(withMasks(subject), STYLE, 100)
    for (const key of Object.keys(next.masks[0].adjustments)) {
      expect(ENHANCE_GLOBAL_KEYS).toContain(key)
    }
    expect(ENHANCE_GLOBAL_KEYS).not.toContain('vignette')
  })
})

describe('hasMaskValues', () => {
  it.each([
    [STYLE, true],
    [{ ...STYLE, background: null }, true],
    [{ ...STYLE, subject: null }, true],
    [{ ...STYLE, subject: null, background: null }, false],
    [{ ...STYLE, subject: {}, background: {} }, false]
  ])('reports %j as %s', (style, expected) => {
    expect(hasMaskValues(style)).toBe(expected)
  })
})
