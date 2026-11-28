import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import * as hostingPolicyMigration from '@/migrations/20261128101143_add_bluesky_hosting_policy'

const COLUMNS = [
  'blueskyHostingPolicy',
  'blueskyHostingAllowEmails',
  'blueskyHostingAllowActors'
]

describe('add_bluesky_hosting_policy migration', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  const domainColumns = async () =>
    (await db.introspection.getTables()).find(
      (table) => table.name === 'domains'
    )?.columns ?? []

  it('adds the columns, keeps existing rows, and rolls down and up cleanly', async () => {
    await database.createServedDomain({ domain: 'run.example', status: 'on' })

    await hostingPolicyMigration.down(db)
    const afterDown = await domainColumns()
    for (const column of COLUMNS) {
      expect(afterDown.some((existing) => existing.name === column)).toBe(false)
    }
    // The row itself survives the rollback.
    const kept = await db
      .selectFrom('domains')
      .select('domain')
      .where('domain', '=', 'run.example')
      .executeTakeFirst()
    expect(kept?.domain).toBe('run.example')

    await hostingPolicyMigration.up(db)
    // Calling up() again is idempotent.
    await hostingPolicyMigration.up(db)
    const afterUp = await domainColumns()
    for (const column of COLUMNS) {
      expect(afterUp.some((existing) => existing.name === column)).toBe(true)
    }
  })

  it('stores and reads the policy and its lists', async () => {
    await database.updateServedDomain({
      domain: 'run.example',
      blueskyHostingPolicy: 'listed',
      blueskyHostingAllowEmails: ['ana@mail.example'],
      blueskyHostingAllowActors: ['ana@run.example']
    })

    await expect(
      database.getServedDomain({ domain: 'run.example' })
    ).resolves.toMatchObject({
      blueskyHostingPolicy: 'listed',
      blueskyHostingAllowEmails: ['ana@mail.example'],
      blueskyHostingAllowActors: ['ana@run.example']
    })

    // Null clears the setting back to the environment's allowlists.
    await database.updateServedDomain({
      domain: 'run.example',
      blueskyHostingPolicy: null,
      blueskyHostingAllowEmails: null,
      blueskyHostingAllowActors: null
    })
    await expect(
      database.getServedDomain({ domain: 'run.example' })
    ).resolves.toMatchObject({
      blueskyHostingPolicy: null,
      blueskyHostingAllowEmails: null,
      blueskyHostingAllowActors: null
    })
  })
})
