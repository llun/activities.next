/**
 * How much of a conversation the post page and the fitness activity page load.
 * The page renders the first step; each "Load earlier posts" / "Load more
 * replies" asks `GET /api/v1/statuses/:id/thread` for the next step, and the
 * route caps every request at the last one.
 *
 * Dependency-free on purpose: the route (server) and the thread pager (client)
 * both import it.
 */
export const THREAD_ANCESTORS_LIMIT_STEPS = [40, 120, 400] as const
export const THREAD_DESCENDANTS_LIMIT_STEPS = [60, 200, 500] as const

export const THREAD_INITIAL_ANCESTORS_LIMIT = THREAD_ANCESTORS_LIMIT_STEPS[0]
export const THREAD_INITIAL_DESCENDANTS_LIMIT =
  THREAD_DESCENDANTS_LIMIT_STEPS[0]

export const THREAD_MAX_ANCESTORS_LIMIT =
  THREAD_ANCESTORS_LIMIT_STEPS[THREAD_ANCESTORS_LIMIT_STEPS.length - 1]
export const THREAD_MAX_DESCENDANTS_LIMIT =
  THREAD_DESCENDANTS_LIMIT_STEPS[THREAD_DESCENDANTS_LIMIT_STEPS.length - 1]

/**
 * The step after `current`, or null when `current` is already at (or past)
 * the last step.
 */
export const getNextThreadLimit = (
  steps: readonly number[],
  current: number
): number | null => steps.find((step) => step > current) ?? null
