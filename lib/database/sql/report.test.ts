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

  describe('getAdminReports', () => {
    it('filters by resolved and by reporter/target', async () => {
      await withFreshDatabase(async (database) => {
        const openReport = await database.createReport({
          actorId: REPORTER,
          targetActorId: TARGET,
          category: 'spam'
        })
        const resolvedReport = await database.createReport({
          actorId: 'https://test.llun.dev/users/other',
          targetActorId: 'https://remote.example/users/troll'
        })
        await database.setReportResolution({
          reportId: resolvedReport.id,
          resolved: true,
          actionTakenByActorId: REPORTER
        })

        const unresolved = await database.getAdminReports({ resolved: false })
        expect(unresolved.map((r) => r.id)).toContain(openReport.id)
        expect(unresolved.map((r) => r.id)).not.toContain(resolvedReport.id)

        const resolved = await database.getAdminReports({ resolved: true })
        expect(resolved.map((r) => r.id)).toEqual([resolvedReport.id])

        const byReporter = await database.getAdminReports({
          accountId: REPORTER
        })
        expect(byReporter.map((r) => r.id)).toEqual([openReport.id])

        const byTarget = await database.getAdminReports({
          targetActorId: TARGET
        })
        expect(byTarget.map((r) => r.id)).toEqual([openReport.id])
      })
    })

    it('filters by the target actor domain', async () => {
      await withFreshDatabase(async (database) => {
        // by_target_domain matches reports whose target actor lives on the
        // given domain (the target must exist as an actor row).
        await database.createActor({
          actorId: 'https://evil.example/users/troll',
          username: 'troll',
          domain: 'evil.example',
          inboxUrl: 'https://evil.example/users/troll/inbox',
          sharedInboxUrl: 'https://evil.example/inbox',
          followersUrl: 'https://evil.example/users/troll/followers',
          publicKey: 'key',
          createdAt: Date.now()
        })
        const onDomain = await database.createReport({
          actorId: REPORTER,
          targetActorId: 'https://evil.example/users/troll'
        })
        const offDomain = await database.createReport({
          actorId: REPORTER,
          targetActorId: TARGET
        })

        const result = await database.getAdminReports({
          byTargetDomain: 'evil.example'
        })
        expect(result.map((r) => r.id)).toContain(onDomain.id)
        expect(result.map((r) => r.id)).not.toContain(offDomain.id)
      })
    })

    it.each([
      { description: 'max_id excludes the cursor', cursor: 'maxId' },
      { description: 'min_id excludes the cursor', cursor: 'minId' },
      { description: 'since_id excludes the cursor', cursor: 'sinceId' }
    ])('paginates: $description', async ({ cursor }) => {
      await withFreshDatabase(async (database) => {
        for (let i = 0; i < 3; i++) {
          await database.createReport({
            actorId: REPORTER,
            targetActorId: TARGET
          })
        }
        const all = await database.getAdminReports({ limit: 100 })
        expect(all).toHaveLength(3)
        const ids = all.map((r) => r.id)

        if (cursor === 'maxId') {
          const page = await database.getAdminReports({ maxId: ids[0] })
          const pageIds = page.map((r) => r.id)
          expect(pageIds).not.toContain(ids[0])
          expect(pageIds).toContain(ids[1])
          expect(pageIds).toContain(ids[2])
        } else {
          const page = await database.getAdminReports({ [cursor]: ids[2] })
          const pageIds = page.map((r) => r.id)
          expect(pageIds).not.toContain(ids[2])
          expect(pageIds).toContain(ids[0])
          expect(pageIds).toContain(ids[1])
        }
      })
    })
  })

  describe('getReportById / updateReportCategory / assignReport', () => {
    it('reads, updates category/rule_ids, and assigns/unassigns', async () => {
      await withFreshDatabase(async (database) => {
        const report = await database.createReport({
          actorId: REPORTER,
          targetActorId: TARGET,
          category: 'other'
        })

        expect(
          (await database.getReportById({ reportId: report.id }))?.id
        ).toBe(report.id)
        expect(await database.getReportById({ reportId: 'missing' })).toBeNull()

        const updated = await database.updateReportCategory({
          reportId: report.id,
          category: 'spam',
          ruleIds: ['rule-1']
        })
        expect(updated?.category).toBe('spam')
        expect(updated?.ruleIds).toEqual(['rule-1'])

        const assigned = await database.assignReport({
          reportId: report.id,
          assignedActorId: REPORTER
        })
        expect(assigned?.assignedActorId).toBe(REPORTER)

        const unassigned = await database.assignReport({
          reportId: report.id,
          assignedActorId: null
        })
        expect(unassigned?.assignedActorId).toBeNull()
      })
    })
  })
})
