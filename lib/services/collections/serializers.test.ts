import { Database } from '@/lib/database/types'
import { Collection } from '@/lib/types/domain/collection'

import {
  COLLECTION_ITEMS_PREVIEW_LIMIT,
  getCollectionEntities,
  serializeCollection,
  serializeCollectionItem,
  wrapCollection,
  wrapCollectionItem
} from './serializers'

const OWNER_ACTOR_ID = 'https://llun.test/users/test1'

const collection: Collection = {
  id: 'col-1',
  ownerActorId: OWNER_ACTOR_ID,
  title: 'Excellent people',
  description: null,
  topic: 'Fediverse',
  language: 'en',
  visibility: 'public',
  sensitive: false,
  publicFeed: true,
  createdAt: 1720000000000,
  updatedAt: 1720000001000
}

const item = (
  overrides: Partial<Parameters<typeof serializeCollectionItem>[0]>
) => ({
  id: 'item-1',
  targetActorId: 'https://llun.test/users/test2',
  featureState: 'pending' as const,
  createdAt: 1720000000000,
  ...overrides
})

describe('serializeCollectionItem', () => {
  it.each([
    { featureState: 'pending' as const, state: 'pending' },
    { featureState: 'approved' as const, state: 'accepted' },
    { featureState: 'revoked' as const, state: 'revoked' }
  ])(
    'maps featureState $featureState to state $state',
    ({ featureState, state }) => {
      const serialized = serializeCollectionItem(item({ featureState }))
      expect(serialized).toEqual({
        id: 'item-1',
        account_id: 'llun.test:users:test2',
        state,
        created_at: '2024-07-03T09:46:40.000Z'
      })
    }
  )
})

describe('serializeCollection', () => {
  it('produces the Mastodon 4.6 entity plus the activities.next extensions', () => {
    const entity = serializeCollection({
      collection,
      items: [item({})],
      itemCount: 1,
      approvedCount: 0
    })
    expect(entity).toMatchObject({
      id: 'col-1',
      account_id: 'llun.test:users:test1',
      uri: `${OWNER_ACTOR_ID}/collections/featured-collections/col-1`,
      url: 'https://llun.test/collections/col-1',
      name: 'Excellent people',
      description: '',
      language: 'en',
      local: true,
      sensitive: false,
      discoverable: true,
      tag: { name: 'Fediverse', url: 'https://llun.test/tags/fediverse' },
      item_count: 1,
      created_at: '2024-07-03T09:46:40.000Z',
      updated_at: '2024-07-03T09:46:41.000Z',
      title: 'Excellent people',
      topic: 'Fediverse',
      visibility: 'public',
      feed_enabled: true,
      size: 0
    })
    expect(entity.items).toHaveLength(1)
    expect(entity.items[0].state).toBe('pending')
  })

  it.each([
    { visibility: 'public' as const, discoverable: true },
    { visibility: 'unlisted' as const, discoverable: false },
    { visibility: 'private' as const, discoverable: false }
  ])(
    'maps visibility $visibility to discoverable $discoverable',
    ({ visibility, discoverable }) => {
      const entity = serializeCollection({
        collection: { ...collection, visibility },
        items: [],
        itemCount: 0,
        approvedCount: 0
      })
      expect(entity.discoverable).toBe(discoverable)
      expect(entity.visibility).toBe(visibility)
    }
  )

  it('emits a null tag when the collection has no topic', () => {
    const entity = serializeCollection({
      collection: { ...collection, topic: null },
      items: [],
      itemCount: 0,
      approvedCount: 0
    })
    expect(entity.tag).toBeNull()
  })

  it('caps the inline items preview', () => {
    const items = Array.from(
      { length: COLLECTION_ITEMS_PREVIEW_LIMIT + 5 },
      (_, index) => item({ id: `item-${index}` })
    )
    const entity = serializeCollection({
      collection,
      items,
      itemCount: items.length,
      approvedCount: 0
    })
    expect(entity.items).toHaveLength(COLLECTION_ITEMS_PREVIEW_LIMIT)
    expect(entity.item_count).toBe(items.length)
  })
})

describe('wrapCollection', () => {
  it('wraps the entity under a collection key', () => {
    const entity = serializeCollection({
      collection,
      items: [],
      itemCount: 0,
      approvedCount: 0
    })
    expect(wrapCollection(entity)).toEqual({ collection: entity })
  })
})

describe('wrapCollectionItem', () => {
  it('wraps the item under a collection_item key', () => {
    const serialized = serializeCollectionItem(item({}))
    expect(wrapCollectionItem(serialized)).toEqual({
      collection_item: serialized
    })
  })
})

describe('getCollectionEntities', () => {
  const buildDatabase = () => {
    const getCollectionItems = vi.fn().mockResolvedValue({ 'col-1': [] })
    const countCollectionItems = vi.fn().mockResolvedValue({ 'col-1': 0 })
    const database = {
      getCollectionItems,
      countCollectionItems
    } as unknown as Database
    return { database, getCollectionItems, countCollectionItems }
  }

  it('skips the redundant all-states count query in the public projection', async () => {
    const { database, getCollectionItems, countCollectionItems } =
      buildDatabase()
    await getCollectionEntities(database, [collection], 'public')
    expect(getCollectionItems).toHaveBeenCalledWith({
      collectionIds: ['col-1'],
      approvedOnly: true
    })
    // Public projection reads approved counts only, so the all-states total
    // query must not run: exactly one count query, approved-only.
    expect(countCollectionItems).toHaveBeenCalledTimes(1)
    expect(countCollectionItems).toHaveBeenCalledWith({
      collectionIds: ['col-1'],
      approvedOnly: true
    })
  })

  it('runs both count queries in the owner projection', async () => {
    const { database, countCollectionItems } = buildDatabase()
    await getCollectionEntities(database, [collection], 'owner')
    // Owner projection needs the all-states total AND the approved count.
    expect(countCollectionItems).toHaveBeenCalledTimes(2)
    expect(countCollectionItems).toHaveBeenCalledWith({
      collectionIds: ['col-1']
    })
    expect(countCollectionItems).toHaveBeenCalledWith({
      collectionIds: ['col-1'],
      approvedOnly: true
    })
  })
})
