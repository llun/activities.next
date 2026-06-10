import { timingSafeStringEqual } from './timingSafeStringEqual'

describe('timingSafeStringEqual', () => {
  it.each([
    {
      description: 'returns true for identical strings',
      a: 'secret-token',
      b: 'secret-token',
      expected: true
    },
    {
      description: 'returns false for different strings of equal length',
      a: 'secret-token',
      b: 'secret-tokem',
      expected: false
    },
    {
      description: 'returns false for strings of different lengths',
      a: 'secret-token',
      b: 'secret',
      expected: false
    },
    {
      description: 'returns true for empty strings',
      a: '',
      b: '',
      expected: true
    },
    {
      description: 'returns false when first value is null',
      a: null,
      b: 'secret',
      expected: false
    },
    {
      description: 'returns false when second value is undefined',
      a: 'secret',
      b: undefined,
      expected: false
    },
    {
      description: 'returns false when both values are null',
      a: null,
      b: null,
      expected: false
    }
  ])('$description', ({ a, b, expected }) => {
    expect(timingSafeStringEqual(a, b)).toBe(expected)
  })
})
