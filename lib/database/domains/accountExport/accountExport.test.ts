import { ACCOUNT_EXPORT_TABLES } from '@/lib/database/domains/accountExport/tables'
import type { AccountExportTableName } from '@/lib/database/domains/accountExport/types'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

// Column names that must never appear in an account archive, whatever table
// they are on.
const SECRET_COLUMNS = [
  'privateKey',
  'publicKey',
  'passwordHash',
  'clientSecret',
  'clientId',
  'webhookToken',
  'wahooWebhookToken',
  'wahooWebhookTokenHash',
  'accessToken',
  'refreshToken',
  'oauthState',
  'oauthStateExpiry',
  'tokenExpiresAt',
  'endpoint',
  'p256dh',
  'auth',
  'secret',
  'token',
  'verificationCode',
  'passwordResetCode',
  'emailChangeCode'
]

describe('account export readers', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb
  let accountId: string

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromEmail({
      email: 'test1@llun.test'
    }))!.account!.id
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const readAll = async (
    table: AccountExportTableName,
    actorId = ACTOR1_ID
  ) => {
    const rows: Record<string, unknown>[] = []
    let after = null
    do {
      const page = await database.getAccountExportRows({
        table,
        actorId,
        after,
        limit: 2
      })
      rows.push(...page.rows)
      after = page.next
    } while (after)
    return rows
  }

  it('lists no secret column in any table allowlist', () => {
    for (const [name, spec] of Object.entries(ACCOUNT_EXPORT_TABLES)) {
      for (const column of spec.columns) {
        expect(SECRET_COLUMNS, `${name}.${column}`).not.toContain(column)
      }
    }
  })

  it('exports galleryDefault as its string enum rather than a boolean', async () => {
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      galleryDefault: 'subject'
    })

    const [settings] = await readAll('gallery_settings')

    expect(settings.galleryDefault).toBe('subject')
    expect(ACCOUNT_EXPORT_TABLES.gallery_settings.booleans).not.toContain(
      'galleryDefault'
    )
  })

  it('reads the account without credentials', async () => {
    const account = await database.getAccountExportAccount({ accountId })
    expect(account).toMatchObject({
      id: accountId,
      email: 'test1@llun.test'
    })
    expect(Object.keys(account!).sort()).toEqual(
      [
        'createdAt',
        'defaultActorId',
        'email',
        'emailVerifiedAt',
        'id',
        'name',
        'signUpDomain',
        'verifiedAt'
      ].sort()
    )
  })

  it('reads the actors of the account without their keys', async () => {
    const actors = await database.getAccountExportActors({ accountId })
    expect(actors.map((actor) => actor.id)).toContain(ACTOR1_ID)
    for (const actor of actors) {
      expect(Object.keys(actor)).not.toContain('privateKey')
      expect(Object.keys(actor)).not.toContain('publicKey')
      expect(typeof actor.settings).toBe('object')
    }
  })

  it('pages follows with a keyset cursor and no inbox columns', async () => {
    const first = await database.getAccountExportRows({
      table: 'follows',
      actorId: ACTOR1_ID,
      limit: 1
    })
    expect(first.rows).toHaveLength(1)
    expect(first.next).not.toBeNull()
    expect(Object.keys(first.rows[0]).sort()).toEqual(
      [...ACCOUNT_EXPORT_TABLES.follows.columns].sort()
    )
    expect(typeof first.rows[0].reblogs).toBe('boolean')

    const all = await readAll('follows')
    expect(all.length).toBeGreaterThanOrEqual(3)
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length)
  })

  it('reads followers of the actor, not the people it follows', async () => {
    const followers = await readAll('followers')
    expect(followers.length).toBeGreaterThan(0)
    for (const row of followers) {
      expect(row).toHaveProperty('actorId')
      expect(row.actorId).not.toBe(ACTOR1_ID)
    }
  })

  it('scopes filter keywords through the actor filters', async () => {
    await db
      .insertInto('filters')
      .values([
        { id: 'f1', actorId: ACTOR1_ID, title: 'mine', context: '["home"]' },
        { id: 'f2', actorId: ACTOR2_ID, title: 'theirs', context: '["home"]' }
      ])
      .execute()
    await db
      .insertInto('filter_keywords')
      .values([
        { id: 'k1', filterId: 'f1', keyword: 'spoiler' },
        { id: 'k2', filterId: 'f2', keyword: 'secret-of-someone-else' }
      ])
      .execute()

    const filters = await readAll('filters')
    expect(filters.map((row) => row.id)).toEqual(['f1'])
    expect(filters[0].context).toEqual(['home'])
    const keywords = await readAll('filter_keywords')
    expect(keywords.map((row) => row.keyword)).toEqual(['spoiler'])
  })

  it('never returns fitness provider credentials', async () => {
    await db
      .insertInto('fitness_settings')
      .values({
        id: 'fs1',
        actorId: ACTOR1_ID,
        serviceType: 'strava',
        clientId: 'client-id-value',
        clientSecret: 'client-secret-value',
        webhookToken: 'webhook-token-value',
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        privacyHomeLatitude: 13.7,
        privacyHomeLongitude: 100.5,
        privacyHideRadiusMeters: 200,
        defaultVisibility: 'private'
      })
      .execute()

    const rows = await readAll('fitness_settings')
    expect(rows).toHaveLength(1)
    const serialized = JSON.stringify(rows)
    for (const secret of [
      'client-id-value',
      'client-secret-value',
      'webhook-token-value',
      'access-token-value',
      'refresh-token-value'
    ]) {
      expect(serialized).not.toContain(secret)
    }
    expect(rows[0]).toMatchObject({
      serviceType: 'strava',
      privacyHideRadiusMeters: 200,
      defaultVisibility: 'private',
      privacyLocations: []
    })
  })

  it('skips soft-deleted gear and reads components through live gear', async () => {
    const now = new Date()
    await db
      .insertInto('fitness_gears')
      .values([
        {
          id: 'g1',
          actorId: ACTOR1_ID,
          kind: 'bike',
          name: 'Road bike',
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'g2',
          actorId: ACTOR1_ID,
          kind: 'shoes',
          name: 'Deleted shoes',
          createdAt: now,
          updatedAt: now,
          deletedAt: now
        }
      ])
      .execute()
    await db
      .insertInto('fitness_gear_components')
      .values([
        {
          id: 'c1',
          gearId: 'g1',
          componentType: 'chain',
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'c2',
          gearId: 'g2',
          componentType: 'laces',
          createdAt: now,
          updatedAt: now
        }
      ])
      .execute()
    await db
      .insertInto('fitness_gear_component_periods')
      .values([
        {
          id: 'p1',
          componentId: 'c1',
          installSequence: 1,
          createdAt: now,
          updatedAt: now
        },
        {
          id: 'p2',
          componentId: 'c2',
          installSequence: 1,
          createdAt: now,
          updatedAt: now
        }
      ])
      .execute()

    expect((await readAll('fitness_gears')).map((row) => row.id)).toEqual([
      'g1'
    ])
    expect(
      (await readAll('fitness_gear_components')).map((row) => row.id)
    ).toEqual(['c1'])
    expect(
      (await readAll('fitness_gear_component_periods')).map((row) => row.id)
    ).toEqual(['p1'])
  })

  it('reads medias with the gallery columns and a composite cursor table', async () => {
    await db
      .insertInto('medias')
      .values({
        actorId: ACTOR1_ID,
        accountId,
        original: 'medias/a.webp',
        originalMimeType: 'image/webp',
        originalBytes: 10,
        originalMetaData: '{"width":1,"height":1}',
        placeName: 'Chiang Mai',
        placeLatitude: 18.79,
        placeLongitude: 98.98,
        inGallery: true
      })
      .execute()
    const medias = await readAll('medias')
    expect(medias).toHaveLength(1)
    expect(medias[0]).toMatchObject({
      original: 'medias/a.webp',
      placeName: 'Chiang Mai',
      placeLatitude: 18.79,
      inGallery: true,
      originalMetaData: { width: 1, height: 1 }
    })
    expect(medias[0]).not.toHaveProperty('accountId')
  })

  it('says which media paths belong to the account', async () => {
    await db
      .insertInto('medias')
      .values({
        actorId: ACTOR1_ID,
        accountId,
        original: 'medias/owned.webp',
        originalMimeType: 'image/webp',
        originalBytes: 10,
        originalMetaData: '{"width":1,"height":1}',
        thumbnail: 'medias/owned-thumb.webp',
        thumbnailMimeType: 'image/webp',
        thumbnailBytes: 5,
        thumbnailMetaData: '{"width":1,"height":1}'
      })
      .execute()
    const owns = (path: string, forAccount = accountId) =>
      database.ownsAccountExportMediaPath({ accountId: forAccount, path })
    expect(await owns('medias/owned.webp')).toBe(true)
    expect(await owns('medias/owned-thumb.webp')).toBe(true)
    expect(await owns('medias/not-in-the-table.webp')).toBe(false)
    expect(await owns('archives/x/y/archive-1.zip')).toBe(false)
    const other = (await database.getActorFromEmail({
      email: 'test2@llun.test'
    }))!.account!.id
    expect(await owns('medias/owned.webp', other)).toBe(false)
  })
})
