import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { RESOLVE_MEDIA_PLACE_JOB_NAME } from '@/lib/jobs/names'
import { getOwnerMediaAttachment } from '@/lib/services/medias/mediaDetails'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { POST } from './route'

const mockGetServerSession = vi.fn()
const mockStoredToken = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase,
  getKnex: () => () => ({
    where: () => ({
      first: () => mockStoredToken()
    })
  })
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
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

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

const mockSaveMedia = vi.fn()
vi.mock('@/lib/services/medias', () => ({
  saveMedia: (...args: unknown[]) => mockSaveMedia(...args)
}))

const sampleAttachment = {
  id: '7',
  type: 'image',
  mime_type: 'image/png',
  url: 'https://llun.test/api/v1/files/medias/sample.webp',
  preview_url: 'https://llun.test/api/v1/files/medias/sample.webp',
  text_url: null,
  remote_url: null,
  meta: { original: { width: 1, height: 1, size: '1x1', aspect: 1 } },
  description: '',
  blurhash: null
}

const buildForm = () => {
  const form = new FormData()
  form.set(
    'file',
    new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' })
  )
  return form
}

const postRequest = (token?: string) => {
  const req = new NextRequest('https://llun.test/api/v1/media', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  // jest / undici cannot materialise a multipart body from a FormData passed to
  // NextRequest — mock formData() directly (see update_credentials route test).
  Object.defineProperty(req, 'formData', {
    value: vi.fn().mockResolvedValue(buildForm())
  })
  return req
}

describe('POST /api/v1/media', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue(null)
    mockSaveMedia.mockResolvedValue(sampleAttachment)
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    await database.deleteServerSetting({ key: 'media.maxFileSize' })
    invalidateServerSettingsCache(database)
  })

  it('returns 200 with a fully-processed attachment for write:media tokens', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })

    const response = await POST(postRequest('write-media-token'), {
      params: Promise.resolve({})
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id: '7', type: 'image', blurhash: null })
    expect(mockSaveMedia).toHaveBeenCalledTimes(1)
  })

  describe('place lookup', () => {
    const withPlace = (latitude: number | null, longitude: number | null) => ({
      ...sampleAttachment,
      details: {
        subject: null,
        takenAt: null,
        camera: null,
        lens: null,
        exposure: null,
        place: { name: null, latitude, longitude, precision: 'hidden' },
        inGallery: false
      }
    })

    beforeEach(() => {
      mockStoredToken.mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        referenceId: ACTOR1_ID,
        scopes: 'write:media'
      })
    })

    it('queues it after the upload when the photo has coordinates, even at hidden precision', async () => {
      mockSaveMedia.mockResolvedValue(withPlace(14.5347, 101.3912))

      const response = await POST(postRequest('write-media-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith({
        id: expect.stringMatching(/^[0-9a-f]{64}$/),
        name: RESOLVE_MEDIA_PLACE_JOB_NAME,
        data: { mediaId: '7' }
      })
    })

    it.each([
      ['no details', sampleAttachment],
      ['no place', { ...withPlace(1, 1), details: { place: null } }],
      ['no coordinates', withPlace(null, null)]
    ])('queues nothing for %s', async (_label, attachment) => {
      mockSaveMedia.mockResolvedValue(attachment)

      const response = await POST(postRequest('write-media-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(mockPublish).not.toHaveBeenCalled()
    })

    // The upload's details, as the owner's dialog will first see them: the
    // lookup is `pending` while it is queued, and what the job wrote once it
    // has run inline (NoQueue). Never the null "hasn't been looked up" that
    // offered a Retry for a lookup already under way.
    describe('the upload’s place status', () => {
      const uploadRealMedia = () =>
        mockSaveMedia.mockImplementation(async () => {
          const media = await database.createMedia({
            actorId: ACTOR1_ID,
            original: {
              path: `medias/upload-${Math.random()}`,
              bytes: 3,
              mimeType: 'image/png',
              metaData: { width: 1, height: 1 }
            },
            details: {
              placeLatitude: 14.5347,
              placeLongitude: 101.3912,
              placePrecision: 'hidden'
            }
          })
          return getOwnerMediaAttachment(database, media!, 'llun.test')
        })

      it('is pending while the lookup is queued', async () => {
        uploadRealMedia()

        const response = await POST(postRequest('write-media-token'), {
          params: Promise.resolve({})
        })

        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect((await response.json()).details.place).toMatchObject({
          lookupStatus: 'pending',
          lookupStale: false
        })
      })

      it('is the job’s result when the lookup ran inline', async () => {
        uploadRealMedia()
        const statuses: (string | null)[] = []
        mockPublish.mockImplementation(async ({ data }) => {
          const before = await database.getMediaByIdForAccount({
            mediaId: data.mediaId,
            accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!
              .account!.id
          })
          statuses.push(before?.details?.placeLookupStatus ?? null)
          // What ResolveMediaPlaceJob writes for this cell.
          await database.setMediaPlaceLookup({
            mediaId: data.mediaId,
            expect: { placeLatitude: 14.5347, placeLongitude: 101.3912 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'TH',
              placeName: 'Pak Chong, Thailand'
            }
          })
        })

        const response = await POST(postRequest('write-media-token'), {
          params: Promise.resolve({})
        })
        const place = (await response.json()).details.place
        statuses.push(place.lookupStatus)

        expect(statuses).toEqual(['pending', 'resolved'])
        expect(place).toMatchObject({
          name: 'Pak Chong, Thailand',
          countryCode: 'TH',
          nameSource: 'geocoder'
        })
      })
    })

    it('still answers 200 with the attachment when the queue fails', async () => {
      mockSaveMedia.mockResolvedValue(withPlace(14.5347, 101.3912))
      mockPublish.mockRejectedValue(new Error('queue down'))

      const response = await POST(postRequest('write-media-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ id: '7' })
    })
  })

  it('accepts a 1500-character description and forwards it to saveMedia', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    const longDescription = 'a'.repeat(1500)
    const form = buildForm()
    form.set('description', longDescription)
    const req = new NextRequest('https://llun.test/api/v1/media', {
      method: 'POST',
      headers: { Authorization: 'Bearer write-media-token' }
    })
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await POST(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(200)
    const media = mockSaveMedia.mock.calls[0][2]
    expect(media.description).toBe(longDescription)
    // The user upload path is the only one that builds gallery details.
    expect(mockSaveMedia.mock.calls[0][3]).toEqual({
      withGalleryDetails: true
    })
  })

  it.each([
    {
      description: 'rejects a file over the admin-configured media.maxFileSize',
      maxFileSize: 2,
      expectedStatus: 422,
      expectedSaveCalls: 0
    },
    {
      description:
        'accepts a file within the admin-configured media.maxFileSize',
      maxFileSize: 3,
      expectedStatus: 200,
      expectedSaveCalls: 1
    }
  ])(
    '$description',
    async ({ maxFileSize, expectedStatus, expectedSaveCalls }) => {
      mockStoredToken.mockResolvedValue({
        expiresAt: new Date(Date.now() + 60_000),
        referenceId: ACTOR1_ID,
        scopes: 'write:media'
      })
      // The sample upload is 3 bytes.
      await database.setServerSettings([
        { key: 'media.maxFileSize', value: maxFileSize }
      ])
      invalidateServerSettingsCache(database)

      const response = await POST(postRequest('write-media-token'), {
        params: Promise.resolve({})
      })

      expect(response.status).toBe(expectedStatus)
      expect(mockSaveMedia).toHaveBeenCalledTimes(expectedSaveCalls)
    }
  )

  it('returns 422 when the description exceeds 1500 characters', async () => {
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    const form = buildForm()
    form.set('description', 'a'.repeat(1501))
    const req = new NextRequest('https://llun.test/api/v1/media', {
      method: 'POST',
      headers: { Authorization: 'Bearer write-media-token' }
    })
    Object.defineProperty(req, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await POST(req, { params: Promise.resolve({}) })

    expect(response.status).toBe(422)
    expect(mockSaveMedia).not.toHaveBeenCalled()
  })
})
