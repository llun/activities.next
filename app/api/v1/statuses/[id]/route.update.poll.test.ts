import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { GET as getStatusHistory } from './history/route'
import { PUT } from './route'

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

describe('PUT /api/v1/statuses/[id] poll edits', () => {
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

  describe('status update', () => {
    it('edits poll options with vote reset and snapshots the old options in history', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-options`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Editable poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Old A', 'Old B'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              status: 'Editable poll v2',
              poll: {
                options: ['New A', 'New B'],
                expires_in: 7200,
                hide_totals: true
              }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.content).toContain('Editable poll v2')
      // Replaced options start from zero and hide_totals nulls the running
      // tallies per option.
      expect(data.poll.options).toEqual([
        { title: 'New A', votes_count: null },
        { title: 'New B', votes_count: null }
      ])
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
      // expires_in (7200s) is rebased from now into expires_at (seconds -> ms).
      const expiresAt = new Date(data.poll.expires_at).getTime()
      expect(Math.abs(expiresAt - (Date.now() + 7200 * 1000))).toBeLessThan(
        60_000
      )

      const historyResponse = await getStatusHistory(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}/history`
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )
      const revisions = await historyResponse.json()
      expect(revisions).toHaveLength(2)
      expect(revisions[0].poll).toEqual({
        options: [{ title: 'Old A' }, { title: 'Old B' }]
      })
      expect(revisions[1].poll).toEqual({
        options: [{ title: 'New A' }, { title: 'New B' }]
      })
    })

    it('keeps existing votes when only hide_totals changes on a poll edit', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-hide-totals-only`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Hide totals only poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Votes survive; hide_totals only masks the per-option numbers.
      expect(data.poll.votes_count).toBe(1)
      expect(data.poll.voters_count).toBe(1)
      expect(data.poll.options).toEqual([
        { title: 'Yes', votes_count: null },
        { title: 'No', votes_count: null }
      ])
    })

    it('resets votes and switches to anyOf when a poll edit flips multiple to true', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-multiple-flip`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Single choice poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Red', 'Blue'],
        endAt: Date.now() + 60_000
      })
      await database.recordPollVotes({
        statusId: pollId,
        actorId: ACTOR2_ID,
        choices: [0]
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              poll: { options: ['Red', 'Blue'], multiple: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      // Same options, but flipping the multiple-choice mode resets votes and
      // switches the poll to anyOf (Mastodon UpdateStatusService#update_poll!).
      expect(data.poll.multiple).toBe(true)
      expect(data.poll.votes_count).toBe(0)
      expect(data.poll.voters_count).toBe(0)
    })

    it.each([
      {
        description: 'a poll payload on a note edit',
        body: { poll: { options: ['A', 'B'] } }
      }
    ])('rejects $description with 422', async ({ body }) => {
      const statusId = `${ACTOR1_ID}/statuses/api-edit-note-no-poll`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'Note cannot gain a poll',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
          {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(statusId) }) }
      )

      expect(response.status).toBe(422)
    })

    it.each([
      { param: 'media_ids', body: { media_ids: ['1'] } },
      {
        param: 'media_attributes',
        body: { media_attributes: [{ id: '1', description: 'x' }] }
      },
      { param: 'visibility', body: { visibility: 'private' } }
    ])(
      'rejects a poll edit that also changes $param with 422',
      async ({ param, body }) => {
        const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-reject-${param}`
        await database.createPoll({
          id: pollId,
          url: pollId,
          actorId: ACTOR1_ID,
          text: 'Poll cannot change media or visibility',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [],
          choices: ['Yes', 'No'],
          endAt: Date.now() + 60_000
        })

        const response = await PUT(
          new NextRequest(
            `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
            {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: {
                'Content-Type': 'application/json',
                Origin: 'https://llun.test'
              }
            }
          ),
          { params: Promise.resolve({ id: urlToId(pollId) }) }
        )

        expect(response.status).toBe(422)
      }
    )

    it('allows a poll edit that carries an empty media_ids array', async () => {
      const pollId = `${ACTOR1_ID}/statuses/api-edit-poll-empty-media`
      await database.createPoll({
        id: pollId,
        url: pollId,
        actorId: ACTOR1_ID,
        text: 'Poll with an empty media edit',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        choices: ['Yes', 'No'],
        endAt: Date.now() + 60_000
      })

      const response = await PUT(
        new NextRequest(
          `https://llun.test/api/v1/statuses/${urlToId(pollId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              // Many clients send an empty media_ids by default; on a poll edit
              // that must be ignored, not rejected with 422.
              media_ids: [],
              poll: { options: ['Yes', 'No'], hide_totals: true }
            }),
            headers: {
              'Content-Type': 'application/json',
              Origin: 'https://llun.test'
            }
          }
        ),
        { params: Promise.resolve({ id: urlToId(pollId) }) }
      )

      expect(response.status).toBe(200)
    })
  })
})
