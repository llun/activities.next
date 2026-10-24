import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { FileArchiveObjectStore } from './objectStore'
import { createInitialProgress, serializeProgress } from './progress'
import {
  ARCHIVE_MAX_REAPS,
  ARCHIVE_STUCK_AFTER_MS,
  reapStuckAccountArchive,
  sweepStuckAccountArchives
} from './reaper'
import { requestAccountArchive } from './request'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('stuck export reaper', () => {
  const { database, db, prepare, destroy } = createTestDatabase()
  const publish = vi.fn()
  let accountId: string
  let root: string
  let store: FileArchiveObjectStore

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromEmail({ email: seedActor1.email }))!
      .account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  const useQueue = (runsInline: boolean) =>
    vi.mocked(getQueue).mockReturnValue({
      runsInline,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)

  beforeEach(async () => {
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-reaper-'))
    store = new FileArchiveObjectStore({
      type: MediaStorageType.LocalFile,
      path: root
    })
    publish.mockReset().mockResolvedValue(undefined)
    useQueue(false)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const stuckArchive = async (updatedAgoMs: number, withProgress = true) => {
    const id = crypto.randomUUID()
    await database.createAccountArchive({
      id,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await db
      .updateTable('account_archives')
      .set({ createdAt: new Date(Date.now() - updatedAgoMs) })
      .where('id', '=', id)
      .execute()
    if (withProgress) {
      const progress = createInitialProgress({
        actors: [],
        now: Date.now() - updatedAgoMs
      })
      progress.slice = 4
      await database.updateAccountArchive({
        id,
        status: 'running',
        progress: serializeProgress(progress)
      })
    }
    await store.put(`archives/${id}/stage/part-0`, 'staged')
    return (await database.getAccountArchive({ id }))!
  }

  const hour = ARCHIVE_STUCK_AFTER_MS

  it('leaves an export that made progress recently alone', async () => {
    const archive = await stuckArchive(hour / 2)
    expect(await reapStuckAccountArchive({ database, archive, store })).toBe(
      archive
    )
    expect(publish).not.toHaveBeenCalled()
  })

  it('requeues the current slice of a stuck export when a queue exists', async () => {
    const archive = await stuckArchive(hour * 2)
    const result = await reapStuckAccountArchive({ database, archive, store })
    expect(result.status).toBe('running')
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { archiveId: archive.id, slice: 4 }
      })
    )
    // The requeue counts as progress: a second pass right away does nothing.
    publish.mockClear()
    const again = await reapStuckAccountArchive({
      database,
      archive: result,
      store
    })
    expect(again).toBe(result)
    expect(publish).not.toHaveBeenCalled()
    expect(
      await store.get(`archives/${archive.id}/stage/part-0`)
    ).not.toBeNull()
  })

  it('requeues an export that never started, from slice 0', async () => {
    const archive = await stuckArchive(hour * 2, false)
    await reapStuckAccountArchive({ database, archive, store })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archiveId: archive.id, slice: 0 } })
    )
  })

  it('marks it failed and deletes the staged parts after three reaps', async () => {
    const archive = await stuckArchive(hour * 2)
    let current = archive
    for (let reap = 1; reap <= ARCHIVE_MAX_REAPS; reap += 1) {
      current = await reapStuckAccountArchive({
        database,
        archive: current,
        store,
        now: () => Date.now() + reap * hour * 2
      })
      expect(current.status).toBe('running')
    }
    expect(publish).toHaveBeenCalledTimes(ARCHIVE_MAX_REAPS)
    const failed = await reapStuckAccountArchive({
      database,
      archive: current,
      store,
      now: () => Date.now() + 10 * hour
    })
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('The export stopped making progress')
    expect(await store.get(`archives/${archive.id}/stage/part-0`)).toBeNull()
  })

  it('marks it failed straight away when the queue cannot deliver later', async () => {
    useQueue(true)
    const archive = await stuckArchive(hour * 2)
    const result = await reapStuckAccountArchive({ database, archive, store })
    expect(result.status).toBe('failed')
    expect(publish).not.toHaveBeenCalled()
    expect(await store.get(`archives/${archive.id}/stage/part-0`)).toBeNull()
  })

  it('does not count a reaped export against the 7-day limit', async () => {
    useQueue(true)
    const archive = await stuckArchive(hour * 2)
    await reapStuckAccountArchive({ database, archive, store })
    useQueue(false)
    const next = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store
    })
    expect(next.ok).toBe(true)
  })

  it('has the sweep reap every stuck export', async () => {
    const archive = await stuckArchive(hour * 2)
    expect(await sweepStuckAccountArchives(database)).toBe(1)
    expect(publish).toHaveBeenCalledTimes(1)
    expect((await database.getAccountArchive({ id: archive.id }))!.status).toBe(
      'running'
    )
    expect(await sweepStuckAccountArchives(database)).toBe(0)
  })
})
