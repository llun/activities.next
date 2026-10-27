import { NextRequest } from 'next/server'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MediaStorageType } from '@/lib/config/mediaStorage'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { FileArchiveObjectStore } from '@/lib/services/accountArchive/objectStore'
import { ACCOUNT_IMPORT_START_WINDOW_MS } from '@/lib/services/accountImport/constants'
import { createAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { buildZip } from '@/lib/services/accountImport/zip/testing/fixtures'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { HTTP_STATUS } from '@/lib/utils/response'

import { DELETE, GET as getImport, POST as uploadById } from './[id]/route'
import { POST as startImport } from './[id]/start/route'
import { POST as presign } from './presigned/route'
import { GET as listImports, POST as upload } from './route'

const mocks = vi.hoisted(() => ({
  maxFileSize: 1024,
  moved: false,
  getSession: vi.fn(),
  getConfig: vi.fn(),
  publish: vi.fn(),
  database: null as Database | null
}))

vi.mock('@/lib/config/accountImport', () => ({
  getAccountImportConfig: () => ({ maxFileSize: mocks.maxFileSize })
}))
vi.mock('@/lib/config', () => ({
  getConfig: () => mocks.getConfig(),
  getBaseURL: () => 'https://llun.test',
  buildBaseURL: (host: string) => `https://${host}`
}))
vi.mock('@/lib/database', () => ({ getDatabase: () => mocks.database }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mocks.getSession()
}))
vi.mock('@/lib/services/accounts/movedAccount', () => ({
  isMovedActor: () => mocks.moved
}))
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: mocks.publish,
    handle: vi.fn()
  })
}))

describe('account import routes', () => {
  const { database, db, prepare, destroy } = createTestDatabase({
    backend: 'sqlite'
  })
  let storageRoot: string
  let actorId: string
  let accountId: string
  let otherActorId: string
  let otherAccountId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mocks.database = database
    actorId = (await database.getActorFromEmail({ email: seedActor1.email }))!
      .id
    accountId = (await database.getActorFromId({ id: actorId }))!.account!.id
    otherActorId = (await database.getActorFromEmail({
      email: seedActor2.email
    }))!.id
    otherAccountId = (await database.getActorFromId({ id: otherActorId }))!
      .account!.id
  })

  afterAll(async () => {
    mocks.database = null
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
    storageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'account-import-routes-')
    )
    mocks.maxFileSize = 1024
    mocks.moved = false
    mocks.getSession
      .mockReset()
      .mockResolvedValue({ user: { email: seedActor1.email } })
    mocks.getConfig.mockReset().mockReturnValue({
      host: 'llun.test',
      allowEmails: [],
      mediaStorage: { type: MediaStorageType.LocalFile, path: storageRoot }
    })
    mocks.publish.mockReset().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true })
  })

  const request = (
    url: string,
    method: string,
    body?: BodyInit | null,
    headers: Record<string, string> = {}
  ) =>
    new NextRequest(url, {
      method,
      headers: { origin: 'https://llun.test', ...headers },
      duplex: 'half',
      ...(body === undefined ? {} : { body })
    } as ConstructorParameters<typeof NextRequest>[1])

  const routeContext = (id: string) => ({ params: Promise.resolve({ id }) })

  const createRow = async (
    ownerActorId = actorId,
    ownerAccountId = accountId,
    status?: 'done' | 'failed'
  ) => {
    const row = await database.createAccountImport({
      id: crypto.randomUUID(),
      actorId: ownerActorId,
      accountId: ownerAccountId,
      options: '{}'
    })
    if (status) {
      await database.updateAccountImport({
        id: row.id,
        status,
        finishedAt: Date.now()
      })
    }
    return row
  }

  const validZip = () =>
    buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          JSON.stringify({
            id: 'https://source.test/users/owner',
            preferredUsername: 'owner',
            followers: 'https://source.test/users/owner/followers'
          })
        )
      },
      {
        name: 'outbox.json',
        data: Buffer.from(
          JSON.stringify({ type: 'OrderedCollection', orderedItems: [] })
        )
      }
    ])

  const saveZip = async (
    row: Awaited<ReturnType<typeof createRow>>,
    bytes: Buffer
  ) => {
    const store = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: MediaStorageType.LocalFile,
        path: storageRoot
      })
    )!
    await store.store.put(store.getUploadKey(row), bytes)
    await database.updateAccountImport({
      id: row.id,
      uploadedBytes: bytes.length
    })
    return store
  }

  it('uploads directly into the object store, remains queued, and lists safe status fields', async () => {
    const response = await upload(
      request(
        'https://llun.test/api/v1/account/imports',
        'POST',
        new Uint8Array(validZip()),
        {
          'content-type': 'application/zip'
        }
      ),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
    const created = await response.json()
    expect(created).toMatchObject({ status: 'queued', kind: null, phase: null })
    expect(created.lastErrorCode).toBeNull()
    expect(mocks.publish).not.toHaveBeenCalled()

    const listed = await (
      await listImports(
        request('https://llun.test/api/v1/account/imports', 'GET'),
        { params: Promise.resolve({}) }
      )
    ).json()
    expect(listed).toHaveLength(1)
    expect(listed[0].id).toBe(created.id)
    expect(Object.keys(listed[0]).sort()).toEqual(
      [
        'createdAt',
        'finishedAt',
        'id',
        'kind',
        'lastErrorCode',
        'phase',
        'progress',
        'startedAt',
        'status'
      ].sort()
    )
  })

  it('stops an oversized stream as soon as it crosses the configured cap and deletes the partial upload', async () => {
    mocks.maxFileSize = 32
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls > 8) return controller.close()
        controller.enqueue(new Uint8Array(24))
      }
    })
    const response = await upload(
      request('https://llun.test/api/v1/account/imports', 'POST', body, {
        'content-type': 'application/zip'
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE)
    expect(pulls).toBeLessThan(5)
    const failed = await db
      .selectFrom('account_imports')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(failed.status).toBe('failed')
    const store = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: MediaStorageType.LocalFile,
        path: storageRoot
      })
    )!
    expect(
      await store.store.size(
        store.getUploadKey({ id: failed.id, storageToken: failed.storageToken })
      )
    ).toBeNull()
  })

  it('checks expected actor before parsing the start body, then rejects actor id mismatches', async () => {
    const row = await createRow()
    const expectedMismatch = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}/start`,
        'POST',
        '{bad json',
        {
          'content-type': 'application/json',
          'Activities-Expected-Actor': 'other-actor'
        }
      ),
      routeContext(row.id)
    )
    expect(expectedMismatch.status).toBe(HTTP_STATUS.CONFLICT)

    const actorMismatch = await getImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}?actorId=other-actor`,
        'GET'
      ),
      routeContext(row.id)
    )
    expect(actorMismatch.status).toBe(HTTP_STATUS.CONFLICT)
  })

  it('returns 404 for another account and 409 when one import is active', async () => {
    const other = await createRow(otherActorId, otherAccountId)
    const hidden = await getImport(
      request(`https://llun.test/api/v1/account/imports/${other.id}`, 'GET'),
      routeContext(other.id)
    )
    expect(hidden.status).toBe(HTTP_STATUS.NOT_FOUND)

    await createRow()
    const response = await presign(
      request(
        'https://llun.test/api/v1/account/imports/presigned',
        'POST',
        JSON.stringify({ actorId }),
        { 'content-type': 'application/json' }
      ),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(HTTP_STATUS.CONFLICT)
  })

  it('returns a null presigned URL and the existing direct upload route for file storage', async () => {
    const response = await presign(
      request(
        'https://llun.test/api/v1/account/imports/presigned',
        'POST',
        JSON.stringify({ actorId }),
        { 'content-type': 'application/json' }
      ),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
    expect(await response.json()).toMatchObject({
      status: 'queued',
      uploadUrl: null,
      directUploadPath: expect.stringMatching(/^\/api\/v1\/account\/imports\//)
    })
  })

  it('rejects moved accounts and unrecognised archives with 422', async () => {
    const movedRow = await createRow()
    mocks.moved = true
    const moved = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${movedRow.id}/start`,
        'POST',
        JSON.stringify({ actorId, options: {} }),
        { 'content-type': 'application/json' }
      ),
      routeContext(movedRow.id)
    )
    expect(moved.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    mocks.moved = false
    await database.updateAccountImport({
      id: movedRow.id,
      status: 'failed',
      lastErrorCode: 'moved_account',
      finishedAt: Date.now()
    })

    const row = await createRow()
    await saveZip(
      row,
      buildZip([{ name: 'not-an-archive.txt', data: Buffer.from('no') }])
    )
    const response = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}/start`,
        'POST',
        JSON.stringify({ options: {} }),
        { 'content-type': 'application/json' }
      ),
      routeContext(row.id)
    )
    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
  })

  it('limits the fourth import start in 24 hours and includes Retry-After', async () => {
    for (let index = 0; index < 3; index += 1) {
      const previous = await createRow(actorId, accountId, 'done')
      await database.updateAccountImport({
        id: previous.id,
        startedAt: Date.now() - index * 60_000
      })
    }
    const row = await createRow()
    await saveZip(row, validZip())
    const response = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}/start`,
        'POST',
        JSON.stringify({ options: {} }),
        { 'content-type': 'application/json' }
      ),
      routeContext(row.id)
    )
    expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('finds starts hidden behind a thousand newer uploads that never started', async () => {
    const now = Date.now()
    const since = now - ACCOUNT_IMPORT_START_WINDOW_MS
    const history = Array.from({ length: 1000 }, (_, index) => ({
      id: `unstarted-history-${index}`,
      accountId,
      actorId,
      status: 'done',
      options: '{}',
      storageToken: `unstarted-token-${index}`,
      createdAt: new Date(now - 60_000),
      startedAt: null,
      updatedAt: new Date(now - 60_000)
    }))
    const started = Array.from({ length: 3 }, (_, index) => ({
      id: `started-history-${index}`,
      accountId,
      actorId,
      status: 'done',
      options: '{}',
      storageToken: `started-token-${index}`,
      createdAt: new Date(since - 60_000),
      startedAt: new Date(now - 2 * 60_000),
      updatedAt: new Date(since - 60_000)
    }))
    for (const rows of [history, started]) {
      for (let offset = 0; offset < rows.length; offset += 40) {
        await db
          .insertInto('account_imports')
          .values(rows.slice(offset, offset + 40))
          .execute()
      }
    }

    const row = await createRow()
    await saveZip(row, validZip())
    const response = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}/start`,
        'POST',
        JSON.stringify({ options: {} }),
        { 'content-type': 'application/json' }
      ),
      routeContext(row.id)
    )

    expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('starts an inspected archive and publishes only after the owner submits options', async () => {
    const row = await createRow()
    await saveZip(row, validZip())
    const response = await startImport(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}/start`,
        'POST',
        JSON.stringify({ options: { repliesToOthers: 'keep' } }),
        { 'content-type': 'application/json' }
      ),
      routeContext(row.id)
    )
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${row.id}:start`,
        data: { importId: row.id, actorId }
      })
    )
    const stored = await database.getAccountImport({ id: row.id, actorId })
    expect(stored).toMatchObject({
      status: 'running',
      kind: 'mastodon',
      phase: 'inspect'
    })
    expect(JSON.parse(stored!.progress!).selectedOptions).toMatchObject({
      likes: false,
      bookmarks: false,
      repliesToOthers: 'keep'
    })
  })

  it('cancels a queued upload and queues a worker to remove it', async () => {
    const row = await createRow()
    const store = await saveZip(row, validZip())
    const response = await DELETE(
      request(`https://llun.test/api/v1/account/imports/${row.id}`, 'DELETE'),
      routeContext(row.id)
    )
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${row.id}:cancel`,
        name: 'ImportAccountArchiveJob'
      })
    )
    expect(
      (await database.getAccountImport({ id: row.id, actorId }))?.status
    ).toBe('cancelled')
    expect(await store.store.size(store.getUploadKey(row))).not.toBeNull()
  })

  it('uses the id route for direct presigned-upload fallback and refuses a duplicate upload', async () => {
    const row = await createRow()
    const store = createAccountImportObjectStore(
      new FileArchiveObjectStore({
        type: MediaStorageType.LocalFile,
        path: storageRoot
      })
    )!
    const response = await uploadById(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}`,
        'POST',
        new Uint8Array(validZip()),
        { 'content-type': 'application/zip' }
      ),
      routeContext(row.id)
    )
    expect(response.status).toBe(HTTP_STATUS.ACCEPTED)
    expect(await store.store.size(store.getUploadKey(row))).not.toBeNull()
    const duplicate = await uploadById(
      request(
        `https://llun.test/api/v1/account/imports/${row.id}`,
        'POST',
        new Uint8Array(validZip()),
        { 'content-type': 'application/zip' }
      ),
      routeContext(row.id)
    )
    expect(duplicate.status).toBe(HTTP_STATUS.CONFLICT)
  })
})
