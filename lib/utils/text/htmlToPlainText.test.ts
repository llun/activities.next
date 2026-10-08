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
    },
    {
      description: 'decodes entities exactly once',
      html: '<p>&amp;lt;b&amp;gt;</p>',
      expected: '&lt;b&gt;'
    },
    {
      description: 'decodes decimal and hex numeric entities',
      html: '<p>&#39;fast&#39; &#x41;&#66;</p>',
      expected: "'fast' AB"
    },
    {
      description: 'does not separate adjacent inline elements',
      html: '<a href="#">@<span>null</span></a>',
      expected: '@null'
    }
  ])('$description', ({ html, expected }) => {
    expect(htmlToPlainText(html)).toBe(expected)
  })

  it('survives markup nested far deeper than the stack allows, keeping its text', () => {
    const depth = 50_000
    const html = `${'<div>'.repeat(depth)}deep bio${'</div>'.repeat(depth)}`

    expect(htmlToPlainText(html)).toBe('deep bio')
  })

  it('keeps text from tags past the nesting limit', () => {
    const depth = 25
    const html = `${'<div>'.repeat(depth)}<p>inner</p> outer${'</div>'.repeat(depth)}`

    expect(htmlToPlainText(html)).toBe('inner outer')
  })
})

describe('htmlToPlainText matchStatusBody', () => {
  const quoteHtml =
    '<p>take</p><p class="quote-inline">RE: <a href="https://r.social/1">link</a></p>'

  it.each([
    {
      description: 'ignores classes by default',
      html: '<a href="x"><span class="invisible">https://</span><span class="ellipsis">a.com/b</span></a>',
      options: undefined,
      expected: 'https://a.com/b'
    },
    {
      description: 'drops invisible parts and marks the ellipsis',
      html: '<a href="x"><span class="invisible">https://</span><span class="ellipsis">a.com/b</span><span class="invisible">c</span></a>',
      options: { matchStatusBody: true },
      expected: 'a.com/b…'
    },
    {
      description: 'keeps quote-inline unless hideQuoteInline is set',
      html: quoteHtml,
      options: { matchStatusBody: true },
      expected: 'take RE: link'
    },
    {
      description: 'drops quote-inline when hideQuoteInline is set',
      html: quoteHtml,
      options: { matchStatusBody: true, hideQuoteInline: true },
      expected: 'take'
    }
  ])('$description', ({ html, options, expected }) => {
    expect(htmlToPlainText(html, options)).toBe(expected)
  })
})
