import { cleanJson } from './cleanJson'

describe('#cleanJson', () => {
  it('clones simple objects', () => {
    const input = { name: 'test', value: 123 }
    const result = cleanJson(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it('clones nested objects', () => {
    const input = { level1: { level2: { value: 'deep' } } }
    const result = cleanJson(input)
    expect(result).toEqual(input)
    expect(result.level1).not.toBe(input.level1)
  })

  it('clones arrays', () => {
    const input = [1, 2, 3, { nested: true }]
    const result = cleanJson(input)
    expect(result).toEqual(input)
    expect(result).not.toBe(input)
  })

  it('removes undefined values', () => {
    const input = { a: 1, b: undefined }
    const result = cleanJson(input)
    expect(result).toEqual({ a: 1 })
    expect('b' in result).toBe(false)
  })

  it('removes functions', () => {
    const input = { a: 1, fn: () => {} }
    const result = cleanJson(input)
    expect(result).toEqual({ a: 1 })
    expect('fn' in result).toBe(false)
  })

  it('handles null values', () => {
    const input = { a: null, b: 'value' }
    const result = cleanJson(input)
    expect(result).toEqual(input)
  })

  it('handles primitive values', () => {
    expect(cleanJson('string')).toEqual('string')
    expect(cleanJson(123)).toEqual(123)
    expect(cleanJson(true)).toEqual(true)
    expect(cleanJson(null)).toEqual(null)
  })
})
