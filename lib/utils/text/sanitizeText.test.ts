import {
  SANITIZED_OPTION,
  sanitizeText,
  sanitizeTrustedStatusText
} from './sanitizeText'

describe('sanitizeText', () => {
  describe('SANITIZED_OPTION', () => {
    it('has correct allowed tags', () => {
      expect(SANITIZED_OPTION.allowedTags).toContain('p')
      expect(SANITIZED_OPTION.allowedTags).toContain('br')
      expect(SANITIZED_OPTION.allowedTags).toContain('a')
      expect(SANITIZED_OPTION.allowedTags).toContain('span')
      expect(SANITIZED_OPTION.allowedTags).toContain('strong')
      expect(SANITIZED_OPTION.allowedTags).toContain('em')
      expect(SANITIZED_OPTION.allowedTags).toContain('code')
      expect(SANITIZED_OPTION.allowedTags).toContain('pre')
      expect(SANITIZED_OPTION.allowedTags).toContain('blockquote')
      expect(SANITIZED_OPTION.allowedTags).toContain('ul')
      expect(SANITIZED_OPTION.allowedTags).toContain('ol')
      expect(SANITIZED_OPTION.allowedTags).toContain('li')
    })

    it('does not allow script tag', () => {
      expect(SANITIZED_OPTION.allowedTags).not.toContain('script')
    })

    it('has correct allowed attributes for links', () => {
      expect(SANITIZED_OPTION.allowedAttributes?.a).toContain('href')
      expect(SANITIZED_OPTION.allowedAttributes?.a).toContain('rel')
      expect(SANITIZED_OPTION.allowedAttributes?.a).toContain('class')
      expect(SANITIZED_OPTION.allowedAttributes?.a).toContain('target')
    })
  })

  describe('#sanitizeText', () => {
    it('allows basic paragraph tags', () => {
      const input = '<p>Hello world</p>'
      expect(sanitizeText(input)).toEqual('<p>Hello world</p>')
    })

    it('allows links with href', () => {
      const input = '<a href="https://example.com">Link</a>'
      expect(sanitizeText(input)).toEqual(
        '<a href="https://example.com">Link</a>'
      )
    })

    it('allows links with rel attribute', () => {
      const input =
        '<a href="https://example.com" rel="nofollow noopener">Link</a>'
      expect(sanitizeText(input)).toContain('rel="nofollow noopener"')
    })

    it('preserves blank link targets with opener protection', () => {
      const input = '<a href="https://example.com" target="_blank">Link</a>'
      expect(sanitizeText(input)).toEqual(
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Link</a>'
      )
    })

    it('allows span with class', () => {
      const input = '<span class="mention">@user</span>'
      expect(sanitizeText(input)).toEqual('<span class="mention">@user</span>')
    })

    it('allows formatting tags', () => {
      const input = '<strong>bold</strong> <em>italic</em> <del>deleted</del>'
      expect(sanitizeText(input)).toEqual(
        '<strong>bold</strong> <em>italic</em> <del>deleted</del>'
      )
    })

    it('allows code blocks', () => {
      const input = '<pre><code>const x = 1;</code></pre>'
      expect(sanitizeText(input)).toEqual(
        '<pre><code>const x = 1;</code></pre>'
      )
    })

    it('allows blockquotes', () => {
      const input = '<blockquote>Quoted text</blockquote>'
      expect(sanitizeText(input)).toEqual(
        '<blockquote>Quoted text</blockquote>'
      )
    })

    it('allows lists', () => {
      const input = '<ul><li>Item 1</li><li>Item 2</li></ul>'
      expect(sanitizeText(input)).toEqual(
        '<ul><li>Item 1</li><li>Item 2</li></ul>'
      )
    })

    it('allows ordered lists with start attribute', () => {
      const input = '<ol start="5"><li>Item</li></ol>'
      expect(sanitizeText(input)).toEqual('<ol start="5"><li>Item</li></ol>')
    })

    it('removes script tags', () => {
      const input = '<p>Hello</p><script>alert("xss")</script>'
      expect(sanitizeText(input)).toEqual('<p>Hello</p>')
    })

    it('removes onclick attributes', () => {
      const input = '<p onclick="alert(1)">Click me</p>'
      expect(sanitizeText(input)).toEqual('<p>Click me</p>')
    })

    it('removes style tags', () => {
      const input = '<style>body { color: red }</style><p>Text</p>'
      expect(sanitizeText(input)).toEqual('<p>Text</p>')
    })

    it('removes iframe tags', () => {
      const input = '<iframe src="https://evil.com"></iframe><p>Safe</p>'
      expect(sanitizeText(input)).toEqual('<p>Safe</p>')
    })

    it('removes non-emoji img tags', () => {
      const input = '<img src="https://example.com/image.jpg"><p>Text</p>'
      expect(sanitizeText(input)).toEqual('<p>Text</p>')
    })

    it('removes remote content images that are not custom emoji', () => {
      const input =
        '<p>Before<img class="u-photo" src="https://example.com/photo.jpg" alt="photo">After</p>'
      expect(sanitizeText(input)).toEqual('<p>BeforeAfter</p>')
    })

    it('removes emoji img tags from untrusted input', () => {
      const input =
        '<img class="emoji" src="https://example.com/image.jpg" alt=":emoji:">'
      expect(sanitizeText(input)).toEqual('')
    })

    it('removes emoji img tags inside untrusted status text', () => {
      const input =
        '<p>Status with <img class="emoji" src="https://example.com/emoji.png" alt=":emoji:"> custom emoji</p>'
      expect(sanitizeText(input)).toEqual('<p>Status with  custom emoji</p>')
    })

    it('removes http emoji image sources', () => {
      const input =
        '<img class="emoji" src="http://example.com/image.jpg" alt=":emoji:">'
      expect(sanitizeText(input)).toEqual('')
    })

    it('removes protocol-relative emoji image sources', () => {
      const input =
        '<img class="emoji" src="//example.com/image.jpg" alt=":emoji:">'
      expect(sanitizeText(input)).toEqual('')
    })

    it('allows mailto links', () => {
      const input = '<a href="mailto:test@example.com">Email</a>'
      expect(sanitizeText(input)).toEqual(
        '<a href="mailto:test@example.com">Email</a>'
      )
    })

    it('removes tel links', () => {
      const input = '<a href="tel:+1234567890">Call</a>'
      expect(sanitizeText(input)).toEqual('<a>Call</a>')
    })

    it('removes javascript links', () => {
      const input = '<a href="javascript:alert(1)">Click</a>'
      expect(sanitizeText(input)).toEqual('<a>Click</a>')
    })

    it('handles br tags', () => {
      const input = 'Line 1<br>Line 2'
      expect(sanitizeText(input)).toEqual('Line 1<br />Line 2')
    })
  })

  describe('#sanitizeTrustedStatusText', () => {
    it('preserves generated emoji img tags with padded class attributes', () => {
      const input =
        '<img class=" emoji " src="https://example.com/image.jpg" alt=":emoji:">'

      expect(sanitizeTrustedStatusText(input)).toEqual(
        '<img class="emoji" src="https://example.com/image.jpg" alt=":emoji:" />'
      )
    })

    it('removes trusted img tags without an emoji class', () => {
      const input =
        '<img class=" not-emoji " src="https://example.com/image.jpg" alt="image">'

      expect(sanitizeTrustedStatusText(input)).toEqual('')
    })
  })
})
