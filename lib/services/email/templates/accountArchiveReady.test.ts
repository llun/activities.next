import { buildAccountArchiveReadyEmail } from './accountArchiveReady'

describe('buildAccountArchiveReadyEmail', () => {
  const email = buildAccountArchiveReadyEmail({
    recipientEmail: 'anna@example.com',
    archiveId: 'archive-1',
    bytes: 3 * 1024 * 1024,
    expiresAt: Date.UTC(2026, 10, 7, 12)
  })

  it('names the file size and the day it is deleted', () => {
    expect(email.subject).toContain('account archive is ready')
    expect(email.text).toContain('3.0 MB')
    expect(email.text).toContain('7 November 2026')
    expect(email.html).toContain('Your account archive is ready')
  })

  it('links to the owner-only download endpoint', () => {
    expect(email.html).toContain('/api/v1/account/archives/archive-1/download')
    expect(email.text).toContain('/api/v1/account/archives/archive-1/download')
  })

  it('goes to the account owner with the account footer', () => {
    expect(email.html).toContain('This email was sent to anna@example.com')
  })
})
