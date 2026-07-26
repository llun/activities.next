import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildMentionEmail } from './mention'

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

const sender = profile()
const senderStatus = status({
  actor: sender,
  actorId: sender.id,
  isLocalActor: false,
  text: 'hey @anna have you tried this'
})

const build = () =>
  buildMentionEmail({ recipient, actor: sender, status: senderStatus })

describe('buildMentionEmail', () => {
  it('keeps the subject the codebase already used', () => {
    expect(build().subject).toBe(`@ben mentions you in ${HOST}`)
  })

  it('uses the short name in the headline', () => {
    expect(build().html).toContain('Ben mentioned you in a post')
  })

  it('quotes the sender, not the recipient', () => {
    const { html } = build()
    expect(html).toContain('>Ben Carter</td>')
    expect(html).toContain('>@ben@remote.example.com</td>')
  })

  it('carries no label because the post is the subject of the email', () => {
    expect(build().html).not.toContain('>Your post:</p>')
  })

  it('uses the notification footer naming mentions', () => {
    expect(build().html).toContain('email notifications for mentions')
  })
})
