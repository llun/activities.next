import {
  THREAD_ANCESTORS_LIMIT_STEPS,
  THREAD_DESCENDANTS_LIMIT_STEPS,
  getNextThreadLimit,
  getThreadLimitSteps
} from './threadPageLimits'

describe('threadPageLimits', () => {
  it('lets a signed-in reader go through every step', () => {
    expect(getThreadLimitSteps(true)).toEqual({
      ancestors: [...THREAD_ANCESTORS_LIMIT_STEPS],
      descendants: [...THREAD_DESCENDANTS_LIMIT_STEPS]
    })
  })

  it('stops a signed-out reader at the middle step', () => {
    const steps = getThreadLimitSteps(false)
    expect(steps).toEqual({ ancestors: [40, 120], descendants: [60, 200] })
    expect(getNextThreadLimit(steps.descendants, 200)).toBeNull()
  })

  it('names the next step, or none past the last', () => {
    expect(getNextThreadLimit(THREAD_DESCENDANTS_LIMIT_STEPS, 60)).toBe(200)
    expect(getNextThreadLimit(THREAD_DESCENDANTS_LIMIT_STEPS, 500)).toBeNull()
  })
})
