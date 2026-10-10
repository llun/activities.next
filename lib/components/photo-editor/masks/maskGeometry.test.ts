import {
  getGeometryTransform,
  getRecipeOutputSize
} from '@/lib/services/medias/edit/geometry'
import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import {
  applyMatrix,
  invertMatrix,
  matrixScale,
  outputToSource,
  sourceToOutput
} from './maskGeometry'

const source = { width: 4000, height: 3000 }

describe('maskGeometry', () => {
  it('inverts an affine matrix', () => {
    const matrix = getGeometryTransform(
      source,
      {
        ...NEUTRAL_RECIPE.geometry,
        rotate90: 1,
        flipH: true,
        straighten: 7.5,
        crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.5 },
        aspect: 'free'
      },
      { width: 800, height: 600 }
    )
    const inverse = invertMatrix(matrix)
    expect(inverse).not.toBeNull()
    const there = applyMatrix(matrix, { x: 123, y: 456 })
    const back = applyMatrix(inverse!, there)
    expect(back.x).toBeCloseTo(123, 6)
    expect(back.y).toBeCloseTo(456, 6)
  })

  it('has no inverse for a collapsed matrix', () => {
    expect(invertMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull()
  })

  it.each([
    ['neutral', NEUTRAL_RECIPE.geometry],
    ['rotated', { ...NEUTRAL_RECIPE.geometry, rotate90: 3 as const }],
    ['flipped', { ...NEUTRAL_RECIPE.geometry, flipH: true }],
    [
      'cropped and straightened',
      {
        ...NEUTRAL_RECIPE.geometry,
        straighten: -4,
        crop: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
        aspect: 'free' as const
      }
    ]
  ])(
    'round-trips a source point through the %s geometry',
    (_name, geometry) => {
      const output = getRecipeOutputSize(source, { geometry })
      const matrix = getGeometryTransform(source, geometry, output)
      const point = { x: 0.5, y: 0.45 }
      const there = sourceToOutput(matrix, point, source)
      const back = outputToSource(matrix, there, source)
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  )

  it('puts the source centre at the output centre for a neutral geometry', () => {
    const matrix = getGeometryTransform(source, NEUTRAL_RECIPE.geometry, {
      width: 400,
      height: 300
    })
    expect(sourceToOutput(matrix, { x: 0.5, y: 0.5 }, source)).toEqual({
      x: 200,
      y: 150
    })
    expect(matrixScale(matrix)).toBeCloseTo(0.1, 9)
  })
})
