import {
  CREATED_AT_INVALID_ERROR,
  CREATED_AT_IN_FUTURE_ERROR,
  MAX_CREATED_AT_CLOCK_SKEW_MS,
  parseBackdatedCreatedAt
} from './backdatedCreatedAt'

const NOW = Date.parse('2026-10-09T12:00:00.000Z')

describe('parseBackdatedCreatedAt', () => {
  it.each([
    { description: 'treats a missing value as now', input: undefined },
    { description: 'treats an empty value as now', input: '' },
    { description: 'treats a whitespace-only value as now', input: '   ' }
  ])('$description', ({ input }) => {
    expect(parseBackdatedCreatedAt(input, NOW)).toEqual({
      ok: true,
      createdAt: undefined
    })
  })

  it.each([
    {
      description: 'accepts a UTC date-time',
      input: '2026-06-14T18:30:00Z',
      expected: Date.parse('2026-06-14T18:30:00Z')
    },
    {
      description: 'accepts a date-time with an offset',
      input: '2026-06-14T20:30:00+02:00',
      expected: Date.parse('2026-06-14T18:30:00Z')
    },
    {
      description: 'accepts fractional seconds and surrounding whitespace',
      input: ' 2026-06-14T18:30:00.123Z ',
      expected: Date.parse('2026-06-14T18:30:00.123Z')
    },
    {
      description: 'accepts the Unix epoch',
      input: '1970-01-01T00:00:00Z',
      expected: 0
    },
    {
      description: 'accepts a time inside the clock-skew allowance',
      input: new Date(NOW + MAX_CREATED_AT_CLOCK_SKEW_MS).toISOString(),
      expected: NOW + MAX_CREATED_AT_CLOCK_SKEW_MS
    }
  ])('$description', ({ input, expected }) => {
    expect(parseBackdatedCreatedAt(input, NOW)).toEqual({
      ok: true,
      createdAt: expected
    })
  })

  it.each([
    {
      description: 'rejects a time just past the clock-skew allowance',
      input: new Date(NOW + MAX_CREATED_AT_CLOCK_SKEW_MS + 1).toISOString(),
      error: CREATED_AT_IN_FUTURE_ERROR
    },
    {
      description: 'rejects a date-time without a time zone',
      input: '2026-06-14T18:30:00',
      error: CREATED_AT_INVALID_ERROR
    },
    {
      description: 'rejects a bare date',
      input: '2026-06-14',
      error: CREATED_AT_INVALID_ERROR
    },
    {
      description: 'rejects a non-date string',
      input: 'yesterday',
      error: CREATED_AT_INVALID_ERROR
    },
    {
      description: 'rejects a time before the Unix epoch',
      input: '1969-12-31T23:59:59Z',
      error: CREATED_AT_INVALID_ERROR
    }
  ])('$description', ({ input, error }) => {
    expect(parseBackdatedCreatedAt(input, NOW)).toEqual({ ok: false, error })
  })
})
