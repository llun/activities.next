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

/**
 * Suggests light and colour adjustments from the preview's statistics
 * (§2.7). Every key in `AUTO_KEYS` is present in the result, 0 where the
 * photo needs nothing, so applying it clears those keys first.
 */
export const computeAuto = (
  stats: ImageStats
): Required<Pick<Adjustments, (typeof AUTO_KEYS)[number]>> => {
  // Exposure aims the mean at middle grey, at 60% strength.
  const meanLinear = Math.max(stats.meanLinear, 1e-4)
  let exposure = roundTo(clamp(Math.log2(0.18 / meanLinear) * 0.6, -2, 2), 0.05)
  if (Math.abs(exposure) < 0.05) exposure = 0

  // Whites and blacks: map p0.5 to 0.03 and p99.5 to 0.97 after exposure.
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
    blacks = slider(clamp((-bp / BLACKS_RANGE) * 100, -50, 50))
    whites = slider(clamp(((1 - wp) / WHITES_RANGE) * 100, -50, 50))
  }

  const contrast = slider(clamp(((0.21 - stats.sd) / 0.21) * 80, -20, 30))
  const highlights =
    stats.fractionHigh > 0.02
      ? slider(-clamp(stats.fractionHigh * 500, 10, 60))
      : 0
  const shadows =
    stats.fractionLow > 0.05
      ? slider(clamp(stats.fractionLow * 300, 10, 50))
      : 0

  const { r, g, b } = stats.midtone
  const temperature =
    r + b > 0 ? slider(clamp(((b - r) / (b + r)) * 120, -30, 30)) : 0
  const tint = g > 0 ? slider(clamp(((g - (r + b) / 2) / g) * 100, -20, 20)) : 0
  const vibrance =
    stats.meanChroma < 0.15 ? 20 : stats.meanChroma < 0.25 ? 10 : 0

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
