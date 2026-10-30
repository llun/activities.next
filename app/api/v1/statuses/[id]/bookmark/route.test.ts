import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

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

const { mockGetNote } = vi.hoisted(() => ({
  mockGetNote: vi.fn()
}))

vi.mock('@/lib/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/activities')>()
  return {
    ...actual,
    getNote: mockGetNote
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

const bookmark = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/bookmark`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/bookmark', () => {
  const { database, prepare } = createTestDatabase()
  const remoteActorId = EXTERNAL_ACTOR1
  const remoteStatusId = `${remoteActorId}/statuses/bookmark-remote-public-1`

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    if (!database) return
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('unstored remote public status → fetched, stored, 200', async () => {
    mockGetNote.mockResolvedValueOnce({
      id: remoteStatusId,
      type: 'Note',
      attributedTo: remoteActorId,
      content: 'hello bookmarkable world',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      published: '2026-04-26T10:00:00Z'
    })

    const response = await bookmark(remoteStatusId)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      uri: remoteStatusId,
      bookmarked: true
    })
    const stored = await database.getStatus({ statusId: remoteStatusId })
    expect(stored?.type).toBe(StatusType.enum.Note)
    if (stored?.type === StatusType.enum.Note) {
      expect(stored.text).toBe('hello bookmarkable world')
    }
    await expect(
      database.isActorBookmarkedStatus({
        actorId: ACTOR1_ID,
        statusId: remoteStatusId
      })
    ).resolves.toBeTrue()
  })
})
