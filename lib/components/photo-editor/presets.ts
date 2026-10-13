import { computeAuto } from '@/lib/components/photo-editor/engine/auto'
import { clamp } from '@/lib/components/photo-editor/engine/colour'
import type { ImageStats } from '@/lib/components/photo-editor/engine/histogram'
import { getBackgroundOf } from '@/lib/components/photo-editor/masks/maskRecipe'
import type {
  Adjustments,
  MaskAdjustments,
  Recipe
} from '@/lib/services/medias/edit/recipe'

export const DEFAULT_ENHANCE_STRENGTH = 80

/** The first subject mask, which is where the subject values go. */
export const getEnhanceSubject = (recipe: Recipe) =>
  recipe.masks.find((mask) => mask.kind === 'subject')
export const PRESET_IDS = [
  'natural',
  'vivid',
  'dramatic',
  'warm',
  'cool',
  'mono'
] as const

export type PresetId = (typeof PRESET_IDS)[number]

export interface PresetMetadata {
  id: PresetId
  label: string
  description: string
}

export const PRESETS: ReadonlyArray<PresetMetadata> = [
  {
    id: 'natural',
    label: 'Natural',
    description: 'Balanced tone and subtle clarity'
  },
  {
    id: 'vivid',
    label: 'Vivid',
    description: 'Rich colour, crisp contrast, and lifted detail'
  },
  {
    id: 'dramatic',
    label: 'Dramatic',
    description: 'Deep shadows, punchy clarity, and subtle vignette'
  },
  {
    id: 'warm',
    label: 'Warm',
    description: 'Golden warmth with soft lifted shadows'
  },
  {
    id: 'cool',
    label: 'Cool',
    description: 'Clean cool tones with crisp highlights'
  },
  {
    id: 'mono',
    label: 'B&W',
    description: 'Classic high-contrast monochrome'
  }
]

export interface PresetAdjustments {
  global: Partial<Adjustments>
  subject?: Partial<Adjustments>
  background?: Partial<Adjustments>
}

const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(6)) + 0

export const scalePresetDelta = (
  key: string,
  delta: number,
  strength: number
): number => {
  const s = clamp(strength, 0, 100) / 100
  if (key === 'exposure') {
    return roundTo(delta * s, 0.05)
  }
  const scaled = Math.abs(delta) * s
  const magnitude = Math.round(scaled)
  const rounded = Math.sign(delta) * magnitude
  return rounded === 0 ? 0 : rounded
}

export const computePresetAdjustments = (
  presetId: PresetId,
  stats: ImageStats | null
): PresetAdjustments => {
  const auto = stats
    ? computeAuto(stats)
    : {
        exposure: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        temperature: 0,
        tint: 0,
        vibrance: 0
      }

  switch (presetId) {
    case 'natural':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.7, 0.05),
          contrast: Math.round(auto.contrast * 0.6),
          highlights: Math.round(auto.highlights * 0.8),
          shadows: Math.round(auto.shadows * 0.8),
          whites: Math.round(auto.whites * 0.7),
          blacks: Math.round(auto.blacks * 0.7),
          temperature: Math.round(auto.temperature * 0.5),
          tint: Math.round(auto.tint * 0.5),
          vibrance: Math.round(auto.vibrance * 0.5) + 6,
          clarity: 10,
          texture: 6
        },
        subject: { clarity: 10 },
        background: { clarity: -5 }
      }

    case 'vivid':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.8, 0.05),
          contrast: Math.round(auto.contrast * 0.6) + 14,
          highlights: Math.round(auto.highlights * 0.8) - 10,
          shadows: Math.round(auto.shadows * 0.8) + 10,
          whites: Math.round(auto.whites * 0.7) + 8,
          blacks: Math.round(auto.blacks * 0.7) - 6,
          saturation: 16,
          vibrance: Math.round(auto.vibrance * 0.5) + 22,
          clarity: 14,
          texture: 10
        },
        subject: { saturation: 10, clarity: 12 },
        background: { saturation: -4 }
      }

    case 'dramatic':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.6, 0.05),
          contrast: Math.round(auto.contrast * 0.5) + 26,
          highlights: Math.round(auto.highlights * 0.8) - 16,
          shadows: Math.round(auto.shadows * 0.5) - 14,
          whites: Math.round(auto.whites * 0.5) + 10,
          blacks: Math.round(auto.blacks * 0.5) - 18,
          vibrance: -6,
          clarity: 24,
          texture: 14,
          vignette: -20
        },
        subject: { exposure: 0.15, clarity: 15 },
        background: { exposure: -0.2, shadows: -10 }
      }

    case 'warm':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.7, 0.05),
          contrast: Math.round(auto.contrast * 0.6) + 6,
          highlights: Math.round(auto.highlights * 0.8) - 8,
          shadows: Math.round(auto.shadows * 0.8) + 14,
          whites: Math.round(auto.whites * 0.7),
          blacks: Math.round(auto.blacks * 0.7) - 6,
          temperature: 18,
          tint: 4,
          vibrance: Math.round(auto.vibrance * 0.5) + 12,
          clarity: 8
        },
        subject: { temperature: 8 },
        background: { temperature: 12 }
      }

    case 'cool':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.7, 0.05),
          contrast: Math.round(auto.contrast * 0.6) + 10,
          highlights: Math.round(auto.highlights * 0.8) + 10,
          shadows: Math.round(auto.shadows * 0.8) + 6,
          whites: Math.round(auto.whites * 0.7) + 6,
          blacks: Math.round(auto.blacks * 0.7) - 8,
          temperature: -16,
          tint: -4,
          vibrance: Math.round(auto.vibrance * 0.5) + 8,
          clarity: 12
        },
        subject: { clarity: 10 },
        background: { temperature: -8 }
      }

    case 'mono':
      return {
        global: {
          exposure: roundTo(auto.exposure * 0.7, 0.05),
          contrast: Math.round(auto.contrast * 0.6) + 24,
          highlights: Math.round(auto.highlights * 0.8) - 12,
          shadows: Math.round(auto.shadows * 0.8) + 12,
          whites: Math.round(auto.whites * 0.7) + 12,
          blacks: Math.round(auto.blacks * 0.7) - 14,
          saturation: -100,
          clarity: 20,
          texture: 10,
          vignette: -12
        },
        subject: { clarity: 15 },
        background: { clarity: -10 }
      }
  }
}

export const applyPreset = (
  recipe: Recipe,
  presetId: PresetId,
  strength: number,
  stats: ImageStats | null,
  baseline?: Recipe
): Recipe => {
  const base = baseline ?? recipe
  const preset = computePresetAdjustments(presetId, stats)
  const nextAdjustments: Adjustments = { ...base.adjustments }

  for (const [key, delta] of Object.entries(preset.global)) {
    if (delta === undefined) continue
    const baseVal = (base.adjustments[key as keyof Adjustments] ?? 0) as number
    const scaledDelta = scalePresetDelta(key, delta, strength)
    if (key === 'exposure') {
      const sum = clamp(roundTo(baseVal + scaledDelta, 0.05), -5, 5)
      if (sum !== 0) nextAdjustments.exposure = sum
      else delete nextAdjustments.exposure
    } else {
      const sum = clamp(Math.round(baseVal + scaledDelta), -100, 100)
      if (sum !== 0) nextAdjustments[key as keyof Adjustments] = sum
      else delete nextAdjustments[key as keyof Adjustments]
    }
  }

  const subject = getEnhanceSubject(recipe)
  const background = subject ? getBackgroundOf(recipe, subject.id) : undefined

  const applyMaskDeltas = (
    maskAdj: MaskAdjustments,
    presetMask: Partial<Adjustments> | undefined
  ): MaskAdjustments => {
    if (!presetMask) return maskAdj
    const result: MaskAdjustments = { ...maskAdj }
    for (const [key, delta] of Object.entries(presetMask)) {
      if (delta === undefined || key === 'vignette') continue
      const baseVal = (maskAdj[key as keyof MaskAdjustments] ?? 0) as number
      const scaledDelta = scalePresetDelta(key, delta, strength)
      if (key === 'exposure') {
        const sum = clamp(roundTo(baseVal + scaledDelta, 0.05), -5, 5)
        if (sum !== 0) result.exposure = sum
        else delete result.exposure
      } else {
        const sum = clamp(Math.round(baseVal + scaledDelta), -100, 100)
        if (sum !== 0) result[key as keyof MaskAdjustments] = sum
        else delete result[key as keyof MaskAdjustments]
      }
    }
    return result
  }

  const baseMasksById = new Map(base.masks.map((m) => [m.id, m]))

  const masks = recipe.masks.map((mask) => {
    const baseMask = baseMasksById.get(mask.id)
    const baseAdj = baseMask ? baseMask.adjustments : mask.adjustments

    if (subject && mask.id === subject.id) {
      return {
        ...mask,
        adjustments: applyMaskDeltas(baseAdj, preset.subject)
      }
    }
    if (background && mask.id === background.id) {
      return {
        ...mask,
        adjustments: applyMaskDeltas(baseAdj, preset.background)
      }
    }
    return mask
  })

  return {
    ...recipe,
    geometry: recipe.geometry,
    adjustments: nextAdjustments,
    masks
  }
}
