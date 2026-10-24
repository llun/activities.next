import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { getConfig } from '@/lib/config'
import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { EXPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { ARCHIVE_REQUEST_INTERVAL_MS } from './constants'
import { expireArchiveIfDue, sweepExpiredAccountArchives } from './expiry'
import { FileArchiveObjectStore } from './objectStore'
import { requestAccountArchive } from './request'

vi.mock('@/lib/services/queue', () => ({ getQueue: vi.fn() }))

describe('requestAccountArchive', () => {
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

  beforeEach(async () => {
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-request-'))
    store = new FileArchiveObjectStore({
      type: MediaStorageType.LocalFile,
      path: root
    })
    publish.mockReset().mockResolvedValue(undefined)
    vi.mocked(getQueue).mockReturnValue({
      runsInline: false,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('queues an export and publishes its first slice', async () => {
    const result = await requestAccountArchive({
      database,
      accountId,
      options: { stripExactLocations: true },
      store
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive).toMatchObject({
      status: 'queued',
      accountId,
      options: { stripExactLocations: true, drafts: false }
    })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: EXPORT_ACCOUNT_ARCHIVE_JOB_NAME,
        data: { archiveId: result.archive.id, slice: 0 }
      })
    )
  })

  it('refuses a second request while one is queued or running', async () => {
    const first = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store
    })
    const second = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store
    })
    expect(second.ok).toBe(false)
    expect(second).toMatchObject({ reason: 'running' })
    expect(first.ok && second.ok === false && 'archive' in second).toBe(true)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('answers with the next allowed date for 7 days after a request', async () => {
    const createdAt = Date.now()
    const id = crypto.randomUUID()
    await database.createAccountArchive({
      id,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await database.updateAccountArchive({ id, status: 'ready' })
    const row = (await database.getAccountArchive({ id }))!

    const limited = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store,
      now: () => row.createdAt + ARCHIVE_REQUEST_INTERVAL_MS - 1000
    })
    expect(limited).toEqual({
      ok: false,
      reason: 'rate-limited',
      nextAllowedAt: row.createdAt + ARCHIVE_REQUEST_INTERVAL_MS
    })
    expect(createdAt).toBeLessThanOrEqual(row.createdAt + 1000)

    const allowed = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store,
      now: () => row.createdAt + ARCHIVE_REQUEST_INTERVAL_MS + 1000
    })
    expect(allowed.ok).toBe(true)
  })

  it('does not count a failed export against the limit', async () => {
    const id = crypto.randomUUID()
    await database.createAccountArchive({
      id,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await database.updateAccountArchive({ id, status: 'failed' })
    const result = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store
    })
    expect(result.ok).toBe(true)
  })

  it('reports that no storage is configured', async () => {
    expect(
      await requestAccountArchive({
        database,
        accountId,
        options: {},
        store: null
      })
    ).toEqual({ ok: false, reason: 'not-configured' })
    expect(await database.getActiveAccountArchive({ accountId })).toBeNull()
  })

  it('rejects bad and oversized drafts before anything is created', async () => {
    expect(
      await requestAccountArchive({
        database,
        accountId,
        options: {},
        drafts: { not: 'a list' },
        store
      })
    ).toEqual({ ok: false, reason: 'drafts-invalid' })
    expect(
      await requestAccountArchive({
        database,
        accountId,
        options: {},
        drafts: [
          { id: 'x', composer: 'post-box', text: 'x'.repeat(6 * 1024 * 1024) }
        ],
        store
      })
    ).toEqual({ ok: false, reason: 'drafts-too-large' })
    expect(await database.getActiveAccountArchive({ accountId })).toBeNull()
    expect(publish).not.toHaveBeenCalled()
  })

  it('stages valid drafts under the export and marks the option', async () => {
    const result = await requestAccountArchive({
      database,
      accountId,
      options: {},
      drafts: [{ id: 'd', composer: 'reply-box', text: 'hi' }],
      store
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.archive.options.drafts).toBe(true)
    const staged = await fs.readdir(
      path.join(root, 'archives', result.archive.id, 'stage')
    )
    expect(staged).toEqual(['drafts.json'])
  })

  it('marks the export failed and cleans up when the queue refuses it', async () => {
    publish.mockRejectedValue(new Error('queue down'))
    await expect(
      requestAccountArchive({
        database,
        accountId,
        options: {},
        drafts: [{ id: 'd', composer: 'reply-box', text: 'hi' }],
        store
      })
    ).rejects.toThrow('queue down')
    expect(await database.getActiveAccountArchive({ accountId })).toBeNull()
    expect(await fs.readdir(path.join(root, 'archives'))).toEqual([])
  })

  it('does not wait for an in-process queue to finish the export', async () => {
    let finish: () => void = () => undefined
    publish.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    vi.mocked(getQueue).mockReturnValue({
      runsInline: true,
      publish,
      handle: vi.fn()
    } as unknown as ReturnType<typeof getQueue>)
    const result = await requestAccountArchive({
      database,
      accountId,
      options: {},
      store
    })
    expect(result.ok).toBe(true)
    finish()
  })
})

describe('archive expiry', () => {
  const { database, db, prepare, destroy } = createTestDatabase()
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

  beforeEach(async () => {
    await db.deleteFrom('account_archives').execute()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-expiry-'))
    store = new FileArchiveObjectStore({
      type: MediaStorageType.LocalFile,
      path: root
    })
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  const readyArchive = async (expiresAt: number) => {
    const id = crypto.randomUUID()
    await database.createAccountArchive({
      id,
      accountId,
      options: { stripExactLocations: false, drafts: false }
    })
    await store.put(`archives/${id}/archive.zip`, 'zip')
    await database.updateAccountArchive({
      id,
      status: 'ready',
      storagePath: `archives/${id}/archive.zip`,
      bytes: 3,
      readyAt: Date.now(),
      expiresAt
    })
    return (await database.getAccountArchive({ id }))!
  }

  it('expires a ready archive that is past its time, lazily', async () => {
    const archive = await readyArchive(Date.now() - 1)
    const result = await expireArchiveIfDue({ database, archive, store })
    expect(result.status).toBe('expired')
    expect(result.storagePath).toBeNull()
    expect(await store.get(`archives/${archive.id}/archive.zip`)).toBeNull()
    expect((await database.getAccountArchive({ id: archive.id }))!.status).toBe(
      'expired'
    )
  })

  it('leaves an archive that is not due alone', async () => {
    const archive = await readyArchive(Date.now() + 60_000)
    const result = await expireArchiveIfDue({ database, archive, store })
    expect(result.status).toBe('ready')
    expect(await store.get(`archives/${archive.id}/archive.zip`)).not.toBeNull()
  })

  it('has the sweep expire every due archive', async () => {
    vi.mocked(getConfig).mockReturnValue({
      ...vi.mocked(getConfig)(),
      mediaStorage: { type: MediaStorageType.LocalFile, path: root }
    } as ReturnType<typeof getConfig>)
    const due = await readyArchive(Date.now() - 1000)
    expect(await sweepExpiredAccountArchives(database)).toBe(1)
    expect((await database.getAccountArchive({ id: due.id }))!.status).toBe(
      'expired'
    )
    expect(await store.get(`archives/${due.id}/archive.zip`)).toBeNull()
  })
})
