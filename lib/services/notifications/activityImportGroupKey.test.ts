import { getActivityImportGroupKey } from './activityImportGroupKey'

const ACTOR = 'https://llun.test/users/anna'
const JAN_2 = Date.UTC(2026, 0, 2, 9, 30)

describe('getActivityImportGroupKey', () => {
  it('buckets by the UTC day of the activity', () => {
    expect(getActivityImportGroupKey(ACTOR, JAN_2)).toBe(
      `activity_import:${ACTOR}:2026-01-02`
    )
  })

  it('groups two activities from the same day together', () => {
    expect(getActivityImportGroupKey(ACTOR, Date.UTC(2026, 0, 2, 6))).toBe(
      getActivityImportGroupKey(ACTOR, Date.UTC(2026, 0, 2, 20))
    )
  })

  it('separates activities from different days', () => {
    expect(getActivityImportGroupKey(ACTOR, JAN_2)).not.toBe(
      getActivityImportGroupKey(ACTOR, Date.UTC(2026, 0, 3, 9))
    )
  })

  it.each([
    { description: 'no start time', value: undefined },
    { description: 'a null start time', value: null },
    { description: 'an unparseable start time', value: Number.NaN }
  ])('falls back to today for $description', ({ value }) => {
    const today = new Date().toISOString().slice(0, 10)
    expect(getActivityImportGroupKey(ACTOR, value)).toBe(
      `activity_import:${ACTOR}:${today}`
    )
  })
})
