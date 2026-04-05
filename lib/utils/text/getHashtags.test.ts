import { getHashtags } from './getHashtags'

describe('#getHashtags', () => {
  const host = 'test.llun.dev'

  it('extracts a single hashtag', () => {
    expect(getHashtags('Hello #world', host)).toEqual([
      { name: '#world', value: 'https://test.llun.dev/tags/world' }
    ])
  })

  it('extracts multiple hashtags', () => {
    expect(getHashtags('#hello world #test', host)).toEqual([
      { name: '#hello', value: 'https://test.llun.dev/tags/hello' },
      { name: '#test', value: 'https://test.llun.dev/tags/test' }
    ])
  })

  it('deduplicates hashtags by lowercase', () => {
    expect(getHashtags('#Hello #hello #HELLO', host)).toEqual([
      { name: '#Hello', value: 'https://test.llun.dev/tags/hello' }
    ])
  })

  it('returns empty array when no hashtags', () => {
    expect(getHashtags('No hashtags here', host)).toEqual([])
  })

  it('handles hashtags with numbers and underscores', () => {
    expect(getHashtags('#test_123', host)).toEqual([
      { name: '#test_123', value: 'https://test.llun.dev/tags/test_123' }
    ])
  })

  it('does not match bare hash symbol', () => {
    expect(getHashtags('# not a tag', host)).toEqual([])
  })

  it('extracts hashtag at start of text', () => {
    expect(getHashtags('#first post', host)).toEqual([
      { name: '#first', value: 'https://test.llun.dev/tags/first' }
    ])
  })

  it('extracts hashtag at end of text', () => {
    expect(getHashtags('my post #last', host)).toEqual([
      { name: '#last', value: 'https://test.llun.dev/tags/last' }
    ])
  })

  it('does not match hash fragments in URLs', () => {
    expect(
      getHashtags('Check https://example.com/page#section here', host)
    ).toEqual([])
  })

  it('does not match hex color codes', () => {
    expect(getHashtags('color:#ff0000', host)).toEqual([])
  })

  it('extracts hashtag after newline', () => {
    expect(getHashtags('line one\n#tag', host)).toEqual([
      { name: '#tag', value: 'https://test.llun.dev/tags/tag' }
    ])
  })

  it('does not match purely numeric hashtags', () => {
    expect(getHashtags('#123', host)).toEqual([])
    expect(getHashtags('#456789', host)).toEqual([])
  })

  it('matches hashtags with numbers and at least one letter', () => {
    expect(getHashtags('#2024election', host)).toEqual([
      {
        name: '#2024election',
        value: 'https://test.llun.dev/tags/2024election'
      }
    ])
    expect(getHashtags('#covid19', host)).toEqual([
      { name: '#covid19', value: 'https://test.llun.dev/tags/covid19' }
    ])
  })
})
