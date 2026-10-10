import {
  MAX_RECIPE_BYTES,
  type Mask,
  NEUTRAL_RECIPE,
  type Recipe,
  RecipeSchema,
  countChangedAdjustments,
  isNeutralRecipe,
  isSameRender,
  normalizeRecipe,
  parseRecipe,
  parseStoredRecipe
} from '@/lib/services/medias/edit/recipe'

const recipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  ...NEUTRAL_RECIPE,
  ...overrides
})

const subject = (id = 'abcd1234', overrides: Partial<Mask> = {}): Mask => ({
  id,
  kind: 'subject',
  points: [{ x: 0.5, y: 0.5, label: 1 }],
  feather: 10,
  adjustments: {},
  ...overrides
})

const background = (id = 'bbbb2222', of = 'abcd1234'): Mask => ({
  id,
  kind: 'background',
  of,
  points: [],
  feather: 0,
  adjustments: {}
})

const parse = (value: unknown, allowMasks = true) =>
  parseRecipe(JSON.stringify(value), { allowMasks })

describe('recipe schema', () => {
  it('accepts the neutral recipe', () => {
    expect(parse(NEUTRAL_RECIPE)).toEqual({ ok: true, recipe: NEUTRAL_RECIPE })
  })

  it.each([
    ['top level', { ...NEUTRAL_RECIPE, extra: 1 }],
    [
      'geometry',
      { ...NEUTRAL_RECIPE, geometry: { ...NEUTRAL_RECIPE.geometry, x: 1 } }
    ],
    [
      'crop',
      {
        ...NEUTRAL_RECIPE,
        geometry: {
          ...NEUTRAL_RECIPE.geometry,
          crop: { ...NEUTRAL_RECIPE.geometry.crop, z: 1 }
        }
      }
    ],
    ['adjustments', { ...NEUTRAL_RECIPE, adjustments: { sharpen: 5 } }],
    ['mask', { ...NEUTRAL_RECIPE, masks: [{ ...subject(), extra: true }] }],
    [
      'mask adjustments (no vignette)',
      {
        ...NEUTRAL_RECIPE,
        masks: [{ ...subject(), adjustments: { vignette: 5 } }]
      }
    ]
  ])('rejects an unknown key in %s', (_, value) => {
    expect(parse(value).ok).toBe(false)
  })

  it('rejects another version', () => {
    expect(parse({ ...NEUTRAL_RECIPE, v: 2 }).ok).toBe(false)
  })

  it.each([
    ['exposure', 5, true],
    ['exposure', 5.01, false],
    ['exposure', -5, true],
    ['exposure', -5.01, false],
    ['contrast', 100, true],
    ['contrast', 101, false],
    ['contrast', -100, true],
    ['contrast', -101, false],
    ['contrast', 1.5, false],
    ['vignette', -100, true],
    ['vignette', 101, false]
  ])('adjustment %s = %s is valid: %s', (key, value, valid) => {
    expect(parse(recipe({ adjustments: { [key]: value } })).ok).toBe(valid)
  })

  it.each([
    ['straighten', 45, true],
    ['straighten', 45.1, false],
    ['straighten', -45, true],
    ['straighten', -45.1, false],
    ['rotate90', 3, true],
    ['rotate90', 4, false],
    ['rotate90', -1, false],
    ['aspect', '16:9', true],
    ['aspect', '2:1', false]
  ])('geometry %s = %s is valid: %s', (key, value, valid) => {
    const geometry = { ...NEUTRAL_RECIPE.geometry, [key]: value }
    expect(parse(recipe({ geometry } as Partial<Recipe>)).ok).toBe(valid)
  })

  it.each([
    [{ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, true],
    [{ x: 0.5, y: 0.5, width: 0.6, height: 0.5 }, false],
    [{ x: 0, y: 0, width: 0, height: 1 }, false],
    [{ x: -0.1, y: 0, width: 1, height: 1 }, false],
    [{ x: 0, y: 0, width: 1.1, height: 1 }, false]
  ])('crop %j is valid: %s', (crop, valid) => {
    const geometry = { ...NEUTRAL_RECIPE.geometry, crop }
    expect(parse(recipe({ geometry })).ok).toBe(valid)
  })

  it('rejects non-finite numbers that survive in-process parsing', () => {
    const result = RecipeSchema.safeParse({
      ...NEUTRAL_RECIPE,
      adjustments: { exposure: Infinity }
    })
    expect(result.success).toBe(false)
  })
})

describe('recipe masks', () => {
  it('rejects masks unless allowMasks is set', () => {
    const value = recipe({ masks: [subject()] })
    expect(parse(value, false)).toEqual({
      ok: false,
      error: 'Masks are not supported'
    })
    expect(parseRecipe(JSON.stringify(value))).toMatchObject({ ok: false })
    expect(parse(value, true).ok).toBe(true)
  })

  it('accepts a background mask that references a subject', () => {
    expect(parse(recipe({ masks: [subject(), background()] })).ok).toBe(true)
  })

  it.each([
    ['missing of', { ...background(), of: undefined }],
    ['unknown of', background('bbbb2222', 'zzzzzzzz')],
    ['of naming a background', background('bbbb2222', 'bbbb2222')]
  ])('rejects a background mask with %s', (_, mask) => {
    expect(parse(recipe({ masks: [subject(), mask as Mask] })).ok).toBe(false)
  })

  it('rejects of on a subject or a brush mask', () => {
    const brush: Mask = { ...subject('cccc3333'), kind: 'brush', points: [] }
    expect(
      parse(recipe({ masks: [{ ...subject(), of: 'cccc3333' }, brush] })).ok
    ).toBe(false)
    expect(
      parse(recipe({ masks: [subject(), { ...brush, of: 'abcd1234' }] })).ok
    ).toBe(false)
  })

  it('requires a positive point on a subject mask', () => {
    expect(
      parse(recipe({ masks: [subject('abcd1234', { points: [] })] })).ok
    ).toBe(false)
    expect(
      parse(
        recipe({
          masks: [subject('abcd1234', { points: [{ x: 0, y: 0, label: 0 }] })]
        })
      ).ok
    ).toBe(false)
  })

  it('rejects points on brush and background masks', () => {
    const point = { x: 0.1, y: 0.1, label: 1 as const }
    expect(
      parse(
        recipe({
          masks: [{ ...subject('cccc3333'), kind: 'brush', points: [point] }]
        })
      ).ok
    ).toBe(false)
    expect(
      parse(
        recipe({ masks: [subject(), { ...background(), points: [point] }] })
      ).ok
    ).toBe(false)
  })

  it('rejects duplicate mask ids and malformed ids', () => {
    expect(parse(recipe({ masks: [subject(), subject()] })).ok).toBe(false)
    expect(parse(recipe({ masks: [subject('ABCD1234')] })).ok).toBe(false)
    expect(parse(recipe({ masks: [subject('abc')] })).ok).toBe(false)
  })

  it('caps masks at 4 and points at 32', () => {
    const ids = ['aaaaaaa1', 'aaaaaaa2', 'aaaaaaa3', 'aaaaaaa4', 'aaaaaaa5']
    expect(
      parse(recipe({ masks: ids.slice(0, 4).map((id) => subject(id)) })).ok
    ).toBe(true)
    expect(parse(recipe({ masks: ids.map((id) => subject(id)) })).ok).toBe(
      false
    )

    const points = (n: number) =>
      Array.from({ length: n }, () => ({ x: 0.5, y: 0.5, label: 1 as const }))
    expect(
      parse(recipe({ masks: [subject('abcd1234', { points: points(32) })] })).ok
    ).toBe(true)
    expect(
      parse(recipe({ masks: [subject('abcd1234', { points: points(33) })] })).ok
    ).toBe(false)
  })
})

describe('recipe size cap', () => {
  it('rejects a payload over 16 KiB before parsing it', () => {
    const json = JSON.stringify(NEUTRAL_RECIPE).padEnd(
      MAX_RECIPE_BYTES + 1,
      ' '
    )
    expect(parseRecipe(json, { allowMasks: true })).toMatchObject({
      ok: false,
      error: expect.stringContaining('larger')
    })
  })
})

describe('parseRecipe failures', () => {
  it.each([['not json'], [''], ['{"v":1']])(
    'returns an error for %j',
    (json) => {
      expect(parseRecipe(json, { allowMasks: true })).toMatchObject({
        ok: false
      })
    }
  )

  it('names the failing path', () => {
    const result = parse(recipe({ adjustments: { contrast: 500 } }))
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('adjustments.contrast')
    })
  })
})

describe('parseStoredRecipe', () => {
  it('returns the recipe for valid JSON, masks included', () => {
    const value = recipe({ masks: [subject()] })
    expect(parseStoredRecipe(JSON.stringify(value))).toEqual(value)
  })

  it.each([[null], [undefined], [''], ['{corrupt'], ['{"v":9}'], ['[]']])(
    'returns null for %j',
    (json) => {
      expect(parseStoredRecipe(json)).toBeNull()
    }
  )
})

describe('normalizeRecipe', () => {
  it('drops zero adjustments and rounds exposure and straighten', () => {
    const result = normalizeRecipe(
      recipe({
        geometry: { ...NEUTRAL_RECIPE.geometry, straighten: 1.2345 },
        adjustments: { exposure: 0.504, contrast: 0, shadows: 20, vignette: 0 },
        masks: [
          subject('abcd1234', { adjustments: { saturation: 0, clarity: 5 } })
        ]
      })
    )
    expect(result.geometry.straighten).toBe(1.2)
    expect(result.adjustments).toEqual({ exposure: 0.5, shadows: 20 })
    expect(result.masks[0].adjustments).toEqual({ clarity: 5 })
  })

  it('drops an exposure that rounds to zero and avoids negative zero', () => {
    const result = normalizeRecipe(
      recipe({
        geometry: { ...NEUTRAL_RECIPE.geometry, straighten: -0.04 },
        adjustments: { exposure: -0.004 }
      })
    )
    expect(result.adjustments).toEqual({})
    expect(Object.is(result.geometry.straighten, 0)).toBe(true)
  })

  it('drops aspectPortrait false but keeps true', () => {
    const base = NEUTRAL_RECIPE.geometry
    expect(
      normalizeRecipe(recipe({ geometry: { ...base, aspectPortrait: false } }))
        .geometry
    ).not.toHaveProperty('aspectPortrait')
    expect(
      normalizeRecipe(recipe({ geometry: { ...base, aspectPortrait: true } }))
        .geometry.aspectPortrait
    ).toBe(true)
  })

  it('is idempotent, does not mutate, and stays valid', () => {
    const input = recipe({ adjustments: { exposure: 0.333, tint: 0 } })
    const once = normalizeRecipe(input)
    expect(normalizeRecipe(once)).toEqual(once)
    expect(input.adjustments).toEqual({ exposure: 0.333, tint: 0 })
    expect(RecipeSchema.safeParse(once).success).toBe(true)
  })
})

describe('countChangedAdjustments', () => {
  it.each([
    [{}, 0],
    [{ exposure: 0, contrast: 0 }, 0],
    [{ exposure: 0.004 }, 0],
    [{ exposure: 0.5, contrast: -10, vignette: 3 }, 3]
  ])('counts %j as %s', (adjustments, count) => {
    expect(countChangedAdjustments(adjustments)).toBe(count)
  })
})

describe('isNeutralRecipe', () => {
  it('is true for the neutral recipe and for zeroed adjustments', () => {
    expect(isNeutralRecipe(NEUTRAL_RECIPE)).toBe(true)
    expect(
      isNeutralRecipe(recipe({ adjustments: { contrast: 0, exposure: 0.003 } }))
    ).toBe(true)
  })

  it('ignores the aspect, which is only UI state', () => {
    const geometry = { ...NEUTRAL_RECIPE.geometry, aspect: '1:1' as const }
    expect(isNeutralRecipe(recipe({ geometry }))).toBe(true)
  })

  it.each([
    ['rotate', { rotate90: 1 }],
    ['flip', { flipH: true }],
    ['straighten', { straighten: 0.5 }],
    ['crop', { crop: { x: 0.1, y: 0, width: 0.9, height: 1 } }]
  ])('is false after a %s', (_, change) => {
    const geometry = { ...NEUTRAL_RECIPE.geometry, ...change }
    expect(isNeutralRecipe(recipe({ geometry } as Partial<Recipe>))).toBe(false)
  })

  it('is false with an adjustment, true with an inert mask', () => {
    expect(isNeutralRecipe(recipe({ adjustments: { shadows: 1 } }))).toBe(false)
    expect(isNeutralRecipe(recipe({ masks: [subject()] }))).toBe(true)
    expect(
      isNeutralRecipe(
        recipe({ masks: [subject('abcd1234', { adjustments: { tint: 4 } })] })
      )
    ).toBe(false)
  })
})

describe('isSameRender', () => {
  const edited = recipe({ adjustments: { exposure: 0.5 } })

  it('ignores the aspect preset and its orientation', () => {
    const geometry = {
      ...edited.geometry,
      aspect: '1:1' as const,
      aspectPortrait: true
    }
    expect(isSameRender(edited, { ...edited, geometry })).toBe(true)
  })

  it('compares the normalized recipes', () => {
    expect(
      isSameRender(
        edited,
        recipe({ adjustments: { exposure: 0.501, contrast: 0 } })
      )
    ).toBe(true)
  })

  it.each([
    ['an adjustment', recipe({ adjustments: { exposure: 0.6 } })],
    ['another adjustment', recipe({ adjustments: { exposure: 0.5, tint: 2 } })],
    [
      'the crop',
      recipe({
        adjustments: { exposure: 0.5 },
        geometry: {
          ...NEUTRAL_RECIPE.geometry,
          crop: { x: 0, y: 0, width: 0.5, height: 1 }
        }
      })
    ],
    [
      'a mask',
      recipe({
        adjustments: { exposure: 0.5 },
        masks: [subject('abcd1234', { adjustments: { tint: 4 } })]
      })
    ]
  ])('is false when %s differs', (_, other) => {
    expect(isSameRender(edited, other)).toBe(false)
  })
})
