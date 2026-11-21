import {
  buildEmailChangeNoticeEmail,
  maskEmailAddress
} from './emailChangeNotice'

const build = (newEmail = 'new@example.com') =>
  buildEmailChangeNoticeEmail({
    recipientEmail: 'old@example.com',
    newEmail
  })

describe('maskEmailAddress', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmailAddress('alice@example.com')).toBe('a***@example.com')
  })

  it('falls back to a placeholder for a value that is not an address', () => {
    expect(maskEmailAddress('not-an-address')).toBe('***')
    expect(maskEmailAddress('@example.com')).toBe('***')
  })
})

describe('buildEmailChangeNoticeEmail', () => {
  it('names the masked destination and never the full new address', () => {
    const { subject, html, text } = build()

    expect(subject).toBe('An email change was requested')
    expect(text).toContain('n***@example.com')
    expect(html).toContain('n***@example.com')
    expect(text).not.toContain('new@example.com')
    expect(html).not.toContain('new@example.com')
  })

  it('carries no confirmation link: the change is confirmed from the new address', () => {
    const { html, text } = build()

    expect(html).not.toContain('/account/verify-email')
    expect(text).not.toContain('/account/verify-email')
  })

  it('tells the owner to contact the administrator when it was not them', () => {
    expect(build().text).toContain(
      "If this wasn't you, contact the administrator and change your password."
    )
  })

  it('names the administrator contact when the domain has one', () => {
    const { text } = buildEmailChangeNoticeEmail({
      recipientEmail: 'old@example.com',
      newEmail: 'new@example.com',
      contactEmail: 'admin@example.com'
    })

    expect(text).toContain('contact the administrator at admin@example.com')
  })

  it('is addressed to the old address in the footer', () => {
    expect(build().html).toContain('This email was sent to old@example.com')
  })
})
