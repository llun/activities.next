import {
  CollectionSummary,
  CollectionWithFirstPage
} from '@/lib/types/activitypub/collections'

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

  it('accepts CollectionWithFirstPage where next is omitted (e.g. single-page replies)', () => {
    expect(
      CollectionWithFirstPage.safeParse({
        id: 'https://remote.test/posts/1/replies',
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          partOf: 'https://remote.test/posts/1/replies',
          items: []
        }
      }).success
    ).toBe(true)
  })
})
