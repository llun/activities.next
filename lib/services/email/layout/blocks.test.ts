import { button, fallbackUrl, headline, label, note, paragraph } from './blocks'

const XSS = '"><script>alert(1)</script>'

describe('headline', () => {
  it('renders the text in an h1', () => {
    expect(headline('Reset your password').html).toContain(
      '>Reset your password</h1>'
    )
  })

  it('carries the text into the plain-text part', () => {
    expect(headline('Reset your password').text).toBe('Reset your password')
  })

  it('escapes the text', () => {
    const { html } = headline(XSS)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('paragraph', () => {
  it('escapes a plain string', () => {
    expect(paragraph(XSS).html).not.toContain('<script>')
  })

  it('uses a tighter bottom margin when tight is set', () => {
    expect(paragraph('a', { tight: true }).html).toContain('margin:0 0 4px')
    expect(paragraph('a').html).toContain('margin:0 0 20px')
  })

  it('renders a bolded fragment', () => {
    const { html, text } = paragraph([
      'Your actor ',
      { strong: '@ben@example.com' },
      ' was deleted.'
    ])
    expect(html).toContain('<strong style="font-weight:600;')
    expect(html).toContain('@ben@example.com</strong>')
    expect(text).toBe('Your actor @ben@example.com was deleted.')
  })

  it('escapes a bolded fragment', () => {
    expect(paragraph([{ strong: XSS }]).html).not.toContain('<script>')
  })

  it('renders a link and keeps the destination in the text part', () => {
    const { html, text } = paragraph([
      'Open ',
      { label: 'the page', href: 'https://example.com/x' }
    ])
    expect(html).toContain('<a href="https://example.com/x"')
    expect(text).toBe('Open the page (https://example.com/x)')
  })

  it('does not repeat a mailto destination that matches its own label', () => {
    const { text } = paragraph([
      { label: 'admin@example.com', href: 'mailto:admin@example.com' }
    ])
    expect(text).toBe('admin@example.com')
  })

  it('degrades an unsafe link to plain text', () => {
    const { html, text } = paragraph([
      { label: 'click', href: 'javascript:alert(1)' }
    ])
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a ')
    expect(text).toBe('click')
  })

  it('escapes a link label and href', () => {
    const { html } = paragraph([
      { label: XSS, href: `https://example.com/?q=${XSS}` }
    ])
    // Assert on the sentinel itself, not on `"><`: that sequence occurs
    // legitimately at every tag boundary (`...">` followed by `<a`), so it
    // would fail on correctly escaped output.
    expect(html).not.toContain(XSS)
    expect(html).not.toContain('<script')
  })
})

describe('label', () => {
  it('renders and escapes the caption', () => {
    expect(label('Your post:').html).toContain('>Your post:</p>')
    expect(label(XSS).html).not.toContain('<script>')
  })
})

describe('button', () => {
  it('puts the background on the td so Outlook keeps it visible', () => {
    expect(
      button({ label: 'View post', url: 'https://example.com' }).html
    ).toContain('<td align="center" bgcolor="#E66A0F"')
  })

  it('renders the label and links to the url', () => {
    const { html, text } = button({
      label: 'View post',
      url: 'https://example.com/p/1'
    })
    expect(html).toContain('href="https://example.com/p/1"')
    expect(html).toContain('>View post</a>')
    expect(text).toBe('View post: https://example.com/p/1')
  })

  it.each([
    { description: 'refuses a javascript url', url: 'javascript:alert(1)' },
    { description: 'refuses a data url', url: 'data:text/html,<script>' },
    { description: 'refuses a relative path', url: '/settings' },
    { description: 'refuses a malformed url', url: 'not a url' }
  ])('$description', ({ url }) => {
    expect(button({ label: 'Go', url })).toEqual({ html: '', text: '' })
  })

  it('escapes the label', () => {
    expect(
      button({ label: XSS, url: 'https://example.com' }).html
    ).not.toContain('<script>')
  })
})

describe('fallbackUrl', () => {
  it('renders the raw url as a breakable link', () => {
    const { html } = fallbackUrl('https://example.com/verify?code=abc')
    expect(html).toContain('word-break:break-all')
    expect(html).toContain('>https://example.com/verify?code=abc</a>')
  })

  it('contributes nothing to the text part because the button already printed it', () => {
    expect(fallbackUrl('https://example.com').text).toBe('')
  })

  it('refuses an unsafe url', () => {
    expect(fallbackUrl('javascript:alert(1)')).toEqual({ html: '', text: '' })
  })
})

describe('note', () => {
  it('renders above a hairline rule', () => {
    expect(note('You can ignore this email.').html).toContain(
      'border-top:1px solid'
    )
  })

  it('escapes the text', () => {
    expect(note(XSS).html).not.toContain('<script>')
  })
})
