import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

describe('MarkerSQLDatabaseMixin', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns no markers when none are set', async () => {
    const markers = await database.getMarkers({
      actorId: ACTOR1_ID,
      timelines: ['home', 'notifications']
    })
    expect(markers).toEqual([])
  })

  it('upserts a marker and starts at version 1', async () => {
    const marker = await database.upsertMarker({
      actorId: ACTOR1_ID,
      timeline: 'home',
      lastReadId: '100'
    })
    expect(marker).toEqual(
      expect.objectContaining({
        timeline: 'home',
        lastReadId: '100',
        version: 1
      })
    )
  })

  it('increments version on subsequent upserts', async () => {
    await database.upsertMarker({
      actorId: ACTOR1_ID,
      timeline: 'notifications',
      lastReadId: '5'
    })
    const updated = await database.upsertMarker({
      actorId: ACTOR1_ID,
      timeline: 'notifications',
      lastReadId: '9'
    })
    expect(updated.lastReadId).toBe('9')
    expect(updated.version).toBe(2)
  })

  it('overwrites lastReadId on every upsert (last-write-wins) and bumps version', async () => {
    const LWW_ACTOR_ID = 'https://llun.test/users/marker-lww'

    // First upsert: brand-new row, version 1
    const first = await database.upsertMarker({
      actorId: LWW_ACTOR_ID,
      timeline: 'home',
      lastReadId: '100'
    })
    expect(first.lastReadId).toBe('100')
    expect(first.version).toBe(1)

    // Second upsert with a numerically smaller id — must still overwrite (ids are opaque)
    const second = await database.upsertMarker({
      actorId: LWW_ACTOR_ID,
      timeline: 'home',
      lastReadId: '50'
    })
    expect(second.lastReadId).toBe('50')
    expect(second.version).toBe(2)

    // Verify persistence: DB holds '50' at version 2
    const persisted = await database.getMarkers({
      actorId: LWW_ACTOR_ID,
      timelines: ['home']
    })
    expect(persisted[0].lastReadId).toBe('50')
    expect(persisted[0].version).toBe(2)

    // Third upsert: any value — must overwrite and bump version again
    const third = await database.upsertMarker({
      actorId: LWW_ACTOR_ID,
      timeline: 'home',
      lastReadId: '200'
    })
    expect(third.lastReadId).toBe('200')
    expect(third.version).toBe(3)

    // Verify persistence: DB holds '200' at version 3
    const persisted2 = await database.getMarkers({
      actorId: LWW_ACTOR_ID,
      timelines: ['home']
    })
    expect(persisted2[0].lastReadId).toBe('200')
    expect(persisted2[0].version).toBe(3)
  })

  it('reads back only the requested timelines', async () => {
    // Use a distinct actor so this test is self-contained regardless of order.
    await database.upsertMarker({
      actorId: ACTOR2_ID,
      timeline: 'home',
      lastReadId: '200'
    })
    await database.upsertMarker({
      actorId: ACTOR2_ID,
      timeline: 'notifications',
      lastReadId: '300'
    })
    const markers = await database.getMarkers({
      actorId: ACTOR2_ID,
      timelines: ['home']
    })
    expect(markers).toHaveLength(1)
    expect(markers[0].timeline).toBe('home')
  })
})
