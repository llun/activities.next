import { htmlToPlainText } from './htmlToPlainText'

describe('htmlToPlainText', () => {
  it.each([
    {
      description: 'decodes entities after stripping HTML tags',
      html: '<p>Tom &amp; Jerry &lt;run&gt; fast</p>',
      expected: 'Tom & Jerry <run> fast'
    },
    {
      description: 'separates adjacent block tags with spaces',
      html: '<p>Line one</p><p>Line two</p>',
      expected: 'Line one Line two'
    },
    {
      description: 'separates line breaks with spaces',
      html: '<p>Line one<br>Line two</p>',
      expected: 'Line one Line two'
    },
    {
      description: 'treats null input as empty text',
      html: null,
      expected: ''
    },
    {
      description: 'treats undefined input as empty text',
      html: undefined,
      expected: ''
    },
    {
      description: 'drops script and style contents',
      html: '<p>Hello</p><script>alert("x")</script><style>.hidden{display:none}</style>',
      expected: 'Hello'
    }
  ])('$description', ({ html, expected }) => {
    expect(htmlToPlainText(html)).toBe(expected)
  })
})
