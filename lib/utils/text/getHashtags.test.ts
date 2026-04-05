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
})
