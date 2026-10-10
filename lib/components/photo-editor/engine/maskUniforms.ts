import type { MaskAdjustments } from '@/lib/services/medias/edit/recipe'

import { SHADER_MASK_COUNT } from './shaders'

/** One mask's sliders as the shader reads them, or null for "changes nothing". */
export type MaskSliders = MaskAdjustments | null

export interface MaskUniforms {
  /** 1 for a channel that has sliders set, else 0. */
  on: [number, number, number, number]
  /** Three vec4 per mask: see MASK_UNIFORM_VEC4S_PER_MASK in shaders.ts. */
  values: Float32Array
}

/** True when the mask has at least one non-zero slider. */
export const hasMaskChanges = (
  adjustments: MaskAdjustments | null | undefined
): adjustments is MaskAdjustments =>
  Boolean(adjustments) &&
  Object.values(adjustments as MaskAdjustments).some(
    (value) => typeof value === 'number' && value !== 0
  )

/**
 * Packs the per-channel sliders into the uniforms of the colour pass. Channel
 * `i` is mask `i` of the recipe. Sliders other than exposure are /100, the
 * same scaling the global uniforms get.
 */
export const packMaskUniforms = (
  masks: ReadonlyArray<MaskSliders>
): MaskUniforms => {
  const on: MaskUniforms['on'] = [0, 0, 0, 0]
  const values = new Float32Array(SHADER_MASK_COUNT * 12)
  masks.slice(0, SHADER_MASK_COUNT).forEach((adjustments, index) => {
    if (!hasMaskChanges(adjustments)) return
    on[index] = 1
    const at = index * 12
    values[at] = adjustments.exposure ?? 0
    values[at + 1] = (adjustments.temperature ?? 0) / 100
    values[at + 2] = (adjustments.tint ?? 0) / 100
    values[at + 3] = (adjustments.whites ?? 0) / 100
    values[at + 4] = (adjustments.blacks ?? 0) / 100
    values[at + 5] = (adjustments.shadows ?? 0) / 100
    values[at + 6] = (adjustments.highlights ?? 0) / 100
    values[at + 7] = (adjustments.contrast ?? 0) / 100
    values[at + 8] = (adjustments.texture ?? 0) / 100
    values[at + 9] = (adjustments.clarity ?? 0) / 100
    values[at + 10] = (adjustments.saturation ?? 0) / 100
    values[at + 11] = (adjustments.vibrance ?? 0) / 100
  })
  return { on, values }
}

/** The sliders of each mask in recipe order; null for a mask that changes nothing. */
export const getMaskSliders = (
  masks: ReadonlyArray<{ adjustments: MaskAdjustments }>
): MaskSliders[] =>
  masks.map((mask) =>
    hasMaskChanges(mask.adjustments) ? mask.adjustments : null
  )
