import { ActorProfile } from '@/lib/types/domain/actor'

import { buildFollowRequestEmail } from './followRequest'

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

describe('buildFollowRequestEmail', () => {
  const build = () => buildFollowRequestEmail({ recipient, actor: actor() })

  it('keeps the subject the codebase already used', () => {
    expect(build().subject).toBe(`@ben wants to follow you in ${HOST}`)
  })

  it('explains why approval is needed', () => {
    expect(build().text).toContain('Your account approves followers manually')
  })

  it('sends the reader to notifications where the controls are', () => {
    const { html } = build()
    expect(html).toContain(`href="${BASE_URL}/notifications"`)
    expect(html).toContain('>Review request</a>')
  })

  it('uses the notification footer naming follow requests', () => {
    expect(build().html).toContain('email notifications for follow requests')
  })
})
