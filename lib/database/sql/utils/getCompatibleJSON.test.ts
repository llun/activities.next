import { getCompatibleJSON } from './getCompatibleJSON'

describe('getCompatibleJSON', () => {
  it('parses JSON string input', () => {
    const value = getCompatibleJSON<{ name: string }>('{"name":"alice"}')
    expect(value).toEqual({ name: 'alice' })
  })

  it('returns object input as-is', () => {
    const value = { id: '1' }
    expect(getCompatibleJSON(value)).toBe(value)
  })

  it('returns empty object for nullish input', () => {
    // @ts-expect-error Testing runtime behavior with undefined input.
    expect(getCompatibleJSON<{}>(undefined)).toEqual({})
    // @ts-expect-error Testing runtime behavior with null input.
    expect(getCompatibleJSON<{}>(null)).toEqual({})
  })

  it('throws for invalid JSON string', () => {
    expect(() => getCompatibleJSON('{invalid json')).toThrow(SyntaxError)
  })
})
