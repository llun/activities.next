import { button, headline, paragraph } from './blocks'
import { renderEmail } from './renderEmail'

// The global config mock (test/setup/vitest.setup.ts) serves host `test.llun.dev` and
// getBaseURL() `https://test.llun.dev`.
const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const render = (overrides: Partial<Parameters<typeof renderEmail>[0]> = {}) =>
  renderEmail({
    subject: 'Reset your password',
    preheader: 'Choose a new password.',
    blocks: [headline('Reset your password')],
    footer: { kind: 'account', recipientEmail: 'anna@example.com' },
    ...overrides
  })

describe('renderEmail', () => {
  it('uses the subject as the document title', () => {
    expect(render({ subject: 'A & B' }).html).toContain(
      '<title>A &amp; B</title>'
    )
  })

  it('pins the column to 600px for outlook with a ghost table', () => {
    const { html } = render()
    // Word ignores max-width, so without this the fluid width would let the
    // card fill the whole reading pane in Outlook.
    expect(html).toContain(
      '<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;"><tr><td><![endif]-->'
    )
    expect(html).toContain('<!--[if mso]></td></tr></table><![endif]-->')
  })

  it('renders the preheader text', () => {
    const { html } = render({ preheader: 'Choose a new password.' })
    expect(html).toContain('Choose a new password.')
  })

  it('renders the host in the header', () => {
    expect(render().html).toContain(`>${HOST}</td>`)
  })

  it('lays the header out so it can shrink on narrow screens', () => {
    const { html } = render()
    // Auto layout keeps the 20px wordmark on one line: the wordmark must
    // never wrap mid-word, even at a 320px viewport.
    expect(html).toContain(
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>'
    )
    // The logo column keeps its explicit 28px.
    expect(html).toContain('<td width="28" style="width:28px;">')
    // overflow-wrap:anywhere lowers the host cell's min-content width, so a
    // very long custom host can still make the header shrink instead of
    // overflowing. The wordmark cell must NOT carry it: there it would also
    // lower the wordmark's own min-content width, and a long host at a 320px
    // viewport would break the wordmark mid-word.
    const wordmarkCell =
      html.match(/<td style="padding-left:8px;[^>]*>/)?.[0] ?? ''
    expect(wordmarkCell).toContain('word-wrap:break-word')
    expect(wordmarkCell).not.toContain('overflow-wrap:anywhere')
    const hostCell = html.match(/<td align="right"[^>]*>/)?.[0] ?? ''
    expect(hostCell).toContain('overflow-wrap:anywhere')
  })

  it('renders every block in order', () => {
    const { html } = render({
      blocks: [headline('First'), paragraph('Second')]
    })
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'))
  })

  it('still renders a well-formed document with no blocks', () => {
    const { html, text } = render({ blocks: [] })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    // The footer is not a block, so it survives an empty card.
    expect(text).toContain('This email was sent to anna@example.com')
  })
})

describe('renderEmail text alternative', () => {
  it('joins block text with blank lines and appends the footer', () => {
    const { text } = render({
      blocks: [headline('Reset your password'), paragraph('Open the link.')]
    })
    expect(text).toBe(
      'Reset your password\n\nOpen the link.\n\n' +
        `This email was sent to anna@example.com because of account activity on ${HOST}.`
    )
  })

  it('skips blocks that contribute no text', () => {
    const { text } = render({
      blocks: [headline('Title'), { html: '<hr>', text: '' }]
    })
    expect(text.startsWith('Title\n\nThis email was sent')).toBe(true)
  })

  it('carries button destinations into the text part', () => {
    const { text } = render({
      blocks: [button({ label: 'Reset password', url: `${BASE_URL}/reset` })]
    })
    expect(text).toContain(`Reset password: ${BASE_URL}/reset`)
  })

  it('contains no markup', () => {
    const { text } = render({
      blocks: [headline('Title'), paragraph('Body')]
    })
    expect(text).not.toContain('<')
    expect(text).not.toContain('>')
  })
})

describe('renderEmail footer', () => {
  it('names the event and links to notification settings for a notification', () => {
    const { html, text } = render({
      footer: {
        kind: 'notification',
        eventLabel: 'likes',
        handle: '@anna@test.llun.dev'
      }
    })
    expect(html).toContain(
      'email notifications for likes are turned on for @anna@test.llun.dev'
    )
    expect(html).toContain(`href="${BASE_URL}/settings/notifications"`)
    expect(html).toContain('>Manage email notifications</a>')
    expect(text).toContain(
      `Manage email notifications: ${BASE_URL}/settings/notifications`
    )
  })

  it('names the recipient address for an account email', () => {
    const { html } = render({
      footer: { kind: 'account', recipientEmail: 'anna@example.com' }
    })
    expect(html).toContain('This email was sent to anna@example.com')
    expect(html).not.toContain('Manage email notifications')
  })
})

describe('renderEmail brand', () => {
  const brand = { name: 'Acme <Social>', domain: 'acme.example' }

  it('shows the brand name as the wordmark, escaped', () => {
    const { html } = render({ brand })
    expect(html).toContain('>Acme &lt;Social&gt;</td>')
    expect(html).not.toContain('>Activities</td>')
  })

  it('names the brand domain in the header, links and footer link', () => {
    const { html } = render({ brand })
    expect(html).toContain('>acme.example</td>')
    expect(html).toContain('href="https://acme.example"')
    // The logo is the one exception: it comes from the configured host, since
    // an alias domain may redirect elsewhere and not serve public/ assets.
    expect(html).toContain(`<img src="${BASE_URL}/logo-nav.png"`)
    expect(html).not.toContain('href="' + BASE_URL)
  })

  it('serves the logo from the configured host for a secondary-domain brand', () => {
    const { html } = render({
      brand: { name: 'Alias', domain: 'alias.example' }
    })
    expect(html).toContain(`<img src="${BASE_URL}/logo-nav.png"`)
    expect(html).not.toContain('<img src="https://alias.example/')
    expect(html).toContain('>alias.example</td>')
    expect(html).toContain('href="https://alias.example"')
  })

  it('builds the notification settings link on the brand domain', () => {
    const { html, text } = render({
      brand,
      footer: { kind: 'notification', eventLabel: 'likes', handle: '@a@b' }
    })
    expect(html).toContain('https://acme.example/settings/notifications')
    expect(text).toContain('https://acme.example/settings/notifications')
  })

  it('keeps the Activities wordmark and primary host without a brand', () => {
    const { html } = render()
    expect(html).toContain('>Activities</td>')
    expect(html).toContain(`>${HOST}</td>`)
  })
})
