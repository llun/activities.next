import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import * as blueskyNetworkMigration from '@/migrations/20261124004542_add_bluesky_network'
import * as blueskyInteractionsMigration from '@/migrations/20261124060051_add_bluesky_interactions'
import * as blueskyCrosspostsMigration from '@/migrations/20261124103009_add_bluesky_crossposts'
import * as blueskyCrosspostDidMigration from '@/migrations/20261128081836_add_bluesky_crosspost_did'

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

describe('add_bluesky_crosspost_did migration', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  const crosspostColumns = async () =>
    (await db.introspection.getTables())
      .find((table) => table.name === 'bluesky_crossposts')
      ?.columns.map((column) => column.name) ?? []

  const insertCrosspost = async (values: {
    statusId: string
    actorId: string
    uri?: string | null
    state?: string
  }) => {
    await db
      .insertInto('bluesky_crossposts')
      .values({
        statusId: values.statusId,
        actorId: values.actorId,
        uri: values.uri ?? null,
        state: values.state ?? 'pending',
        updatedAt: new Date()
      })
      .execute()
  }

  const readDid = async (statusId: string) =>
    (
      await db
        .selectFrom('bluesky_crossposts')
        .select('did')
        .where('statusId', '=', statusId)
        .executeTakeFirst()
    )?.did ?? null

  it('rolls down and back up cleanly', async () => {
    await blueskyCrosspostDidMigration.down(db)
    expect(await crosspostColumns()).not.toContain('did')

    await blueskyCrosspostDidMigration.up(db)
    // Calling up() again is idempotent.
    await blueskyCrosspostDidMigration.up(db)
    expect(await crosspostColumns()).toContain('did')
  })

  it('backfills a posted row from its uri and a pending row from the linked account', async () => {
    await blueskyCrosspostDidMigration.down(db)

    const linkedActorId = 'https://example.test/users/did-backfill'
    await db
      .insertInto('bluesky_accounts')
      .values({
        actorId: linkedActorId,
        did: 'did:plc:backfilledaccount1234',
        handle: 'backfill.bsky.social',
        pdsUrl: 'https://bsky.social',
        authType: 'oauth',
        domainHandle: false
      })
      .execute()

    await insertCrosspost({
      statusId: 'https://example.test/users/did-backfill/statuses/posted',
      actorId: linkedActorId,
      uri: 'at://did:plc:postedrecord1234/app.bsky.feed.post/3kposted',
      state: 'posted'
    })
    await insertCrosspost({
      statusId: 'https://example.test/users/did-backfill/statuses/pending',
      actorId: linkedActorId
    })
    await insertCrosspost({
      statusId: 'https://example.test/users/did-backfill/statuses/unlinked',
      actorId: 'https://example.test/users/no-account'
    })
    await insertCrosspost({
      statusId: 'https://example.test/users/did-backfill/statuses/foreign-uri',
      actorId: linkedActorId,
      uri: 'at://example.com/app.bsky.feed.post/3kforeign',
      state: 'posted'
    })

    await blueskyCrosspostDidMigration.up(db)

    // The record's own DID wins over the account linked now.
    await expect(
      readDid('https://example.test/users/did-backfill/statuses/posted')
    ).resolves.toBe('did:plc:postedrecord1234')
    await expect(
      readDid('https://example.test/users/did-backfill/statuses/pending')
    ).resolves.toBe('did:plc:backfilledaccount1234')
    // No account to take a DID from, and no record to read one from.
    await expect(
      readDid('https://example.test/users/did-backfill/statuses/unlinked')
    ).resolves.toBeNull()
    await expect(
      readDid('https://example.test/users/did-backfill/statuses/foreign-uri')
    ).resolves.toBeNull()
  })
})
