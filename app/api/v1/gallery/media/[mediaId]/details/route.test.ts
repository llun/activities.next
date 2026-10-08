import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { seedActor3 } from '@/lib/stub/seed/actor3'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { GET } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined })
}))

vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('GET /api/v1/gallery/media/[mediaId]/details', () => {
  const { database, prepare } = getTestDatabaseWithInstance()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    await database.createFollow({
      actorId: ACTOR2_ID,
      targetActorId: ACTOR1_ID,
      inbox: `${ACTOR1_ID}/inbox`,
      sharedInbox: `https://${TEST_DOMAIN}/inbox`,
      status: FollowStatus.enum.Accepted
    })
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      showGear: true,
      hiddenLocations: []
    })
  })

  const defaultDetails: Partial<MediaDetailsRecord> = {
    subjectName: 'Common Kingfisher',
    subjectScientificName: 'Alcedo atthis',
    subjectCategory: 'bird',
    takenAt: Date.UTC(2024, 4, 6, 7, 8, 9),
    exposure: { iso: 800, exposureTime: '1/2000' },
    placeName: 'Lea Valley',
    placeLatitude: 51.5543,
    placeLongitude: -0.0731,
    placePrecision: 'area',
    inGallery: true
  }

  // A media owned by ACTOR1, optionally attached to a new status addressed to
  // `to`.
  let counter = 0
  const createMedia = async ({
    to,
    details = {}
  }: {
    to?: string[]
    details?: Partial<MediaDetailsRecord>
  }) => {
    counter += 1
    const camera = await database.createGalleryGear({
      actorId: ACTOR1_ID,
      kind: 'camera',
      name: `Canon EOS R5 #${counter}`
    })
    const lens = await database.createGalleryGear({
      actorId: ACTOR1_ID,
      kind: 'lens',
      name: `RF100-500mm #${counter}`
    })
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/gallery-details-${counter}.jpg`,
        bytes: 10,
        mimeType: 'image/jpeg',
        metaData: { width: 10, height: 10 }
      },
      details: {
        ...defaultDetails,
        cameraGearId: camera.id,
        lensGearId: lens.id,
        ...details
      }
    })
    if (to) {
      const statusId = `${ACTOR1_ID}/statuses/gallery-details-${counter}`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: ACTOR1_ID,
        text: 'A photo',
        to,
        cc: []
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: media!.original.path,
        mediaId: media!.id
      })
    }
    return { id: media!.id, camera, lens }
  }

  const request = (mediaId: string) =>
    GET(
      new NextRequest(
        `https://llun.test/api/v1/gallery/media/${mediaId}/details`
      ),
      { params: Promise.resolve({ mediaId }) }
    )

  const signInAs = (email: string | null) =>
    mockGetServerSession.mockResolvedValue(email ? { user: { email } } : null)

  it('returns the public-safe details of a photo on a public post', async () => {
    const { id, camera, lens } = await createMedia({
      to: [ACTIVITY_STREAM_PUBLIC]
    })

    const response = await request(id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      subject: {
        name: 'Common Kingfisher',
        scientificName: 'Alcedo atthis',
        category: 'bird'
      },
      takenAt: '2024-05-06T07:08:09.000Z',
      camera: { name: camera.name },
      lens: { name: lens.name },
      exposure: {
        focalLengthMm: null,
        aperture: null,
        exposureTime: '1/2000',
        iso: 800
      },
      // `area`: snapped to the 0.05 degree grid, not the stored coordinates.
      place: {
        name: 'Lea Valley',
        precision: 'area',
        latitude: 51.55,
        longitude: -0.05
      }
    })
  })

  it.each([
    ['exact', { latitude: 51.5543, longitude: -0.0731 }],
    ['area', { latitude: 51.55, longitude: -0.05 }],
    ['country', {}]
  ] as const)(
    'discloses coordinates for %s precision as %j',
    async (placePrecision, coordinates) => {
      const { id } = await createMedia({
        to: [ACTIVITY_STREAM_PUBLIC],
        details: { placePrecision }
      })

      const { place } = await (await request(id)).json()

      expect(place).toEqual({
        name: 'Lea Valley',
        precision: placePrecision,
        ...coordinates
      })
    }
  )

  it('returns no place for a hidden one', async () => {
    const { id } = await createMedia({
      to: [ACTIVITY_STREAM_PUBLIC],
      details: { placePrecision: 'hidden' }
    })

    expect((await (await request(id)).json()).place).toBeNull()
  })

  it.each([
    ['the stored point', { latitude: 51.5543, longitude: -0.0731 }, 'exact'],
    ['the stored point', { latitude: 51.5543, longitude: -0.0731 }, 'country'],
    // About 1.7 km from the stored point, around its 0.05 degree cell centre.
    ['only the snapped point', { latitude: 51.55, longitude: -0.05 }, 'area']
  ] as const)(
    'returns no place when a hidden location covers %s of an %s place',
    async (_, centre, placePrecision) => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        hiddenLocations: [{ ...centre, hideRadiusMeters: 500 }]
      })
      const { id } = await createMedia({
        to: [ACTIVITY_STREAM_PUBLIC],
        details: { placePrecision }
      })

      const body = await (await request(id)).json()

      expect(body.place).toBeNull()
      expect(body.subject).toMatchObject({ name: 'Common Kingfisher' })
    }
  )

  it('keeps the place when the hidden location is elsewhere', async () => {
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      hiddenLocations: [
        { latitude: 40.7, longitude: -74, hideRadiusMeters: 1000 }
      ]
    })
    const { id } = await createMedia({
      to: [ACTIVITY_STREAM_PUBLIC],
      details: { placePrecision: 'exact' }
    })

    expect((await (await request(id)).json()).place).toEqual({
      name: 'Lea Valley',
      precision: 'exact',
      latitude: 51.5543,
      longitude: -0.0731
    })
  })

  it('withholds gear and exposure when the owner hides gear', async () => {
    await database.updateGallerySettings({
      actorId: ACTOR1_ID,
      showGear: false
    })
    const { id } = await createMedia({ to: [ACTIVITY_STREAM_PUBLIC] })

    expect(await (await request(id)).json()).toMatchObject({
      camera: null,
      lens: null,
      exposure: null,
      subject: { name: 'Common Kingfisher' }
    })
  })

  describe('visibility of the post', () => {
    const followersOnly = [`${ACTOR1_ID}/followers`]

    it.each([
      ['anonymous', null, 404],
      ['a signed-in non-follower', seedActor3.email, 404],
      ['a follower', seedActor2.email, 200],
      ['the author', seedActor1.email, 200]
    ])(
      'answers %s on a followers-only post with %i',
      async (_, email, status) => {
        signInAs(email)
        const { id } = await createMedia({ to: followersOnly })

        expect((await request(id)).status).toBe(status)
      }
    )

    it.each([
      ['anonymous', null, 404],
      ['a follower', seedActor2.email, 404],
      ['the author', seedActor1.email, 200]
    ])('answers %s on a direct post with %i', async (_, email, status) => {
      signInAs(email)
      const { id } = await createMedia({ to: [ACTOR2_ID + '/nobody'] })

      expect((await request(id)).status).toBe(status)
    })

    it('does not leak the difference between private and missing media', async () => {
      const { id } = await createMedia({ to: followersOnly })

      const privateResponse = await request(id)
      const missingResponse = await request('987654321')

      expect(privateResponse.status).toBe(404)
      expect(await privateResponse.json()).toEqual(await missingResponse.json())
    })

    it('answers 404 for media that is not attached to any post', async () => {
      const { id } = await createMedia({})

      expect((await request(id)).status).toBe(404)
    })

    it('reads the media through whichever attached post the viewer may see', async () => {
      const { id } = await createMedia({ to: followersOnly })
      const publicStatusId = `${ACTOR1_ID}/statuses/gallery-details-redraft`
      await database.createNote({
        id: publicStatusId,
        url: publicStatusId,
        actorId: ACTOR1_ID,
        text: 'Public again',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId: publicStatusId,
        mediaType: 'image/jpeg',
        url: 'medias/redraft.jpg',
        mediaId: id
      })

      expect((await request(id)).status).toBe(200)
    })

    it("answers 404 when only another actor's public post points at the media", async () => {
      // ACTOR1's media sits in a followers-only post; ACTOR2 writes a public
      // post whose attachment carries ACTOR1's media id. That attachment is not
      // evidence ACTOR1 published the photo, so it must not unlock its details.
      const { id } = await createMedia({ to: followersOnly })
      const attackerStatusId = `${ACTOR2_ID}/statuses/gallery-details-foreign`
      await database.createNote({
        id: attackerStatusId,
        url: attackerStatusId,
        actorId: ACTOR2_ID,
        text: 'Not my photo',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await database.createAttachment({
        actorId: ACTOR2_ID,
        statusId: attackerStatusId,
        mediaType: 'image/jpeg',
        url: 'x',
        mediaId: id
      })

      const response = await request(id)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual(
        await (await request('987654321')).json()
      )
    })
  })

  it.each(['abc', '0', '-1', '1.5', '2147483648', '1e3'])(
    'answers 404 for the malformed media id %j',
    async (mediaId) => {
      expect((await request(mediaId)).status).toBe(404)
    }
  )

  it('never returns the stored ids, the gallery flag or the owner', async () => {
    const { id, camera } = await createMedia({ to: [ACTIVITY_STREAM_PUBLIC] })

    const text = JSON.stringify(await (await request(id)).json())

    expect(text).not.toContain(camera.id)
    expect(text).not.toContain('inGallery')
    expect(text).not.toContain(ACTOR1_ID)
  })
})
