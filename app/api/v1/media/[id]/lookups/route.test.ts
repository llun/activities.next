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

const takeMock = vi.hoisted(() => vi.fn())
const counterOptions = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/services/gallery/lookups/rateLimit', () => ({
  createWindowCounter: (options: unknown) => {
    counterOptions.push(options)
    return { tryHit: takeMock, reset: vi.fn() }
  }
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
    takeMock.mockReturnValue(true)
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
    // Told it is a retry, so the job skips a remembered provider failure.
    for (const [message] of mockPublish.mock.calls) {
      expect(message.data).toEqual({ mediaId: id, retry: true })
    }
  })

  // On a real queue the job has not run when this answers; the owner must
  // see that the lookup is under way, not the failure they just retried.
  it('marks each re-queued lookup pending before it answers', async () => {
    const id = await createMediaFor(ACTOR1_ID, {
      subjectScientificName: 'Panthera tigris',
      subjectCategory: 'mammal',
      placeLatitude: 14.5,
      placeLongitude: 101.4
    })
    await database.setMediaPlaceLookup({
      mediaId: id,
      expect: { placeLatitude: 14.5, placeLongitude: 101.4 },
      patch: { placeLookupStatus: 'failed' }
    })
    await database.setMediaSubjectLookup({
      mediaId: id,
      expect: {
        subjectName: null,
        subjectScientificName: 'Panthera tigris',
        subjectTaxonKey: null
      },
      patch: { subjectLookupStatus: 'failed' }
    })

    const body = await (await request(id)).json()

    expect(body.details.place).toMatchObject({
      lookupStatus: 'pending',
      lookupStale: false
    })
    expect(body.details.subject).toMatchObject({
      lookupStatus: 'pending',
      lookupStale: false
    })
  })

  it('uses a fresh job id each time, so a retry is not collapsed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const id = await createMediaFor(ACTOR1_ID, {
        placeLatitude: 1,
        placeLongitude: 2
      })

      // Same millisecond: the id must still differ.
      await request(id)
      await request(id)

      const ids = mockPublish.mock.calls.map(([message]) => message.id)
      expect(new Set(ids).size).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  const setLookups = async (
    id: string,
    {
      subject,
      place
    }: {
      subject?: Parameters<typeof database.setMediaSubjectLookup>[0]['patch']
      place?: Parameters<typeof database.setMediaPlaceLookup>[0]['patch']
    }
  ) => {
    const account = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!
    const media = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: account.id
    })
    const details = media!.details!
    if (subject) {
      await database.setMediaSubjectLookup({
        mediaId: id,
        expect: {
          subjectName: details.subjectName,
          subjectScientificName: details.subjectScientificName,
          subjectTaxonKey: details.subjectTaxonKey
        },
        patch: subject
      })
    }
    if (place) {
      await database.setMediaPlaceLookup({
        mediaId: id,
        expect: {
          placeLatitude: details.placeLatitude,
          placeLongitude: details.placeLongitude
        },
        patch: place
      })
    }
  }

  it('queues only the lookups that have not finished', async () => {
    const SPECIES = {
      subjectName: 'Common Kingfisher',
      subjectScientificName: 'Alcedo atthis',
      subjectCategory: 'bird',
      placeLatitude: 14.5,
      placeLongitude: 101.4
    }

    // Subject failed, place resolved: only the subject.
    const subjectFailed = await createMediaFor(ACTOR1_ID, SPECIES)
    await setLookups(subjectFailed, {
      subject: { subjectLookupStatus: 'failed' },
      place: { placeLookupStatus: 'resolved', placeCountryCode: 'TH' }
    })
    await request(subjectFailed)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])

    // Subject cleared, place never looked up (null): only the place.
    mockPublish.mockClear()
    const placeNull = await createMediaFor(ACTOR1_ID, SPECIES)
    await setLookups(placeNull, {
      subject: { subjectLookupStatus: 'resolved', subjectIucnCategory: 'LC' }
    })
    await request(placeNull)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_PLACE_JOB_NAME])

    // Both finished: nothing, and still the details.
    mockPublish.mockClear()
    const finished = await createMediaFor(ACTOR1_ID, SPECIES)
    await setLookups(finished, {
      subject: { subjectLookupStatus: 'resolved', subjectIucnCategory: 'LC' },
      place: { placeLookupStatus: 'no-match' }
    })
    const response = await request(finished)
    expect(response.status).toBe(200)
    expect(mockPublish).not.toHaveBeenCalled()

    // A subject no-match from an earlier build no longer clears the place,
    // so it is asked again; a place no-match is final.
    mockPublish.mockClear()
    const subjectNoMatch = await createMediaFor(ACTOR1_ID, SPECIES)
    await setLookups(subjectNoMatch, {
      subject: { subjectLookupStatus: 'no-match' },
      place: { placeLookupStatus: 'no-match' }
    })
    await request(subjectNoMatch)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])

    // Disabled and pending are retried.
    mockPublish.mockClear()
    const disabled = await createMediaFor(ACTOR1_ID, SPECIES)
    await setLookups(disabled, {
      subject: { subjectLookupStatus: 'disabled' },
      place: { placeLookupStatus: 'disabled' }
    })
    await request(disabled)
    expect(publishedNames().sort()).toEqual(
      [RESOLVE_MEDIA_PLACE_JOB_NAME, RESOLVE_MEDIA_SUBJECT_JOB_NAME].sort()
    )
  })

  it('queues the subject lookup for a subject known only by its taxon key', async () => {
    const id = await createMediaFor(ACTOR1_ID, { subjectTaxonKey: '2475532' })

    await request(id)

    expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])
  })

  it('limits each actor to 20 retries an hour', async () => {
    expect(counterOptions).toEqual([{ limit: 20, windowMs: 60 * 60 * 1000 }])

    takeMock.mockReturnValue(false)
    const id = await createMediaFor(ACTOR1_ID, {
      placeLatitude: 1,
      placeLongitude: 2
    })

    const response = await request(id)

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'Too many requests' })
    expect(mockPublish).not.toHaveBeenCalled()
    expect(takeMock).toHaveBeenCalledWith(ACTOR1_ID)
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
      subjectName: 'Otter',
      subjectCategory: 'mammal'
    })
    await request(subjectOnly)
    expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])

    // A landscape is not species-like: nothing to check.
    mockPublish.mockClear()
    const landscape = await createMediaFor(ACTOR1_ID, {
      subjectName: 'Doi Suthep',
      subjectCategory: 'landscape'
    })
    await request(landscape)
    expect(mockPublish).not.toHaveBeenCalled()

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
