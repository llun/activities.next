import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: [],
    secretPhase: 'test-secret'
  })
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

const callRetry = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/bluesky_crosspost/retry`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

describe('POST /api/v1/statuses/[id]/bluesky_crosspost/retry', () => {
  const { database, db, prepare } = createTestDatabase()

  const seed = async (suffix: string, actorId = ACTOR1_ID) => {
    const status = await database.createNote({
      id: `${actorId}/statuses/bluesky-retry-${suffix}`,
      url: `${actorId}/statuses/bluesky-retry-${suffix}`,
      actorId,
      text: 'Cross-posted',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    await database.claimBlueskyCrosspost({ statusId: status.id, actorId })
    return status
  }

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
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  it('puts a failed cross-post back to pending and queues it under a fresh id', async () => {
    const status = await seed('failed')
    await database.markBlueskyCrosspostFailedIfAttemptable({
      statusId: status.id,
      error: 'Bluesky ended this session.'
    })

    const response = await callRetry(status.id)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      uri: status.id,
      bluesky_crosspost: { state: 'pending', url: null, error: null }
    })
    await expect(
      database.getBlueskyCrosspost({ statusId: status.id })
    ).resolves.toMatchObject({ state: 'pending', error: null })
    const publish = vi.mocked(getQueue().publish)
    expect(publish).toHaveBeenCalledTimes(1)
    const [job] = publish.mock.calls[0]
    expect(job).toMatchObject({
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: status.id }
    })
    // Not the first job's id, which the queue would deduplicate away.
    expect(job.id).not.toBe(getHashFromString(`${status.id}#bluesky-crosspost`))
  })

  it('answers 422 when the cross-post has not failed', async () => {
    const status = await seed('pending')

    const response = await callRetry(status.id)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: expect.any(String)
    })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('accepts a stale pending cross-post whose job never finished', async () => {
    const status = await seed('stale')
    // Older than STALE_CROSSPOST_MS: the queue dead-lettered its job.
    await db
      .updateTable('bluesky_crossposts')
      .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where('statusId', '=', status.id)
      .execute()

    const response = await callRetry(status.id)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      uri: status.id,
      bluesky_crosspost: { state: 'pending', url: null, error: null }
    })
    const publish = vi.mocked(getQueue().publish)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: status.id }
    })
  })

  it('accepts a stale posting cross-post whose worker crashed, and refuses a fresh posting one', async () => {
    const fresh = await seed('posting-fresh')
    await database.beginBlueskyCrosspostAttempt({ statusId: fresh.id })

    const freshResponse = await callRetry(fresh.id)
    expect(freshResponse.status).toBe(422)
    expect(getQueue().publish).not.toHaveBeenCalled()

    const stale = await seed('posting-stale')
    await database.beginBlueskyCrosspostAttempt({ statusId: stale.id })
    await db
      .updateTable('bluesky_crossposts')
      .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where('statusId', '=', stale.id)
      .execute()

    const staleResponse = await callRetry(stale.id)
    expect(staleResponse.status).toBe(200)
    await expect(staleResponse.json()).resolves.toMatchObject({
      uri: stale.id,
      bluesky_crosspost: { state: 'pending', url: null, error: null }
    })
    await expect(
      database.getBlueskyCrosspost({ statusId: stale.id })
    ).resolves.toMatchObject({ state: 'pending', error: null })
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('answers 422 when the post is no longer public', async () => {
    const status = await seed('narrowed')
    await database.markBlueskyCrosspostFailedIfAttemptable({
      statusId: status.id,
      error: 'Bluesky ended this session.'
    })
    await database.updateNoteVisibility({
      statusId: status.id,
      to: [`${ACTOR1_ID}/followers`],
      cc: []
    })

    const response = await callRetry(status.id)

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: expect.any(String)
    })
    expect(getQueue().publish).not.toHaveBeenCalled()
    // Not reset to pending: a private post must not be re-posted.
    await expect(
      database.getBlueskyCrosspost({ statusId: status.id })
    ).resolves.toMatchObject({ state: 'failed' })
  })

  it("answers 404 for someone else's post", async () => {
    const status = await seed('theirs', ACTOR2_ID)
    await database.markBlueskyCrosspostFailedIfAttemptable({
      statusId: status.id,
      error: 'x'
    })

    const response = await callRetry(status.id)

    expect(response.status).toBe(404)
    await expect(
      database.getBlueskyCrosspost({ statusId: status.id })
    ).resolves.toMatchObject({ state: 'failed' })
  })

  it('keeps it failed with its reason when the job cannot be queued', async () => {
    const status = await seed('queue-down')
    await database.markBlueskyCrosspostFailedIfAttemptable({
      statusId: status.id,
      error: 'Bluesky ended this session.'
    })
    vi.mocked(getQueue().publish).mockRejectedValueOnce(new Error('down'))

    const response = await callRetry(status.id)

    expect(response.status).toBe(500)
    await expect(
      database.getBlueskyCrosspost({ statusId: status.id })
    ).resolves.toMatchObject({
      state: 'failed',
      error: 'Bluesky ended this session.'
    })
  })

  it('leaves a posting row untouched when queue publish fails after a worker already started it', async () => {
    const status = await seed('queue-race')
    await database.markBlueskyCrosspostFailedIfAttemptable({
      statusId: status.id,
      error: 'Bluesky ended this session.'
    })
    vi.mocked(getQueue().publish).mockImplementationOnce(async () => {
      await database.beginBlueskyCrosspostAttempt({ statusId: status.id })
      throw new Error('publish timed out after delivery')
    })

    const response = await callRetry(status.id)

    expect(response.status).toBe(500)
    await expect(
      database.getBlueskyCrosspost({ statusId: status.id })
    ).resolves.toMatchObject({
      state: 'posting',
      error: null
    })
  })
})
