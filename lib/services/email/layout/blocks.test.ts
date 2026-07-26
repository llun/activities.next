import {
  button,
  fallbackUrl,
  headline,
  label,
  note,
  paragraph,
  quote
} from './blocks'
import { MONOGRAM_PALETTE } from './theme'

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

  it('lets an over-long unbroken word wrap instead of overflowing the card', () => {
    expect(paragraph('a').html).toContain('word-wrap:break-word')
  })

  it('uses a tighter bottom margin when tight is set', () => {
    // Asserted as a string on purpose: the visible effect is Outlook-only.
    // Standards engines collapse the 4px with the next block's 20px margin-top
    // to the same 20px the default gives, so a rendered-gap assertion would see
    // no difference and read as dead code. Word does not collapse margins, and
    // there this is what keeps the gap near 20px instead of 40px.
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

  it('carries both halves of the outlook padding recipe', () => {
    const { html } = button({ label: 'Go', url: 'https://example.com' })
    // The cell supplies the padding Word drops from the inline anchor, and the
    // anchor resets its own so Outlook does not apply both.
    expect(html).toContain('mso-padding-alt:10px 20px;')
    expect(html).toContain('mso-padding-alt:0;')
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
    // Both properties are needed: Outlook's Word engine honours only
    // word-wrap, everything else honours word-break.
    expect(html).toContain('word-break:break-all')
    expect(html).toContain('word-wrap:break-word')
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
  it('is separated from the body by a hairline rule', () => {
    expect(note('You can ignore this email.').html).toContain(
      'border-top:1px solid'
    )
  })

  it('escapes the text', () => {
    expect(note(XSS).html).not.toContain('<script>')
  })

  it('lets an over-long unbroken word wrap instead of overflowing the card', () => {
    expect(note('a').html).toContain('word-wrap:break-word')
  })
})

describe('quote', () => {
  const author = { displayName: 'Ben Carter', handle: '@ben@example.com' }

  it('renders the monogram, display name and handle', () => {
    const { html } = quote({ author })
    expect(html).toContain('>BC</td>')
    expect(html).toContain('>Ben Carter</td>')
    expect(html).toContain('>@ben@example.com</td>')
  })

  it('gives the monogram a colour from the palette', () => {
    const { html } = quote({ author })
    const bgcolor = html.match(
      /bgcolor="(#[0-9a-f]{6})" style="width:24px/
    )?.[1]
    expect(MONOGRAM_PALETTE).toContain(bgcolor)
  })

  it('renders the actor row alone when there is no body', () => {
    const { html, text } = quote({ author })
    expect(html).not.toContain('margin-top:8px')
    expect(text).toBe('Ben Carter (@ben@example.com)')
  })

  it('renders a pre-sanitized body below the actor row', () => {
    const { html, text } = quote({
      author,
      body: { html: '<p>Hello <b>there</b></p>', text: 'Hello there' }
    })
    expect(html).toContain('<p>Hello <b>there</b></p>')
    expect(text).toBe('Ben Carter (@ben@example.com)\nHello there')
  })

  it('escapes the display name and handle', () => {
    const { html } = quote({ author: { displayName: XSS, handle: XSS } })
    expect(html).not.toContain(XSS)
    expect(html).not.toContain('<script')
  })

  it('emits the body html verbatim because it is already sanitized', () => {
    // The single unescaped slot in the layout. It is the caller's job to have
    // run getStatusBody first; this asserts the contract rather than a bug.
    const { html } = quote({
      author,
      body: { html: '<a href="https://example.com/x">link</a>', text: 'link' }
    })
    expect(html).toContain('<a href="https://example.com/x">link</a>')
  })

  it('lets a long unbroken body word wrap', () => {
    const { html } = quote({ author, body: { html: 'x', text: 'x' } })
    expect(html).toContain('word-wrap:break-word')
  })
})
