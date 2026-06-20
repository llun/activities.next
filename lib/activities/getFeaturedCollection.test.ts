import { getFeaturedCollection } from '@/lib/activities/getFeaturedCollection'
import { Collection } from '@/lib/types/domain/collection'

const baseCollection: Collection = {
  id: 'col-1',
  ownerActorId: 'https://llun.test/users/owner',
  title: 'Cool people',
  description: 'A bundle',
  topic: 'fediverse',
  language: 'en',
  visibility: 'public',
  publicFeed: true,
  createdAt: 1700000000000,
  updatedAt: 1700000100000
}

describe('getFeaturedCollection', () => {
  it('builds a FEP-7aa9 FeaturedCollection with FeaturedItem members', () => {
    const result = getFeaturedCollection(
      'https://llun.test/users/owner',
      baseCollection,
      [
        { id: 'https://llun.test/users/alice', type: 'Person' },
        { id: 'https://remote.test/users/bob', type: 'Service' }
      ]
    )

    expect(result['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/fep/7aa9'
    ])
    expect(result.id).toBe(
      'https://llun.test/users/owner/collections/featured-collections/col-1'
    )
    expect(result.type).toBe('FeaturedCollection')
    expect(result.attributedTo).toBe('https://llun.test/users/owner')
    expect(result.name).toBe('Cool people')
    expect(result.summary).toBe('A bundle')
    expect(result.topic).toEqual({ type: 'Hashtag', name: '#fediverse' })
    expect(result.totalItems).toBe(2)
    // featuredObjectType reflects each member's actual actor type.
    expect(result.orderedItems).toEqual([
      {
        type: 'FeaturedItem',
        featuredObject: 'https://llun.test/users/alice',
        featuredObjectType: 'Person'
      },
      {
        type: 'FeaturedItem',
        featuredObject: 'https://remote.test/users/bob',
        featuredObjectType: 'Service'
      }
    ])
  })

  it('omits summary and topic when absent', () => {
    const result = getFeaturedCollection(
      'https://llun.test/users/owner',
      { ...baseCollection, description: null, topic: null },
      []
    )
    expect(result).not.toHaveProperty('summary')
    expect(result).not.toHaveProperty('topic')
    expect(result.totalItems).toBe(0)
    expect(result.orderedItems).toEqual([])
  })
})
