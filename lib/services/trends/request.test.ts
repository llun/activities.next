import {
  TRENDS_DEFAULT_LIMIT,
  TRENDS_MAX_LIMIT,
  TRENDS_STATUSES_DEFAULT_LIMIT,
  TRENDS_STATUSES_MAX_LIMIT,
  normalizeTrendsLimit,
  normalizeTrendsOffset,
  normalizeTrendsStatusesLimit
} from './request'

describe('normalizeTrendsLimit', () => {
  it.each([
    {
      description: 'limit above the max clamps to the max',
      value: '25',
      expected: TRENDS_MAX_LIMIT
    },
    {
      description: 'limit at the max stays at the max',
      value: '20',
      expected: TRENDS_MAX_LIMIT
    },
    {
      description: 'zero limit falls back to the default',
      value: '0',
      expected: TRENDS_DEFAULT_LIMIT
    },
    {
      description: 'decimal limit falls back to the default',
      value: '5.9',
      expected: TRENDS_DEFAULT_LIMIT
    }
  ])('$description', ({ value, expected }) => {
    expect(normalizeTrendsLimit(value)).toBe(expected)
  })
})

describe('normalizeTrendsOffset', () => {
  it.each([
    {
      description: 'negative offset falls back to zero',
      value: '-3',
      expected: 0
    },
    {
      description: 'decimal offset falls back to zero',
      value: '2.5',
      expected: 0
    }
  ])('$description', ({ value, expected }) => {
    expect(normalizeTrendsOffset(value)).toBe(expected)
  })
})

describe('normalizeTrendsStatusesLimit', () => {
  it.each([
    {
      description: 'limit above the max clamps to the max',
      value: '41',
      expected: TRENDS_STATUSES_MAX_LIMIT
    },
    {
      description: 'limit at the max stays at the max',
      value: '40',
      expected: TRENDS_STATUSES_MAX_LIMIT
    },
    {
      description: 'zero limit falls back to the default',
      value: '0',
      expected: TRENDS_STATUSES_DEFAULT_LIMIT
    }
  ])('$description', ({ value, expected }) => {
    expect(normalizeTrendsStatusesLimit(value)).toBe(expected)
  })
})
