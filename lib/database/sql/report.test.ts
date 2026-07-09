import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabase
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const REPORTER = 'https://test.llun.dev/users/reporter'
const TARGET = 'https://remote.example/users/spammer'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

describe('ReportDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  it('persists a report with category, comment and status ids', async () => {
    await withFreshDatabase(async (database) => {
      const report = await database.createReport({
        actorId: REPORTER,
        targetActorId: TARGET,
        category: 'spam',
        comment: 'unsolicited ads',
        forward: true,
        statusIds: ['https://remote.example/users/spammer/statuses/1']
      })

      expect(report.id).toBeDefined()
      expect(report.category).toBe('spam')
      expect(report.comment).toBe('unsolicited ads')
      expect(report.forward).toBe(true)
      expect(report.statusIds).toEqual([
        'https://remote.example/users/spammer/statuses/1'
      ])
      expect(report.ruleIds).toEqual([])
      expect(report.actionTaken).toBe(false)
    })
  })

  it('defaults category to other and arrays to empty', async () => {
    await withFreshDatabase(async (database) => {
      const report = await database.createReport({
        actorId: REPORTER,
        targetActorId: TARGET
      })
      expect(report.category).toBe('other')
      expect(report.comment).toBe('')
      expect(report.statusIds).toEqual([])
    })
  })

  it('persists collection ids and defaults them to empty', async () => {
    await withFreshDatabase(async (database) => {
      const withCollections = await database.createReport({
        actorId: REPORTER,
        targetActorId: TARGET,
        collectionIds: ['collection-1', 'collection-2']
      })
      expect(withCollections.collectionIds).toEqual([
        'collection-1',
        'collection-2'
      ])

      const withoutCollections = await database.createReport({
        actorId: REPORTER,
        targetActorId: TARGET
      })
      expect(withoutCollections.collectionIds).toEqual([])
    })
  })
})
