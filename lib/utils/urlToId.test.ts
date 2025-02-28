import { idToUrl, urlToId } from '@/lib/utils/urlToId'

describe('#urlToId', () => {
  it('converts all / to :', () => {
    expect(urlToId('https://llun.test/users/test1')).toEqual(
      'llun.test:users:test1'
    )
    expect(urlToId('https://llun.test/users/test1/statuses/status-id')).toEqual(
      'llun.test:users:test1:statuses:status-id'
    )
  })

  it('handles empty strings', () => {
    expect(urlToId('')).toEqual('')
  })

  it('handles URLs with query parameters', () => {
    expect(urlToId('https://llun.test/users/test1?param=value')).toEqual(
      'llun.test:users:test1?param=value'
    )
  })

  it('handles URLs with fragments', () => {
    expect(urlToId('https://llun.test/users/test1#section')).toEqual(
      'llun.test:users:test1#section'
    )
  })

  it('handles URLs with special characters', () => {
    expect(urlToId('https://llun.test/users/test-user+name')).toEqual(
      'llun.test:users:test-user+name'
    )
    expect(urlToId('https://llun.test/users/test%20user')).toEqual(
      'llun.test:users:test%20user'
    )
  })

  it('handles URLs without protocol', () => {
    expect(urlToId('llun.test/users/test1')).toEqual('llun.test:users:test1')
  })
})

describe('#idToUrl', () => {
  it('converts all : to /', () => {
    expect(idToUrl('llun.test:users:test1')).toEqual(
      'https://llun.test/users/test1'
    )
  })

  it('handles empty strings', () => {
    expect(idToUrl('')).toEqual('')
  })

  it('handles IDs with query parameters', () => {
    expect(idToUrl('llun.test:users:test1?param=value')).toEqual(
      'https://llun.test/users/test1?param=value'
    )
  })

  it('handles IDs with fragments', () => {
    expect(idToUrl('llun.test:users:test1#section')).toEqual(
      'https://llun.test/users/test1#section'
    )
  })

  it('handles IDs with special characters', () => {
    expect(idToUrl('llun.test:users:test-user+name')).toEqual(
      'https://llun.test/users/test-user+name'
    )
    expect(idToUrl('llun.test:users:test%20user')).toEqual(
      'https://llun.test/users/test%20user'
    )
  })

  it('preserves https protocol if already in the ID', () => {
    expect(idToUrl('https:llun.test:users:test1')).toEqual(
      'https://llun.test/users/test1'
    )
  })

  it('handles IDs with multiple consecutive colons', () => {
    expect(idToUrl('llun.test:users::test1')).toEqual(
      'https://llun.test/users//test1'
    )
  })
})
