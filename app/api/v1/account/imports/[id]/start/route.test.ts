import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import {
  ACCOUNT_IMPORT_MAX_STARTS,
  ACCOUNT_IMPORT_START_WINDOW_MS
} from '@/lib/services/accountImport/constants'
import { startAccountImport } from '@/lib/services/accountImport/start'
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

vi.mock('@/lib/services/accountImport/objectStore', () => ({
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
  const getOldestAccountImportStartSince = vi.fn()
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(accountImport),
    getActiveAccountImport: vi.fn().mockResolvedValue(null),
    countAccountImportStartsSince,
    getOldestAccountImportStartSince
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
    getOldestAccountImportStartSince.mockReset()
    vi.mocked(startAccountImport)
      .mockReset()
      .mockResolvedValue({ type: 'storage-unavailable' })
  })

  it('counts the start limit per account, not per actor', async () => {
    countAccountImportStartsSince.mockResolvedValue(ACCOUNT_IMPORT_MAX_STARTS)
    getOldestAccountImportStartSince.mockResolvedValue(Date.now())

    const response = await start()

    expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS)
    // The whole account shares the window: the count is keyed by the
    // account, so starts made through another profile of the same account
    // count against this one.
    expect(countAccountImportStartsSince).toHaveBeenCalledWith({
      accountId: 'account-id',
      since: expect.any(Number)
    })
    expect(countAccountImportStartsSince).not.toHaveBeenCalledWith(
      expect.objectContaining({ actorId: expect.anything() })
    )
    expect(getOldestAccountImportStartSince).toHaveBeenCalledWith({
      accountId: 'account-id',
      since: expect.any(Number)
    })
    expect(response.headers.get('Retry-After')).toMatch(/^\d+$/)
    // The window is 24 h, so the header is bounded by it.
    const retryAfter = Number(response.headers.get('Retry-After'))
    expect(retryAfter).toBeLessThanOrEqual(
      Math.ceil(ACCOUNT_IMPORT_START_WINDOW_MS / 1000)
    )
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
