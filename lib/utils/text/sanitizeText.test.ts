import { SANITIZED_OPTION, sanitizeText } from './sanitizeText'

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

    it('removes img tags', () => {
      const input = '<img src="https://example.com/image.jpg"><p>Text</p>'
      expect(sanitizeText(input)).toEqual('<p>Text</p>')
    })

    it('allows mailto links', () => {
      const input = '<a href="mailto:test@example.com">Email</a>'
      expect(sanitizeText(input)).toEqual(
        '<a href="mailto:test@example.com">Email</a>'
      )
    })

    it('allows tel links', () => {
      const input = '<a href="tel:+1234567890">Call</a>'
      expect(sanitizeText(input)).toEqual('<a href="tel:+1234567890">Call</a>')
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
})
