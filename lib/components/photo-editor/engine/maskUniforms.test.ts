import { MAX_MASKS } from '@/lib/services/medias/edit/recipe'

import {
  getMaskSliders,
  hasMaskChanges,
  packMaskUniforms
} from './maskUniforms'
import { SHADER_MASK_COUNT } from './shaders'

describe('maskUniforms', () => {
  it('holds as many masks as a recipe can', () => {
    expect(SHADER_MASK_COUNT).toBe(MAX_MASKS)
  })

  it('detects a mask with a non-zero slider', () => {
    expect(hasMaskChanges(null)).toBe(false)
    expect(hasMaskChanges({})).toBe(false)
    expect(hasMaskChanges({ exposure: 0, tint: 0 })).toBe(false)
    expect(hasMaskChanges({ tint: -3 })).toBe(true)
  })

  it('packs the sliders in the order the shader unpacks them', () => {
    const packed = packMaskUniforms([
      null,
      {
        exposure: 0.5,
        temperature: 10,
        tint: -20,
        whites: 30,
        blacks: -40,
        shadows: 50,
        highlights: -60,
        contrast: 70,
        texture: -80,
        clarity: 90,
        saturation: -100,
        vibrance: 5
      }
    ])
    expect(packed.on).toEqual([0, 1, 0, 0])
    expect(packed.values).toHaveLength(MAX_MASKS * 12)
    expect(Array.from(packed.values.slice(12, 24))).toEqual(
      [0.5, 0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8, 0.9, -1, 0.05].map(
        (v) => Math.fround(v)
      )
    )
    expect(Array.from(packed.values.slice(0, 12)).every((v) => v === 0)).toBe(
      true
    )
  })

  it('leaves masks that change nothing switched off', () => {
    expect(packMaskUniforms([{}, { exposure: 0 }, null]).on).toEqual([
      0, 0, 0, 0
    ])
  })

  it('ignores masks past the shader limit', () => {
    const many = Array.from({ length: 6 }, () => ({ exposure: 1 }))
    const packed = packMaskUniforms(many)
    expect(packed.on).toEqual([1, 1, 1, 1])
    expect(packed.values).toHaveLength(MAX_MASKS * 12)
  })

  it('lists the sliders of each recipe mask, null when unchanged', () => {
    expect(
      getMaskSliders([{ adjustments: {} }, { adjustments: { exposure: 1 } }])
    ).toEqual([null, { exposure: 1 }])
  })
})
