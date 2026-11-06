import { randomUUID } from 'node:crypto'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'
import { MAX_BOOKMARK_FOLDERS_PER_ACTOR } from '@/lib/types/domain/bookmark'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Private bookmark folders on whichever backend TEST_DATABASE_TYPE picks: the
// name rules, the cap, deleting with unfiling, filing, the folder filter in
// the keyset paging and owner isolation.
describe('bookmark folders', () => {
  const testDb = createTestDatabase()
  const { database, db, prepare, destroy } = testDb

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await destroy()
  })

  const createStatus = async (name: string) => {
    const statusId = `${ACTOR1_ID}/statuses/folder-${name}-${randomUUID()}`
    return database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: `Folder ${name}`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
  }

  const createFolder = async (actorId: string, name: string) => {
    const result = await database.createBookmarkFolder({ actorId, name })
    if (result.status !== 'ok')
      throw new Error(`create failed: ${result.status}`)
    return result.folder
  }

  const folderIdOf = async (actorId: string, statusId: string) =>
    (
      await db
        .selectFrom('bookmarks')
        .select('folderId')
        .where('actorId', '=', actorId)
        .where('statusId', '=', statusId)
        .executeTakeFirst()
    )?.folderId

  it('creates a trimmed folder and lists folders by name case-insensitively', async () => {
    const suffix = randomUUID()
    const banana = await createFolder(ACTOR2_ID, `  banana ${suffix}  `)
    const apple = await createFolder(ACTOR2_ID, `Apple ${suffix}`)
    const cherry = await createFolder(ACTOR2_ID, `cherry ${suffix}`)

    expect(banana).toMatchObject({
      actorId: ACTOR2_ID,
      name: `banana ${suffix}`
    })
    expect(banana.createdAt).toEqual(expect.any(Number))

    const listed = (await database.getBookmarkFolders({ actorId: ACTOR2_ID }))
      .filter((folder) => folder.name.endsWith(suffix))
      .map((folder) => folder.id)
    expect(listed).toEqual([apple.id, banana.id, cherry.id])
  })

  it('refuses a blank, too long or case-insensitively duplicate name', async () => {
    const name = `Reading ${randomUUID()}`
    const folder = await createFolder(ACTOR2_ID, name)

    await expect(
      database.createBookmarkFolder({
        actorId: ACTOR2_ID,
        name: name.toUpperCase()
      })
    ).resolves.toEqual({ status: 'duplicate-name' })
    await expect(
      database.createBookmarkFolder({ actorId: ACTOR2_ID, name: '   ' })
    ).resolves.toEqual({ status: 'invalid-name' })
    await expect(
      database.createBookmarkFolder({
        actorId: ACTOR2_ID,
        name: 'x'.repeat(121)
      })
    ).resolves.toEqual({ status: 'invalid-name' })

    const other = await createFolder(ACTOR2_ID, `Other ${randomUUID()}`)
    await expect(
      database.updateBookmarkFolder({
        id: other.id,
        actorId: ACTOR2_ID,
        name: name.toLowerCase()
      })
    ).resolves.toEqual({ status: 'duplicate-name' })

    // Another actor may use the same name.
    await expect(
      database.createBookmarkFolder({ actorId: ACTOR1_ID, name })
    ).resolves.toMatchObject({ status: 'ok' })

    // Renaming to a case variant of its own name is not a duplicate.
    await expect(
      database.updateBookmarkFolder({
        id: folder.id,
        actorId: ACTOR2_ID,
        name: name.toUpperCase()
      })
    ).resolves.toMatchObject({
      status: 'ok',
      folder: { id: folder.id, name: name.toUpperCase() }
    })
  })

  it('stops at the folder cap', async () => {
    const existing = (await database.getBookmarkFolders({ actorId: ACTOR3_ID }))
      .length
    const now = new Date()
    const rows = Array.from(
      { length: MAX_BOOKMARK_FOLDERS_PER_ACTOR - 1 - existing },
      (_, index) => ({
        id: randomUUID(),
        actorId: ACTOR3_ID,
        name: `cap ${index}`,
        createdAt: now,
        updatedAt: now
      })
    )
    if (rows.length > 0) {
      await db.insertInto('bookmark_folders').values(rows).execute()
    }

    await expect(
      database.createBookmarkFolder({ actorId: ACTOR3_ID, name: 'last one' })
    ).resolves.toMatchObject({ status: 'ok' })
    await expect(
      database.createBookmarkFolder({ actorId: ACTOR3_ID, name: 'one more' })
    ).resolves.toEqual({ status: 'limit-reached' })
  })

  it('files, refiles and unfiles a bookmark, bookmarking it first', async () => {
    const status = await createStatus('file')
    const first = await createFolder(ACTOR2_ID, `First ${randomUUID()}`)
    const second = await createFolder(ACTOR2_ID, `Second ${randomUUID()}`)

    await expect(
      database.fileBookmark({
        actorId: ACTOR2_ID,
        statusId: status.id,
        folderId: first.id
      })
    ).resolves.toBe('filed')
    await expect(
      database.isActorBookmarkedStatus({
        actorId: ACTOR2_ID,
        statusId: status.id
      })
    ).resolves.toBe(true)
    expect(await folderIdOf(ACTOR2_ID, status.id)).toBe(first.id)

    // A plain bookmark keeps the folder.
    await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })
    expect(await folderIdOf(ACTOR2_ID, status.id)).toBe(first.id)

    await database.fileBookmark({
      actorId: ACTOR2_ID,
      statusId: status.id,
      folderId: second.id
    })
    expect(await folderIdOf(ACTOR2_ID, status.id)).toBe(second.id)

    await database.fileBookmark({
      actorId: ACTOR2_ID,
      statusId: status.id,
      folderId: null
    })
    expect(await folderIdOf(ACTOR2_ID, status.id)).toBeNull()
    await expect(
      database.isActorBookmarkedStatus({
        actorId: ACTOR2_ID,
        statusId: status.id
      })
    ).resolves.toBe(true)

    await expect(
      database.fileBookmark({
        actorId: ACTOR2_ID,
        statusId: `${ACTOR1_ID}/statuses/missing-${randomUUID()}`,
        folderId: null
      })
    ).resolves.toBe('status-not-found')
  })

  it('unbookmarking drops the folder, and bookmarking again starts unfiled', async () => {
    const status = await createStatus('unbookmark')
    const folder = await createFolder(ACTOR2_ID, `Gone ${randomUUID()}`)
    await database.fileBookmark({
      actorId: ACTOR2_ID,
      statusId: status.id,
      folderId: folder.id
    })

    await database.deleteBookmark({ actorId: ACTOR2_ID, statusId: status.id })
    await database.createBookmark({ actorId: ACTOR2_ID, statusId: status.id })

    expect(await folderIdOf(ACTOR2_ID, status.id)).toBeNull()
  })

  it('deleting a folder keeps its bookmarks, unfiled', async () => {
    const status = await createStatus('delete-folder')
    const folder = await createFolder(ACTOR2_ID, `Doomed ${randomUUID()}`)
    await database.fileBookmark({
      actorId: ACTOR2_ID,
      statusId: status.id,
      folderId: folder.id
    })

    await expect(
      database.deleteBookmarkFolder({ id: folder.id, actorId: ACTOR2_ID })
    ).resolves.toBe(true)

    await expect(
      database.getBookmarkFolder({ id: folder.id, actorId: ACTOR2_ID })
    ).resolves.toBeNull()
    await expect(
      database.isActorBookmarkedStatus({
        actorId: ACTOR2_ID,
        statusId: status.id
      })
    ).resolves.toBe(true)
    expect(await folderIdOf(ACTOR2_ID, status.id)).toBeNull()
    await expect(
      database.deleteBookmarkFolder({ id: folder.id, actorId: ACTOR2_ID })
    ).resolves.toBe(false)
  })

  it("never reads, renames, deletes or files into another actor's folder", async () => {
    const status = await createStatus('isolation')
    const folder = await createFolder(ACTOR1_ID, `Mine ${randomUUID()}`)

    await expect(
      database.getBookmarkFolder({ id: folder.id, actorId: ACTOR2_ID })
    ).resolves.toBeNull()
    expect(
      (await database.getBookmarkFolders({ actorId: ACTOR2_ID })).map(
        (item) => item.id
      )
    ).not.toContain(folder.id)
    await expect(
      database.updateBookmarkFolder({
        id: folder.id,
        actorId: ACTOR2_ID,
        name: 'Taken'
      })
    ).resolves.toEqual({ status: 'not-found' })
    await expect(
      database.deleteBookmarkFolder({ id: folder.id, actorId: ACTOR2_ID })
    ).resolves.toBe(false)
    await expect(
      database.fileBookmark({
        actorId: ACTOR2_ID,
        statusId: status.id,
        folderId: folder.id
      })
    ).resolves.toBe('folder-not-found')
    // Refused before anything was written: not bookmarked either.
    await expect(
      database.isActorBookmarkedStatus({
        actorId: ACTOR2_ID,
        statusId: status.id
      })
    ).resolves.toBe(false)
    await expect(
      database.getBookmarkFolder({ id: folder.id, actorId: ACTOR1_ID })
    ).resolves.toMatchObject({ id: folder.id })
  })

  it('filters the keyset pages by folder, and by unfiled', async () => {
    const actorId = ACTOR2_ID
    const folder = await createFolder(actorId, `Pages ${randomUUID()}`)
    const statuses: Awaited<ReturnType<typeof createStatus>>[] = []
    for (let index = 0; index < 5; index += 1) {
      statuses.push(await createStatus(`page-${index}`))
    }
    // Statuses 0, 2 and 4 are filed; 1 and 3 are not.
    for (const [index, status] of statuses.entries()) {
      if (index % 2 === 0) {
        await database.fileBookmark({
          actorId,
          statusId: status.id,
          folderId: folder.id
        })
      } else {
        await database.createBookmark({ actorId, statusId: status.id })
      }
    }
    const ids = new Set(statuses.map((status) => status.id))
    const onlyNew = (rows: { statusId: string }[]) =>
      rows.map((row) => row.statusId).filter((id) => ids.has(id))

    const firstPage = await database.getBookmarks({
      actorId,
      limit: 2,
      folderId: folder.id
    })
    expect(onlyNew(firstPage)).toEqual([statuses[4].id, statuses[2].id])
    const secondPage = await database.getBookmarks({
      actorId,
      limit: 2,
      folderId: folder.id,
      maxId: firstPage[firstPage.length - 1].id
    })
    expect(onlyNew(secondPage)).toEqual([statuses[0].id])
    const newer = await database.getBookmarks({
      actorId,
      limit: 2,
      folderId: folder.id,
      minId: secondPage[0].id
    })
    expect(onlyNew(newer)).toEqual([statuses[4].id, statuses[2].id])

    const unfiled = await database.getBookmarks({
      actorId,
      limit: 20,
      folderId: null
    })
    expect(onlyNew(unfiled)).toEqual([statuses[3].id, statuses[1].id])
    expect(unfiled.every((bookmark) => bookmark.folderId == null)).toBe(true)

    const all = await database.getBookmarks({ actorId, limit: 20 })
    expect(onlyNew(all)).toEqual(
      [...statuses].reverse().map((status) => status.id)
    )
    expect(all.find((row) => row.statusId === statuses[0].id)?.folderId).toBe(
      folder.id
    )
  })
})
