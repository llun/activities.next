import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { serializeReportEntity } from '@/lib/services/reports/serializeReportEntity'
import { TEST_DOMAIN } from '@/lib/stub/const'

const REPORTER = `https://${TEST_DOMAIN}/users/reporter`
const TARGET_ACTOR_ID = `https://${TEST_DOMAIN}/users/spammer`

describe('serializeReportEntity', () => {
  it('reflects the real action_taken/action_taken_at once a report is resolved', async () => {
    const database = getTestSQLDatabase()
    await database.migrate()
    try {
      await database.createAccount({
        email: `spammer@${TEST_DOMAIN}`,
        username: 'spammer',
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: 'private',
        publicKey: 'public'
      })
      const targetAccount = await database.getMastodonActorFromId({
        id: TARGET_ACTOR_ID
      })
      if (!targetAccount) throw new Error('target account not found')

      const report = await database.createReport({
        actorId: REPORTER,
        targetActorId: TARGET_ACTOR_ID,
        category: 'spam'
      })

      // Before resolution: action_taken false, action_taken_at null.
      const before = serializeReportEntity({ report, targetAccount })
      expect(before.action_taken).toBe(false)
      expect(before.action_taken_at).toBeNull()

      // Admin resolves; the reporter's Report entity now reflects it (previously
      // action_taken_at was hardcoded null).
      await database.setReportResolution({
        reportId: report.id,
        resolved: true,
        actionTakenByActorId: REPORTER
      })
      const resolvedReport = await database.getReportById({
        reportId: report.id
      })
      const after = serializeReportEntity({
        report: resolvedReport!,
        targetAccount
      })
      expect(after.action_taken).toBe(true)
      expect(after.action_taken_at).not.toBeNull()
    } finally {
      await database.destroy()
    }
  })
})
