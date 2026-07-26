import { ActorProfile } from '@/lib/types/domain/actor'

import { buildActorDeletedEmail } from './actorDeleted'

// No local vi.mock of '@/lib/config' here on purpose. The global mock in
// vitest.setup.ts supplies both getConfig (host test.llun.dev) and getBaseURL;
// a local factory that stubs only getConfig shadows it and makes the shared
// layout fail with "getBaseURL is not a function".
const HOST = 'test.llun.dev'

const actor: ActorProfile = {
  id: `https://${HOST}/users/testuser`,
  username: 'testuser',
  domain: HOST,
  followersUrl: `https://${HOST}/users/testuser/followers`,
  inboxUrl: `https://${HOST}/users/testuser/inbox`,
  sharedInboxUrl: `https://${HOST}/inbox`,
  followingCount: 10,
  followersCount: 20,
  statusCount: 5,
  lastStatusAt: 1000,
  createdAt: 1000
}

const build = (contactEmail?: string) =>
  buildActorDeletedEmail({
    recipient: actor,
    recipientEmail: 'anna@example.com',
    contactEmail
  })

describe('buildActorDeletedEmail', () => {
  it('names the deleted actor and the instance in the subject', () => {
    expect(build().subject).toBe(
      `Your actor @testuser@${HOST} has been deleted from ${HOST}`
    )
  })

  it('leads with a past-tense headline', () => {
    const { html, text } = build()
    expect(html).toContain('Your actor was deleted')
    expect(text).toContain('Your actor was deleted')
  })

  it('bolds the deleted handle in the body', () => {
    expect(build().html).toContain(`@testuser@${HOST}</strong>`)
  })

  it('states that all associated data is gone', () => {
    expect(build().text).toContain(`has been permanently removed from ${HOST}`)
  })

  it('carries no call to action because there is nothing left to open', () => {
    expect(build().html).not.toContain('bgcolor="#E66A0F"')
  })

  it('links the instance contact address when one is configured', () => {
    const { html, text } = build('admin@example.com')
    expect(html).toContain('href="mailto:admin@example.com"')
    expect(text).toContain(
      'contact your server admin immediately at admin@example.com'
    )
  })

  it('omits the address when no contact is configured', () => {
    const { html, text } = build()
    expect(html).not.toContain('mailto:')
    expect(text).toContain('contact your server admin immediately.')
  })

  it('uses the account footer, not a notification footer', () => {
    const { html } = build()
    expect(html).toContain('This email was sent to anna@example.com')
    expect(html).not.toContain('Manage email notifications')
  })
})
