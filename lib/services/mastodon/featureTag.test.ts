import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { FEATURED_TAGS_LIMIT, featureTag, unfeatureTag } from './featureTag'

describe('featureTag', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('creates a featured tag and returns the existing entry when re-featuring', async () => {
    const first = await featureTag({
      database,
      actorId: ACTOR1_ID,
      name: 'Coffee'
    })
    expect(first.status).toBe('featured')
    if (first.status !== 'featured') return

    // Same normalized name, different case and a leading # — idempotent.
    const second = await featureTag({
      database,
      actorId: ACTOR1_ID,
      name: '#coffee'
    })
    expect(second.status).toBe('featured')
    if (second.status !== 'featured') return
    expect(second.tag.id).toBe(first.tag.id)
  })

  it('returns limit_reached once the per-account cap is hit', async () => {
    for (let index = 0; index < FEATURED_TAGS_LIMIT; index += 1) {
      const result = await featureTag({
        database,
        actorId: ACTOR2_ID,
        name: `limit${index}`
      })
      expect(result.status).toBe('featured')
    }
    const overflow = await featureTag({
      database,
      actorId: ACTOR2_ID,
      name: 'overflow'
    })
    expect(overflow.status).toBe('limit_reached')
  })
})

describe('unfeatureTag', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('removes a featured tag by name and is a no-op when not featured', async () => {
    const created = await featureTag({
      database,
      actorId: ACTOR1_ID,
      name: 'Trail'
    })
    expect(created.status).toBe('featured')

    await unfeatureTag({ database, actorId: ACTOR1_ID, name: '#trail' })
    expect(
      await database.getFeaturedTagByName({ actorId: ACTOR1_ID, name: 'trail' })
    ).toBeNull()

    await expect(
      unfeatureTag({ database, actorId: ACTOR1_ID, name: 'trail' })
    ).resolves.toBeUndefined()
  })
})
