import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImportPhaseContext } from '@/lib/services/accountImport/phases'
import { runStatusesPhase } from '@/lib/services/accountImport/phases'
import {
  createInitialImportProgress,
  serializeImportCursor
} from '@/lib/services/accountImport/progress'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('account import phases', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let actorId: string
  let accountId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    actorId = actor!.id
    accountId = actor!.account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
  })

  it('resumes statuses from cataloged JSON without reopening the archive', async () => {
    const accountImport = await database.createAccountImport({
      id: 'import-status-resume',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const sourceActorId = 'https://source.test/users/archive'
    const rawStatus = JSON.stringify({
      id: `${sourceActorId}/activities/2`,
      type: 'Announce',
      actor: sourceActorId,
      published: '2024-02-03T04:05:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${sourceActorId}/followers`],
      object: `${sourceActorId}/statuses/1`
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        { kind: 'status', sourceId: 'already-processed', position: 1 },
        {
          kind: 'status',
          sourceId: 'pending-status',
          position: 2,
          data: rawStatus
        }
      ]
    })
    const alreadyProcessed = (
      await database.getAccountImportItems({
        importId: accountImport.id,
        limit: 1
      })
    )[0]
    await database.markAccountImportItem({
      id: alreadyProcessed.id,
      state: 'done',
      targetId: 'target-already-processed'
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const openSource = vi
      .fn()
      .mockRejectedValue(new Error('zip source opened after catalog'))
    const objectStore = { openSource } as unknown as AccountImportObjectStore
    const progress = {
      ...createInitialImportProgress(),
      sourceActorId,
      sourceFollowersUrl: `${sourceActorId}/followers`,
      statusOrder: 'oldest-first' as const,
      catalogStage: 'done' as const
    }
    const context: AccountImportPhaseContext = {
      database,
      objectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    const result = await runStatusesPhase(
      context,
      progress,
      serializeImportCursor(1)
    )

    expect(result.result).toBe('done')
    expect(openSource).not.toHaveBeenCalled()
    const imported = (
      await database.getAccountImportItems({
        importId: accountImport.id,
        afterPosition: 1,
        limit: 10
      })
    )[0]
    expect(imported).toMatchObject({
      sourceId: 'pending-status',
      state: 'skipped',
      reason: 'boost',
      data: null
    })
  })
})
