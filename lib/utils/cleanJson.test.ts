import { cleanJson } from './cleanJson'

describe('cleanJson', () => {
  it.each([
    {
      description: 'simple objects',
      input: { name: 'test', value: 123 },
      nested: (value: { name: string; value: number }) => value
    },
    {
      description: 'nested objects',
      input: { level1: { level2: { value: 'deep' } } },
      nested: (value: { level1: unknown }) => value.level1
    },
    {
      description: 'arrays',
      input: [1, 2, 3, { nested: true }],
      nested: (value: unknown[]) => value[3]
    }
  ])('clones $description', ({ input, nested }) => {
    const result = cleanJson(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
    // The copy is deep: nested containers are new objects too.
    expect(nested(result as never)).not.toBe(nested(input as never))
  })

  it('drops undefined values and functions but keeps null', () => {
    const input = { a: 1, b: undefined, fn: () => {}, c: null, d: 'value' }
    const result = cleanJson(input)
    expect(result).toEqual({ a: 1, c: null, d: 'value' })
    expect('b' in result).toBe(false)
    expect('fn' in result).toBe(false)
  })

  it('handles primitive values', () => {
    expect(cleanJson('string')).toEqual('string')
    expect(cleanJson(123)).toEqual(123)
    expect(cleanJson(true)).toEqual(true)
    expect(cleanJson(null)).toEqual(null)
  })
})
