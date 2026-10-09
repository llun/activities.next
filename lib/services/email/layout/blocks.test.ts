import { contrastRatio } from '@/lib/testing/contrast'

import {
  button,
  fallbackUrl,
  headline,
  label,
  note,
  paragraph,
  quote,
  statCard
} from './blocks'
import { INSET_BACKGROUND, MONOGRAM_PALETTE, QUOTE_LINK } from './theme'

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
  it('escapes the text', () => {
    expect(note(XSS).html).not.toContain('<script>')
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

  describe('avatar', () => {
    const iconUrl = 'https://files.mastodon.social/accounts/avatars/ben.jpg'
    const avatarCell = (html: string) =>
      html.match(/<td [^>]*width="24" height="24"[^>]*>[\s\S]*?<\/td>/)?.[0]

    it.each([
      { description: 'initials', iconUrl: undefined },
      { description: 'image', iconUrl }
    ])(
      'gives the avatar cell a palette colour ($description)',
      ({ iconUrl }) => {
        const cell = avatarCell(quote({ author: { ...author, iconUrl } }).html)
        const bgcolor = cell?.match(/bgcolor="(#[0-9a-f]{6})"/)?.[1]
        expect(MONOGRAM_PALETTE).toContain(bgcolor)
        expect(cell).toContain(`background-color:${bgcolor}`)
      }
    )

    it('uses the initials as the alt text', () => {
      const cell = avatarCell(quote({ author: { ...author, iconUrl } }).html)
      expect(cell).toContain('alt="BC"')
    })

    it('renders the actor image when the actor has an icon', () => {
      const { html } = quote({ author: { ...author, iconUrl } })
      expect(html).toContain(`<img src="${iconUrl}"`)
      expect(html).not.toContain('>BC</td>')
    })

    it('falls back to the initials when the actor has no icon', () => {
      const { html } = quote({ author })
      expect(html).not.toContain('<img')
      expect(html).toContain('>BC</td>')
    })

    it.each([
      'javascript:alert(1)',
      'mailto:ben@example.com',
      'data:image/png;base64,AAAA',
      'not a url'
    ])(
      'falls back to the initials when the icon is not an http(s) URL (%s)',
      (badUrl) => {
        const { html } = quote({ author: { ...author, iconUrl: badUrl } })
        expect(html).not.toContain('<img')
        expect(html).not.toContain(badUrl)
        expect(html).toContain('>BC</td>')
      }
    )

    it('escapes the icon URL and still renders the image', () => {
      const { html } = quote({
        author: { ...author, iconUrl: 'https://example.com/a.png?x="><b>' }
      })
      expect(html).toContain(
        '<img src="https://example.com/a.png?x=&quot;&gt;&lt;b&gt;"'
      )
      expect(html).not.toContain('"><b>')
    })
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
    expect(html).toContain('<p style="margin:0;">Hello <b>there</b></p>')
    expect(text).toBe('Ben Carter (@ben@example.com)\nHello there')
  })

  describe('body styling', () => {
    const bodyOf = (htmlBody: string) =>
      quote({ author, body: { html: htmlBody, text: 'x' } }).html

    it('leaves no paragraph margin above or below a single-paragraph post', () => {
      const html = bodyOf('<p>Morning run done</p>')
      // A bare <p> keeps the client's 14px margins, which pushed the text
      // 14px (not 8px) below the actor row and added 14px under the last line.
      expect(html).toContain('<p style="margin:0;">Morning run done</p>')
    })

    it('trims only the outer edges of a multi-paragraph post', () => {
      const html = bodyOf('<p>One</p><p>Two</p><p>Three</p>')
      expect(html).toContain(
        '<p style="margin:0 0 14px;">One</p><p style="margin:0 0 14px;">Two</p><p style="margin:0;">Three</p>'
      )
    })

    it('keeps a paragraph class and does not touch <pre>', () => {
      const html = bodyOf('<p class="quote-inline">RE</p><pre>code</pre>')
      expect(html).toContain('<p class="quote-inline" style="margin:0;">RE</p>')
      expect(html).toContain('<pre>code</pre>')
    })

    it.each([
      '<a href="https://example.com/tags/running" class="mention hashtag" rel="tag">#running</a>',
      '<a href="https://llun.social/@anna" class="u-url mention">@anna</a>',
      '<a href="https://example.com/tags/run" class="hashtag" rel="tag">#run</a>'
    ])(
      'draws a hashtag or mention link mid blue without an underline (%s)',
      (anchor) => {
        const html = bodyOf(`<p>${anchor}</p>`)
        expect(html).toContain('style="color:#0272AC;text-decoration:none;"')
      }
    )

    it('keeps the hashtag and mention blue above the 4.5:1 AA floor on the quote inset', () => {
      // The design's #0284C7 is only 3.76:1 on #F5F5F5.
      expect(QUOTE_LINK).toBe('#0272AC')
      expect(INSET_BACKGROUND).toBe('#f5f5f5')
      expect(
        contrastRatio(QUOTE_LINK, INSET_BACKGROUND)
      ).toBeGreaterThanOrEqual(4.7)
    })

    it('leaves an ordinary link as it was, underline included', () => {
      const html = bodyOf(
        '<p><a href="https://example.com/x" rel="nofollow">https://example.com/x</a></p>'
      )
      expect(html).toContain(
        '<a href="https://example.com/x" rel="nofollow">https://example.com/x</a>'
      )
      expect(html).not.toContain('text-decoration:none')
    })

    it('does not style the plain-text part', () => {
      const { text } = quote({
        author,
        body: { html: '<p>Hi <a class="hashtag">#x</a></p>', text: 'Hi #x' }
      })
      expect(text).toBe('Ben Carter (@ben@example.com)\nHi #x')
    })
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
})

describe('statCard', () => {
  const stats = [
    { label: 'Distance', value: '8.21 km' },
    { label: 'Time', value: '42:18' },
    { label: 'Pace', value: '5:09 /km' }
  ]

  it('renders the title, stats and footnote', () => {
    const { html, text } = statCard({
      title: 'Morning run',
      timestamp: 'Today, 07:12',
      stats,
      footnote: 'Imported from activity file · morning-run.fit'
    })
    expect(html).toContain('>Morning run</td>')
    expect(html).toContain('>Today, 07:12</td>')
    expect(html).toContain('>Distance</div>')
    expect(html).toContain('>8.21 km</div>')
    expect(text).toContain('Morning run (Today, 07:12)')
    expect(text).toContain('Distance: 8.21 km')
    expect(text).toContain('morning-run.fit')
  })

  it('divides the row evenly between the stats it is given', () => {
    expect(statCard({ title: 'a', stats }).html).toContain('width="33%"')
    expect(statCard({ title: 'a', stats: stats.slice(0, 2) }).html).toContain(
      'width="50%"'
    )
  })

  it('renders the route map when one is available', () => {
    const { html } = statCard({
      title: 'a',
      stats,
      mapImageUrl: 'https://example.com/api/v1/files/map.webp'
    })
    expect(html).toContain('alt="Route map"')
    expect(html).toContain('src="https://example.com/api/v1/files/map.webp"')
    // No fixed height: the generated map is 4:3 and the slot is wider, so
    // letting the client scale keeps the whole route visible.
    expect(html).toContain('height:auto')
  })

  it('omits the map for an activity with no route', () => {
    const { html } = statCard({ title: 'a', stats })
    expect(html).not.toContain('alt="Route map"')
    expect(html).not.toContain('<img')
  })

  it('refuses an unsafe map url', () => {
    const { html } = statCard({
      title: 'a',
      stats,
      mapImageUrl: 'javascript:alert(1)'
    })
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
  })

  it('still renders with no stats at all', () => {
    const { html } = statCard({ title: 'Indoor ride', stats: [] })
    expect(html).toContain('>Indoor ride</td>')
    expect(html).not.toContain('<div style="font-size:12px')
  })

  it('escapes a hostile activity title and footnote', () => {
    const { html } = statCard({ title: XSS, stats: [], footnote: XSS })
    expect(html).not.toContain(XSS)
    expect(html).not.toContain('<script')
  })
})
