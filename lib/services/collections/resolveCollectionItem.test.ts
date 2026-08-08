import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { resolveCollectionItem } from './resolveCollectionItem'

describe('resolveCollectionItem', () => {
  const database = getTestSQLDatabase()
  let collectionId: string
  let itemId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    const collection = await database.createCollection({
      actorId: ACTOR1_ID,
      title: 'Resolve target'
    })
    collectionId = collection.id
    await database.addCollectionMembers({
      id: collectionId,
      actorId: ACTOR1_ID,
      targetActorIds: [ACTOR2_ID]
    })
    const item = await database.getCollectionItemByAccount({
      collectionId,
      targetActorId: ACTOR2_ID
    })
    if (!item) {
      throw new Error('failed to seed a collection membership row')
    }
    itemId = item.id
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('resolves by the v4 collection-item row id first', async () => {
    const item = await resolveCollectionItem(database, collectionId, itemId)
    expect(item?.targetActorId).toBe(ACTOR2_ID)
  })

  it('falls back to the colon-form account id', async () => {
    const item = await resolveCollectionItem(
      database,
      collectionId,
      urlToId(ACTOR2_ID)
    )
    expect(item?.targetActorId).toBe(ACTOR2_ID)
  })

  it('falls back to the publicId-form account id', async () => {
    const actor = await database.getActorFromId({ id: ACTOR2_ID })
    if (!actor?.publicId) {
      throw new Error('seeded actor is missing a publicId')
    }

    const item = await resolveCollectionItem(
      database,
      collectionId,
      actor.publicId
    )
    expect(item?.targetActorId).toBe(ACTOR2_ID)
  })

  it('returns null when neither an item id nor an account id resolves', async () => {
    const item = await resolveCollectionItem(
      database,
      collectionId,
      'this-does-not-resolve'
    )
    expect(item).toBeNull()
  })
})
