import type { Database } from '@/lib/database/types'
import { CREATE_NOTE_JOB_NAME, CREATE_POLL_JOB_NAME } from '@/lib/jobs/names'
import { fetchQuoteTargetForCreate } from '@/lib/services/quotes/fetchQuoteTargetForCreate'
import { Status, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const {
  mockGetNote,
  mockCreateNoteJob,
  mockCreatePollJob,
  mockIsLocalFederationDomain,
  mockCanFederateWithDomain,
  mockGetFederationSigningActorSafe
} = vi.hoisted(() => ({
  mockGetNote: vi.fn(),
  mockCreateNoteJob: vi.fn(),
  mockCreatePollJob: vi.fn(),
  mockIsLocalFederationDomain: vi.fn(),
  mockCanFederateWithDomain: vi.fn(),
  mockGetFederationSigningActorSafe: vi.fn()
}))

vi.mock('@/lib/activities', () => ({
  getNote: mockGetNote
}))

vi.mock('@/lib/jobs/createNoteJob', () => ({
  createNoteJob: mockCreateNoteJob
}))

vi.mock('@/lib/jobs/createPollJob', () => ({
  createPollJob: mockCreatePollJob
}))

vi.mock('@/lib/services/federation/domainPolicy', () => ({
  isLocalFederationDomain: mockIsLocalFederationDomain,
  canFederateWithDomain: mockCanFederateWithDomain
}))

vi.mock('@/lib/services/federation/getFederationSigningActor', () => ({
  getFederationSigningActorSafe: mockGetFederationSigningActorSafe
}))

describe('fetchQuoteTargetForCreate', () => {
  const remoteStatusId = 'https://remote.test/users/alice/statuses/1'
  const mockStatus = {
    id: remoteStatusId,
    actorId: 'https://remote.test/users/alice',
    type: StatusType.enum.Note,
    url: remoteStatusId,
    text: 'Hello world',
    summary: null,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    reply: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isLocalActor: false
  } as unknown as Status

  const makeDatabase = (
    storedStatuses: Record<string, Status | null> = {}
  ): Database =>
    ({
      getStatus: vi.fn(async ({ statusId }: { statusId: string }) => {
        if (statusId in storedStatuses) {
          return storedStatuses[statusId]
        }
        return null
      })
    }) as unknown as Database

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsLocalFederationDomain.mockResolvedValue(false)
    mockCanFederateWithDomain.mockResolvedValue(true)
    mockGetFederationSigningActorSafe.mockResolvedValue(undefined)
    mockCreateNoteJob.mockResolvedValue(undefined)
    mockCreatePollJob.mockResolvedValue(undefined)
  })

  it('fetches, stores, and returns an unstored remote public note', async () => {
    const fetchedNote = {
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Hello world',
      published: '2026-01-01T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase({
      [remoteStatusId]: mockStatus
    })

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(mockGetNote).toHaveBeenCalledWith({
      statusId: remoteStatusId,
      signingActor: undefined
    })
    expect(mockCreateNoteJob).toHaveBeenCalledWith(database, {
      id: remoteStatusId,
      name: CREATE_NOTE_JOB_NAME,
      data: expect.objectContaining({ id: remoteStatusId }),
      skipQuoteResolution: true
    })
    expect(result).toEqual(mockStatus)
  })

  it('fetches and dispatches to createPollJob when remote note is a Question', async () => {
    const questionId = 'https://remote.test/users/alice/polls/1'
    const fetchedQuestion = {
      id: questionId,
      type: 'Question',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Which option?',
      published: '2026-01-01T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      oneOf: [
        { name: 'Option 1', type: 'Note' },
        { name: 'Option 2', type: 'Note' }
      ]
    }
    mockGetNote.mockResolvedValue(fetchedQuestion)
    const pollStatus = {
      ...mockStatus,
      id: questionId,
      type: StatusType.enum.Poll
    } as unknown as Status
    const database = makeDatabase({
      [questionId]: pollStatus
    })

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: questionId
    })

    expect(mockCreatePollJob).toHaveBeenCalledWith(database, {
      id: questionId,
      name: CREATE_POLL_JOB_NAME,
      data: expect.objectContaining({ id: questionId }),
      skipQuoteResolution: true
    })
    expect(result).toEqual(pollStatus)
  })

  it('accepts a same-origin permalink alias and recovers the status stored under the canonical id', async () => {
    const requestedPermalink = 'https://remote.test/@alice/1'
    const canonicalId = 'https://remote.test/users/alice/statuses/1'
    const fetchedNote = {
      id: canonicalId,
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Hello permalink',
      published: '2026-01-01T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase({
      [requestedPermalink]: null,
      [canonicalId]: { ...mockStatus, id: canonicalId }
    })

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: requestedPermalink
    })

    expect(mockCreateNoteJob).toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ id: canonicalId }))
  })

  it('rejects and stores nothing when the fetched note id has a different origin than requested', async () => {
    const fetchedNote = {
      id: 'https://evil.test/users/bob/statuses/999',
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Spoofed id',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('rejects and stores nothing when attributedTo has a different origin than the note id', async () => {
    const fetchedNote = {
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://evil.test/users/attacker',
      content: 'Spoofed author',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('rejects immediately without fetching if quotedStatusId is not a valid http/https url', async () => {
    const database = makeDatabase()
    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: 'not-a-url'
    })
    expect(result).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('rejects immediately without fetching if quotedStatusId is on a local federation domain', async () => {
    mockIsLocalFederationDomain.mockResolvedValue(true)
    const database = makeDatabase()
    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: 'https://local.test/users/alice/statuses/1'
    })
    expect(result).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('rejects immediately without fetching if domain is blocked by federation policy', async () => {
    mockCanFederateWithDomain.mockResolvedValue(false)
    const database = makeDatabase()
    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })
    expect(result).toBeNull()
    expect(mockGetNote).not.toHaveBeenCalled()
  })

  it('rejects if the attributed author domain is blocked by federation policy', async () => {
    mockCanFederateWithDomain.mockImplementation(async (_db, url) => {
      return url === remoteStatusId
    })
    const fetchedNote = {
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://remote.test/users/blocked-actor',
      content: 'Blocked author',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('returns null if getNote returns null', async () => {
    mockGetNote.mockResolvedValue(null)
    const database = makeDatabase()
    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })
    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('handles getNote throwing and returns null', async () => {
    mockGetNote.mockRejectedValue(new Error('Network error'))
    const database = makeDatabase()
    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })
    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('rejects and stores nothing if audience is not public or unlisted', async () => {
    const fetchedNote = {
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Direct message',
      to: ['https://remote.test/users/bob'],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('rejects and stores nothing if fetched object is not a supported note type', async () => {
    const fetchedObject = {
      id: remoteStatusId,
      type: 'Activity',
      attributedTo: 'https://remote.test/users/alice',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedObject)
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
    expect(mockCreateNoteJob).not.toHaveBeenCalled()
  })

  it('returns null if storing the note throws an error', async () => {
    const fetchedNote = {
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'Hello world',
      published: '2026-01-01T00:00:00Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    }
    mockGetNote.mockResolvedValue(fetchedNote)
    mockCreateNoteJob.mockRejectedValue(new Error('Database write error'))
    const database = makeDatabase()

    const result = await fetchQuoteTargetForCreate({
      database,
      quotedStatusId: remoteStatusId
    })

    expect(result).toBeNull()
  })
})
