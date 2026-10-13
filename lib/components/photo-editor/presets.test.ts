import type { ImageStats } from '@/lib/components/photo-editor/engine/histogram'
import { NEUTRAL_RECIPE, type Recipe } from '@/lib/services/medias/edit/recipe'

import {
  DEFAULT_ENHANCE_STRENGTH,
  PRESETS,
  PRESET_IDS,
  applyPreset,
  computePresetAdjustments,
  getEnhanceSubject,
  scalePresetDelta
} from './presets'

const mockStats: ImageStats = {
  meanLinear: 0.1,
  p005: 0.02,
  p50: 0.35,
  p995: 0.85,
  sd: 0.15,
  fractionHigh: 0,
  fractionLow: 0.08,
  midtone: { r: 0.4, g: 0.4, b: 0.4 },
  meanChroma: 0.1,
  neutralMidtone: { r: 0.1, g: 0.1, b: 0.1, weight: 0.5 }
}

describe('presets metadata', () => {
  it('defines the 6 preset IDs', () => {
    expect(PRESET_IDS).toEqual([
      'natural',
      'vivid',
      'dramatic',
      'warm',
      'cool',
      'mono'
    ])
  })

  it('provides metadata for all 6 presets with matching IDs', () => {
    expect(PRESETS).toHaveLength(6)
    expect(PRESETS.map((p) => p.id)).toEqual([...PRESET_IDS])
    for (const preset of PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
    }
  })
})

describe('scalePresetDelta', () => {
  it('rounds exposure to 0.05 steps', () => {
    expect(scalePresetDelta('exposure', 0.43, 100)).toBe(0.45)
    expect(scalePresetDelta('exposure', 0.43, 50)).toBe(0.2)
    expect(scalePresetDelta('exposure', 0.43, 0)).toBe(0)
  })

  it('rounds integer sliders to whole numbers', () => {
    expect(scalePresetDelta('contrast', 25, 100)).toBe(25)
    expect(scalePresetDelta('contrast', 25, 50)).toBe(13)
    expect(scalePresetDelta('contrast', 25, 0)).toBe(0)
    expect(scalePresetDelta('contrast', -25, 50)).toBe(-13)
  })
})

describe('computePresetAdjustments', () => {
  it.each(PRESET_IDS)(
    'computes valid adjustments for %s without stats',
    (id) => {
      const adj = computePresetAdjustments(id, null)
      expect(adj.global).toBeDefined()
      if (id === 'mono') {
        expect(adj.global.saturation).toBe(-100)
      }
    }
  )

  it.each(PRESET_IDS)(
    'computes adaptive adjustments for %s with stats',
    (id) => {
      const adj = computePresetAdjustments(id, mockStats)
      expect(adj.global).toBeDefined()
      // Adaptive exposure should be adjusted for dark mockStats
      expect(adj.global.exposure).toBeGreaterThan(0)
      if (id === 'mono') {
        expect(adj.global.saturation).toBe(-100)
      }
    }
  )

  it('warm preset warms temperature while cool preset cools', () => {
    const warm = computePresetAdjustments('warm', null)
    const cool = computePresetAdjustments('cool', null)
    expect(warm.global.temperature ?? 0).toBeGreaterThan(0)
    expect(cool.global.temperature ?? 0).toBeLessThan(0)
  })
})

describe('applyPreset', () => {
  const baseRecipe: Recipe = {
    ...NEUTRAL_RECIPE,
    adjustments: { exposure: 0.1, contrast: 5 }
  }

  it('at strength 0 leaves base recipe adjustments and masks unchanged', () => {
    const result = applyPreset(baseRecipe, 'vivid', 0, mockStats)
    expect(result.adjustments).toEqual(baseRecipe.adjustments)
    expect(result.masks).toEqual(baseRecipe.masks)
  })

  it('at strength 100 applies full preset deltas on top of base adjustments', () => {
    const result = applyPreset(baseRecipe, 'mono', 100, null)
    expect(result.adjustments.saturation).toBe(-100)
    expect(result.adjustments.contrast).toBeGreaterThan(
      baseRecipe.adjustments.contrast!
    )
  })

  it('preserves existing adjustments not touched by the preset', () => {
    const recipeWithVignette: Recipe = {
      ...baseRecipe,
      adjustments: { vignette: -40 }
    }
    const result = applyPreset(recipeWithVignette, 'natural', 50, null)
    expect(result.adjustments.vignette).toBe(-40)
  })

  it('clamps values to valid schema limits', () => {
    const extremeRecipe: Recipe = {
      ...NEUTRAL_RECIPE,
      adjustments: { exposure: 4.9, contrast: 95 }
    }
    const result = applyPreset(extremeRecipe, 'dramatic', 100, null)
    expect(result.adjustments.exposure).toBeLessThanOrEqual(5)
    expect(result.adjustments.contrast).toBeLessThanOrEqual(100)
  })

  it('applies subject and background adjustments when masks exist on base', () => {
    const recipeWithMasks: Recipe = {
      ...NEUTRAL_RECIPE,
      masks: [
        {
          id: 'sub12345',
          kind: 'subject',
          points: [{ x: 0.5, y: 0.5, label: 1 }],
          feather: 10,
          adjustments: { clarity: 5 }
        },
        {
          id: 'bg123456',
          kind: 'background',
          of: 'sub12345',
          points: [],
          feather: 10,
          adjustments: {}
        }
      ]
    }

    const applied = applyPreset(recipeWithMasks, 'natural', 100, null)
    const subjectMask = applied.masks.find((m) => m.id === 'sub12345')
    const bgMask = applied.masks.find((m) => m.id === 'bg123456')

    expect(subjectMask?.adjustments.clarity).toBe(15) // 5 base + 10 delta
    expect(bgMask?.adjustments.clarity).toBe(-5) // 0 base + -5 delta
  })

  it('exports DEFAULT_ENHANCE_STRENGTH and getEnhanceSubject', () => {
    expect(DEFAULT_ENHANCE_STRENGTH).toBe(80)
    expect(getEnhanceSubject(NEUTRAL_RECIPE)).toBeUndefined()
    const withSubject: Recipe = {
      ...NEUTRAL_RECIPE,
      masks: [
        {
          id: 'sub1',
          kind: 'subject',
          points: [{ x: 0.5, y: 0.5, label: 1 }],
          feather: 8,
          adjustments: {}
        }
      ]
    }
    expect(getEnhanceSubject(withSubject)?.id).toBe('sub1')
  })

  it('preserves current recipe geometry when applying preset with baseline', () => {
    const baseline: Recipe = {
      ...NEUTRAL_RECIPE
    }
    const currentWithCrop: Recipe = {
      ...NEUTRAL_RECIPE,
      geometry: {
        ...NEUTRAL_RECIPE.geometry,
        rotate90: 1,
        straighten: 2.5,
        flipH: true,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      }
    }

    const result = applyPreset(currentWithCrop, 'vivid', 100, null, baseline)

    expect(result.geometry).toEqual(currentWithCrop.geometry)
    expect(result.adjustments.vibrance).toBeDefined()
  })

  it('preserves masks added after baseline while applying deltas from baseline', () => {
    const baseline: Recipe = {
      ...NEUTRAL_RECIPE,
      masks: [
        {
          id: 'sub1',
          kind: 'subject',
          points: [{ x: 0.5, y: 0.5, label: 1 }],
          feather: 8,
          adjustments: { clarity: 10 }
        }
      ]
    }
    const currentWithNewMask: Recipe = {
      ...baseline,
      masks: [
        ...baseline.masks,
        {
          id: 'brush1',
          kind: 'brush',
          points: [],
          feather: 5,
          adjustments: { exposure: 0.5 }
        }
      ]
    }

    const result = applyPreset(
      currentWithNewMask,
      'natural',
      100,
      null,
      baseline
    )

    expect(result.masks).toHaveLength(2)
    const subject = result.masks.find((m) => m.id === 'sub1')
    const brush = result.masks.find((m) => m.id === 'brush1')
    expect(subject?.adjustments.clarity).toBe(20) // 10 base + 10 delta
    expect(brush?.adjustments.exposure).toBe(0.5) // preserved untouched
  })
})
