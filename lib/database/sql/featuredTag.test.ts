import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const ACTOR_ID = 'https://llun.test/users/owner'
const OTHER_ACTOR_ID = 'https://llun.test/users/other'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

const createActor = (database: Database, id: string, username: string) =>
  database.createActor({
    actorId: id,
    username,
    domain: 'llun.test',
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: 'https://llun.test/inbox',
    followersUrl: `${id}/followers`,
    publicKey: 'public-key',
    privateKey: 'private-key',
    createdAt: 1
  })

const createTaggedNote = async (
  database: Database,
  {
    actorId,
    id,
    tag,
    createdAt,
    isPublic = true
  }: {
    actorId: string
    id: string
    tag: string
    createdAt: number
    isPublic?: boolean
  }
) => {
  await database.createNote({
    id,
    url: id,
    actorId,
    to: isPublic ? [ACTIVITY_STREAM_PUBLIC] : [`${actorId}/followers`],
    cc: [],
    text: `Post about #${tag}`,
    createdAt
  })
  await database.createTag({
    statusId: id,
    type: 'hashtag',
    name: `#${tag}`,
    value: `https://llun.test/tags/${tag.toLowerCase()}`
  })
}

describe('FeaturedTagDatabase', () => {
  it('lists featured tags ordered by statuses_count desc with derived stats', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      // "running" appears in two public statuses, "coffee" in one.
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/1`,
        tag: 'Running',
        createdAt: 1000
      })
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/2`,
        tag: 'running',
        createdAt: 5000
      })
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/3`,
        tag: 'coffee',
        createdAt: 3000
      })

      await database.createFeaturedTag({ actorId: ACTOR_ID, name: 'coffee' })
      await database.createFeaturedTag({ actorId: ACTOR_ID, name: '#Running' })

      const tags = await database.getFeaturedTags({ actorId: ACTOR_ID })
      expect(tags).toHaveLength(2)
      // running (2 statuses) sorts before coffee (1 status).
      expect(tags[0]).toMatchObject({
        name: 'Running',
        statusesCount: 2,
        lastStatusAt: 5000
      })
      expect(tags[1]).toMatchObject({
        name: 'coffee',
        statusesCount: 1,
        lastStatusAt: 3000
      })
    })
  })

  it('counts only the actor own publicly-addressed statuses', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      await createActor(database, OTHER_ACTOR_ID, 'other')

      // Public status by the owner — counted.
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/1`,
        tag: 'news',
        createdAt: 1000
      })
      // Followers-only status by the owner — NOT counted (private).
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/2`,
        tag: 'news',
        createdAt: 2000,
        isPublic: false
      })
      // Public status by a different actor — NOT counted (not the owner).
      await createTaggedNote(database, {
        actorId: OTHER_ACTOR_ID,
        id: `${OTHER_ACTOR_ID}/statuses/1`,
        tag: 'news',
        createdAt: 9000
      })

      await database.createFeaturedTag({ actorId: ACTOR_ID, name: 'news' })
      const [tag] = await database.getFeaturedTags({ actorId: ACTOR_ID })
      expect(tag).toMatchObject({ statusesCount: 1, lastStatusAt: 1000 })
    })
  })

  it('returns a featured tag with zero stats when no statuses carry it', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      const created = await database.createFeaturedTag({
        actorId: ACTOR_ID,
        name: 'unused'
      })
      expect(created).toMatchObject({
        name: 'unused',
        statusesCount: 0,
        lastStatusAt: null
      })
    })
  })

  it('normalizes the name and rejects an already-featured tag via getFeaturedTagByName', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      const created = await database.createFeaturedTag({
        actorId: ACTOR_ID,
        name: '#Foo'
      })
      expect(created.name).toBe('Foo')

      // The normalized-name lookup matches regardless of case or leading hash.
      const existing = await database.getFeaturedTagByName({
        actorId: ACTOR_ID,
        name: 'foo'
      })
      expect(existing?.id).toBe(created.id)
    })
  })

  it('deletes a featured tag only for its owner', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      const created = await database.createFeaturedTag({
        actorId: ACTOR_ID,
        name: 'mine'
      })

      // A different actor cannot delete it.
      const otherDelete = await database.deleteFeaturedTag({
        actorId: OTHER_ACTOR_ID,
        id: created.id
      })
      expect(otherDelete).toBeNull()
      expect(
        await database.getFeaturedTags({ actorId: ACTOR_ID })
      ).toHaveLength(1)

      // The owner can.
      const removed = await database.deleteFeaturedTag({
        actorId: ACTOR_ID,
        id: created.id
      })
      expect(removed?.id).toBe(created.id)
      expect(
        await database.getFeaturedTags({ actorId: ACTOR_ID })
      ).toHaveLength(0)

      // Deleting a missing id returns null.
      expect(
        await database.deleteFeaturedTag({
          actorId: ACTOR_ID,
          id: 'does-not-exist'
        })
      ).toBeNull()
    })
  })

  it('suggests the most-used hashtags that are not already featured', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      // popular: 2 statuses, niche: 1 status, featured: 1 status (featured).
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/1`,
        tag: 'popular',
        createdAt: 1000
      })
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/2`,
        tag: 'popular',
        createdAt: 2000
      })
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/3`,
        tag: 'niche',
        createdAt: 3000
      })
      await createTaggedNote(database, {
        actorId: ACTOR_ID,
        id: `${ACTOR_ID}/statuses/4`,
        tag: 'featured',
        createdAt: 4000
      })

      await database.createFeaturedTag({ actorId: ACTOR_ID, name: 'featured' })

      const suggestions = await database.getFeaturedTagSuggestions({
        actorId: ACTOR_ID
      })
      const names = suggestions.map((suggestion) => suggestion.name)
      // Already-featured "featured" is excluded; "popular" outranks "niche".
      expect(names).toEqual(['popular', 'niche'])
    })
  })

  it('caps suggestions at the requested limit', async () => {
    await withFreshDatabase(async (database) => {
      await createActor(database, ACTOR_ID, 'owner')
      for (let index = 0; index < 5; index += 1) {
        await createTaggedNote(database, {
          actorId: ACTOR_ID,
          id: `${ACTOR_ID}/statuses/${index}`,
          tag: `tag${index}`,
          createdAt: 1000 + index
        })
      }
      const suggestions = await database.getFeaturedTagSuggestions({
        actorId: ACTOR_ID,
        limit: 3
      })
      expect(suggestions).toHaveLength(3)
    })
  })
})
