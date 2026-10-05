import { z } from 'zod'

// The only period keys a heatmap can legitimately have. `all_time` ignores the
// key when selecting files (the UI sends 'all'), so an unconstrained key let a
// caller mint unlimited distinct keys that each created a heatmap row and
// re-ran the whole history. Years are bounded to a plausible window for the
// same reason: it keeps the set of valid keys finite and small.
const MIN_HEATMAP_YEAR = 1970
const MAX_HEATMAP_YEAR = 2100

const YEARLY_KEY = /^\d{4}$/
const MONTHLY_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/

const isYearInRange = (year: number) =>
  year >= MIN_HEATMAP_YEAR && year <= MAX_HEATMAP_YEAR

export const isValidHeatmapPeriodKey = (
  periodType: 'all_time' | 'yearly' | 'monthly',
  periodKey: string
): boolean => {
  switch (periodType) {
    case 'all_time':
      return periodKey === 'all'
    case 'yearly':
      return YEARLY_KEY.test(periodKey) && isYearInRange(Number(periodKey))
    case 'monthly': {
      const match = MONTHLY_KEY.exec(periodKey)
      return Boolean(match) && isYearInRange(Number(match![1]))
    }
  }
}

/**
 * `superRefine` for a request schema holding `period_type` and `period_key`:
 * rejects a key that does not belong to its type.
 */
export const refineHeatmapPeriodKey = (
  value: {
    period_type: 'all_time' | 'yearly' | 'monthly'
    period_key: string
  },
  ctx: z.RefinementCtx
) => {
  if (!isValidHeatmapPeriodKey(value.period_type, value.period_key)) {
    ctx.addIssue({
      code: 'custom',
      path: ['period_key'],
      message: `Invalid period_key for period_type ${value.period_type}`
    })
  }
}
