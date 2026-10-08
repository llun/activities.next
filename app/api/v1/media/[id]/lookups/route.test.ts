import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  RESOLVE_MEDIA_PLACE_JOB_NAME,
  RESOLVE_MEDIA_SUBJECT_JOB_NAME
} from '@/lib/jobs/names'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { POST } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({ where: () => ({ first: () => null }) })
}))

vi.mock('next/headers', () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) })
}))

vi.mock('better-auth/oauth2', () => ({ verifyBearerToken: vi.fn() }))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

// The jobs are only published here; none runs.
const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

describe('POST /api/v1/media/[id]/lookups', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

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
    mockPublish.mockResolvedValue(undefined)
  })

  let counter = 0
  const createMediaFor = async (
    actorId: string,
    details?: Record<string, unknown>
  ) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/lookups-${counter}`,
        bytes: 100,
        mimeType: 'image/jpeg',
        metaData: { width: 10, height: 10 }
      },
      ...(details ? { details } : {})
    })
    return media!.id
  }

  const request = (id: string) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/lookups`, {
        method: 'POST',
        headers: { origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id }) }
    )

  const publishedNames = () =>
    mockPublish.mock.calls.map(([message]) => message.name)

  it('queues both lookups again and answers the owner details', async () => {
    const id = await createMediaFor(ACTOR1_ID, {
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      placeLatitude: 14.5347,
      placeLongitude: 101.3912,
      placePrecision: 'area'
    })

    const response = await request(id)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.details).toMatchObject({
      subject: { scientificName: 'Alcedo atthis' },
      place: { latitude: 14.5347, longitude: 101.3912 }
    })
    expect(publishedNames().sort()).toEqual(
      [RESOLVE_MEDIA_PLACE_JOB_NAME, RESOLVE_MEDIA_SUBJECT_JOB_NAME].sort()
    )
    for (const [message] of mockPublish.mock.calls) {
      expect(message.data).toEqual({ mediaId: id })
    }
  })

  it('uses a fresh job id each time, so a retry is not collapsed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const id = await createMediaFor(ACTOR1_ID, {
        placeLatitude: 1,
        placeLongitude: 2
      })

      await request(id)
      vi.advanceTimersByTime(5)
      await request(id)

      const ids = mockPublish.mock.calls.map(([message]) => message.id)
      expect(new Set(ids).size).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues only what the media has', async () => {
    const placeOnly = await createMediaFor(ACTOR1_ID, {
      placeLatitude: 1,
      placeLongitude: 2
    })
    await request(placeOnly)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_PLACE_JOB_NAME])

    mockPublish.mockClear()
    const subjectOnly = await createMediaFor(ACTOR1_ID, {
      subjectName: 'Otter'
    })
    await request(subjectOnly)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])

    mockPublish.mockClear()
    const neither = await createMediaFor(ACTOR1_ID)
    const response = await request(neither)
    expect(response.status).toBe(200)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('answers 404 for another account’s media and queues nothing', async () => {
    const id = await createMediaFor(ACTOR2_ID, {
      placeLatitude: 1,
      placeLongitude: 2
    })

    expect((await request(id)).status).toBe(404)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it.each(['999999999', 'abc', '1.5'])(
    'answers 404 for the id %j',
    async (id) => {
      expect((await request(id)).status).toBe(404)
    }
  )

  it('still answers 200 when the queue fails', async () => {
    mockPublish.mockRejectedValue(new Error('queue down'))
    const id = await createMediaFor(ACTOR1_ID, {
      placeLatitude: 1,
      placeLongitude: 2
    })

    expect((await request(id)).status).toBe(200)
  })
})
