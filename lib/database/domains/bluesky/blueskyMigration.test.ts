import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import * as blueskyNetworkMigration from '@/migrations/20261124004542_add_bluesky_network'
import * as blueskyInteractionsMigration from '@/migrations/20261124060051_add_bluesky_interactions'
import * as blueskyCrosspostsMigration from '@/migrations/20261124103009_add_bluesky_crossposts'

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

describe('add_bluesky_interactions migration', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  it('rolls down and back up cleanly', async () => {
    await blueskyInteractionsMigration.down(db)
    const afterDown = await db.introspection.getTables()
    expect(
      afterDown.some((table) => table.name === 'bluesky_interactions')
    ).toBe(false)
    expect(
      afterDown
        .find((table) => table.name === 'bluesky_accounts')
        ?.columns.some((column) => column.name === 'notificationsSeenAt')
    ).toBe(false)

    await blueskyInteractionsMigration.up(db)
    // Calling up() again is idempotent.
    await blueskyInteractionsMigration.up(db)
    const afterUp = await db.introspection.getTables()
    expect(afterUp.some((table) => table.name === 'bluesky_interactions')).toBe(
      true
    )
    expect(
      afterUp
        .find((table) => table.name === 'bluesky_accounts')
        ?.columns.some((column) => column.name === 'notificationsSeenAt')
    ).toBe(true)
  })

  it('backfills notificationsSeenAt for accounts that existed before up()', async () => {
    await blueskyInteractionsMigration.down(db)

    const actorId = 'https://example.test/users/pre-migration'
    await db
      .insertInto('bluesky_accounts')
      .values({
        actorId,
        did: 'did:plc:premigrationaccount1234',
        handle: 'premigration.bsky.social',
        pdsUrl: 'https://bsky.social',
        authType: 'oauth',
        domainHandle: false
      })
      .execute()

    await blueskyInteractionsMigration.up(db)

    const row = await db
      .selectFrom('bluesky_accounts')
      .select('notificationsSeenAt')
      .where('actorId', '=', actorId)
      .executeTakeFirst()
    expect(row?.notificationsSeenAt).not.toBeNull()
    expect(row?.notificationsSeenAt).toBeDefined()

    const account = await database.getBlueskyAccount({ actorId })
    expect(account?.notificationsSeenAt).not.toBeNull()
    expect(typeof account?.notificationsSeenAt).toBe('number')
  })
})

describe('add_bluesky_crossposts migration', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  it('rolls down and back up cleanly', async () => {
    await blueskyCrosspostsMigration.down(db)
    const afterDown = await db.introspection.getTables()
    expect(afterDown.some((table) => table.name === 'bluesky_crossposts')).toBe(
      false
    )
    expect(
      afterDown
        .find((table) => table.name === 'bluesky_accounts')
        ?.columns.some((column) => column.name === 'crosspostByDefault')
    ).toBe(false)

    await blueskyCrosspostsMigration.up(db)
    // Calling up() again is idempotent.
    await blueskyCrosspostsMigration.up(db)
    const afterUp = await db.introspection.getTables()
    expect(afterUp.some((table) => table.name === 'bluesky_crossposts')).toBe(
      true
    )
    expect(
      afterUp
        .find((table) => table.name === 'bluesky_accounts')
        ?.columns.some((column) => column.name === 'crosspostByDefault')
    ).toBe(true)
  })

  it('defaults cross-posting on for accounts that existed before up()', async () => {
    await blueskyCrosspostsMigration.down(db)

    const actorId = 'https://example.test/users/pre-crosspost'
    await db
      .insertInto('bluesky_accounts')
      .values({
        actorId,
        did: 'did:plc:precrosspostaccount1234',
        handle: 'precrosspost.bsky.social',
        pdsUrl: 'https://bsky.social',
        authType: 'oauth',
        domainHandle: false
      })
      .execute()

    await blueskyCrosspostsMigration.up(db)

    const account = await database.getBlueskyAccount({ actorId })
    expect(account?.crosspostByDefault).toBe(true)
  })
})
