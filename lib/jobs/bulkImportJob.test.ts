import { follow, unfollow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import {
  bulkImportJob,
  getBulkImportContinueJobId,
  runBulkImport
} from '@/lib/jobs/bulkImportJob'
import { fetchRemoteStatusJob } from '@/lib/jobs/fetchRemoteStatusJob'
import { BULK_IMPORT_JOB_NAME } from '@/lib/jobs/names'
import { resolveAccountTarget } from '@/lib/services/actors/resolveAccountTarget'
import {
  createImportTestDatabase,
  createPublicNote,
  createRemoteActor,
  resolveStoredAccount
} from '@/lib/services/imports/importTestUtils'
import { BulkImportRowData, BulkImportType } from '@/lib/services/imports/types'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))
vi.mock('@/lib/activities', () => ({ follow: vi.fn(), unfollow: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@/lib/services/actors/resolveAccountTarget', () => ({
  resolveAccountTarget: vi.fn()
}))
vi.mock('@/lib/jobs/fetchRemoteStatusJob', () => ({
  fetchRemoteStatusJob: vi.fn()
}))

const IMPORT_ID = 'import-1'

describe('bulkImportJob', () => {
  let database: Database
  let actor: Actor
  let bob: Actor
  let carol: Actor

  beforeEach(async () => {
    ;({ database, actor } = await createImportTestDatabase())
    bob = await createRemoteActor(database, 'bob')
    carol = await createRemoteActor(database, 'carol')
    mockPublish.mockReset().mockResolvedValue(undefined)
    vi.mocked(follow).mockReset().mockResolvedValue(true)
    vi.mocked(unfollow).mockReset().mockResolvedValue(true)
    vi.mocked(fetchRemoteStatusJob).mockReset()
    vi.mocked(resolveAccountTarget)
      .mockReset()
      .mockImplementation(resolveStoredAccount)
  })

  afterEach(async () => {
    await database.destroy()
  })

  const createImport = async (
    type: BulkImportType,
    rows: BulkImportRowData[],
    overwrite = false
  ) => {
    await database.createBulkImport({
      id: IMPORT_ID,
      actorId: actor.id,
      type,
      overwrite,
      originalFilename: 'file.csv',
      rows
    })
  }

  const getImport = async () =>
    (await database.getBulkImportById({ id: IMPORT_ID }))!

  const followTarget = (target: Actor, status = FollowStatus.enum.Accepted) =>
    database.createFollow({
      actorId: actor.id,
      targetActorId: target.id,
      status,
      inbox: `${actor.id}/inbox`,
      sharedInbox: 'https://test.llun.dev/inbox'
    })

  const activeFollow = (target: Actor) =>
    database.getAcceptedOrRequestedFollow({
      actorId: actor.id,
      targetActorId: target.id
    })

  it('ignores a missing import and malformed data', async () => {
    await bulkImportJob(database, {
      id: 'x',
      name: BULK_IMPORT_JOB_NAME,
      data: { importId: 'missing' }
    })
    await bulkImportJob(database, {
      id: 'x',
      name: BULK_IMPORT_JOB_NAME,
      data: {}
    })
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('finishes an empty import', async () => {
    await createImport('following', [])
    await runBulkImport(database, IMPORT_ID)
    expect(await getImport()).toMatchObject({
      state: 'finished',
      totalItems: 0,
      processedItems: 0
    })
  })

  it('merges: imports what resolves, fails the rest and keeps existing follows', async () => {
    await followTarget(carol)
    await createImport('following', [
      { acct: 'bob@remote.test', show_reblogs: false, notify: true },
      { acct: 'nobody@remote.test' }
    ])

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      totalItems: 2,
      processedItems: 2,
      importedItems: 1
    })
    expect(await activeFollow(bob)).toMatchObject({
      reblogs: false,
      notify: true
    })
    expect(await activeFollow(carol)).not.toBeNull()
    const failed = await database.getBulkImportFailedRows({
      importId: IMPORT_ID
    })
    expect(failed).toHaveLength(1)
    expect(failed[0].error).toBe('Account not found')
  })

  it('records a generic error for a row that throws, not its message', async () => {
    vi.mocked(resolveAccountTarget).mockRejectedValueOnce(new Error('boom'))
    await createImport('following', [{ acct: 'bob@remote.test' }])

    await runBulkImport(database, IMPORT_ID)

    const failed = await database.getBulkImportFailedRows({
      importId: IMPORT_ID
    })
    expect(failed[0].error).toBe('Could not import this row')
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 1,
      importedItems: 0
    })
  })

  it('overwrites: counts kept follows, removes the rest, imports the new ones', async () => {
    await followTarget(bob)
    await followTarget(carol)
    await createImport(
      'following',
      [{ acct: 'bob@remote.test', notify: true }, { acct: 'dave@remote.test' }],
      true
    )
    await createRemoteActor(database, 'dave')
    const dave = (await database.getActorFromUsername({
      username: 'dave',
      domain: 'remote.test'
    })) as Actor

    await runBulkImport(database, IMPORT_ID)

    expect(await activeFollow(carol)).toBeNull()
    expect(await activeFollow(bob)).toMatchObject({ notify: true })
    expect(await activeFollow(dave)).not.toBeNull()
    expect(await getImport()).toMatchObject({
      state: 'finished',
      overwriteDone: true,
      totalItems: 2,
      processedItems: 2,
      importedItems: 2
    })
  })

  it('finishes an overwrite whose rows the pre-pass consumed entirely', async () => {
    await followTarget(bob)
    await createImport('following', [{ acct: 'bob@remote.test' }], true)

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 1,
      importedItems: 1
    })
    expect(follow).not.toHaveBeenCalled()
  })

  it('is idempotent when the whole job runs again', async () => {
    await followTarget(carol)
    await createImport(
      'following',
      [{ acct: 'bob@remote.test' }, { acct: 'nobody@remote.test' }],
      true
    )
    await runBulkImport(database, IMPORT_ID)
    const first = await getImport()

    // A re-delivered job starts from a checkpoint that was never saved.
    await database.updateBulkImport({
      id: IMPORT_ID,
      state: 'scheduled',
      nextRowIndex: 0,
      overwriteDone: false
    })
    await runBulkImport(database, IMPORT_ID)

    const second = await getImport()
    expect(second).toMatchObject({
      state: 'finished',
      totalItems: first.totalItems,
      processedItems: first.processedItems,
      importedItems: first.importedItems
    })
    expect(follow).toHaveBeenCalledTimes(1)
    expect(await activeFollow(bob)).not.toBeNull()
  })

  it('does not duplicate blocks or bookmarks on a repeated run', async () => {
    const uri = `${bob.id}/statuses/1`
    await createPublicNote(database, uri, bob.id)
    await createImport('bookmarks', [{ uri }])
    await runBulkImport(database, IMPORT_ID)
    await database.updateBulkImport({ id: IMPORT_ID, state: 'scheduled' })
    await runBulkImport(database, IMPORT_ID)

    expect(
      await database.getBookmarks({ actorId: actor.id, limit: 10 })
    ).toHaveLength(1)
    expect(await getImport()).toMatchObject({
      processedItems: 1,
      importedItems: 1
    })
  })

  it('imports bookmarks: a remote status is fetched, an unknown local one fails', async () => {
    const remote = `${bob.id}/statuses/remote`
    vi.mocked(fetchRemoteStatusJob).mockImplementation(async () => {
      await createPublicNote(database, remote, bob.id)
    })
    await createImport('bookmarks', [
      { uri: remote },
      { uri: `https://${TEST_DOMAIN}/users/test/statuses/unknown` }
    ])

    await runBulkImport(database, IMPORT_ID)

    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 2,
      importedItems: 1
    })
    expect(
      (await database.getBookmarks({ actorId: actor.id, limit: 10 })).map(
        (bookmark) => bookmark.statusId
      )
    ).toEqual([remote])
  })

  it('imports blocking rows', async () => {
    await createImport('blocking', [{ acct: 'bob@remote.test' }])
    await runBulkImport(database, IMPORT_ID)
    expect(
      await database.isBlocking({ actorId: actor.id, targetActorId: bob.id })
    ).toBe(true)
  })

  it('imports muting rows', async () => {
    await createImport('muting', [{ acct: 'bob@remote.test' }])
    await runBulkImport(database, IMPORT_ID)
    expect(
      await database.getMute({ actorId: actor.id, targetActorId: bob.id })
    ).not.toBeNull()
  })

  it('imports domain_blocking rows and drops the blocks the file omits', async () => {
    await database.createActorDomainBlock({
      actorId: actor.id,
      domain: 'old.test'
    })
    await createImport('domain_blocking', [{ domain: 'new.test' }], true)
    await runBulkImport(database, IMPORT_ID)
    expect(
      (await database.getActorDomainBlocks({ actorId: actor.id })).map(
        (block) => block.domain
      )
    ).toEqual(['new.test'])
    expect(await getImport()).toMatchObject({
      state: 'finished',
      importedItems: 1
    })
  })

  it('creates the lists of the file by title and fills them', async () => {
    const existing = await database.createList({
      actorId: actor.id,
      title: 'Existing'
    })
    await createImport('lists', [
      { list_name: 'Existing', acct: 'bob@remote.test' },
      { list_name: 'New', acct: 'bob@remote.test' },
      { list_name: 'New', acct: 'carol@remote.test' }
    ])

    await runBulkImport(database, IMPORT_ID)

    const lists = await database.getLists({ actorId: actor.id })
    expect(lists.map((list) => list.title).sort()).toEqual(['Existing', 'New'])
    const created = lists.find((list) => list.title === 'New')!
    expect(created.id).not.toBe(existing.id)
    const membersOf = async (listId: string) =>
      (await database.getListMembers({ listId, actorId: actor.id }))
        .map((member) => member.targetActorId)
        .sort()
    expect(await membersOf(existing.id)).toEqual([bob.id])
    expect(await membersOf(created.id)).toEqual([bob.id, carol.id].sort())
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 3,
      importedItems: 3
    })
  })

  it('overwrites lists: drops the ones missing from the file and refills the rest', async () => {
    const keep = await database.createList({ actorId: actor.id, title: 'Keep' })
    await database.createList({ actorId: actor.id, title: 'Drop' })
    await followTarget(bob)
    await database.addListAccounts({
      listId: keep.id,
      actorId: actor.id,
      targetActorIds: [bob.id]
    })
    await createImport(
      'lists',
      [{ list_name: 'Keep', acct: 'carol@remote.test' }],
      true
    )

    await runBulkImport(database, IMPORT_ID)

    const lists = await database.getLists({ actorId: actor.id })
    expect(lists.map((list) => list.title)).toEqual(['Keep'])
    expect(
      (
        await database.getListMembers({ listId: keep.id, actorId: actor.id })
      ).map((member) => member.targetActorId)
    ).toEqual([carol.id])
  })

  it('hands over to a deterministic continuation when the budget is spent and resumes from nextRowIndex', async () => {
    await createImport('blocking', [
      { acct: 'bob@remote.test' },
      { acct: 'carol@remote.test' },
      { acct: 'nobody@remote.test' }
    ])

    // The budget is checked after every row, so a page of 2 stops after 1.
    await runBulkImport(database, IMPORT_ID, { budgetMs: -1, pageSize: 2 })

    expect(
      mockPublish.mock.calls.filter(
        ([message]) => message.name === BULK_IMPORT_JOB_NAME
      )
    ).toHaveLength(1)
    expect(mockPublish).toHaveBeenCalledWith({
      id: getBulkImportContinueJobId(IMPORT_ID, 1),
      name: BULK_IMPORT_JOB_NAME,
      data: { importId: IMPORT_ID }
    })
    expect(await getImport()).toMatchObject({
      state: 'in_progress',
      nextRowIndex: 1,
      processedItems: 1
    })

    mockPublish.mockClear()
    await runBulkImport(database, IMPORT_ID, { pageSize: 2 })

    expect(
      mockPublish.mock.calls.filter(
        ([message]) => message.name === BULK_IMPORT_JOB_NAME
      )
    ).toHaveLength(0)
    expect(await getImport()).toMatchObject({
      state: 'finished',
      processedItems: 3,
      importedItems: 2
    })
  })
})
