import type { Adjustments } from '@/lib/services/medias/edit/recipe'

import {
  BLACKS_RANGE,
  WHITES_RANGE,
  clamp,
  linearToSrgb,
  srgbToLinear
} from './colour'
import type { ImageStats } from './histogram'

/** The keys Auto sets; texture, clarity, saturation and vignette are left alone. */
export const AUTO_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'vibrance'
] as const satisfies ReadonlyArray<keyof Adjustments>

const roundTo = (value: number, step: number) =>
  Number((Math.round(value / step) * step).toFixed(6)) + 0

/** Rounds an integer slider and zeroes anything under 3. */
const slider = (value: number) => {
  const rounded = Math.round(value) + 0
  return Math.abs(rounded) < 3 ? 0 : rounded
}

const TARGET_LUMA = 0.18
const TARGET_SD = 0.21

/**
 * Suggests light and colour adjustments from the preview's statistics
 * (§2.7). Every key in `AUTO_KEYS` is present in the result, 0 where the
 * photo needs nothing, so applying it clears those keys first.
 */
export const computeAuto = (
  stats: ImageStats
): Required<Pick<Adjustments, (typeof AUTO_KEYS)[number]>> => {
  // Exposure: blend meanLinear with srgbToLinear(p50), aim at TARGET_LUMA.
  const p50Linear =
    stats.p50 !== undefined ? srgbToLinear(stats.p50) : stats.meanLinear
  const effectiveMean = Math.max(
    stats.meanLinear * 0.65 + p50Linear * 0.35,
    1e-4
  )
  let rawExp = Math.log2(TARGET_LUMA / effectiveMean) * 0.45
  if (rawExp > 0 && stats.fractionHigh > 0.02) {
    rawExp *= Math.max(0.2, 1 - stats.fractionHigh * 6)
  }
  let exposure = roundTo(clamp(rawExp, -0.85, 0.85), 0.05)
  if (Math.abs(exposure) < 0.05) exposure = 0

  // Whites and blacks: post-exposure p005 and p995 gently mapped.
  const afterExposure = (value: number) =>
    linearToSrgb(srgbToLinear(value) * Math.pow(2, exposure))
  const low = afterExposure(stats.p005)
  const high = afterExposure(stats.p995)
  let whites = 0
  let blacks = 0
  if (high - low > 1e-3) {
    const span = (high - low) / (0.97 - 0.03)
    const bp = low - 0.03 * span
    const wp = bp + span
    blacks = slider(clamp(Math.round((-bp / BLACKS_RANGE) * 50), -20, 20))
    whites = slider(clamp(Math.round(((1 - wp) / WHITES_RANGE) * 50), -20, 25))
  }

  // Contrast
  const contrast = slider(
    clamp(Math.round(((TARGET_SD - stats.sd) / TARGET_SD) * 45), -15, 22)
  )

  // Highlights and shadows
  const highlights =
    stats.fractionHigh > 0.015
      ? slider(clamp(-Math.round((stats.fractionHigh - 0.015) * 220), -40, 0))
      : 0
  const shadows =
    stats.fractionLow > 0.04
      ? slider(clamp(Math.round((stats.fractionLow - 0.04) * 180), 0, 35))
      : 0

  // Temperature & Tint (Safe Neutral-Only WB)
  let temperature = 0
  let tint = 0
  if (stats.neutralMidtone && stats.neutralMidtone.weight >= 0.04) {
    const { r, g, b } = stats.neutralMidtone
    if (r + b > 0) {
      const diffTemp = (b - r) / (b + r)
      const DEADBAND_TEMP = 0.02
      if (Math.abs(diffTemp) > DEADBAND_TEMP) {
        const sign = Math.sign(diffTemp)
        const magnitude = (Math.abs(diffTemp) - DEADBAND_TEMP) * 60
        temperature = slider(clamp(Math.round(sign * magnitude), -10, 10))
      }
    }
    if (g > 0) {
      const avgRb = (r + b) / 2
      const diffTint = (g - avgRb) / g
      const DEADBAND_TINT = 0.02
      if (Math.abs(diffTint) > DEADBAND_TINT) {
        const sign = Math.sign(diffTint)
        const magnitude = (Math.abs(diffTint) - DEADBAND_TINT) * 50
        tint = slider(clamp(Math.round(sign * magnitude), -6, 6))
      }
    }
  }

  // Vibrance
  const vibrance = slider(
    clamp(Math.round((0.24 - stats.meanChroma) * 75), 0, 18)
  )

  return {
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature,
    tint,
    vibrance
  }
}
