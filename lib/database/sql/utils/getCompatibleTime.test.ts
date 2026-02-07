import { getCompatibleTime } from './getCompatibleTime'

describe('getCompatibleTime', () => {
  it('returns the number value unchanged', () => {
    expect(getCompatibleTime(123)).toBe(123)
  })

  it('returns timestamp from a date object', () => {
    const date = new Date('2025-01-02T03:04:05.000Z')
    expect(getCompatibleTime(date)).toBe(date.getTime())
  })

  it('returns timestamp from a date string', () => {
    expect(getCompatibleTime('2025-01-02T03:04:05.000Z')).toBe(
      new Date('2025-01-02T03:04:05.000Z').getTime()
    )
  })

  it('returns NaN for an invalid date string', () => {
    expect(getCompatibleTime('not-a-date')).toBeNaN()
  })
})
