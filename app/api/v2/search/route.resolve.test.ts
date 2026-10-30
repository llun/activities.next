import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

const { mockGetNote, mockRecordRemoteActorBestEffort } = vi.hoisted(() => ({
  mockGetNote: vi.fn(),
  mockRecordRemoteActorBestEffort: vi.fn()
}))

// Only getNote is mocked: the real getReadableStatusAndFetchedNoteForAction,
// dispatchCreateNoteOrPollJob and status storage all run against the test
// database, so these tests prove the route consumes the helper's result
// without a second remote fetch. recordRemoteActorBestEffort is stubbed
// because the forged-author test needs the ephemeral fallback path to run to
// completion: without the helper's author-origin check that path would build
// an ephemeral status from the forged note, but recording its (nonexistent)
// remote actor would fail first and mask the bug.
vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    getNote: mockGetNote
  }
})

vi.mock('@/lib/services/actors/refreshRemoteActor', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/actors/refreshRemoteActor')
    >()
  return {
    ...actual,
    recordRemoteActorBestEffort: mockRecordRemoteActorBestEffort
  }
})

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const context = { params: Promise.resolve({}) }

const searchStatuses = (query: string) =>
  GET(
    new NextRequest(
      `https://llun.test/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&resolve=true&format=activities_next`,
      { headers: { Authorization: 'Bearer read-search-token' } }
    ),
    context
  )

describe('GET /api/v2/search resolved remote statuses (real store-first helper)', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    vi.spyOn(database, 'getOAuthAccessTokenByHash').mockImplementation(() =>
      Promise.resolve({
        clientId: 'test-client',
        userId: ACTOR1_ID,
        expiresAt: Date.now() + 60_000,
        referenceId: ACTOR1_ID,
        scopes: 'read:search'
      })
    )
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockRecordRemoteActorBestEffort.mockImplementation(({ actorId }) =>
      Promise.resolve({ id: actorId })
    )
  })

  it('stores a resolved remote note and returns the status with its stored id', async () => {
    const remoteActorId = 'https://remote.test/users/bob'
    const remoteStatusId = `${remoteActorId}/statuses/1`
    mockGetNote.mockResolvedValueOnce({
      id: remoteStatusId,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'hello remote world',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await searchStatuses(remoteStatusId)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.statuses).toHaveLength(1)
    expect(data.statuses[0].id).toBe(remoteStatusId)
    expect(mockGetNote).toHaveBeenCalledTimes(1)
    const stored = await database.getStatus({ statusId: remoteStatusId })
    expect(stored).not.toBeNull()
  })

  it('resolves a permalink query, stores under the note id and returns the stored row', async () => {
    const permalink = 'https://remote.test/@alice/7'
    const noteId = 'https://remote.test/users/alice/statuses/7'
    mockGetNote.mockResolvedValueOnce({
      id: noteId,
      url: permalink,
      type: 'Note',
      attributedTo: 'https://remote.test/users/alice',
      content: 'permalink target',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await searchStatuses(permalink)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.statuses).toHaveLength(1)
    expect(data.statuses[0].id).toBe(noteId)
    expect(mockGetNote).toHaveBeenCalledTimes(1)
    const stored = await database.getStatus({ statusId: noteId })
    expect(stored).not.toBeNull()
    expect(stored?.actorId).toBe('https://remote.test/users/alice')
  })

  it('returns no statuses and stores nothing when attributedTo is on another origin', async () => {
    const remoteStatusId = 'https://remote.test/users/bob/statuses/2'
    mockGetNote.mockResolvedValueOnce({
      id: remoteStatusId,
      type: 'Note',
      attributedTo: 'https://evil.example/users/evil',
      content: 'forged author',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await searchStatuses(remoteStatusId)
    const data = await response.json()

    expect(data.statuses).toHaveLength(0)
    expect(mockGetNote).toHaveBeenCalledTimes(1)
    const stored = await database.getStatus({ statusId: remoteStatusId })
    expect(stored).toBeNull()
  })

  it('returns no statuses and stores nothing when a local actor is attributed to a note on another origin', async () => {
    const remoteStatusId = 'https://evil.test/users/x/statuses/1'
    mockGetNote.mockResolvedValueOnce({
      id: remoteStatusId,
      type: 'Note',
      attributedTo: ACTOR1_ID,
      content: 'local author, foreign id',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await searchStatuses(remoteStatusId)
    const data = await response.json()

    expect(data.statuses).toHaveLength(0)
    expect(mockGetNote).toHaveBeenCalledTimes(1)
    const stored = await database.getStatus({ statusId: remoteStatusId })
    expect(stored).toBeNull()
  })
})
