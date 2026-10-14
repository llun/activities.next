import { NextRequest } from 'next/server'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import type { Database } from '@/lib/database/types'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    allowEmails: []
  })
}))

let mockDatabase: Database | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: mockPublish, runsInline: false })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: () => undefined
  })
}))

describe('POST /api/v1/fitness-files/[id]/primary', () => {
  const { database, prepare } = createTestDatabase()
  let slugCounter = 0

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const post = (
    id: string,
    headers: Record<string, string> = { Origin: 'https://llun.test' }
  ) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/fitness-files/${id}/primary`, {
        method: 'POST',
        headers
      }),
      { params: Promise.resolve({ id }) }
    )

  const createStatus = async () => {
    slugCounter += 1
    const statusId = `${ACTOR1_ID}/statuses/route-make-primary-${slugCounter}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Merged ride',
      to: [],
      cc: []
    })
    return statusId
  }

  const createRecording = async ({
    statusId,
    slug,
    isPrimary,
    processingStatus = 'completed',
    actorId = ACTOR1_ID
  }: {
    statusId?: string
    slug: string
    isPrimary: boolean
    processingStatus?: 'pending' | 'processing' | 'completed' | 'failed'
    actorId?: string
  }) => {
    const file = await database.createFitnessFile({
      actorId,
      statusId,
      path: `fitness/route-make-primary-${slug}.fit`,
      fileName: `route-make-primary-${slug}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 10
    })
    await database.updateFitnessFileProcessingStatus(file!.id, processingStatus)
    if (!isPrimary) await database.updateFitnessFilePrimary(file!.id, false)
    return file!
  }

  const createPair = async () => {
    const statusId = await createStatus()
    const oldPrimary = await createRecording({
      statusId,
      slug: `old-${slugCounter}`,
      isPrimary: true
    })
    const chosen = await createRecording({
      statusId,
      slug: `chosen-${slugCounter}`,
      isPrimary: false
    })
    return { statusId, oldPrimary, chosen }
  }

  const flags = async (...ids: string[]) =>
    Promise.all(
      ids.map(async (id) => (await database.getFitnessFile({ id }))?.isPrimary)
    )

  it('swaps the primary flag and answers with the new primary', async () => {
    const { oldPrimary, chosen } = await createPair()

    const response = await post(chosen.id)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: chosen.id,
      isPrimary: true,
      fileName: chosen.fileName
    })
    expect(await flags(oldPrimary.id, chosen.id)).toEqual([false, true])
  })

  it('copies the old primary’s gear and names it in the response', async () => {
    const { oldPrimary, chosen } = await createPair()
    const gear = await database.createFitnessGear({
      actorId: ACTOR1_ID,
      kind: 'bike',
      name: 'Route bike'
    })
    await database.setFitnessFileGear({
      fitnessFileId: oldPrimary.id,
      actorId: ACTOR1_ID,
      gearId: gear.id
    })

    const response = await post(chosen.id)

    expect(await response.json()).toMatchObject({
      id: chosen.id,
      gearId: gear.id,
      gearName: 'Route bike'
    })
    expect((await database.getFitnessFile({ id: chosen.id }))?.gearId).toBe(
      gear.id
    )
  })

  it('moves the generated route map pointers to the new primary', async () => {
    const { oldPrimary, chosen } = await createPair()
    await database.updateFitnessFileActivityData(oldPrimary.id, {
      hasMapData: true,
      mapImagePath: 'medias/route-old.webp',
      mapImageEmailPath: 'medias/route-old.jpg'
    })

    await post(chosen.id)

    expect(await database.getFitnessFile({ id: chosen.id })).toMatchObject({
      hasMapData: true,
      mapImagePath: 'medias/route-old.webp',
      mapImageEmailPath: 'medias/route-old.jpg'
    })
    expect(await database.getFitnessFile({ id: oldPrimary.id })).toMatchObject({
      hasMapData: false
    })
    expect(
      (await database.getFitnessFile({ id: oldPrimary.id }))?.mapImagePath
    ).toBeUndefined()
  })

  it('queues the processing job for the new primary once the swap is committed', async () => {
    const { statusId, oldPrimary, chosen } = await createPair()
    let flagsWhenPublished: Array<boolean | undefined> = []
    mockPublish.mockImplementation(async () => {
      flagsWhenPublished = await flags(oldPrimary.id, chosen.id)
    })

    await post(chosen.id)

    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish).toHaveBeenCalledWith({
      id: expect.stringMatching(/^[0-9a-f]{64}$/),
      name: PROCESS_FITNESS_FILE_JOB_NAME,
      data: {
        actorId: ACTOR1_ID,
        statusId,
        fitnessFileId: chosen.id,
        publishSendNote: false,
        notifyOnComplete: false,
        retryingMapFailure: true
      }
    })
    // The job reads the file's flag, so it must already be primary by then.
    expect(flagsWhenPublished).toEqual([false, true])
    // Not the id the import used, or a queue that dedupes on it would drop this.
    expect(mockPublish.mock.calls[0][0].id).not.toBe(
      getHashFromString(`${statusId}:${chosen.id}:process-fitness`)
    )
  })

  it('gives each promotion of the same file a job id of its own', async () => {
    const { oldPrimary, chosen } = await createPair()
    vi.useFakeTimers({ toFake: ['Date'] })

    vi.setSystemTime(new Date('2026-06-01T10:00:00Z'))
    await post(chosen.id)
    await post(oldPrimary.id)
    vi.setSystemTime(new Date('2026-06-01T10:05:00Z'))
    await post(chosen.id)

    const chosenJobIds = mockPublish.mock.calls
      .map(([job]) => job)
      .filter((job) => job.data.fitnessFileId === chosen.id)
      .map((job) => job.id)
    expect(chosenJobIds).toHaveLength(2)
    expect(new Set(chosenJobIds).size).toBe(2)
  })

  it('answers 200 for the file that already is the primary and queues nothing', async () => {
    const { oldPrimary, chosen } = await createPair()

    const response = await post(oldPrimary.id)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: oldPrimary.id,
      isPrimary: true
    })
    expect(await flags(oldPrimary.id, chosen.id)).toEqual([true, false])
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('keeps the swap and records a map failure when the job cannot be queued', async () => {
    const { oldPrimary, chosen } = await createPair()
    mockPublish.mockRejectedValue(new Error('queue down'))
    const errorSpy = vi.spyOn(logger, 'error')

    const response = await post(chosen.id)

    expect(response.status).toBe(200)
    expect(await flags(oldPrimary.id, chosen.id)).toEqual([false, true])
    // A `completed` primary with a `mapError` is what the post offers a retry
    // for, so the owner is not left with the old file's map and no way out.
    expect(await database.getFitnessFile({ id: chosen.id })).toMatchObject({
      processingStatus: 'completed',
      mapError: 'Failed to queue the route map update'
    })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to queue processing for the new primary file',
        err: expect.any(Object)
      })
    )
  })

  it('answers 404 for someone else’s recording and changes nothing', async () => {
    const { oldPrimary, chosen } = await createPair()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor2.email }
    })

    const response = await post(chosen.id)

    expect(response.status).toBe(404)
    expect(await flags(oldPrimary.id, chosen.id)).toEqual([true, false])
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown recording', async () => {
    expect((await post('no-such-file')).status).toBe(404)
  })

  it('answers 404 for a deleted recording', async () => {
    const { chosen } = await createPair()
    await database.deleteFitnessFile({ id: chosen.id })

    expect((await post(chosen.id)).status).toBe(404)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('answers 404 for a recording with no status', async () => {
    const lone = await createRecording({ slug: 'lone', isPrimary: true })

    expect((await post(lone.id)).status).toBe(404)
  })

  it('answers 404 for another actor’s recording even when it has a status', async () => {
    const statusId = await createStatus()
    const theirs = await createRecording({
      statusId,
      slug: 'theirs',
      isPrimary: false,
      actorId: ACTOR2_ID
    })

    expect((await post(theirs.id)).status).toBe(404)
    expect(await flags(theirs.id)).toEqual([false])
  })

  it.each(['pending', 'processing', 'failed'] as const)(
    'answers 422 for a recording that is %s',
    async (processingStatus) => {
      const statusId = await createStatus()
      const primary = await createRecording({
        statusId,
        slug: `unusable-primary-${processingStatus}`,
        isPrimary: true
      })
      const chosen = await createRecording({
        statusId,
        slug: `unusable-${processingStatus}`,
        isPrimary: false,
        processingStatus
      })

      const response = await post(chosen.id)

      expect(response.status).toBe(422)
      expect(await flags(primary.id, chosen.id)).toEqual([true, false])
      expect(mockPublish).not.toHaveBeenCalled()
    }
  )

  it('answers 422 while the current primary is still being processed', async () => {
    const statusId = await createStatus()
    const primary = await createRecording({
      statusId,
      slug: 'busy-primary',
      isPrimary: true,
      processingStatus: 'processing'
    })
    const chosen = await createRecording({
      statusId,
      slug: 'busy-chosen',
      isPrimary: false
    })

    expect((await post(chosen.id)).status).toBe(422)
    expect(await flags(primary.id, chosen.id)).toEqual([true, false])
  })

  it('rejects a cross-site request before looking at the session', async () => {
    const { chosen } = await createPair()

    const response = await post(chosen.id, { Origin: 'https://evil.example' })

    expect(response.status).toBe(403)
    expect(mockGetServerSession).not.toHaveBeenCalled()
  })

  it('redirects a signed-out caller to sign in', async () => {
    const { chosen } = await createPair()
    mockGetServerSession.mockResolvedValue(null)

    const response = await post(chosen.id)

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toContain('/auth/signin')
  })
})
