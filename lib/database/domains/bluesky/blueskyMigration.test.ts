import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import * as blueskyNetworkMigration from '@/migrations/20261124004542_add_bluesky_network'

describe('add_bluesky_network migration', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  it('refuses to roll back while Bluesky rows exist, then rolls down and up', async () => {
    await database.upsertBlueskyActor({
      did: 'did:plc:migrationdown',
      handle: 'down.bsky.social'
    })

    // Without the column the row would read as an ActivityPub actor.
    await expect(blueskyNetworkMigration.down(db)).rejects.toThrow(
      /Bluesky rows/
    )

    await db.deleteFrom('actors').where('network', '=', 'bluesky').execute()
    await blueskyNetworkMigration.down(db)
    const afterDown = await db.introspection.getTables()
    expect(afterDown.some((table) => table.name === 'bluesky_records')).toBe(
      false
    )

    await blueskyNetworkMigration.up(db)
    const afterUp = await db.introspection.getTables()
    expect(afterUp.some((table) => table.name === 'bluesky_records')).toBe(true)
    expect(
      afterUp
        .find((table) => table.name === 'actors')
        ?.columns.some((column) => column.name === 'network')
    ).toBe(true)
  })
})
