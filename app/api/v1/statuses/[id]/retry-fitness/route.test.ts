import knex from 'knex'
import { NextRequest } from 'next/server'

import { getSQLDatabase } from '@/lib/database/sql'
import { STUCK_PROCESSING_THRESHOLD_MS } from '@/lib/services/fitness-files/processingState'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import {
  ACTOR1_FOLLOWER_URL,
  ACTOR1_ID,
  seedActor1
} from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
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

let mockDatabase: ReturnType<typeof getSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
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

const callRetry = (statusId: string) =>
  POST(
    new NextRequest(
      `https://llun.test/api/v1/statuses/${urlToId(statusId)}/retry-fitness`,
      { method: 'POST', headers: { Origin: 'https://llun.test' } }
    ),
    { params: Promise.resolve({ id: urlToId(statusId) }) }
  )

const seedFitnessStatus = async (
  database: ReturnType<typeof getSQLDatabase>,
  suffix: string
) => {
  const status = await database.createNote({
    id: `${ACTOR1_ID}/statuses/retry-fitness-${suffix}`,
    url: `${ACTOR1_ID}/statuses/retry-fitness-${suffix}`,
    actorId: ACTOR1_ID,
    text: 'Fitness activity',
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [ACTOR1_FOLLOWER_URL]
  })
  const file = await database.createFitnessFile({
    actorId: ACTOR1_ID,
    statusId: status.id,
    path: `fitness/retry-${suffix}.tcx`,
    fileName: `retry-${suffix}.tcx`,
    fileType: 'tcx',
    mimeType: 'application/vnd.garmin.tcx+xml',
    bytes: 1_024
  })
  return { status, file: file! }
}

describe('POST /api/v1/statuses/[id]/retry-fitness', () => {
  const knexInstance = knex({
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: { filename: ':memory:' }
  })
  const database = getSQLDatabase(knexInstance)

  beforeAll(async () => {
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries a file stranded in processing past the stuck threshold', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))

    const { status, file } = await seedFitnessStatus(database, 'stuck')
    await database.updateFitnessFileProcessingStatus(file.id, 'processing')

    // Jump past the threshold so the file looks stranded mid-job.
    vi.setSystemTime(
      new Date(Date.now() + STUCK_PROCESSING_THRESHOLD_MS + 60_000)
    )

    const response = await callRetry(status.id)
    expect(response.status).toBe(200)
    const json = (await response.json()) as { retried: number }
    expect(json.retried).toBe(1)
    expect(getQueue().publish).toHaveBeenCalledTimes(1)

    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('pending')
  })

  it('does not retry a file that is still actively processing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-02-01T00:00:00.000Z'))

    const { status, file } = await seedFitnessStatus(database, 'in-flight')
    await database.updateFitnessFileProcessingStatus(file.id, 'processing')

    // Still well within the threshold — a genuinely in-flight job.
    vi.setSystemTime(new Date(Date.now() + 60_000))

    const response = await callRetry(status.id)
    expect(response.status).toBe(422)
    expect(getQueue().publish).not.toHaveBeenCalled()

    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('processing')
  })

  it('keeps the failure reason when the retry cannot be queued', async () => {
    const { status, file } = await seedFitnessStatus(database, 'rollback')
    await database.updateFitnessFileProcessingStatus(
      file.id,
      'failed',
      'Invalid TCX file structure'
    )
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce(
      new Error('queue unavailable')
    )

    const response = await callRetry(status.id)
    expect(response.status).toBe(500)

    // Resetting to `pending` clears importError; the rollback must put it back,
    // or the reason is destroyed exactly when the retry could not even be sent.
    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('failed')
    expect(refreshed?.importError).toBe('Invalid TCX file structure')
  })

  it('still retries a failed file', async () => {
    const { status, file } = await seedFitnessStatus(database, 'failed')
    await database.updateFitnessFileProcessingStatus(file.id, 'failed')

    const response = await callRetry(status.id)
    expect(response.status).toBe(200)
    const json = (await response.json()) as { retried: number }
    expect(json.retried).toBe(1)

    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('pending')
  })

  it('retries a completed file whose route map failed', async () => {
    const { status, file } = await seedFitnessStatus(database, 'map-failed')
    await database.updateFitnessFileProcessingStatus(file.id, 'completed')
    await database.updateFitnessFileActivityData(file.id, {
      mapError: 'Failed to store generated route map image'
    })

    const response = await callRetry(status.id)
    expect(response.status).toBe(200)
    const json = (await response.json()) as { retried: number }
    expect(json.retried).toBe(1)

    // This endpoint is the retry the post offers its owner for a missing map:
    // the activity itself never failed, so nothing else marks it retriable.
    // It goes to `processing`, not `pending`: that marks the run as in flight
    // (so a second click finds nothing to retry instead of queueing a second
    // job that attaches a second map) and is the one state the staleness check
    // recovers, so a dropped queue message still gets its retry back.
    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('processing')
    expect(refreshed?.mapError).toBe(
      'Failed to store generated route map image'
    )
    // The job is told this is a live activity whose map is the only problem,
    // so a failure in the retry records the reason instead of demoting it.
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fitnessFileId: file.id,
          retryingMapFailure: true
        })
      })
    )
  })

  it('keeps a stuck map retry marked as a map failure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-05-01T00:00:00.000Z'))

    const { status, file } = await seedFitnessStatus(database, 'map-stuck')
    await database.updateFitnessFileActivityData(file.id, {
      mapError: 'tile server down'
    })
    await database.updateFitnessFileProcessingStatus(file.id, 'processing')

    // A map retry parks the file in `processing`; a worker that dies there
    // leaves it stranded. The follow-up retry has to keep saying "this is a map
    // failure", or the job's outer catch demotes a live activity to `failed`.
    vi.setSystemTime(
      new Date(Date.now() + STUCK_PROCESSING_THRESHOLD_MS + 60_000)
    )

    const response = await callRetry(status.id)
    expect(response.status).toBe(200)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retryingMapFailure: true })
      })
    )
  })

  it('does not mark an ordinary failed retry as a map failure', async () => {
    const { status, file } = await seedFitnessStatus(database, 'plain-failed')
    await database.updateFitnessFileProcessingStatus(file.id, 'failed')

    await callRetry(status.id)

    // This one never imported, so a failure in the retry SHOULD keep it failed.
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retryingMapFailure: false })
      })
    )
  })

  it('ignores a second map retry while the first is still in flight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-04-01T00:00:00.000Z'))

    const { status, file } = await seedFitnessStatus(database, 'map-double')
    await database.updateFitnessFileProcessingStatus(file.id, 'completed')
    await database.updateFitnessFileActivityData(file.id, {
      mapError: 'tile server down'
    })

    expect((await callRetry(status.id)).status).toBe(200)

    // A stale tab, or an owner who reloads and clicks again. Without the
    // in-flight marker both requests publish (the queue ids are salted per
    // request), both jobs attach a map, and the post keeps two of them
    // permanently — only one is ever matched for cleanup again.
    vi.setSystemTime(new Date(Date.now() + 5_000))
    expect((await callRetry(status.id)).status).toBe(422)
    expect(getQueue().publish).toHaveBeenCalledTimes(1)
  })

  it('ignores a map failure recorded on a non-primary file', async () => {
    const { status, file } = await seedFitnessStatus(database, 'map-nonprimary')
    await database.updateFitnessFileProcessingStatus(file.id, 'completed')
    await database.updateFitnessFilePrimary(file.id, false)
    await database.updateFitnessFileActivityData(file.id, {
      mapError: 'tile server down'
    })

    // A non-primary file (the second device of a merged same-ride post) must
    // never own the status's map, so a reason left on one is not something to
    // retry — acting on it would attach a second route map on every click.
    const response = await callRetry(status.id)
    expect(response.status).toBe(422)
    expect(getQueue().publish).not.toHaveBeenCalled()
  })

  it('rolls a map-failed file back to completed, not failed, when queueing fails', async () => {
    const { status, file } = await seedFitnessStatus(database, 'map-rollback')
    await database.updateFitnessFileProcessingStatus(file.id, 'completed')
    await database.updateFitnessFileActivityData(file.id, {
      mapError: 'tile server down'
    })
    ;(getQueue().publish as jest.Mock).mockRejectedValueOnce(
      new Error('queue unavailable')
    )

    const response = await callRetry(status.id)
    expect(response.status).toBe(500)

    // Rolling it back to `failed` would hide a perfectly good activity behind
    // every surface gated on `completed`. The reason survives a status write,
    // so the retry the post offers is still there after the queue recovers.
    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('completed')
    expect(refreshed?.mapError).toBe('tile server down')
  })

  it('rejects a retry from someone who does not own the status and queues nothing', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })
    const { status, file } = await seedFitnessStatus(database, 'owner-only')
    await database.updateFitnessFileProcessingStatus(file.id, 'failed')

    const response = await callRetry(status.id)
    expect(response.status).toBe(403)
    expect(getQueue().publish).not.toHaveBeenCalled()

    const refreshed = await database.getFitnessFile({ id: file.id })
    expect(refreshed?.processingStatus).toBe('failed')
  })

  it('retries every failed and stuck-processing file in a status but skips completed ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-03-01T00:00:00.000Z'))

    const status = await database.createNote({
      id: `${ACTOR1_ID}/statuses/retry-fitness-multi`,
      url: `${ACTOR1_ID}/statuses/retry-fitness-multi`,
      actorId: ACTOR1_ID,
      text: 'Fitness activity',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [ACTOR1_FOLLOWER_URL]
    })
    const makeFile = (suffix: string) =>
      database.createFitnessFile({
        actorId: ACTOR1_ID,
        statusId: status.id,
        path: `fitness/multi-${suffix}.tcx`,
        fileName: `multi-${suffix}.tcx`,
        fileType: 'tcx',
        mimeType: 'application/vnd.garmin.tcx+xml',
        bytes: 1_024
      })
    const failed = await makeFile('failed')
    const stuck = await makeFile('stuck')
    const completed = await makeFile('completed')
    await database.updateFitnessFileProcessingStatus(failed!.id, 'failed')
    await database.updateFitnessFileProcessingStatus(stuck!.id, 'processing')
    await database.updateFitnessFileProcessingStatus(completed!.id, 'completed')

    // Age past the threshold so `stuck` is stranded; `completed` stays done.
    vi.setSystemTime(
      new Date(Date.now() + STUCK_PROCESSING_THRESHOLD_MS + 60_000)
    )

    const response = await callRetry(status.id)
    expect(response.status).toBe(200)
    const json = (await response.json()) as { retried: number }
    expect(json.retried).toBe(2)
    expect(getQueue().publish).toHaveBeenCalledTimes(2)

    expect(
      (await database.getFitnessFile({ id: failed!.id }))?.processingStatus
    ).toBe('pending')
    expect(
      (await database.getFitnessFile({ id: stuck!.id }))?.processingStatus
    ).toBe('pending')
    expect(
      (await database.getFitnessFile({ id: completed!.id }))?.processingStatus
    ).toBe('completed')
  })
})
