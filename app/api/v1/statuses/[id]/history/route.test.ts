import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { actorPublicId } from '@/lib/stub/publicIds'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusHistory } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

// No `deleteStatus` here on purpose: status deletion federates through
// SendDeleteNoteJob now, so the request path never reaches the sender.
vi.mock('@/lib/activities', async () => ({
  sendLike: vi.fn().mockResolvedValue(undefined),
  sendUndoLike: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/medias')>()),
  deleteMediaFile: vi.fn().mockResolvedValue(true)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/statuses/[id]/history', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
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

  describe('status edit history', () => {
    it('returns the full StatusEdit timeline oldest-first including the original', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-history-edits`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Version one',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.updateNote({ statusId, text: 'Version two' })
      await database.updateNote({ statusId, text: 'Version three' })

      const response = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(response.status).toBe(200)
      const history = await response.json()
      expect(history).toHaveLength(3)
      expect(history[0].content).toContain('Version one')
      expect(history[2].content).toContain('Version three')
      // created_at is non-decreasing oldest→newest (a bug giving every revision
      // the same timestamp from the wrong column would break ordering).
      const timestamps = history.map((edit: { created_at: string }) =>
        Date.parse(edit.created_at)
      )
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1])
      }
      for (const edit of history) {
        expect(edit).toMatchObject({
          spoiler_text: expect.any(String),
          sensitive: expect.any(Boolean),
          created_at: expect.any(String),
          account: expect.objectContaining({
            id: await actorPublicId(database, ACTOR1_ID)
          }),
          media_attachments: expect.any(Array),
          emojis: expect.any(Array)
        })
      }
    })

    it('returns a single edit for a never-edited status', async () => {
      const statusId = `${ACTOR1_ID}/statuses/api-history-unedited`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Only version',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )
      expect(response.status).toBe(200)
      const history = await response.json()
      expect(history).toHaveLength(1)
      expect(history[0].content).toContain('Only version')
    })
  })
})
