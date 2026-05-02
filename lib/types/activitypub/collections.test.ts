import { CollectionSummary } from '@/lib/types/activitypub/collections'

describe('ActivityPub collections', () => {
  it('accepts OrderedCollection summaries from Mastodon-compatible servers', () => {
    expect(
      CollectionSummary.safeParse({
        id: 'https://remote.test/users/alice/followers',
        type: 'OrderedCollection',
        totalItems: 12
      }).success
    ).toBe(true)
  })
})
