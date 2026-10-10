import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withTimeZone } from '@/lib/testing/withTimeZone'

// A history import's `fromDate` and `toDate` are calendar days, not instants.
// PostgreSQL's `date` column reaches node-postgres as a local-midnight Date by
// default, which `toISOString()` shifted a day back east of UTC. The days must
// come back as stored whatever zone the process runs in.
describe('wahoo history import dates', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  let actorCount = 0
  const newActor = async () => {
    actorCount += 1
    const username = `wd${actorCount}`
    const id = `https://wahoo-dates.test/users/${username}`
    await createSearchActor(database, {
      id,
      username,
      domain: 'wahoo-dates.test'
    })
    return id
  }

  it.each([
    ['Pacific/Kiritimati', 'UTC+14'],
    ['Asia/Bangkok', 'UTC+7'],
    ['UTC', 'UTC'],
    ['Pacific/Pago_Pago', 'UTC-11']
  ])('keeps the stored days in %s (%s)', async (timeZone) => {
    await withTimeZone(timeZone, async () => {
      const actorId = await newActor()
      const created = await database.createWahooHistoryImport({
        actorId,
        providerUserId: 'wahoo-user',
        fromDate: '2026-03-01',
        toDate: '2026-03-31'
      })
      const other = await database.createWahooHistoryImport({
        actorId: await newActor(),
        providerUserId: 'wahoo-user',
        fromDate: '2024-12-31',
        toDate: '2025-01-01'
      })

      expect(created).toMatchObject({
        fromDate: '2026-03-01',
        toDate: '2026-03-31'
      })
      expect(await database.getWahooHistoryImport(created.id)).toMatchObject({
        fromDate: '2026-03-01',
        toDate: '2026-03-31'
      })
      expect(await database.getLatestWahooHistoryImport(actorId)).toMatchObject(
        { fromDate: '2026-03-01', toDate: '2026-03-31' }
      )
      expect(await database.getWahooHistoryImport(other.id)).toMatchObject({
        fromDate: '2024-12-31',
        toDate: '2025-01-01'
      })
    })
  })
})
