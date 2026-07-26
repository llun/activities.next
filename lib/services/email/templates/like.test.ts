import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildLikeEmail } from './like'

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

const build = (overrides = {}) =>
  buildLikeEmail({
    recipient,
    actor: profile(),
    status: status(),
    ...overrides
  })

describe('buildLikeEmail', () => {
  it('keeps the subject the codebase already used', () => {
    expect(build().subject).toBe(`@ben liked your post in ${HOST}`)
  })

  it('uses the short name in the headline', () => {
    expect(build().html).toContain('Ben liked your post')
  })

  it('labels the quote as the recipient own post', () => {
    const { html } = build()
    expect(html).toContain('>Your post:</p>')
    expect(html).toContain('>Anna</td>')
    expect(html).toContain(`>@anna@${HOST}</td>`)
  })

  it('includes the post body in both media', () => {
    const { html, text } = build()
    expect(html).toContain('Morning run done')
    expect(text).toContain('Morning run done')
  })

  it('links the post on the recipient own server', () => {
    const { html } = build()
    expect(html).toContain(`href="${BASE_URL}/@anna@${HOST}/`)
    expect(html).toContain('>View post</a>')
  })

  it('uses the notification footer naming likes', () => {
    expect(build().html).toContain('email notifications for likes')
  })

  it('does not emit raw remote post markup', () => {
    const { html } = build({
      status: status({
        text: '<script>alert(1)</script>hi',
        isLocalActor: false
      })
    })
    expect(html).not.toContain('<script')
  })
})
