import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { ACTOR4_ID } from '@/lib/stub/seed/actor4'

describe('EndorsementSQLDatabaseMixin', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('creates an endorsement idempotently and reads it back', async () => {
    const first = await database.createEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID
    })
    expect(first.actorId).toBe(ACTOR1_ID)
    expect(first.targetActorId).toBe(ACTOR2_ID)
    expect(first.id).toEqual(expect.any(String))

    // A second create returns the same row (no duplicate, no throw).
    const second = await database.createEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID
    })
    expect(second.id).toBe(first.id)

    const fetched = await database.getEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID
    })
    expect(fetched?.id).toBe(first.id)
  })

  it('returns null for a non-existent endorsement', async () => {
    const fetched = await database.getEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR3_ID
    })
    expect(fetched).toBeNull()
  })

  it('lists endorsements newest-first and paginates by id cursor', async () => {
    await database.createEndorsement({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR3_ID
    })

    const all = await database.getEndorsements({
      actorId: ACTOR1_ID,
      limit: 40
    })
    expect(all.length).toBeGreaterThanOrEqual(2)
    // Newest-first: ids strictly descending.
    for (let i = 1; i < all.length; i += 1) {
      expect(Number(all[i - 1].id)).toBeGreaterThan(Number(all[i].id))
    }

    const firstPage = await database.getEndorsements({
      actorId: ACTOR1_ID,
      limit: 1
    })
    expect(firstPage).toHaveLength(1)
    const nextPage = await database.getEndorsements({
      actorId: ACTOR1_ID,
      limit: 1,
      maxId: firstPage[0].id
    })
    expect(nextPage).toHaveLength(1)
    expect(Number(nextPage[0].id)).toBeLessThan(Number(firstPage[0].id))
  })

  it('orders min_id vs since_id differently but always returns newest-first', async () => {
    // Three endorsements by Actor2, created oldest -> newest (ids ascending).
    const e1 = await database.createEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID
    })
    const e2 = await database.createEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR3_ID
    })
    const e3 = await database.createEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR4_ID
    })

    // Forward pagination above the oldest cursor: newest-first, no overlap.
    const forward = await database.getEndorsements({
      actorId: ACTOR2_ID,
      limit: 40,
      minId: e1.id
    })
    expect(forward.map((e) => e.id)).toEqual([e3.id, e2.id])
    expect(forward.map((e) => e.id)).not.toContain(e1.id)

    // With a tight limit, min_id and since_id select different bands above the
    // cursor: min_id -> oldest band (e2), since_id -> newest band (e3). Both are
    // returned newest-first.
    const byMinId = await database.getEndorsements({
      actorId: ACTOR2_ID,
      limit: 1,
      minId: e1.id
    })
    expect(byMinId.map((e) => e.id)).toEqual([e2.id])

    const bySinceId = await database.getEndorsements({
      actorId: ACTOR2_ID,
      limit: 1,
      sinceId: e1.id
    })
    expect(bySinceId.map((e) => e.id)).toEqual([e3.id])
  })

  it('deletes an endorsement', async () => {
    await database.createEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID
    })
    await database.deleteEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID
    })
    const fetched = await database.getEndorsement({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID
    })
    expect(fetched).toBeNull()
  })
})
