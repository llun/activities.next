import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import { ACCOUNT_IMPORT_MAX_STARTS } from '@/lib/services/accountImport/constants'
import { getAccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import { startAccountImport } from '@/lib/services/accountImport/start'
import {
  buildZip,
  sourceOf
} from '@/lib/services/accountImport/zip/testing/fixtures'
import type { AccountImport } from '@/lib/types/domain/accountImport'
import type { Actor } from '@/lib/types/domain/actor'
import { HTTP_STATUS } from '@/lib/utils/response'

import { POST } from './route'

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard: (handler: unknown) => handler
}))

vi.mock('@/lib/services/accounts/movedAccount', () => ({
  isMovedActor: () => false
}))

vi.mock('@/lib/services/accountImport/objectStore', async (importOriginal) => ({
  // The real exports stay: the start service checks errors against
  // AccountImportArchiveChangedError from this module.
  ...(await importOriginal<
    typeof import('@/lib/services/accountImport/objectStore')
  >()),
  getAccountImportObjectStore: vi.fn().mockReturnValue(null)
}))

vi.mock('@/lib/services/accountImport/start', () => ({
  startAccountImport: vi.fn()
}))

describe('start account import actor state', () => {
  const currentActor = {
    id: 'https://llun.test/users/current',
    account: { id: 'account-id' }
  } as Actor
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(null)
  } as unknown as Database

  const request = () =>
    new NextRequest(
      'https://llun.test/api/v1/account/imports/import-id/start',
      {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ options: {} }),
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )

  const start = () =>
    POST(request(), {
      params: Promise.resolve({ id: 'import-id' }),
      currentActor,
      database
    } as never)

  beforeEach(() => {
    vi.mocked(database.getActorFromId)
      .mockReset()
      .mockResolvedValue(currentActor)
    vi.mocked(database.getAccountImport).mockClear()
  })

  it('refuses a suspended actor with 403 before inspecting the import', async () => {
    vi.mocked(database.getActorFromId).mockResolvedValue({
      ...currentActor,
      suspendedAt: Date.now()
    })

    const response = await start()

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN)
    expect(database.getActorFromId).toHaveBeenCalledWith({
      id: currentActor.id
    })
    expect(database.getAccountImport).not.toHaveBeenCalled()
  })

  it.each(['scheduled', 'deleting'] as const)(
    'refuses an actor with deletion state %s with 422',
    async (deletionStatus) => {
      vi.mocked(database.getActorFromId).mockResolvedValue({
        ...currentActor,
        deletionStatus
      })

      const response = await start()

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(database.getActorFromId).toHaveBeenCalledWith({
        id: currentActor.id
      })
      expect(database.getAccountImport).not.toHaveBeenCalled()
    }
  )
})

describe('start account import start limit', () => {
  const currentActor = {
    id: 'https://llun.test/users/current',
    account: { id: 'account-id' }
  } as Actor
  const accountImport: AccountImport = {
    id: 'import-id',
    accountId: 'account-id',
    actorId: currentActor.id,
    status: 'queued',
    kind: null,
    archiveETag: null,
    options: '{}',
    storageToken: 'token',
    uploadedBytes: 100,
    progress: null,
    phase: null,
    cursor: null,
    runToken: null,
    claimedUntil: null,
    lastErrorCode: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  }
  const countAccountImportStartsSince = vi.fn()
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(accountImport),
    getActiveAccountImport: vi.fn().mockResolvedValue(null),
    countAccountImportStartsSince
  } as unknown as Database

  const request = () =>
    new NextRequest(
      'https://llun.test/api/v1/account/imports/import-id/start',
      {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ options: {} }),
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )

  const start = () =>
    POST(request(), {
      params: Promise.resolve({ id: 'import-id' }),
      currentActor,
      database
    } as never)

  beforeEach(() => {
    vi.mocked(database.getActorFromId)
      .mockReset()
      .mockResolvedValue(currentActor)
    vi.mocked(database.getAccountImport)
      .mockReset()
      .mockResolvedValue(accountImport)
    vi.mocked(database.getActiveAccountImport)
      .mockReset()
      .mockResolvedValue(null)
    countAccountImportStartsSince.mockReset()
    vi.mocked(startAccountImport)
      .mockReset()
      .mockResolvedValue({ type: 'storage-unavailable' })
  })

  it('passes the limit check when the account is under it', async () => {
    countAccountImportStartsSince.mockResolvedValue(
      ACCOUNT_IMPORT_MAX_STARTS - 1
    )

    const response = await start()

    // Under the limit the route moves on: with no object store configured it
    // answers storage-unavailable rather than too many requests.
    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE)
    expect(countAccountImportStartsSince).toHaveBeenCalledWith({
      accountId: 'account-id',
      since: expect.any(Number)
    })
  })
})

describe('start account import result mapping', () => {
  const currentActor = {
    id: 'https://llun.test/users/current',
    account: { id: 'account-id' }
  } as Actor
  const accountImport: AccountImport = {
    id: 'import-id',
    accountId: 'account-id',
    actorId: currentActor.id,
    status: 'queued',
    kind: null,
    archiveETag: null,
    options: '{}',
    storageToken: 'token',
    uploadedBytes: 100,
    progress: null,
    phase: null,
    cursor: null,
    runToken: null,
    claimedUntil: null,
    lastErrorCode: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    updatedAt: Date.now()
  }
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(accountImport),
    getActiveAccountImport: vi.fn().mockResolvedValue(null),
    countAccountImportStartsSince: vi.fn().mockResolvedValue(0),
    getOldestAccountImportStartSince: vi.fn().mockResolvedValue(null)
  } as unknown as Database

  const request = () =>
    new NextRequest(
      'https://llun.test/api/v1/account/imports/import-id/start',
      {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ options: {} }),
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )

  const start = () =>
    POST(request(), {
      params: Promise.resolve({ id: 'import-id' }),
      currentActor,
      database
    } as never)

  beforeEach(() => {
    vi.mocked(database.getActorFromId)
      .mockReset()
      .mockResolvedValue(currentActor)
    vi.mocked(database.getAccountImport)
      .mockReset()
      .mockResolvedValue(accountImport)
    vi.mocked(database.getActiveAccountImport)
      .mockReset()
      .mockResolvedValue(null)
    vi.mocked(database.countAccountImportStartsSince)
      .mockReset()
      .mockResolvedValue(0)
    vi.mocked(startAccountImport).mockReset()
  })

  it.each([
    ['upload-incomplete', HTTP_STATUS.CONFLICT],
    ['archive-changed', HTTP_STATUS.CONFLICT],
    ['too-large', HTTP_STATUS.PAYLOAD_TOO_LARGE],
    ['unrecognised', HTTP_STATUS.UNPROCESSABLE_ENTITY]
  ] as const)('maps %s to its status code', async (type, status) => {
    vi.mocked(startAccountImport).mockResolvedValue({ type })

    const response = await start()

    expect(response.status).toBe(status)
  })
})

describe('start account import archive inspection', () => {
  const currentActor = {
    id: 'https://llun.test/users/current',
    account: { id: 'account-id' }
  } as Actor

  // A Mastodon-shaped archive whose second central-directory record is
  // damaged: yauzl's verdict on the directory must reach the owner as the
  // documented 422, never as an unhandled 500.
  const corruptedArchive = () => {
    const archive = buildZip([
      {
        name: 'actor.json',
        data: Buffer.from(
          '{"id":"https://source.test/users/archive","preferredUsername":"archive"}'
        )
      },
      { name: 'outbox.json', data: Buffer.from('{"orderedItems":[]}') }
    ])
    const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02])
    const firstRecord = archive.indexOf(signature)
    const secondRecord = archive.indexOf(signature, firstRecord + 1)
    archive[secondRecord + 3] ^= 0xff
    return archive
  }

  const archive = corruptedArchive()
  const accountImport: AccountImport = {
    id: 'import-id',
    accountId: 'account-id',
    actorId: currentActor.id,
    status: 'queued',
    kind: null,
    archiveETag: null,
    options: '{}',
    storageToken: 'token',
    uploadedBytes: archive.length,
    progress: null,
    phase: null,
    cursor: null,
    runToken: null,
    claimedUntil: null,
    lastErrorCode: null,
    createdAt: 0,
    startedAt: null,
    finishedAt: null,
    updatedAt: 0
  }
  const objectStore = {
    store: {
      getMetadata: async () => ({
        size: archive.length,
        etag: '"archive-version-1"'
      })
    },
    getUploadKey: () => 'imports/import-id/token/upload.zip',
    openSource: async () => sourceOf(archive),
    deleteUpload: vi.fn()
  } as unknown as AccountImportObjectStore
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(accountImport),
    getActiveAccountImport: vi.fn().mockResolvedValue(null),
    countAccountImportStartsSince: vi.fn().mockResolvedValue(0),
    getOldestAccountImportStartSince: vi.fn().mockResolvedValue(null)
  } as unknown as Database

  const request = () =>
    new NextRequest(
      'https://llun.test/api/v1/account/imports/import-id/start',
      {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ options: {} }),
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )

  const start = () =>
    POST(request(), {
      params: Promise.resolve({ id: 'import-id' }),
      currentActor,
      database
    } as never)

  beforeEach(async () => {
    // The real start service runs against the fake object store, so the
    // whole inspection path (metadata check, zip open, catalog walk) is
    // exercised through the route.
    const actual = await vi.importActual<
      typeof import('@/lib/services/accountImport/start')
    >('@/lib/services/accountImport/start')
    vi.mocked(startAccountImport).mockImplementation(actual.startAccountImport)
    vi.mocked(getAccountImportObjectStore).mockReturnValue(objectStore)
  })

  afterEach(() => {
    vi.mocked(getAccountImportObjectStore).mockReturnValue(null)
  })

  it('answers 422 for an archive with a corrupted central directory', async () => {
    const response = await start()

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
  })
})
