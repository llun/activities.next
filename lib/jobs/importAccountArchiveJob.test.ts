import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { importAccountArchiveJob } from '@/lib/jobs/importAccountArchiveJob'
import { IMPORT_ACCOUNT_ARCHIVE_JOB_NAME } from '@/lib/jobs/names'
import { FileArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import { createAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import {
  createInitialImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'
import { sweepStuckAccountImports } from '@/lib/services/accountImport/reaper'
import {
  getAccountImportContinuationJobId,
  runAccountImport
} from '@/lib/services/accountImport/runner'
import { buildZip } from '@/lib/services/accountImport/zip/testing/fixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import type { Actor } from '@/lib/types/domain/actor'
import { getLocalStatusId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const mocks = vi.hoisted(() => ({
  storageRoot: '',
  inline: true,
  publish: vi.fn(),
  database: null as Database | null
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    allowEmails: [],
    trustedHosts: [],
    allowActorDomains: [],
    mediaStorage: {
      type: MediaStorageType.LocalFile,
      path: mocks.storageRoot,
      maxFileSize: 10 * 1024 * 1024
    }
  }),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => `https://${host}`
}))
vi.mock('@/lib/database', () => ({ getDatabase: () => mocks.database }))
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: mocks.inline,
    publish: mocks.publish,
    handle: vi.fn()
  })
}))

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

describe('ImportAccountArchiveJob', () => {
  const { database, db, prepare, destroy } = createTestDatabase({
    backend: 'sqlite'
  })
  let actor: Actor
  let storageRoot: string
  let importObjectStore: NonNullable<
    ReturnType<typeof createAccountImportObjectStore>
  >

  beforeAll(async () => {
    storageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'account-import-job-')
    )
    mocks.storageRoot = storageRoot
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mocks.database = database
    actor = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
    importObjectStore = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: MediaStorageType.LocalFile,
        path: storageRoot
      })
    )!
  })

  afterAll(async () => {
    mocks.database = null
    await destroy()
    await fs.rm(storageRoot, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    await fs.rm(storageRoot, { recursive: true, force: true })
    await fs.mkdir(storageRoot, { recursive: true })
    mocks.inline = true
    mocks.publish.mockReset().mockResolvedValue(undefined)
  })

  const createImport = async (
    archive: Buffer,
    options = {
      likes: false,
      bookmarks: false,
      repliesToOthers: 'skip' as const,
      profile: false,
      settings: false
    }
  ) => {
    const row = await database.createAccountImport({
      id: crypto.randomUUID(),
      actorId: actor.id,
      accountId: actor.account!.id,
      options: '{}'
    })
    await importObjectStore.store.put(
      importObjectStore.getUploadKey(row),
      archive
    )
    await database.updateAccountImport({
      id: row.id,
      uploadedBytes: archive.length,
      status: 'running',
      phase: 'inspect',
      progress: serializeImportProgress({
        ...createInitialImportProgress(),
        selectedOptions: options
      }),
      startedAt: Date.now()
    })
    return row
  }

  const archiveFor = ({
    label,
    likedStatusId,
    includeMedia = true
  }: {
    label: string
    likedStatusId?: string
    includeMedia?: boolean
  }) => {
    const sourceActorId = `https://source.test/users/${label}`
    const followers = `${sourceActorId}/followers`
    const parentId = `${sourceActorId}/statuses/${label}-parent`
    const replyId = `${sourceActorId}/statuses/${label}-reply`
    const attachment = {
      type: 'Document',
      mediaType: 'image/png',
      url: `https://source.test/media_attachments/files/${label}.png`,
      name: `${label}.png`,
      width: 1,
      height: 1
    }
    const parent = {
      id: `https://source.test/activities/${label}-parent`,
      type: 'Create',
      actor: sourceActorId,
      published: '2024-02-03T04:05:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [followers],
      object: {
        id: parentId,
        type: 'Note',
        attributedTo: sourceActorId,
        content: `<p>parent ${label}</p>`,
        published: '2024-02-03T04:05:06.000Z',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [followers],
        attachment: includeMedia ? [attachment] : [],
        tag: [],
        url: `https://source.test/@${label}/${label}-parent`
      }
    }
    const reply = {
      id: `https://source.test/activities/${label}-reply`,
      type: 'Create',
      actor: sourceActorId,
      published: '2024-02-03T04:06:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [followers],
      object: {
        id: replyId,
        type: 'Note',
        attributedTo: sourceActorId,
        content: `<p>reply ${label}</p>`,
        published: '2024-02-03T04:06:06.000Z',
        inReplyTo: parentId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [followers],
        attachment: [],
        tag: [],
        url: `https://source.test/@${label}/${label}-reply`
      }
    }
    const entries = [
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: sourceActorId,
            preferredUsername: label,
            followers
          })
        )
      },
      {
        name: 'outbox.json',
        data: Buffer.from(
          JSON.stringify({
            type: 'OrderedCollection',
            orderedItems: [parent, reply]
          })
        )
      },
      {
        name: 'likes.json',
        data: Buffer.from(
          JSON.stringify({
            type: 'OrderedCollection',
            orderedItems: likedStatusId ? [likedStatusId] : []
          })
        )
      },
      {
        name: 'bookmarks.json',
        data: Buffer.from(
          JSON.stringify({ type: 'OrderedCollection', orderedItems: [] })
        )
      }
    ]
    if (includeMedia) {
      entries.push({ name: `media_attachments/files/${label}.png`, data: png })
    }
    return buildZip(entries)
  }

  const counts = async () => ({
    timelines: await db.selectFrom('timelines').selectAll().execute(),
    notifications: await db.selectFrom('notifications').selectAll().execute(),
    federatedTimeline: await db
      .selectFrom('federated_timeline')
      .selectAll()
      .execute(),
    linkPreviews: await db
      .selectFrom('status_link_previews')
      .selectAll()
      .execute(),
    queueJobs: await db.selectFrom('queue_jobs').selectAll().execute()
  })

  it('imports a Mastodon archive quietly with parent order, local media, and a local like', async () => {
    const localStatusPublicId = crypto.randomUUID()
    const localStatusId = getLocalStatusId({
      actorId: actor.id,
      statusId: localStatusPublicId
    })
    await database.createNote({
      id: localStatusId,
      url: localStatusId,
      actorId: actor.id,
      text: 'existing local liked status',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const before = await counts()
    const archive = archiveFor({
      label: `quiet-${crypto.randomUUID()}`,
      likedStatusId: localStatusId
    })
    const row = await createImport(archive, {
      likes: true,
      bookmarks: false,
      repliesToOthers: 'skip',
      profile: false,
      settings: false
    })

    await importAccountArchiveJob(database, {
      id: `${row.id}:start`,
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: row.id, actorId: actor.id }
    })

    const finished = await database.getAccountImport({
      id: row.id,
      actorId: actor.id
    })
    expect(finished?.status).toBe('done')
    expect(finished?.lastErrorCode).toBeNull()
    const items = await database.getAccountImportItems({
      importId: row.id,
      limit: 100
    })
    const statuses = items.filter((item) => item.kind === 'status')
    expect(statuses).toHaveLength(2)
    const [parent, reply] = statuses
    const importedReply = await db
      .selectFrom('statuses')
      .select('reply')
      .where('id', '=', reply.targetId!)
      .executeTakeFirst()
    expect(importedReply?.reply).toBe(parent.targetId)
    const media = items.find((item) => item.kind === 'media')
    expect(media?.state).toBe('done')
    const attachment = await db
      .selectFrom('attachments')
      .selectAll()
      .where('statusId', '=', parent.targetId!)
      .executeTakeFirst()
    expect(String(attachment?.mediaId)).toBe(media?.targetId)
    expect(
      await database.isActorLikedStatus({
        actorId: actor.id,
        statusId: localStatusId
      })
    ).toBe(true)
    expect(await counts()).toEqual(before)
    expect(
      await importObjectStore.store.size(importObjectStore.getUploadKey(row))
    ).toBeNull()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('resumes a saved catalog cursor and finishes the same import', async () => {
    const row = await createImport(
      archiveFor({
        label: `resume-${crypto.randomUUID()}`,
        includeMedia: false
      })
    )
    mocks.inline = false
    const first = await runAccountImport(database, row.id, {
      actorId: actor.id,
      budgetMs: 0,
      now: () => 1,
      runToken: 'first-run'
    })
    expect(first.type).toBe('continued')
    if (first.type !== 'continued') return
    expect(first.phase).toBe('catalog')
    expect(first.cursor).toContain('likes')
    const catalogedStatuses = (
      await database.getAccountImportItems({
        importId: row.id,
        limit: 100
      })
    ).filter((item) => item.kind === 'status')
    expect(catalogedStatuses).toHaveLength(2)
    expect(catalogedStatuses.every((item) => item.data !== null)).toBe(true)

    mocks.inline = true
    await importAccountArchiveJob(database, {
      id: getAccountImportContinuationJobId(
        row.id,
        `${first.phase}:${first.cursor ?? ''}`,
        first.pass
      ),
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: row.id, actorId: actor.id }
    })
    expect(
      (await database.getAccountImport({ id: row.id, actorId: actor.id }))
        ?.status
    ).toBe('done')
  })

  it('imports pending items left by a cancelled import on the next import', async () => {
    const archive = archiveFor({
      label: `reclaim-${crypto.randomUUID()}`,
      includeMedia: false
    })
    const cancelled = await createImport(archive)
    const partial = await runAccountImport(database, cancelled.id, {
      actorId: actor.id,
      budgetMs: 0,
      now: () => 1,
      runToken: 'cancelled-slice'
    })
    expect(partial).toMatchObject({ type: 'continued', phase: 'catalog' })
    const catalogued = await database.getAccountImportItems({
      importId: cancelled.id,
      limit: 100
    })
    expect(catalogued.filter((item) => item.kind === 'status')).toHaveLength(2)
    expect(
      catalogued
        .filter((item) => item.kind === 'status')
        .every((item) => item.state === 'pending')
    ).toBe(true)
    await database.updateAccountImport({
      id: cancelled.id,
      status: 'cancelled',
      finishedAt: Date.now()
    })

    const next = await createImport(archive)
    await importAccountArchiveJob(database, {
      id: `${next.id}:start`,
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: next.id, actorId: actor.id }
    })

    expect(
      (
        await database.getAccountImportItems({
          importId: cancelled.id,
          limit: 100
        })
      ).filter((item) => item.kind === 'status')
    ).toEqual([])
    const imported = (
      await database.getAccountImportItems({
        importId: next.id,
        limit: 100
      })
    ).filter((item) => item.kind === 'status')
    expect(imported).toHaveLength(2)
    expect(
      imported.every((item) => item.state === 'done' && item.data === null)
    ).toBe(true)
    expect(imported.every((item) => item.targetId !== null)).toBe(true)
  })

  it('writes nothing after a run loses its lease', async () => {
    const row = await createImport(
      archiveFor({ label: `lost-${crypto.randomUUID()}` })
    )
    const lostLeaseDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === 'renewAccountImportRun') {
          return vi.fn().mockResolvedValue(false)
        }
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const result = await runAccountImport(lostLeaseDatabase, row.id, {
      actorId: actor.id,
      runToken: 'lost-lease'
    })
    expect(result.type).toBe('busy')
    expect(
      await database.getAccountImportItems({ importId: row.id, limit: 10 })
    ).toEqual([])
    expect(
      (await database.getAccountImport({ id: row.id, actorId: actor.id }))
        ?.phase
    ).toBe('inspect')
  })

  it('deletes the upload when a queued import is cancelled', async () => {
    const row = await createImport(
      archiveFor({ label: `cancel-${crypto.randomUUID()}` })
    )
    await database.updateAccountImport({
      id: row.id,
      status: 'cancelled',
      finishedAt: Date.now()
    })
    const key = importObjectStore.getUploadKey(row)
    expect(await importObjectStore.store.size(key)).not.toBeNull()
    await importAccountArchiveJob(database, {
      id: `${row.id}:cancel`,
      name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
      data: { importId: row.id, actorId: actor.id }
    })
    expect(await importObjectStore.store.size(key)).toBeNull()
  })

  it('derives a continuation id from the import id, cursor and pass', () => {
    expect(
      getAccountImportContinuationJobId('import-a', 'statuses:10', 1)
    ).toBe(getAccountImportContinuationJobId('import-a', 'statuses:10', 1))
    expect(
      getAccountImportContinuationJobId('import-a', 'statuses:10', 1)
    ).not.toBe(getAccountImportContinuationJobId('import-a', 'statuses:11', 1))
    // A second pass over the same phase and cursor must get a fresh id.
    expect(
      getAccountImportContinuationJobId('import-a', 'statuses:10', 1)
    ).not.toBe(getAccountImportContinuationJobId('import-a', 'statuses:10', 2))
  })

  it('requeues an expired running import through the sweep callback', async () => {
    const row = await createImport(
      archiveFor({ label: `sweep-${crypto.randomUUID()}` })
    )
    await db
      .updateTable('account_imports')
      .set({
        updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        claimedUntil: null
      })
      .where('id', '=', row.id)
      .execute()
    expect(
      await database.getActiveAccountImport({ actorId: actor.id })
    ).toMatchObject({ id: row.id, status: 'running' })
    // A silenced actor is still hidden from the directory listing, but silence
    // is not a moderation block: the actor stays available to the import, so
    // the sweep must requeue the expired run rather than fail it.
    await db
      .updateTable('actors')
      .set({ silencedAt: new Date() })
      .where('id', '=', actor.id)
      .execute()
    try {
      expect(
        (
          await database.getLocalMastodonActors({
            localDomain: 'llun.test',
            local: true,
            order: 'new',
            limit: 100
          })
        ).map((candidate) => candidate.uri)
      ).not.toContain(actor.id)
      const schedule = vi.fn().mockResolvedValue(undefined)
      const count = await sweepStuckAccountImports(
        database,
        Date.now(),
        schedule,
        false
      )
      expect(count).toBe(1)
      expect(schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          id: getAccountImportContinuationJobId(row.id, 'inspect:', 1),
          name: IMPORT_ACCOUNT_ARCHIVE_JOB_NAME,
          data: { importId: row.id, actorId: actor.id }
        })
      )
    } finally {
      await db
        .updateTable('actors')
        .set({ silencedAt: null })
        .where('id', '=', actor.id)
        .execute()
    }
  })

  it('fails a run that stayed stuck beyond the sweep bound and deletes its upload', async () => {
    const row = await createImport(
      archiveFor({ label: `stuck-${crypto.randomUUID()}` })
    )
    const key = importObjectStore.getUploadKey(row)
    const now = Date.now()
    await db
      .updateTable('account_imports')
      .set({
        updatedAt: new Date(now - 25 * 60 * 60 * 1000),
        claimedUntil: null
      })
      .where('id', '=', row.id)
      .execute()

    const count = await sweepStuckAccountImports(
      database,
      now,
      vi.fn().mockResolvedValue(undefined),
      false
    )

    expect(count).toBe(1)
    expect(
      await database.getAccountImport({ id: row.id, actorId: actor.id })
    ).toMatchObject({ status: 'failed', lastErrorCode: 'import_stuck' })
    expect(await importObjectStore.store.size(key)).toBeNull()
  })
})
