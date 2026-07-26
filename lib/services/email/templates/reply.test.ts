import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildReplyEmail } from './reply'

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
const replyStatus = status({
  actor: sender,
  actorId: sender.id,
  isLocalActor: false,
  text: 'This is brilliant'
})

const build = () =>
  buildReplyEmail({ recipient, actor: sender, status: replyStatus })

describe('buildReplyEmail', () => {
  it('keeps the subject the codebase already used', () => {
    expect(build().subject).toBe(`@ben replied to your post in ${HOST}`)
  })

  it('labels the quote as the reply', () => {
    const { html } = build()
    expect(html).toContain('>Reply:</p>')
    expect(html).toContain('This is brilliant')
  })

  it('quotes the replier, not the recipient', () => {
    expect(build().html).toContain('>@ben@remote.example.com</td>')
  })

  it('uses the notification footer naming replies', () => {
    expect(build().html).toContain('email notifications for replies')
  })
})
