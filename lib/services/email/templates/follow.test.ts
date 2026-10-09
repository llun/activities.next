import { ActorProfile } from '@/lib/types/domain/actor'

import { buildFollowEmail } from './follow'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const actor = (overrides: Partial<ActorProfile> = {}): ActorProfile => ({
  id: 'https://remote.example.com/users/ben',
  username: 'ben',
  domain: 'remote.example.com',
  name: 'Ben Carter',
  followersUrl: '',
  inboxUrl: '',
  sharedInboxUrl: '',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1000,
  ...overrides
})

const recipient = actor({
  id: `${BASE_URL}/users/anna`,
  username: 'anna',
  domain: HOST,
  name: 'Anna'
})

describe('buildFollowEmail', () => {
  const build = () => buildFollowEmail({ recipient, actor: actor() })

  it('renders the subject, headline and notification footer', () => {
    const { subject, html } = build()
    // The subject is the one the codebase already used.
    expect(subject).toBe(`@ben is following you in ${HOST}`)
    expect(html).toContain('Ben is following you')
    expect(html).toContain('email notifications for new followers')
    expect(html).toContain(`@anna@${HOST}`)
    expect(html).toContain(`${BASE_URL}/settings/notifications`)
  })

  it('quotes the follower with their handle', () => {
    const { html } = build()
    expect(html).toContain('>Ben Carter</td>')
    expect(html).toContain('>@ben@remote.example.com</td>')
  })

  it('links the local profile rather than the remote actor id', () => {
    const { html } = build()
    expect(html).toContain(`href="${BASE_URL}/@ben@remote.example.com"`)
    // The old template linked actor.id, dropping the reader on another server.
    expect(html).not.toContain('href="https://remote.example.com/users/ben"')
  })
})
