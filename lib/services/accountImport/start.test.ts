import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { ArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import {
  AccountImportArchiveChangedError,
  type AccountImportObjectStore
} from '@/lib/services/accountImport/objectStore'
import { inspectAccountArchive } from '@/lib/services/accountImport/phases'
import { startAccountImport } from '@/lib/services/accountImport/start'
import {
  buildZip,
  sourceOf
} from '@/lib/services/accountImport/zip/testing/fixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

vi.mock('@/lib/config/accountImport', () => ({
  getAccountImportConfig: () => ({ maxFileSize: 1_000 })
}))

vi.mock('@/lib/services/accountImport/phases', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/services/accountImport/phases')>()
  return { ...original, inspectAccountArchive: vi.fn() }
})

describe('startAccountImport', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  const getMetadata = vi.fn()
  const getSize = vi.fn()
  const deleteUpload = vi.fn()
  const openSource = vi.fn()
  const objectStore = {
    store: {
      getMetadata,
      size: getSize
    } as unknown as ArchiveObjectStore,
    getUploadKey: () => 'imports/import-id/token/upload.zip',
    openSource,
    deleteUpload
  } as unknown as AccountImportObjectStore
  const options = {
    likes: false,
    bookmarks: false,
    repliesToOthers: 'skip' as const,
    profile: false,
    settings: false
  }
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
    getMetadata.mockReset().mockResolvedValue({
      size: 100,
      etag: '"archive-version-1"'
    })
    getSize.mockReset().mockResolvedValue(100)
    deleteUpload.mockReset().mockResolvedValue(undefined)
    openSource.mockReset()
    vi.mocked(inspectAccountArchive).mockReset().mockResolvedValue({
      kind: 'mastodon',
      sourceActorId: 'https://source.test/users/owner',
      sourceFollowersUrl: null
    })
  })

  const createImport = async (uploadedBytes = 100) => {
    const accountImport = await database.createAccountImport({
      id: 'start-account-import',
      accountId,
      actorId,
      options: '{}',
      uploadedBytes
    })
    return accountImport
  }

  it('stores the inspected object ETag on the import row', async () => {
    const accountImport = await createImport()
    const result = await startAccountImport({
      database,
      objectStore,
      accountImport,
      options
    })

    expect(result).toMatchObject({ type: 'started' })
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({
      status: 'running',
      uploadedBytes: 100,
      archiveETag: '"archive-version-1"'
    })
    expect(inspectAccountArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        accountImport: expect.objectContaining({
          archiveETag: '"archive-version-1"'
        })
      })
    )
  })

  it('rejects and deletes an upload whose object metadata is missing', async () => {
    const accountImport = await createImport()
    getMetadata.mockResolvedValue(null)

    const result = await startAccountImport({
      database,
      objectStore,
      accountImport,
      options
    })

    expect(result).toEqual({ type: 'upload-incomplete' })
    expect(deleteUpload).toHaveBeenCalledWith(accountImport)
    expect(inspectAccountArchive).not.toHaveBeenCalled()
  })

  it('reports archive_changed when reading the upload fails with the pinned ETag', async () => {
    const accountImport = await createImport()
    const actual = await vi.importActual<
      typeof import('@/lib/services/accountImport/phases')
    >('@/lib/services/accountImport/phases')
    vi.mocked(inspectAccountArchive).mockImplementation(
      actual.inspectAccountArchive
    )
    openSource.mockResolvedValue({
      size: 100,
      read: () => Promise.reject(new AccountImportArchiveChangedError())
    })

    const result = await startAccountImport({
      database,
      objectStore,
      accountImport,
      options
    })

    expect(result).toEqual({ type: 'archive-changed' })
    expect(deleteUpload).toHaveBeenCalledWith(accountImport)
  })

  // A valid ZIP whose actor entry is not a JSON object must reach the owner
  // as the documented 422 unrecognised, never as an unhandled 500 from a
  // plain scanner error.
  it.each([
    ['a JSON array', Buffer.from('[]')],
    ['not JSON at all', Buffer.from(',')]
  ] as const)(
    'answers unrecognised when actor.json is %s',
    async (_description, actorData) => {
      const actual = await vi.importActual<
        typeof import('@/lib/services/accountImport/phases')
      >('@/lib/services/accountImport/phases')
      vi.mocked(inspectAccountArchive).mockImplementation(
        actual.inspectAccountArchive
      )
      const archive = buildZip([
        { name: 'actor.json', data: actorData },
        { name: 'outbox.json', data: Buffer.from('{"orderedItems":[]}') }
      ])
      getMetadata.mockResolvedValue({
        size: archive.length,
        etag: '"archive-version-1"'
      })
      openSource.mockResolvedValue(sourceOf(archive))
      const accountImport = await createImport(archive.length)

      const result = await startAccountImport({
        database,
        objectStore,
        accountImport,
        options
      })

      expect(result).toEqual({ type: 'unrecognised' })
      // The row follows the same verdict as any other unrecognised archive:
      // it stays queued, the way the existing 422 unrecognised behaves.
      expect(
        await database.getAccountImport({ id: accountImport.id, actorId })
      ).toMatchObject({ status: 'queued' })
    }
  )

  // A storage fault while start reads the archive is transient: the row
  // stays queued, the upload is kept and the owner can retry, so it must
  // answer with the route's storage-unavailable verdict, not a bare 500.
  it('answers storage-unavailable when reading the upload metadata fails', async () => {
    const accountImport = await createImport()
    getMetadata.mockReset().mockRejectedValue(new Error('S3 unavailable'))

    const result = await startAccountImport({
      database,
      objectStore,
      accountImport,
      options
    })

    expect(result).toEqual({ type: 'storage-unavailable' })
    expect(deleteUpload).not.toHaveBeenCalled()
    expect(inspectAccountArchive).not.toHaveBeenCalled()
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'queued' })
  })

  it('answers storage-unavailable when inspecting the archive hits a storage fault', async () => {
    const accountImport = await createImport()
    vi.mocked(inspectAccountArchive).mockRejectedValue(
      new Error('S3 unavailable')
    )

    const result = await startAccountImport({
      database,
      objectStore,
      accountImport,
      options
    })

    expect(result).toEqual({ type: 'storage-unavailable' })
    expect(deleteUpload).not.toHaveBeenCalled()
    expect(
      await database.getAccountImport({ id: accountImport.id, actorId })
    ).toMatchObject({ status: 'queued' })
  })
})
