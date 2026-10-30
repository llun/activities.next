import type { BaseNote } from '@/lib/activities/note'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'

import { getReadableStatusForAction } from './getReadableStatusForAction'

const {
  mockGetReadableStatus,
  mockGetNote,
  mockDispatchCreateNoteOrPollJob,
  mockIsLocalDomain,
  mockCanFederateWithDomain,
  mockGetFederationSigningActorSafe
} = vi.hoisted(() => ({
  mockGetReadableStatus: vi.fn(),
  mockGetNote: vi.fn(),
  mockDispatchCreateNoteOrPollJob: vi.fn(),
  mockIsLocalDomain: vi.fn(),
  mockCanFederateWithDomain: vi.fn(),
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

vi.mock('@/lib/services/domains/localDomains', () => ({
  isLocalDomain: mockIsLocalDomain
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  canFederateWithDomain: mockCanFederateWithDomain
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: mockGetFederationSigningActorSafe
}))

describe('getReadableStatusForAction', () => {
  const currentActor = { id: 'https://llun.test/users/alice' } as Actor
  const signingActor = { id: 'https://llun.test/actor' } as Actor
  const mockStatus = {
    id: 'https://remote.social/users/bob/statuses/1',
    actorId: 'https://remote.social/users/bob'
  } as unknown as Status

  const mockNote: BaseNote = {
    id: 'https://remote.social/users/bob/statuses/1',
    type: 'Note',
    attributedTo: 'https://remote.social/users/bob',
    content: 'hello with attachment',
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [],
    attachment: [
      {
        type: 'Document',
        mediaType: 'image/jpeg',
        url: 'https://remote.social/media/photo.jpg',
        name: 'A scenic photo'
      }
    ]
  } as unknown as BaseNote

  const mockGetStatus = vi.fn()
  const database = {
    getStatus: mockGetStatus
  } as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetReadableStatus.mockResolvedValue(null)
    mockGetStatus.mockResolvedValue(null)
    mockGetNote.mockResolvedValue(null)
    mockDispatchCreateNoteOrPollJob.mockResolvedValue(undefined)
    mockIsLocalDomain.mockResolvedValue(false)
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetFederationSigningActorSafe.mockResolvedValue(signingActor)
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
    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
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
    expect(mockGetStatus).toHaveBeenCalledWith({
      statusId: mockStatus.id,
      withReplies: false
    })
    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
  })

  it('returns null without fetching if statusId is not an http(s) URL', async () => {
    const result = await getReadableStatusForAction({
      database,
      statusId: 'not-a-url',
      currentActor
    })

    expect(result).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
  })

  it('returns null without fetching if statusId is on a local domain', async () => {
    mockIsLocalDomain.mockResolvedValue(true)

    const result = await getReadableStatusForAction({
      database,
      statusId: 'https://llun.test/users/bob/statuses/999',
      currentActor
    })

    expect(result).toBeNull()
    expect(mockIsLocalDomain).toHaveBeenCalledWith(
      database,
      'https://llun.test/users/bob/statuses/999'
    )
    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
  })

  it('returns null without fetching if domain policy blocks federation', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockCanFederateWithDomain).toHaveBeenCalledWith(
      database,
      mockStatus.id
    )
    expect(mockGetNote).not.toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
  })

  it('fetches remote status, calls dispatch with attachment-bearing note, and returns readable status', async () => {
    mockGetReadableStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockStatus)

    mockGetNote.mockResolvedValue(mockNote)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor,
      withReplies: false
    })

    expect(result).toBe(mockStatus)
    expect(mockGetFederationSigningActorSafe).toHaveBeenCalledWith(
      database,
      'for remote status action'
    )
    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: mockStatus.id,
      signingActor
    })
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      database,
      mockNote
    )
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(2)
  })

  it('alias case (note.id differs on the same origin) falls back to note.id', async () => {
    const aliasStatusId = 'https://remote.social/@bob/1'
    const canonicalNoteId = 'https://remote.social/users/bob/statuses/1'
    const noteWithCanonicalId = {
      ...mockNote,
      id: canonicalNoteId
    }

    mockGetNote.mockResolvedValue(noteWithCanonicalId)
    mockGetReadableStatus
      .mockResolvedValueOnce(null) // initial check for alias
      .mockResolvedValueOnce(null) // re-read for alias misses
      .mockResolvedValueOnce(mockStatus) // fallback re-read for note.id succeeds

    const result = await getReadableStatusForAction({
      database,
      statusId: aliasStatusId,
      currentActor,
      withReplies: true
    })

    expect(result).toBe(mockStatus)
    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: aliasStatusId,
      signingActor
    })
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      database,
      noteWithCanonicalId
    )
    expect(mockGetReadableStatus).toHaveBeenNthCalledWith(1, {
      database,
      statusId: aliasStatusId,
      currentActor,
      withReplies: true
    })
    expect(mockGetReadableStatus).toHaveBeenNthCalledWith(2, {
      database,
      statusId: aliasStatusId,
      currentActor,
      withReplies: true
    })
    expect(mockGetReadableStatus).toHaveBeenNthCalledWith(3, {
      database,
      statusId: canonicalNoteId,
      currentActor,
      withReplies: true
    })
  })

  it('returns null and does not dispatch if note is non-public', async () => {
    const nonPublicNote = {
      ...mockNote,
      to: ['https://remote.social/users/bob/followers'],
      cc: []
    }
    mockGetNote.mockResolvedValue(nonPublicNote)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockGetNote).toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(1)
  })

  it('returns null and does not dispatch if note id has origin mismatch', async () => {
    const crossOriginNote = {
      ...mockNote,
      id: 'https://evil.social/users/bob/statuses/1'
    }
    mockGetNote.mockResolvedValue(crossOriginNote)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockGetNote).toHaveBeenCalled()
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(1)
  })

  it('logs warning and returns null when getNote throws an error', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const networkError = new Error('Connection refused')
    mockGetNote.mockRejectedValue(networkError)

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
    expect(mockDispatchCreateNoteOrPollJob).not.toHaveBeenCalled()
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(1)
  })

  it('logs warning and returns null when dispatchCreateNoteOrPollJob throws an error', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const dispatchError = new Error('Database write failure')
    mockGetNote.mockResolvedValue(mockNote)
    mockDispatchCreateNoteOrPollJob.mockRejectedValue(dispatchError)

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
        err: dispatchError
      })
    )
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(1)
  })

  it('falls back to an unsigned fetch when the signer lookup fails', async () => {
    // The real getFederationSigningActorSafe never rejects; a signer failure
    // resolves to undefined so the fetch proceeds unsigned.
    mockGetFederationSigningActorSafe.mockResolvedValue(undefined)
    mockGetNote.mockResolvedValue(mockNote)
    mockGetReadableStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(mockStatus)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBe(mockStatus)
    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: mockStatus.id,
      signingActor: undefined
    })
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      database,
      mockNote
    )
  })

  it('returns null when remote fetch fails to store anything', async () => {
    mockGetNote.mockResolvedValue(mockNote)
    mockGetReadableStatus.mockResolvedValue(null)

    const result = await getReadableStatusForAction({
      database,
      statusId: mockStatus.id,
      currentActor
    })

    expect(result).toBeNull()
    expect(mockDispatchCreateNoteOrPollJob).toHaveBeenCalledWith(
      database,
      mockNote
    )
    expect(mockGetReadableStatus).toHaveBeenCalledTimes(2)
  })
})
