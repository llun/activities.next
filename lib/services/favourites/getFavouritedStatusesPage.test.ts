import knex, { Knex } from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { encodeFavouriteCursor } from '@/lib/database/sql/utils/favouriteCursor'
import { Database } from '@/lib/database/types'
import {
  MAX_FAVOURITE_BACKFILL_ITERATIONS,
  getFavouritedStatusesPage
} from '@/lib/services/favourites/getFavouritedStatusesPage'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const newTestDatabase = async () => {
  const raw = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(raw)
  await database.migrate()
  await seedDatabase(database)
  return { raw, database }
}

// Like a status by ACTOR1 with an explicit createdAt so ordering is
// deterministic (createLike stamps `now()`, which would tie).
const likeAt = async (
  raw: Knex,
  database: Database,
  statusId: string,
  createdAtMs: number
) => {
  await database.createLike({ actorId: ACTOR1_ID, statusId })
  await raw('likes')
    .where({ actorId: ACTOR1_ID, statusId })
    .update({ createdAt: new Date(createdAtMs) })
}

const createNote = (database: Database, statusId: string) =>
  database.createNote({
    id: statusId,
    url: statusId,
    actorId: ACTOR2_ID,
    text: `favourite ${statusId}`,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: []
  })

const idsOf = (statuses: { id: string }[]) => statuses.map((s) => s.id)

describe('getFavouritedStatusesPage', () => {
  let raw: Knex
  let database: Database
  let viewer: Actor

  const statusIds = Array.from(
    { length: 5 },
    (_, index) => `${ACTOR2_ID}/statuses/fav-page-${index + 1}`
  )

  beforeAll(async () => {
    ;({ raw, database } = await newTestDatabase())
    viewer = (await database.getActorFromId({ id: ACTOR1_ID }))!
    for (let index = 0; index < statusIds.length; index++) {
      await createNote(database, statusIds[index])
      await likeAt(raw, database, statusIds[index], (index + 1) * 1000)
    }
  })

  afterAll(async () => {
    await raw.destroy()
  })

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
    const oldestCursor = encodeFavouriteCursor({
      createdAt: 1000,
      statusId: statusIds[0]
    })

    // Drop only the status row (not via deleteStatus, which would also delete
    // the like) so fav-page-2 stays liked but unreadable. The page immediately
    // after min_id (fav-page-2, fav-page-3) then loses an entry and the service
    // must backfill into the next band to reach fav-page-4.
    await raw('statuses').where('id', statusIds[1]).delete()

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

describe('getFavouritedStatusesPage backfill exhaustion', () => {
  let raw: Knex
  let database: Database
  let viewer: Actor

  // Two readable (oldest) favourites buried under a run of unreadable ones
  // longer than the backfill budget, so the first page scans only unreadable
  // likes and must still hand back a resume cursor.
  const unreadableCount = MAX_FAVOURITE_BACKFILL_ITERATIONS * 2 + 2
  const readableIds = [
    `${ACTOR2_ID}/statuses/reachable-1`,
    `${ACTOR2_ID}/statuses/reachable-2`
  ]

  beforeAll(async () => {
    ;({ raw, database } = await newTestDatabase())
    viewer = (await database.getActorFromId({ id: ACTOR1_ID }))!

    // Oldest: two readable favourites (createdAt 1000, 2000).
    for (let index = 0; index < readableIds.length; index++) {
      await createNote(database, readableIds[index])
      await likeAt(raw, database, readableIds[index], (index + 1) * 1000)
    }
    // Newer: a long run of liked-but-unreadable statuses (status rows removed).
    for (let index = 0; index < unreadableCount; index++) {
      const statusId = `${ACTOR2_ID}/statuses/unreadable-${index + 1}`
      await createNote(database, statusId)
      await likeAt(raw, database, statusId, 10000 + index * 1000)
      await raw('statuses').where('id', statusId).delete()
    }
  })

  afterAll(async () => {
    await raw.destroy()
  })

  it('does not strand the client when a full backfill window is unreadable', async () => {
    const firstPage = await getFavouritedStatusesPage({
      database,
      actorId: ACTOR1_ID,
      currentActor: viewer,
      limit: 2
    })

    // The newest window is entirely unreadable, so this page is empty — but it
    // must still expose a next cursor so the client can keep scanning.
    expect(firstPage.statuses).toHaveLength(0)
    expect(firstPage.nextMaxFavouriteId).toEqual(expect.any(String))

    // Following the resume cursor must eventually surface the readable ones
    // rather than dead-ending.
    let cursor = firstPage.nextMaxFavouriteId
    const seen: string[] = []
    for (let i = 0; i < 10 && cursor; i++) {
      const page = await getFavouritedStatusesPage({
        database,
        actorId: ACTOR1_ID,
        currentActor: viewer,
        limit: 2,
        maxId: cursor
      })
      seen.push(...idsOf(page.statuses))
      cursor = page.nextMaxFavouriteId
    }
    expect(seen).toEqual(readableIds.reverse())
  })
})
