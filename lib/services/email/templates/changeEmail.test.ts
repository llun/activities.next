import { buildChangeEmail } from './changeEmail'

const BASE_URL = 'https://test.llun.dev'

const build = (emailChangeCode = 'code-123') =>
  buildChangeEmail({ recipientEmail: 'new@example.com', emailChangeCode })

describe('buildChangeEmail', () => {
  it('renders the subject, new-address footer and verification link', () => {
    const url = `${BASE_URL}/account/verify-email?code=code-123`
    const { subject, html, text } = build()
    // The subject is the one the route already used.
    expect(subject).toBe('Verify your new email address')
    expect(html).toContain('This email was sent to new@example.com')
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('>Verify email address</a>')
    expect(text).toContain(`Verify email address: ${url}`)
  })

  it('percent-encodes the change code', () => {
    expect(build('a+b/c').html).toContain('code=a%2Bb%2Fc')
  })

  it('states the expiry and the ignore path', () => {
    expect(build().text).toContain(
      "If you didn't request this change, you can safely ignore this email. This link expires in 24 hours."
    )
  })
})
