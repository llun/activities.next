import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildBoostEmail } from './reblog'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const profile = (overrides: Partial<ActorProfile> = {}): ActorProfile => ({
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

const recipient = profile({
  id: `${BASE_URL}/users/anna`,
  username: 'anna',
  domain: HOST,
  name: 'Anna'
})

const status = (overrides: Partial<EditableStatus> = {}): EditableStatus =>
  ({
    id: `${BASE_URL}/statuses/1`,
    url: `${BASE_URL}/@anna/1`,
    actorId: `${BASE_URL}/users/anna`,
    actor: recipient,
    isLocalActor: true,
    type: StatusType.enum.Note,
    text: 'Morning run done',
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1000,
    ...overrides
  }) as EditableStatus

const build = () =>
  buildBoostEmail({ recipient, actor: profile(), status: status() })

describe('buildBoostEmail', () => {
  it('says boosted, matching the product vocabulary', () => {
    expect(build().subject).toBe(`@ben boosted your post in ${HOST}`)
    expect(build().html).toContain('Ben boosted your post')
  })

  it('no longer says reblogged anywhere in the user-facing copy', () => {
    const { subject, html, text } = build()
    expect(subject).not.toContain('reblog')
    expect(html).not.toContain('reblog')
    expect(text).not.toContain('reblog')
  })

  it('labels the quote as the recipient own post', () => {
    expect(build().html).toContain('>Your post:</p>')
  })

  it('uses the notification footer naming boosts', () => {
    expect(build().html).toContain('email notifications for boosts')
  })
})
