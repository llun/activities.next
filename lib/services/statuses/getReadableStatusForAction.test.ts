import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

import { getReadableStatusForAction } from './getReadableStatusForAction'

const {
  mockGetReadableStatus,
  mockFetchRemoteStatus,
  mockIsLocalFederationDomain,
  mockGetFederationSigningActor
} = vi.hoisted(() => ({
  mockGetReadableStatus: vi.fn(),
  mockFetchRemoteStatus: vi.fn(),
  mockIsLocalFederationDomain: vi.fn(),
  mockGetFederationSigningActor: vi.fn()
}))

vi.mock('@/lib/services/statusRouteAccess', () => ({
  getReadableStatus: mockGetReadableStatus
}))

vi.mock('@/lib/jobs/fetchRemoteStatusJob', () => ({
  fetchRemoteStatus: mockFetchRemoteStatus
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: mockIsLocalFederationDomain
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActor: mockGetFederationSigningActor
}))

describe('getReadableStatusForAction', () => {
  const currentActor = { id: 'https://llun.test/users/alice' } as Actor
  const signingActor = { id: 'https://llun.test/actor' } as Actor
  const mockStatus = {
    id: 'https://remote.social/users/bob/statuses/1',
    actorId: 'https://remote.social/users/bob'
  } as unknown as Status

  const mockGetStatus = vi.fn()
  const database = {
    getStatus: mockGetStatus
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetReadableStatus.mockResolvedValue(null)
    mockGetStatus.mockResolvedValue(null)
    mockFetchRemoteStatus.mockResolvedValue(null)
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockGetFederationSigningActor.mockResolvedValue(signingActor)
  })

  it('returns status immediately if already readable', async () => {
    mockGetReadableStatus.mockResolvedValue(mockStatus)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor,
      withReplies: false
    })

    expect(result).toBe(mockStatus)
    expect(mockGetReadableStatus).toHaveBeenCalledWith({
      database,
      statusId: mockStatus.id,
      currentActor,
      withReplies: false
    })
    expect(mockGetStatus).not.toHaveBeenCalled()
    expect(mockFetchRemoteStatus).not.toHaveBeenCalled()
  })

  it('returns null without fetching if row exists but is unreadable for viewer', async () => {
    mockGetReadableStatus.mockResolvedValue(null)
    mockGetStatus.mockResolvedValue(mockStatus)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockGetStatus).toHaveBeenCalledWith({ statusId: mockStatus.id })
    expect(mockFetchRemoteStatus).not.toHaveBeenCalled()
  })

  it('returns null without fetching if statusId is not an http(s) URL', async () => {
    const result = await getReadableStatusForAction({
      database,
      statusId: 'not-a-url',
      currentActor
    })

    expect(result).toBeNull()
    expect(mockFetchRemoteStatus).not.toHaveBeenCalled()
  })

  it('returns null without fetching if statusId is on a local domain', async () => {
    mockIsLocalFederationDomain.mockResolvedValue(true)

    const result = await getReadableStatusForAction({
      database,
      statusId: 'https://llun.test/users/bob/statuses/999',
      currentActor
    })

    expect(result).toBeNull()
    expect(mockIsLocalFederationDomain).toHaveBeenCalledWith(
      database,
      'https://llun.test/users/bob/statuses/999'
    )
    expect(mockFetchRemoteStatus).not.toHaveBeenCalled()
  })

  it('fetches remote status and returns readable status when newly stored', async () => {
    mockGetReadableStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockStatus)

    mockFetchRemoteStatus.mockResolvedValue({ status: mockStatus })

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor,
      withReplies: false
    })

    expect(result).toBe(mockStatus)
    expect(mockGetFederationSigningActor).toHaveBeenCalledWith(database)
    expect(mockFetchRemoteStatus).toHaveBeenCalledWith(
      database,
      mockStatus.id,
      0,
      signingActor
    )
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(2)
  })

  it('logs warning and returns null when fetch throws a network failure', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const networkError = new Error('Connection refused')
    mockFetchRemoteStatus.mockRejectedValue(networkError)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to fetch remote status for action',
        statusId: mockStatus.id,
        err: networkError
      })
    )
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(1)
  })

  it('returns null when remote fetch fails to store anything', async () => {
    mockFetchRemoteStatus.mockResolvedValue(null)
    mockGetReadableStatus.mockResolvedValue(null)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(2)
  })
})
