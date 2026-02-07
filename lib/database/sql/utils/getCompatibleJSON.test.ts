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
    expect(getCompatibleJSON<{}>(undefined as unknown as {})).toEqual({})
    expect(getCompatibleJSON<{}>(null as unknown as {})).toEqual({})
  })

  it('throws for invalid JSON string', () => {
    expect(() => getCompatibleJSON('{invalid json')).toThrow(SyntaxError)
  })
})
