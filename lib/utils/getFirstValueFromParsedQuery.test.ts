import { getFirstValueFromParsedQuery } from './getFirstValueFromParsedQuery'

describe('#getFirstValueFromParsedQuery', () => {
  it('returns undefined for undefined input', () => {
    expect(getFirstValueFromParsedQuery(undefined)).toBeUndefined()
  })

  it('returns the value directly for non-array input', () => {
    expect(getFirstValueFromParsedQuery('single')).toEqual('single')
    expect(getFirstValueFromParsedQuery(123)).toEqual(123)
    expect(getFirstValueFromParsedQuery({ key: 'value' })).toEqual({
      key: 'value'
    })
  })

  it('returns the first element for array input', () => {
    expect(getFirstValueFromParsedQuery(['first', 'second', 'third'])).toEqual(
      'first'
    )
    expect(getFirstValueFromParsedQuery([1, 2, 3])).toEqual(1)
  })

  it('returns undefined for empty array', () => {
    expect(getFirstValueFromParsedQuery([])).toBeUndefined()
  })

  it('handles null value', () => {
    expect(getFirstValueFromParsedQuery(null)).toEqual(null)
  })

  it('handles array with null as first element', () => {
    expect(getFirstValueFromParsedQuery([null, 'second'])).toEqual(null)
  })
})
