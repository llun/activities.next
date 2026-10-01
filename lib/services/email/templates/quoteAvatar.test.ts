import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { buildFollowEmail } from './follow'
import { buildFollowRequestEmail } from './followRequest'
import { buildLikeEmail } from './like'
import { buildMentionEmail } from './mention'
import { buildBoostEmail } from './reblog'
import { buildReplyEmail } from './reply'

// Every template that quotes an actor builds its `QuoteAuthor` through
// `toQuoteAuthor`. A template that later assembled one by hand would pass its
// own tests while silently dropping the avatar, so this pins the wiring for all
// of them in one table.

const HOST = 'test.llun.dev'
const ICON_URL = 'https://files.mastodon.social/avatars/ben.jpg'

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
  id: `https://${HOST}/users/anna`,
  username: 'anna',
  domain: HOST,
  name: 'Anna'
})

const status = (actor: ActorProfile): EditableStatus =>
  ({
    id: `https://${HOST}/statuses/1`,
    url: `https://${HOST}/@anna/1`,
    actorId: actor.id,
    actor,
    isLocalActor: actor.domain === HOST,
    type: StatusType.enum.Note,
    text: 'Morning run done',
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: 1000
  }) as unknown as EditableStatus

interface Case {
  description: string
  /** Builds the email with `shown` as the actor the quote card displays. */
  build: (shown: ActorProfile) => { html: string }
}

const cases: Case[] = [
  {
    description: 'reply (quotes the replier)',
    build: (shown) =>
      buildReplyEmail({ recipient, actor: shown, status: status(shown) })
  },
  {
    description: 'mention (quotes the mentioner)',
    build: (shown) =>
      buildMentionEmail({ recipient, actor: shown, status: status(shown) })
  },
  {
    description: 'like (quotes the recipient post)',
    build: (shown) =>
      buildLikeEmail({
        recipient,
        actor: profile({ username: 'liker' }),
        status: status(shown)
      })
  },
  {
    description: 'boost (quotes the recipient post)',
    build: (shown) =>
      buildBoostEmail({
        recipient,
        actor: profile({ username: 'booster' }),
        status: status(shown)
      })
  },
  {
    description: 'follow (quotes the follower)',
    build: (shown) => buildFollowEmail({ recipient, actor: shown })
  },
  {
    description: 'follow request (quotes the requester)',
    build: (shown) => buildFollowRequestEmail({ recipient, actor: shown })
  }
]

describe('quoted-actor avatar in notification emails', () => {
  it.each(cases)('shows the avatar image for $description', ({ build }) => {
    const { html } = build(profile({ iconUrl: ICON_URL }))
    expect(html).toContain(`<img src="${ICON_URL}" width="24" height="24"`)
    expect(html).not.toContain('>BC</td>')
  })

  it.each(cases)('falls back to the initials for $description', ({ build }) => {
    const { html } = build(profile())
    expect(html).not.toContain(`src="${ICON_URL}"`)
    expect(html).toContain('>BC</td>')
  })
})
