import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import {
  MASK_LONG_EDGE,
  NO_RASTERS,
  cloneRaster,
  createRaster,
  getMaskSize,
  getRasters,
  invertRaster,
  rasterCoverage,
  sameRasters,
  withRaster,
  withRasters
} from './maskRaster'

describe('getMaskSize', () => {
  it.each([
    [
      { width: 4000, height: 3000 },
      { width: 1024, height: 768 }
    ],
    [
      { width: 3000, height: 4000 },
      { width: 768, height: 1024 }
    ],
    [
      { width: 200, height: 100 },
      { width: 1024, height: 512 }
    ]
  ])('fits %j to a long edge of 1024', (source, expected) => {
    expect(MASK_LONG_EDGE).toBe(1024)
    expect(getMaskSize(source)).toEqual(expected)
  })
})

describe('rasters', () => {
  it('creates, clones and inverts', () => {
    const raster = createRaster({ width: 4, height: 2 }, 10)
    raster.data[0] = 200
    const copy = cloneRaster(raster)
    copy.data[1] = 99
    expect(raster.data[1]).toBe(10)
    expect(Array.from(invertRaster(raster).data)).toEqual([
      55, 245, 245, 245, 245, 245, 245, 245
    ])
  })

  it('measures coverage as the share of pixels at least half inside', () => {
    const raster = createRaster({ width: 4, height: 1 })
    raster.data.set([255, 128, 127, 0])
    expect(rasterCoverage(raster)).toBe(0.5)
  })
})

describe('rasters on a recipe', () => {
  const raster = createRaster({ width: 2, height: 2 })

  it('start empty', () => {
    expect(getRasters(NEUTRAL_RECIPE)).toBe(NO_RASTERS)
  })

  it('travel with the recipe through an object spread', () => {
    const recipe = withRaster(NEUTRAL_RECIPE, 'aaaaaaaa', raster)
    const next = { ...recipe, adjustments: { exposure: 1 } }
    expect(getRasters(next).aaaaaaaa).toBe(raster)
  })

  it('stay out of JSON and out of the keys', () => {
    const recipe = withRaster(NEUTRAL_RECIPE, 'aaaaaaaa', raster)
    expect(JSON.stringify(recipe)).toBe(JSON.stringify(NEUTRAL_RECIPE))
    expect(Object.keys(recipe)).toEqual(Object.keys(NEUTRAL_RECIPE))
  })

  it('can be replaced and removed one mask at a time', () => {
    const other = createRaster({ width: 2, height: 2 })
    let recipe = withRaster(NEUTRAL_RECIPE, 'aaaaaaaa', raster)
    recipe = withRaster(recipe, 'bbbbbbbb', other)
    expect(Object.keys(getRasters(recipe))).toEqual(['aaaaaaaa', 'bbbbbbbb'])
    recipe = withRaster(recipe, 'aaaaaaaa', null)
    expect(Object.keys(getRasters(recipe))).toEqual(['bbbbbbbb'])
    expect(withRasters(recipe, NO_RASTERS)).not.toBe(recipe)
  })

  it('are the same only when every mask has the same raster object', () => {
    const a = { aaaaaaaa: raster }
    expect(sameRasters(a, a)).toBe(true)
    expect(sameRasters(a, { aaaaaaaa: raster })).toBe(true)
    expect(sameRasters(a, { aaaaaaaa: cloneRaster(raster) })).toBe(false)
    expect(sameRasters(a, {})).toBe(false)
  })
})
