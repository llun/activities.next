import {
  type DirectConversationStatusLookup,
  type DirectConversationStatusLookupRow,
  buildDirectConversationStatusLookup,
  isDirectStatusLookup
} from '@/lib/database/domains/conversation/ordering'
import { StatusType } from '@/lib/types/domain/status'

const authorId = 'https://friendica.test/profile/alice'
const followersUrl = 'https://friendica.test/followers/alice'
const mentionedId = 'https://friendica.test/profile/bob'

// A Friendica followers-only note: the collection is `/followers/<nick>`, so
// the `/followers` suffix rule alone would read it as direct.
const friendicaFollowersOnly = ({
  to = [followersUrl],
  cc = [],
  statusFollowersUrl = followersUrl
}: {
  to?: string[]
  cc?: string[]
  statusFollowersUrl?: string | null
} = {}): DirectConversationStatusLookup => ({
  id: `${authorId}/statuses/1`,
  url: `${authorId}/statuses/1`,
  actorId: authorId,
  type: StatusType.enum.Note,
  to,
  cc,
  reply: '',
  followersUrl: statusFollowersUrl
})

describe('isDirectStatusLookup', () => {
  it('is false for a Friendica followers-only status', () => {
    expect(isDirectStatusLookup(friendicaFollowersOnly())).toBe(false)
  })

  it('is false when a mentioned account is in cc', () => {
    expect(
      isDirectStatusLookup(friendicaFollowersOnly({ cc: [mentionedId] }))
    ).toBe(false)
  })

  it('is true when the author followers URL is unknown', () => {
    expect(
      isDirectStatusLookup(friendicaFollowersOnly({ statusFollowersUrl: null }))
    ).toBe(true)
  })

  it('is true for a status addressed to specific accounts only', () => {
    expect(
      isDirectStatusLookup(friendicaFollowersOnly({ to: [mentionedId] }))
    ).toBe(true)
  })

  it('is false for a boost', () => {
    expect(
      isDirectStatusLookup({
        ...friendicaFollowersOnly({ to: [mentionedId] }),
        type: StatusType.enum.Announce
      })
    ).toBe(false)
  })
})

describe('buildDirectConversationStatusLookup', () => {
  const row = (
    overrides: Partial<DirectConversationStatusLookupRow> = {}
  ): DirectConversationStatusLookupRow => ({
    id: `${authorId}/statuses/1`,
    url: `${authorId}/statuses/1`,
    actorId: authorId,
    type: StatusType.enum.Note,
    reply: '',
    followersUrl,
    recipientActorId: null,
    recipientType: null,
    ...overrides
  })

  it('carries the author followers URL from the row', () => {
    expect(buildDirectConversationStatusLookup([row()])).toMatchObject({
      followersUrl
    })
  })

  it('keeps it null when the actors row has none', () => {
    expect(
      buildDirectConversationStatusLookup([row({ followersUrl: null })])
    ).toMatchObject({ followersUrl: null })
  })

  it('collects to and cc recipients around it', () => {
    const lookup = buildDirectConversationStatusLookup([
      row({ recipientActorId: followersUrl, recipientType: 'to' }),
      row({ recipientActorId: mentionedId, recipientType: 'cc' })
    ])
    expect(lookup).toMatchObject({
      to: [followersUrl],
      cc: [mentionedId],
      followersUrl
    })
    expect(lookup && isDirectStatusLookup(lookup)).toBe(false)
  })

  it('returns null for no rows', () => {
    expect(buildDirectConversationStatusLookup([])).toBeNull()
  })
})
