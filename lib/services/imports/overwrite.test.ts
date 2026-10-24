import { unfollow } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { SEND_UNBLOCK_JOB_NAME } from '@/lib/jobs/names'
import { BulkImportRowData, BulkImportType } from '@/lib/services/imports/types'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'

import {
  createImportTestDatabase,
  createPublicNote,
  createRemoteActor
} from './importTestUtils'
import { applyOverwrite } from './overwrite'

const mockPublish = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish })
}))
vi.mock('@/lib/activities', () => ({ follow: vi.fn(), unfollow: vi.fn() }))
vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: vi.fn().mockResolvedValue(undefined)
}))

describe('applyOverwrite', () => {
  let database: Database
  let actor: Actor
  let kept: Actor
  let dropped: Actor

  beforeEach(async () => {
    ;({ database, actor } = await createImportTestDatabase())
    kept = await createRemoteActor(database, 'kept')
    dropped = await createRemoteActor(database, 'dropped')
    mockPublish.mockReset().mockResolvedValue(undefined)
    vi.mocked(unfollow).mockReset().mockResolvedValue(true)
  })

  afterEach(async () => {
    await database.destroy()
  })

  const run = async (type: BulkImportType, rows: BulkImportRowData[]) => {
    await database.createBulkImport({
      id: 'import-1',
      actorId: actor.id,
      type,
      overwrite: true,
      originalFilename: 'file.csv',
      rows
    })
    const bulkImport = await database.getBulkImportById({ id: 'import-1' })
    // Twice: an interrupted pass reruns from the start.
    await applyOverwrite({ database, actor, bulkImport: bulkImport! })
    await applyOverwrite({ database, actor, bulkImport: bulkImport! })
    return (await database.getBulkImportById({ id: 'import-1' }))!
  }

  const follows = (target: Actor) =>
    database.getAcceptedOrRequestedFollow({
      actorId: actor.id,
      targetActorId: target.id
    })

  it('following: unfollows what the file omits, keeps and updates the rest', async () => {
    for (const target of [kept, dropped]) {
      await database.createFollow({
        actorId: actor.id,
        targetActorId: target.id,
        status: FollowStatus.enum.Accepted,
        inbox: `${actor.id}/inbox`,
        sharedInbox: 'https://test.llun.dev/inbox'
      })
    }

    const result = await run('following', [
      {
        acct: 'Kept@Remote.test',
        show_reblogs: false,
        notify: true,
        languages: ['th']
      },
      { acct: 'other@remote.test' }
    ])

    expect(await follows(dropped)).toBeNull()
    expect(unfollow).toHaveBeenCalledTimes(1)
    expect(await follows(kept)).toMatchObject({
      status: FollowStatus.enum.Accepted,
      reblogs: false,
      notify: true,
      languages: ['th']
    })
    expect(result).toMatchObject({ processedItems: 1, importedItems: 1 })
  })

  it('following: a row without preferences keeps the stored ones', async () => {
    await database.createFollow({
      actorId: actor.id,
      targetActorId: kept.id,
      status: FollowStatus.enum.Accepted,
      inbox: `${actor.id}/inbox`,
      sharedInbox: 'https://test.llun.dev/inbox',
      reblogs: false,
      notify: true,
      languages: ['th']
    })

    await run('following', [{ acct: 'kept@remote.test', notify: null }])

    expect(await follows(kept)).toMatchObject({
      reblogs: false,
      notify: true,
      languages: ['th']
    })
  })

  it('blocking: unblocks (federated) what the file omits, keeps the rest', async () => {
    for (const target of [kept, dropped]) {
      await database.createBlock({
        actorId: actor.id,
        targetActorId: target.id,
        uri: `${actor.id}#blocks/${target.username}`
      })
    }

    const result = await run('blocking', [{ acct: 'kept@remote.test' }])

    expect(
      await database.isBlocking({
        actorId: actor.id,
        targetActorId: dropped.id
      })
    ).toBe(false)
    expect(
      await database.isBlocking({ actorId: actor.id, targetActorId: kept.id })
    ).toBe(true)
    expect(
      mockPublish.mock.calls.filter(
        ([message]) => message.name === SEND_UNBLOCK_JOB_NAME
      )
    ).toHaveLength(1)
    expect(result).toMatchObject({ processedItems: 1, importedItems: 1 })
  })

  it('muting: unmutes what the file omits, re-mutes the rest with the row flag', async () => {
    for (const target of [kept, dropped]) {
      await database.createMute({
        actorId: actor.id,
        targetActorId: target.id,
        notifications: true,
        endsAt: null
      })
    }

    const result = await run('muting', [
      { acct: 'kept@remote.test', hide_notifications: false }
    ])

    expect(
      await database.getMute({ actorId: actor.id, targetActorId: dropped.id })
    ).toBeNull()
    expect(
      (await database.getMute({ actorId: actor.id, targetActorId: kept.id }))
        ?.notifications
    ).toBe(false)
    expect(result).toMatchObject({ processedItems: 1, importedItems: 1 })
  })

  it('domain_blocking: removes the blocks the file omits', async () => {
    for (const domain of ['keep.test', 'drop.test']) {
      await database.createActorDomainBlock({ actorId: actor.id, domain })
    }

    const result = await run('domain_blocking', [{ domain: 'KEEP.test' }])

    const blocks = await database.getActorDomainBlocks({ actorId: actor.id })
    expect(blocks.map((block) => block.domain)).toEqual(['keep.test'])
    // The row pass still handles the rows of this type.
    expect(result).toMatchObject({ processedItems: 0, importedItems: 0 })
  })

  it('bookmarks: deletes the bookmarks the file omits, keeps the rest', async () => {
    const keptUri = `${kept.id}/statuses/1`
    const droppedUri = `${dropped.id}/statuses/1`
    for (const [uri, author] of [
      [keptUri, kept],
      [droppedUri, dropped]
    ] as const) {
      await createPublicNote(database, uri, author.id)
      await database.createBookmark({ actorId: actor.id, statusId: uri })
    }

    const result = await run('bookmarks', [{ uri: keptUri }])

    const bookmarks = await database.getBookmarks({
      actorId: actor.id,
      limit: 10
    })
    expect(bookmarks.map((bookmark) => bookmark.statusId)).toEqual([keptUri])
    expect(result).toMatchObject({ processedItems: 1, importedItems: 1 })
  })

  it('bookmarks: keeps a bookmark made through a boost when the file names the boost', async () => {
    const original = `${kept.id}/statuses/1`
    const boostUri = `${dropped.id}/statuses/boost-1`
    await createPublicNote(database, original, kept.id)
    await database.createAnnounce({
      id: boostUri,
      actorId: dropped.id,
      originalStatusId: original,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    })
    await database.createBookmark({ actorId: actor.id, statusId: boostUri })

    const result = await run('bookmarks', [{ uri: boostUri }])

    const bookmarks = await database.getBookmarks({
      actorId: actor.id,
      limit: 10
    })
    expect(bookmarks.map((bookmark) => bookmark.statusId)).toEqual([original])
    expect(result).toMatchObject({ processedItems: 1, importedItems: 1 })
  })

  it('lists: deletes lists the file omits and clears the members of the rest', async () => {
    const keep = await database.createList({ actorId: actor.id, title: 'Keep' })
    await database.createList({ actorId: actor.id, title: 'Drop' })
    await database.createFollow({
      actorId: actor.id,
      targetActorId: kept.id,
      status: FollowStatus.enum.Accepted,
      inbox: `${actor.id}/inbox`,
      sharedInbox: 'https://test.llun.dev/inbox'
    })
    await database.addListAccounts({
      listId: keep.id,
      actorId: actor.id,
      targetActorIds: [kept.id]
    })

    await run('lists', [{ list_name: 'Keep', acct: 'kept@remote.test' }])

    const lists = await database.getLists({ actorId: actor.id })
    expect(lists.map((list) => list.title)).toEqual(['Keep'])
    expect(
      await database.getListMembers({ listId: keep.id, actorId: actor.id })
    ).toHaveLength(0)
  })
})
