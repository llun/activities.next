import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { ACCOUNT_MOVED_ERROR } from '@/lib/services/accounts/movedAccount'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { POST as postOutbox } from './accounts/outbox/route'
import { POST as postRepost } from './accounts/repost/route'
import { GET as getVerifyCredentials } from './accounts/verify_credentials/route'
import { GET as getProfile } from './profile/route'
import { POST as postReblog } from './statuses/[id]/reblog/route'
import { POST as postStatus } from './statuses/route'

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

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

const post = (url: string, body: unknown) =>
  new NextRequest(`https://llun.test${url}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://llun.test'
    }
  })
const context = { params: Promise.resolve({}) }

describe('a moved account cannot post', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(async () => {
    await database.updateActor({ actorId: ACTOR1_ID, movedTo: null })
  })

  const markMoved = () =>
    database.updateActor({ actorId: ACTOR1_ID, movedTo: ACTOR2_ID })

  const expectMoved = async (response: Response) => {
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: ACCOUNT_MOVED_ERROR })
  }

  const statusTexts = async () =>
    (await database.getActorStatuses({ actorId: ACTOR1_ID })).flatMap(
      (status) => ('text' in status ? [status.text] : [])
    )

  it('refuses POST /api/v1/statuses and keeps the note out of the timeline', async () => {
    await markMoved()
    await expectMoved(
      await postStatus(
        post('/api/v1/statuses', { status: 'moved note' }),
        context
      )
    )
    expect(await statusTexts()).not.toContain('moved note')
  })

  it('refuses a scheduled status and a poll on POST /api/v1/statuses', async () => {
    await markMoved()
    await expectMoved(
      await postStatus(
        post('/api/v1/statuses', {
          status: 'moved scheduled',
          scheduled_at: new Date(Date.now() + 3_600_000).toISOString()
        }),
        context
      )
    )
    await expectMoved(
      await postStatus(
        post('/api/v1/statuses', {
          status: 'moved poll',
          poll: { options: ['a', 'b'], expires_in: 3600 }
        }),
        context
      )
    )
    expect(
      await database.getScheduledStatuses({ actorId: ACTOR1_ID, limit: 10 })
    ).toEqual([])
  })

  it('still creates the note when the account has not moved', async () => {
    const response = await postStatus(
      post('/api/v1/statuses', { status: 'not moved note' }),
      context
    )
    expect(response.status).toBe(200)
    expect(await statusTexts()).toContain('not moved note')
  })

  it('refuses the deprecated outbox route', async () => {
    await markMoved()
    await expectMoved(
      await postOutbox(
        post('/api/v1/accounts/outbox', {
          type: 'note',
          message: 'moved outbox note'
        }),
        context
      )
    )
    expect(await statusTexts()).not.toContain('moved outbox note')
  })

  it('refuses a reblog and the deprecated repost route', async () => {
    await markMoved()
    const target = (await database.getActorStatuses({ actorId: ACTOR2_ID }))[0]
    const reblog = await postReblog(
      post(`/api/v1/statuses/${target.id}/reblog`, {}),
      { params: Promise.resolve({ id: target.id }) }
    )
    await expectMoved(reblog)
    await expectMoved(
      await postRepost(
        post('/api/v1/accounts/repost', { statusId: target.id }),
        context
      )
    )
    expect(
      await database.getActorAnnounceStatus({
        statusId: target.id,
        actorId: ACTOR1_ID
      })
    ).toBeFalsy()
  })

  it('exposes the moved flag on the profile and the moved account on verify_credentials', async () => {
    const get = (url: string) =>
      new NextRequest(`https://llun.test${url}`, {
        headers: { Origin: 'https://llun.test' }
      })
    const profile = async () =>
      (await getProfile(get('/api/v1/profile'), context)).json()
    const credentials = async () =>
      (
        await getVerifyCredentials(
          get('/api/v1/accounts/verify_credentials'),
          context
        )
      ).json()

    expect((await profile()).moved).toBe(false)
    expect((await credentials()).moved).toBeFalsy()

    await markMoved()
    expect((await profile()).moved).toBe(true)
    expect((await credentials()).moved).toMatchObject({
      uri: ACTOR2_ID
    })
  })
})
