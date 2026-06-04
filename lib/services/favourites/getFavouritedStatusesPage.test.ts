import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { encodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import { Database } from '@/lib/database/types'
import { getFavouritedStatusesPage } from '@/lib/services/favourites/getFavouritedStatusesPage'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('getFavouritedStatusesPage', () => {
  let raw: Knex
  let database: Database
  let viewer: Actor

  // Five statuses by ACTOR2, all liked by ACTOR1 with strictly increasing
  // createdAt so ordering is deterministic (no timestamp ties).
  const statusIds = Array.from(
    { length: 5 },
    (_, index) => `${ACTOR2_ID}/statuses/fav-page-${index + 1}`
  )

  beforeAll(async () => {
    raw = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: { filename: ':memory:' }
    })
    database = getSQLDatabase(raw)
    await database.migrate()
    await seedDatabase(database)
    viewer = (await database.getActorFromId({ id: ACTOR1_ID }))!

    for (const statusId of statusIds) {
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR2_ID,
        text: `favourite ${statusId}`,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createLike({ actorId: ACTOR1_ID, statusId })
    }

    // Force deterministic, distinct like timestamps (index i → epoch i+1 sec).
    for (let index = 0; index < statusIds.length; index++) {
      await raw('likes')
        .where({ actorId: ACTOR1_ID, statusId: statusIds[index] })
        .update({ createdAt: new Date((index + 1) * 1000) })
    }
  })

  afterAll(async () => {
    await raw.destroy()
  })

  const idsOf = (statuses: { id: string }[]) => statuses.map((s) => s.id)

  it('returns all favourites newest-first', async () => {
    const page = await getFavouritedStatusesPage({
      database,
      actorId: ACTOR1_ID,
      currentActor: viewer,
      limit: 10
    })
    expect(idsOf(page.statuses)).toEqual([...statusIds].reverse())
  })

  it('backfills past an unreadable status during min_id forward pagination', async () => {
    // min_id at the oldest favourite (fav-page-1).
    const oldestCursor = encodeFavouriteCursor({
      createdAt: 1000,
      statusId: statusIds[0]
    })

    // Delete fav-page-2: it stays liked but is no longer readable, so the page
    // immediately after min_id (fav-page-2, fav-page-3) loses one entry and the
    // service must backfill to reach fav-page-4.
    await database.deleteStatus({ statusId: statusIds[1], actorId: ACTOR2_ID })

    const page = await getFavouritedStatusesPage({
      database,
      actorId: ACTOR1_ID,
      currentActor: viewer,
      limit: 2,
      minId: oldestCursor
    })

    // Closest two readable favourites newer than fav-page-1 are fav-page-3 and
    // fav-page-4 (fav-page-2 is gone), presented newest-first.
    expect(idsOf(page.statuses)).toEqual([statusIds[3], statusIds[2]])
  })
})
