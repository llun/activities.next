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

  describe('preserveLineBreaks', () => {
    it.each([
      {
        description: 'keeps a <br> as a single line break',
        html: '<p>Line one<br>Line two</p>',
        expected: 'Line one\nLine two'
      },
      {
        description: 'separates adjacent block tags with a blank line',
        html: '<p>Line one</p><p>Line two</p>',
        expected: 'Line one\n\nLine two'
      },
      {
        description: 'caps consecutive separators at one blank line',
        html: '<p>Line one<br></p><p>Line two</p>',
        expected: 'Line one\n\nLine two'
      },
      {
        description: 'still collapses runs of spaces within a line',
        html: '<p>Line   one</p>',
        expected: 'Line one'
      },
      {
        description: 'treats null input as empty text',
        html: null,
        expected: ''
      }
    ])('$description', ({ html, expected }) => {
      expect(htmlToPlainText(html, { preserveLineBreaks: true })).toBe(expected)
    })
  })
})
