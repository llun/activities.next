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

const mute = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/mute`,
      {
        method: 'POST',
        headers: { Origin: 'https://llun.test' }
      }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/mute', () => {
  const { database, prepare } = createTestDatabase()

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

  describe('unstored remote status', () => {
    const remoteActorId = EXTERNAL_ACTOR1

    it('unstored remote public status → fetched, stored, 200 and mute recorded', async () => {
      const remoteStatusId = `${remoteActorId}/statuses/mute-remote-1`
      mockGetNote.mockResolvedValueOnce({
        id: remoteStatusId,
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'mute me remotely',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await mute(remoteStatusId)

      expect(response.status).toBe(200)
      const stored = await database.getStatus({
        statusId: remoteStatusId,
        withReplies: false
      })
      expect(stored?.type).toBe(StatusType.enum.Note)
      // The conversation root of the fetched status is itself, so the mute is
      // recorded under the remote status's own id.
      await expect(
        database.isConversationMuted({
          actorId: ACTOR1_ID,
          statusId: remoteStatusId
        })
      ).resolves.toBeTrue()
    })

    it('a non-public remote note → 404, nothing stored', async () => {
      const nonPublicId = `${remoteActorId}/statuses/mute-remote-private-1`
      mockGetNote.mockResolvedValueOnce({
        id: nonPublicId,
        type: 'Note',
        attributedTo: remoteActorId,
        content: 'followers only',
        to: [`${remoteActorId}/followers`],
        cc: [],
        published: '2026-04-26T10:00:00Z'
      })

      const response = await mute(nonPublicId)

      expect(response.status).toBe(404)
      expect(
        await database.getStatus({ statusId: nonPublicId, withReplies: false })
      ).toBeNull()
      await expect(
        database.isConversationMuted({
          actorId: ACTOR1_ID,
          statusId: nonPublicId
        })
      ).resolves.toBeFalse()
    })

    it('a local-domain id → 404, nothing stored, no fetch', async () => {
      const localStatusId =
        'https://llun.test/users/test2/statuses/mute-local-missing-1'
      const response = await mute(localStatusId)

      expect(response.status).toBe(404)
      expect(mockGetNote).not.toHaveBeenCalled()
      expect(
        await database.getStatus({
          statusId: localStatusId,
          withReplies: false
        })
      ).toBeNull()
    })
  })
})
