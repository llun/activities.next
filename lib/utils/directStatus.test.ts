import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import {
  getDirectStatusParticipantActorIds,
  isDirectAudienceActorId,
  isDirectStatus
} from './directStatus'

const authorId = 'https://friendica.test/profile/alice'
const followersUrl = 'https://friendica.test/followers/alice'
const mentionedId = 'https://friendica.test/profile/bob'

const actor: ActorProfile = {
  id: authorId,
  username: 'alice',
  domain: 'friendica.test',
  followersUrl,
  inboxUrl: `${authorId}/inbox`,
  sharedInboxUrl: 'https://friendica.test/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 0
}

// A Friendica followers-only note: the collection is `/followers/<nick>`, so
// the `/followers` suffix rule alone would read it as direct.
const friendicaFollowersOnly = ({
  to = [followersUrl],
  cc = [],
  statusActor = actor
}: {
  to?: string[]
  cc?: string[]
  statusActor?: ActorProfile | null
} = {}): Status =>
  ({
    id: `${authorId}/statuses/1`,
    url: `${authorId}/statuses/1`,
    actorId: authorId,
    actor: statusActor,
    type: StatusType.enum.Note,
    text: 'followers only',
    summary: '',
    reply: '',
    to,
    cc,
    createdAt: 1000,
    updatedAt: 1000,
    attachments: [],
    mentions: [],
    likesCount: 0,
    repliesCount: 0,
    reblogsCount: 0,
    liked: false,
    bookmarked: false
  }) as unknown as StatusNote

describe('isDirectStatus', () => {
  it('is false for a Friendica followers-only status', () => {
    expect(isDirectStatus(friendicaFollowersOnly())).toBe(false)
  })

  it('is false when a mentioned account is in cc', () => {
    expect(isDirectStatus(friendicaFollowersOnly({ cc: [mentionedId] }))).toBe(
      false
    )
  })

  it('is true when the author is unknown, so only the suffix rule applies', () => {
    expect(isDirectStatus(friendicaFollowersOnly({ statusActor: null }))).toBe(
      true
    )
  })

  it('is true for a status addressed to specific accounts only', () => {
    expect(isDirectStatus(friendicaFollowersOnly({ to: [mentionedId] }))).toBe(
      true
    )
  })

  it('is false for a boost', () => {
    expect(
      isDirectStatus({
        ...friendicaFollowersOnly({ to: [mentionedId] }),
        type: StatusType.enum.Announce
      } as Status)
    ).toBe(false)
  })
})

describe('getDirectStatusParticipantActorIds', () => {
  it('excludes the author followers URL', () => {
    expect(
      getDirectStatusParticipantActorIds(friendicaFollowersOnly())
    ).toEqual([authorId])
  })

  it('excludes it when a mentioned account is in cc', () => {
    expect(
      getDirectStatusParticipantActorIds(
        friendicaFollowersOnly({ cc: [mentionedId] })
      )
    ).toEqual([authorId, mentionedId])
  })

  it('keeps the followers URL when the author is unknown', () => {
    expect(
      getDirectStatusParticipantActorIds(
        friendicaFollowersOnly({ statusActor: null })
      )
    ).toEqual([authorId, followersUrl])
  })
})

describe('isDirectAudienceActorId', () => {
  it('treats the author followers URL as a collection, not an actor', () => {
    expect(isDirectAudienceActorId(followersUrl, followersUrl)).toBe(false)
    expect(isDirectAudienceActorId(followersUrl)).toBe(true)
  })

  it('keeps the /followers suffix as a fallback', () => {
    expect(
      isDirectAudienceActorId(
        'https://misskey.test/users/x/followers',
        'https://misskey.test/different'
      )
    ).toBe(false)
  })

  it('treats the public collection as not an actor', () => {
    expect(isDirectAudienceActorId(ACTIVITY_STREAM_PUBLIC)).toBe(false)
  })
})
