import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImportPhaseContext } from '@/lib/services/accountImport/phases'
import { runStatusesPhase } from '@/lib/services/accountImport/phases'
import {
  createInitialImportProgress,
  serializeImportCursor
} from '@/lib/services/accountImport/progress'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('account import phases', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let actorId: string
  let otherActorId: string
  let accountId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    await database.createAccount({
      ...seedActor2,
      email: 'test-import-author@llun.test',
      username: 'import-author',
      domain: TEST_DOMAIN
    })
    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    const otherActor = await database.getActorFromEmail({
      email: 'test-import-author@llun.test'
    })
    actorId = actor!.id
    otherActorId = otherActor!.id
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

  const runLikeImport = async (statusId: string, importId: string) => {
    expect(await isLocalFederationDomain(database, statusId)).toBe(true)
    const accountImport = await database.createAccountImport({
      id: importId,
      accountId,
      actorId,
      options: '{"likes":true}'
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'like',
          sourceId: statusId,
          position: 1,
          data: JSON.stringify({ id: statusId })
        }
      ]
    })
    const objectStore = {
      openSource: vi.fn()
    } as unknown as AccountImportObjectStore
    const context: AccountImportPhaseContext = {
      database,
      objectStore,
      accountImport,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    await runStatusesPhase(context, createInitialImportProgress(), null)
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'done'
    })
    return (
      await database.getAccountImportItems({
        importId: accountImport.id,
        limit: 10
      })
    )[0]
  }

  it('likes a public status but skips another actor’s private local status', async () => {
    const privateStatusId = `${otherActorId}/statuses/private-import-like`
    expect(
      await database.getAcceptedOrRequestedFollow({
        actorId,
        targetActorId: otherActorId
      })
    ).toBeNull()
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: otherActorId,
      to: [`${otherActorId}/followers`],
      cc: [],
      text: 'Private status'
    })

    const privateItem = await runLikeImport(
      privateStatusId,
      'import-private-like'
    )

    expect(privateItem).toMatchObject({
      state: 'skipped',
      reason: 'local_status_missing',
      data: null
    })
    expect(
      await db
        .selectFrom('likes')
        .selectAll()
        .where('actorId', '=', actorId)
        .where('statusId', '=', privateStatusId)
        .execute()
    ).toEqual([])

    const publicStatusId = `${otherActorId}/statuses/public-import-like`
    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: otherActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Public status'
    })

    const publicItem = await runLikeImport(publicStatusId, 'import-public-like')

    expect(publicItem).toMatchObject({
      state: 'done',
      reason: null,
      data: null
    })
    expect(
      await db
        .selectFrom('likes')
        .selectAll()
        .where('actorId', '=', actorId)
        .where('statusId', '=', publicStatusId)
        .execute()
    ).toHaveLength(1)
  })
})
