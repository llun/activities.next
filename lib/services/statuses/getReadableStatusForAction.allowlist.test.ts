import type { BaseNote } from '@/lib/activities/note'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

import { getReadableStatusForAction } from './getReadableStatusForAction'

// The point of this file is to exercise the REAL `isLocalDomain` and the REAL
// `canFederateWithDomain`: only the config, the server settings and the
// served-domain snapshot are mocked, so an allowlisted remote domain must pass
// the local-domain check (not local) and the federation policy (allowlist
// member) and reach the fetch-and-store path.

const {
  mockGetReadableStatus,
  mockGetNote,
  mockDispatchCreateNoteOrPollJob,
  mockGetFederationSigningActorSafe
} = vi.hoisted(() => ({
  mockGetReadableStatus: vi.fn(),
  mockGetNote: vi.fn(),
  mockDispatchCreateNoteOrPollJob: vi.fn(),
  mockGetFederationSigningActorSafe: vi.fn()
}))

vi.mock('@/lib/services/statusRouteAccess', () => ({
  getReadableStatus: mockGetReadableStatus
}))

vi.mock('@/lib/activities', () => ({
  getNote: mockGetNote
}))

vi.mock('@/lib/jobs/dispatchCreateNoteOrPollJob', () => ({
  dispatchCreateNoteOrPollJob: mockDispatchCreateNoteOrPollJob
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: mockGetFederationSigningActorSafe
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'llun.test',
    trustedHosts: []
  })
}))

vi.mock('@/lib/services/domains/servedDomainSnapshot', () => ({
  ensureServedDomainsFresh: vi.fn(async () => {}),
  getServedHostConfig: () => ({
    host: 'llun.test',
    trustedHosts: [],
    servedDomains: []
  })
}))

vi.mock('@/lib/services/serverSettings', () => ({
  getResolvedServerSettings: vi.fn(async () => ({
    federation: {
      mode: 'allowlist',
      allowActorDomains: ['allowed.remote']
    }
  }))
}))

describe('getReadableStatusForAction (real domain policy, allowlist mode)', () => {
  const currentActor = { id: 'https://llun.test/users/alice' } as Actor
  const statusId = 'https://allowed.remote/users/a/statuses/1'

  const mockStatus = {
    id: statusId,
    actorId: 'https://allowed.remote/users/a'
  } as unknown as Status

  const mockNote: BaseNote = {
    id: statusId,
    type: 'Note',
    attributedTo: 'https://allowed.remote/users/a',
    content: 'allowlisted remote note',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: []
  } as unknown as BaseNote

  const mockGetStatus = vi.fn().mockResolvedValue(null)
  const mockGetDomainBlockForDomain = vi.fn().mockResolvedValue(null)
  const mockGetDomainAllowForDomain = vi.fn().mockResolvedValue(null)
  const database = {
    getStatus: mockGetStatus,
    getDomainBlockForDomain: mockGetDomainBlockForDomain,
    getDomainAllowForDomain: mockGetDomainAllowForDomain
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockResolvedValue(null)
    mockGetDomainBlockForDomain.mockResolvedValue(null)
    mockGetDomainAllowForDomain.mockResolvedValue(null)
    mockGetReadableStatus.mockResolvedValue(null)
    mockGetNote.mockResolvedValue(null)
    mockDispatchCreateNoteOrPollJob.mockResolvedValue(undefined)
    mockGetFederationSigningActorSafe.mockResolvedValue(undefined)
  })

  it('fetches and stores an allowlisted remote status that is not local and not stored', async () => {
    mockGetNote.mockResolvedValue(mockNote)
    mockGetReadableStatus
      .mockResolvedValueOnce(null) // not readable before the fetch
      .mockResolvedValueOnce(mockStatus) // readable after storing

    const result = await getReadableStatusForAction({
      database,
      statusId,
      currentActor
    })

    expect(result).toBe(mockStatus)
    // The row does not exist yet, so the fetch path runs.
    expect(mockGetStatus).toHaveBeenCalledWith({
      statusId,
      withReplies: false
    })
    // The real isLocalDomain treats 'allowed.remote' as remote, and the real
    // allowlist policy lets it federate.
    expect(mockGetNote).toHaveBeenCalledWith({
      statusId,
      signingActor: undefined
    })
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      database,
      mockNote
    )
    // allowActorDomains entries are exempt from the per-domain allow row: the
    // policy's local matcher includes them, so no getDomainAllowForDomain read.
    expect(mockGetDomainAllowForDomain).not.toHaveBeenCalled()
  })
})
