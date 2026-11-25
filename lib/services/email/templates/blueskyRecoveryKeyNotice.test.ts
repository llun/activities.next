import { buildBlueskyRecoveryKeyNoticeEmail } from './blueskyRecoveryKeyNotice'

describe('buildBlueskyRecoveryKeyNoticeEmail', () => {
  it('names the handle and the added key', () => {
    const { subject, text, html } = buildBlueskyRecoveryKeyNoticeEmail({
      recipientEmail: 'alice@example.com',
      handle: 'alice.pds.example.com',
      recoveryKeyDid: 'did:key:zRecovery'
    })

    expect(subject).toBe('A recovery key was added to your Bluesky account')
    expect(text).toContain('@alice.pds.example.com')
    expect(text).toContain('did:key:zRecovery')
    expect(html).toContain('did:key:zRecovery')
  })

  it('says the key was removed', () => {
    const { subject, text } = buildBlueskyRecoveryKeyNoticeEmail({
      recipientEmail: 'alice@example.com',
      handle: 'alice.pds.example.com',
      recoveryKeyDid: null
    })

    expect(subject).toBe(
      'The recovery key was removed from your Bluesky account'
    )
    expect(text).toContain('no longer has a recovery key')
  })

  it('names the administrator contact and the recipient', () => {
    const { text, html } = buildBlueskyRecoveryKeyNoticeEmail({
      recipientEmail: 'alice@example.com',
      handle: 'alice.pds.example.com',
      recoveryKeyDid: null,
      contactEmail: 'admin@example.com'
    })

    expect(text).toContain('contact the administrator at admin@example.com')
    expect(html).toContain('This email was sent to alice@example.com')
  })
})
