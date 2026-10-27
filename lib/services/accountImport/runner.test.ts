import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  ACCOUNT_IMPORT_MAX_STUCK_MS,
  ACCOUNT_IMPORT_STUCK_AFTER_MS
} from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { sweepStuckAccountImports } from '@/lib/services/accountImport/reaper'
import { runAccountImport } from '@/lib/services/accountImport/runner'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/services/accountImport/objectStore', () => ({
  getAccountImportObjectStore: vi.fn()
}))

describe('account import runner payload cleanup', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  const deleteUpload = vi.fn().mockResolvedValue(undefined)
  const objectStore = {
    deleteUpload
  } as unknown as AccountImportObjectStore
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
    vi.mocked(getAccountImportObjectStore)
      .mockReset()
      .mockReturnValue(objectStore)
    deleteUpload.mockReset().mockResolvedValue(undefined)
  })

  const createImportWithItem = async (id: string) => {
    const accountImport = await database.createAccountImport({
      id,
      accountId,
      actorId,
      options: '{}'
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: `${id}-status`,
          position: 1,
          data: '{"raw":"archive payload"}'
        }
      ]
    })
    return accountImport
  }

  const getItemData = async (importId: string) =>
    (await database.getAccountImportItems({ importId, limit: 10 })).map(
      (item) => item.data
    )

  it('clears remaining item data when the runner finishes', async () => {
    const accountImport = await createImportWithItem('import-runner-finish')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      phase: 'finish'
    })

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'finish-run',
      now: Date.now,
      runsInline: true
    })

    expect(result).toEqual({ type: 'done' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })

  it('clears remaining item data when cancellation becomes terminal', async () => {
    const accountImport = await createImportWithItem('import-runner-cancel')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'cancelled',
      finishedAt: Date.now()
    })

    const result = await runAccountImport(database, accountImport.id, {
      actorId,
      runToken: 'cancel-run'
    })

    expect(result).toEqual({ type: 'cancelled' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })

  it('clears remaining item data when the sweep fails a stuck import', async () => {
    const accountImport = await createImportWithItem('import-runner-sweep')
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running'
    })
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({
        updatedAt: new Date(now - ACCOUNT_IMPORT_MAX_STUCK_MS - 1),
        claimedUntil: null
      })
      .where('id', '=', accountImport.id)
      .execute()

    expect(now - (now - ACCOUNT_IMPORT_MAX_STUCK_MS - 1)).toBeGreaterThan(
      ACCOUNT_IMPORT_STUCK_AFTER_MS
    )
    expect(await sweepStuckAccountImports(database, now)).toBe(1)
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'import_stuck' })
    expect(await getItemData(accountImport.id)).toEqual([null])
  })
})
