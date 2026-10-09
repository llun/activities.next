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

  it('points the logo at an absolute url on the configured host', () => {
    expect(render().html).toContain(`<img src="${BASE_URL}/logo-nav.png"`)
  })

  it('renders the host in the header', () => {
    expect(render().html).toContain(`>${HOST}</td>`)
  })

  it('renders every block in order', () => {
    const { html } = render({
      blocks: [headline('First'), paragraph('Second')]
    })
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'))
  })

  it('escapes the preheader', () => {
    const { html } = render({ preheader: '"><script>alert(1)</script>' })
    expect(html).not.toContain('<script')
    expect(html).not.toContain('"><script>alert(1)</script>')
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

  it('escapes the footer values', () => {
    const { html } = render({
      footer: {
        kind: 'account',
        recipientEmail: '"><script>alert(1)</script>'
      }
    })
    expect(html).not.toContain('<script')
  })
})
