import { getHashtags } from './getHashtags'

describe('#getHashtags', () => {
  const host = 'test.llun.dev'
  const tag = (name: string, slug: string) => ({
    name,
    value: `https://${host}/tags/${slug}`
  })

  it.each([
    {
      description: 'extracts a single hashtag',
      text: 'Hello #world',
      expected: [tag('#world', 'world')]
    },
    {
      description: 'extracts multiple hashtags',
      text: '#hello world #test',
      expected: [tag('#hello', 'hello'), tag('#test', 'test')]
    },
    {
      description:
        'deduplicates hashtags by lowercase, keeping the first casing',
      text: '#Hello #hello #HELLO',
      expected: [tag('#Hello', 'hello')]
    },
    {
      description: 'returns an empty array when there are no hashtags',
      text: 'No hashtags here',
      expected: []
    },
    {
      description: 'keeps numbers and underscores in a hashtag',
      text: '#test_123',
      expected: [tag('#test_123', 'test_123')]
    },
    {
      description: 'does not match a bare hash symbol',
      text: '# not a tag',
      expected: []
    },
    {
      description: 'extracts a hashtag at the start of the text',
      text: '#first post',
      expected: [tag('#first', 'first')]
    },
    {
      description: 'extracts a hashtag at the end of the text',
      text: 'my post #last',
      expected: [tag('#last', 'last')]
    },
    {
      description: 'does not match hash fragments in URLs',
      text: 'Check https://example.com/page#section here',
      expected: []
    },
    {
      description: 'does not match hex color codes',
      text: 'color:#ff0000',
      expected: []
    },
    {
      description: 'extracts a hashtag after a newline',
      text: 'line one\n#tag',
      expected: [tag('#tag', 'tag')]
    },
    {
      description: 'does not match a short purely numeric hashtag',
      text: '#123',
      expected: []
    },
    {
      description: 'does not match a long purely numeric hashtag',
      text: '#456789',
      expected: []
    },
    {
      description:
        'matches a hashtag that starts with numbers but contains a letter',
      text: '#2024election',
      expected: [tag('#2024election', '2024election')]
    },
    {
      description: 'matches a hashtag that ends with numbers',
      text: '#covid19',
      expected: [tag('#covid19', 'covid19')]
    }
  ])('$description', ({ text, expected }) => {
    expect(getHashtags(text, host)).toEqual(expected)
  })
})
