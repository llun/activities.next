import { buildVerifyEmail } from './verifyEmail'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const build = (verificationCode = 'code-123') =>
  buildVerifyEmail({ recipientEmail: 'anna@example.com', verificationCode })

describe('buildVerifyEmail', () => {
  it('keeps the subject the confirmations endpoint already used', () => {
    expect(build().subject).toBe('Email verification')
  })

  it('leads with the verification headline', () => {
    const { html, text } = build()
    expect(html).toContain('Verify your email')
    expect(text).toContain('Verify your email')
  })

  it('links the confirmation url on the configured host', () => {
    const url = `${BASE_URL}/auth/confirmation?verificationCode=code-123`
    const { html, text } = build()
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('>Verify email</a>')
    expect(text).toContain(`Verify email: ${url}`)
  })

  it('repeats the url as copyable text for clients that strip links', () => {
    expect(build().html).toContain('Or open this link in your browser:')
  })

  it('percent-encodes the verification code', () => {
    expect(build('a b/c').html).toContain('verificationCode=a%20b%2Fc')
  })

  it('tells an unintended recipient they can ignore it', () => {
    expect(build().text).toContain(
      `If you didn't create an account on ${HOST}, you can safely ignore this email.`
    )
  })

  it('uses the account footer', () => {
    expect(build().html).toContain('This email was sent to anna@example.com')
  })
})
