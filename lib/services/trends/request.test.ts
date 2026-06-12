import {
  TRENDS_DEFAULT_LIMIT,
  TRENDS_MAX_LIMIT,
  normalizeTrendsLimit,
  normalizeTrendsOffset
} from './request'

describe('normalizeTrendsLimit', () => {
  it.each([
    {
      description: 'valid in-range limit passes through',
      value: '5',
      expected: 5
    },
    {
      description: 'minimum limit of one passes through',
      value: '1',
      expected: 1
    },
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
      description: 'negative limit falls back to the default',
      value: '-5',
      expected: TRENDS_DEFAULT_LIMIT
    },
    {
      description: 'decimal limit falls back to the default',
      value: '5.9',
      expected: TRENDS_DEFAULT_LIMIT
    },
    {
      description: 'non-numeric limit falls back to the default',
      value: 'garbage',
      expected: TRENDS_DEFAULT_LIMIT
    },
    {
      description: 'absent limit falls back to the default',
      value: null,
      expected: TRENDS_DEFAULT_LIMIT
    }
  ])('$description', ({ value, expected }) => {
    expect(normalizeTrendsLimit(value)).toBe(expected)
  })
})

describe('normalizeTrendsOffset', () => {
  it.each([
    {
      description: 'valid positive offset passes through',
      value: '5',
      expected: 5
    },
    { description: 'zero offset stays zero', value: '0', expected: 0 },
    {
      description: 'negative offset falls back to zero',
      value: '-3',
      expected: 0
    },
    {
      description: 'decimal offset falls back to zero',
      value: '2.5',
      expected: 0
    },
    {
      description: 'non-numeric offset falls back to zero',
      value: 'garbage',
      expected: 0
    },
    {
      description: 'absent offset falls back to zero',
      value: null,
      expected: 0
    }
  ])('$description', ({ value, expected }) => {
    expect(normalizeTrendsOffset(value)).toBe(expected)
  })
})
