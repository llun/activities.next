import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { down, up } from '@/migrations/20261021072844_add_domain_scopes'

const testDb = createTestDatabase()

const REPORTER = 'https://llun.test/users/reporter'

const insertReport = (id: string, targetActorId: string) =>
  testDb.db
    .insertInto('reports')
    .values({ id, actorId: REPORTER, targetActorId, domain: null })
    .execute()

const domainsOf = async () =>
  Object.fromEntries(
    (
      await testDb.db.selectFrom('reports').select(['id', 'domain']).execute()
    ).map((row) => [row.id, row.domain])
  )

describe('20261021072844_add_domain_scopes', () => {
  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('backfills reports.domain from the host of the target actor id', async () => {
    await insertReport('club', 'https://Club.Example/users/ana')
    await insertReport('port', 'http://localhost:3000/users/ana')
    await insertReport('default-port', 'https://run.example:443/users/ana')
    await insertReport('garbage', 'not a url')

    // Back to before the migration, then forward again: the columns come back
    // empty and the backfill fills them.
    await down(testDb.db)
    await up(testDb.db)

    expect(await domainsOf()).toEqual({
      club: 'club.example',
      port: 'localhost:3000',
      'default-port': 'run.example',
      garbage: null
    })
  })

  it('leaves existing rules and announcements for every domain and is safe to run twice', async () => {
    await testDb.db
      .insertInto('instance_rules')
      .values({
        id: 'rule',
        text: 'Be kind',
        createdAt: new Date(),
        updatedAt: new Date()
      })
      .execute()

    await up(testDb.db)

    const rule = await testDb.db
      .selectFrom('instance_rules')
      .select('domain')
      .where('id', '=', 'rule')
      .executeTakeFirstOrThrow()
    expect(rule.domain).toBeNull()
    // The second run changed no reported domain either.
    expect((await domainsOf()).club).toBe('club.example')
  })
})
