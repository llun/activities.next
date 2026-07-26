import { buildResetPasswordEmail } from './resetPassword'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const build = (passwordResetCode = 'code-123') =>
  buildResetPasswordEmail({
    recipientEmail: 'anna@example.com',
    passwordResetCode
  })

describe('buildResetPasswordEmail', () => {
  it('keeps the subject the route already used', () => {
    expect(build().subject).toBe('Reset your password')
  })

  it('links the reset url on the configured host', () => {
    const url = `${BASE_URL}/auth/reset-password?code=code-123`
    const { html, text } = build()
    expect(html).toContain(`href="${url}"`)
    expect(html).toContain('>Reset password</a>')
    expect(text).toContain(`Reset password: ${url}`)
  })

  it('percent-encodes the reset code', () => {
    expect(build('a+b/c').html).toContain('code=a%2Bb%2Fc')
  })

  it('names the instance in the body', () => {
    expect(build().text).toContain(
      `You requested a password reset for your account on ${HOST}.`
    )
  })

  it('states the expiry and the ignore path', () => {
    expect(build().text).toContain(
      'If you did not request this, you can safely ignore this email. This link expires in 24 hours.'
    )
  })

  it('uses the account footer', () => {
    expect(build().html).toContain('This email was sent to anna@example.com')
  })
})
