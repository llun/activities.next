import { coercePollEndAt } from '@/lib/database/sql/utils/coercePollEndAt'

describe('coercePollEndAt', () => {
  it('returns a finite numeric timestamp unchanged', () => {
    expect(coercePollEndAt(1_700_000_000_000)).toEqual(1_700_000_000_000)
  })

  it('parses an ISO 8601 date string into a timestamp', () => {
    expect(coercePollEndAt('2023-11-14T22:13:20.000Z')).toEqual(
      Date.parse('2023-11-14T22:13:20.000Z')
    )
  })

  it('parses a SQLite UTC timestamp string into a timestamp', () => {
    expect(coercePollEndAt('2023-11-14 22:13:20')).toEqual(
      Date.parse('2023-11-14T22:13:20Z')
    )
  })

  it('coerces a Date instance into a timestamp', () => {
    const date = new Date('2023-11-14T22:13:20.000Z')
    expect(coercePollEndAt(date)).toEqual(date.getTime())
  })

  it.each([
    { description: 'null', value: null },
    { description: 'undefined', value: undefined },
    { description: 'an unparseable string', value: 'not-a-date' },
    { description: 'a non-time object', value: { foo: 'bar' } },
    { description: 'a boolean', value: true }
  ])('falls back to Date.now() for $description', ({ value }) => {
    const before = Date.now()
    const result = coercePollEndAt(value)
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(after)
  })
})
