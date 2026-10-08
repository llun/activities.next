import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  RESOLVE_MEDIA_PLACE_JOB_NAME,
  RESOLVE_MEDIA_SUBJECT_JOB_NAME
} from '@/lib/jobs/names'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import iucnLeastConcern from '@/lib/services/gallery/lookups/__fixtures__/gbif-iucn-lc.json'
import taxonPandaOleosa from '@/lib/services/gallery/lookups/__fixtures__/gbif-taxon-panda-oleosa.json'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { DatabaseQueue } from '@/lib/services/queue/database'
import { invalidateServerSettingsCache } from '@/lib/services/serverSettings'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

import { DELETE, GET, PATCH, PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

const mockSaveMediaThumbnail = vi.fn()
const mockDeleteMediaFile = vi.fn()
vi.mock('@/lib/services/medias', () => ({
  saveMediaThumbnail: (...args: unknown[]) => mockSaveMediaThumbnail(...args),
  deleteMediaFile: (...args: unknown[]) => mockDeleteMediaFile(...args)
}))

// Lookups are published as jobs after an update; no job runs in this suite.
const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
const mockStoredToken = vi.fn()
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
    secretPhase: 'test-secret',
    languages: ['en'],
    gallery: { gbif: { endpoint: 'https://gbif.test/v1' } }
  })
}))

// GBIF, for the one test that runs the subject job the PUT queues: served
// from the recorded fixtures, never the network.
const gbifAnswers = new Map<string, { statusCode: number; body: unknown }>()
vi.mock('@/lib/utils/safeRemoteFetch', () => ({
  safeRemoteFetch: async ({ url }: { url: string }) => {
    const answer = gbifAnswers.get(new URL(url).pathname) ?? {
      statusCode: 404,
      body: '<!DOCTYPE html><html></html>'
    }
    return {
      body: JSON.stringify(answer.body),
      bodyTruncated: false,
      headers: {},
      statusCode: answer.statusCode,
      url
    }
  }
}))

describe('/api/v1/media/[id]', () => {
  // `getTestDatabaseWithInstance` honours TEST_DATABASE_TYPE; the SQLite-only
  // `getTestSQLDatabase` does not, so under `TEST_DATABASE_TYPE=pg` this suite
  // used to report a clean pass having never opened a PostgreSQL connection.
  // It has to run on PostgreSQL for the malformed-id cases below to mean
  // anything: `medias.id` is an integer column there, so a bad id is an error
  // rather than a miss unless the query layer rejects it first.
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

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockStoredToken.mockResolvedValue(null)
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
    await database.deleteServerSetting({ key: 'media.maxFileSize' })
    invalidateServerSettingsCache(database)
  })

  const createMediaFor = async (actorId: string, name: string) => {
    const media = await database.createMedia({
      actorId,
      description: 'before',
      original: {
        path: `medias/route-${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    })
    // Route params always arrive as strings; normalise to mirror production.
    return String(media!.id)
  }

  const putRequest = (id: string, body: Record<string, unknown>) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      // Same-origin proof for the cookie-session path (CSRF protection); bearer
      // clients bypass this in OAuthGuard.
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  const patchRequest = (id: string, body: Record<string, unknown>) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'https://llun.test'
      },
      body: JSON.stringify(body)
    })

  const deleteRequest = (id: string) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'DELETE',
      headers: { origin: 'https://llun.test' }
    })

  const getRequest = (id: string) =>
    new NextRequest(`https://llun.test/api/v1/media/${id}`)

  it('GET returns the media attachment for the owner', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'get-owner')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({
      id,
      type: 'image',
      description: 'before',
      url: `https://llun.test/api/v1/files/medias/route-get-owner.jpg`
    })
  })

  it('GET returns blurhash for media that has blurhash', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      description: 'before',
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      original: {
        path: 'medias/route-blurhash.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    })
    const id = String(media!.id)

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
  })

  it('GET returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'get-foreign')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
  })

  // The user-visible half of the integer-column bug: `medias.id` is an
  // `integer` on PostgreSQL, so before the query layer coerced these each verb
  // raised `invalid input syntax for type integer` and the route answered 500
  // instead of 404. These only exercise that under `TEST_DATABASE_TYPE=pg` —
  // on SQLite a malformed id has always simply missed.
  describe.each([
    { description: 'a non-numeric id', id: 'abc' },
    { description: 'a fractional id', id: '1.5' },
    { description: 'an exponential id', id: '1e21' },
    { description: 'an id past the integer max', id: '2147483648' }
  ])('$description', ({ id }) => {
    it('GET returns 404', async () => {
      const response = await GET(getRequest(id), {
        params: Promise.resolve({ id })
      })
      expect(response.status).toBe(404)
    })

    it('PUT returns 404', async () => {
      const response = await PUT(putRequest(id, { description: 'nope' }), {
        params: Promise.resolve({ id })
      })
      expect(response.status).toBe(404)
    })

    it('DELETE returns 404', async () => {
      const response = await DELETE(deleteRequest(id), {
        params: Promise.resolve({ id })
      })
      expect(response.status).toBe(404)
    })
  })

  it('GET accepts a bearer token with write:media scope', async () => {
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'write:media'
    })
    const id = await createMediaFor(ACTOR1_ID, 'get-bearer-ok')

    const response = await GET(
      new NextRequest(`https://llun.test/api/v1/media/${id}`, {
        headers: { Authorization: 'Bearer write-media-token' }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
  })

  it('GET rejects a bearer token that only has the read scope', async () => {
    mockGetServerSession.mockResolvedValue(null)
    mockStoredToken.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      referenceId: ACTOR1_ID,
      scopes: 'read'
    })
    const id = await createMediaFor(ACTOR1_ID, 'get-bearer-read')

    const response = await GET(
      new NextRequest(`https://llun.test/api/v1/media/${id}`, {
        headers: { Authorization: 'Bearer read-only-token' }
      }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(401)
  })

  it('PUT updates the description', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-update')

    const response = await PUT(
      putRequest(id, { description: 'a new alt text' }),
      {
        params: Promise.resolve({ id })
      }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id, description: 'a new alt text' })

    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.description).toBe('a new alt text')
  })

  it('PUT clears the description when null is sent', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-clear')

    const response = await PUT(putRequest(id, { description: null }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.description).toBeNull()
  })

  it('PUT leaves the description untouched when not provided', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-omit')

    const response = await PUT(putRequest(id, { focus: '0.0,0.0' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.description).toBe('before')
  })

  it("PUT accepts alt text up to Mastodon's 1500-character limit", async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-long-description')
    const longDescription = 'a'.repeat(1500)

    const response = await PUT(
      putRequest(id, { description: longDescription }),
      {
        params: Promise.resolve({ id })
      }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.description).toBe(longDescription)

    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.description).toBe(longDescription)
  })

  it('PUT returns 422 when alt text exceeds 1500 characters', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-description-too-long')

    const response = await PUT(
      putRequest(id, { description: 'a'.repeat(1501) }),
      {
        params: Promise.resolve({ id })
      }
    )

    expect(response.status).toBe(422)
  })

  it('PUT returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'put-foreign')

    const response = await PUT(putRequest(id, { description: 'nope' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
  })

  it('PATCH updates the description like PUT (same handler)', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'patch-update')

    const response = await PATCH(
      patchRequest(id, { description: 'patched alt text' }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toMatchObject({ id, description: 'patched alt text' })

    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.description).toBe('patched alt text')
  })

  it('PUT persists a focal point into meta.focus', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-focus')

    const response = await PUT(putRequest(id, { focus: '0.5,-0.25' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.meta.focus).toEqual({ x: 0.5, y: -0.25 })

    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored?.focus).toEqual({ x: 0.5, y: -0.25 })
  })

  it.each([
    { description: 'out of range', focus: '2.0,0.0' },
    { description: 'a missing axis', focus: '0.5,' },
    { description: 'non-numeric', focus: 'a,b' },
    { description: 'wrong arity', focus: '0.1,0.2,0.3' }
  ])('PUT returns 422 for focus that is $description', async ({ focus }) => {
    const id = await createMediaFor(ACTOR1_ID, `put-focus-bad-${focus}`)

    const response = await PUT(putRequest(id, { focus }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(422)
  })

  it('PUT replaces the thumbnail through storage and deletes the old file', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-thumb-original.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      },
      thumbnail: {
        path: 'medias/route-thumb-old.jpg',
        bytes: 200,
        mimeType: 'image/jpeg',
        metaData: { width: 40, height: 40 }
      }
    })
    const id = String(media!.id)

    mockSaveMediaThumbnail.mockResolvedValue({
      path: 'medias/route-thumb-new.webp',
      bytes: 350,
      mimeType: 'image/webp',
      metaData: { width: 60, height: 60 }
    })

    const form = new FormData()
    form.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3])], 'thumb.png', { type: 'image/png' })
    )
    const request = new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      headers: { origin: 'https://llun.test' }
    })
    // jest / undici cannot materialise a multipart body from a FormData passed
    // to NextRequest — mock formData() directly (see update_credentials test).
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await PUT(request, { params: Promise.resolve({ id }) })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.preview_url).toBe(
      'https://llun.test/api/v1/files/medias/route-thumb-new.webp'
    )
    expect(mockSaveMediaThumbnail).toHaveBeenCalledTimes(1)
    // The previous thumbnail file is cleaned up after the replacement persists.
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      expect.anything(),
      'medias/route-thumb-old.jpg'
    )
  })

  it('PUT returns 422 when the thumbnail upload exceeds quota', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-thumb-quota')
    mockSaveMediaThumbnail.mockRejectedValue(
      new MediaValidationError('Storage quota exceeded')
    )

    const form = new FormData()
    form.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3])], 'thumb.png', { type: 'image/png' })
    )
    const request = new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      headers: { origin: 'https://llun.test' }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await PUT(request, { params: Promise.resolve({ id }) })

    expect(response.status).toBe(422)
  })

  it('PUT returns 422 for a thumbnail over the admin-configured media.maxFileSize', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-thumb-oversize')
    // The thumbnail below is 3 bytes.
    await database.setServerSettings([{ key: 'media.maxFileSize', value: 2 }])
    invalidateServerSettingsCache(database)

    const form = new FormData()
    form.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3])], 'thumb.png', { type: 'image/png' })
    )
    const request = new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      headers: { origin: 'https://llun.test' }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await PUT(request, { params: Promise.resolve({ id }) })

    expect(response.status).toBe(422)
    expect(mockSaveMediaThumbnail).not.toHaveBeenCalled()
  })

  it('PUT returns 422 for a non-image thumbnail instead of ignoring it', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-thumb-badtype')

    const form = new FormData()
    form.set(
      'thumbnail',
      new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' })
    )
    const request = new NextRequest(`https://llun.test/api/v1/media/${id}`, {
      method: 'PUT',
      headers: { origin: 'https://llun.test' }
    })
    Object.defineProperty(request, 'formData', {
      value: vi.fn().mockResolvedValue(form)
    })

    const response = await PUT(request, { params: Promise.resolve({ id }) })

    expect(response.status).toBe(422)
    expect(mockSaveMediaThumbnail).not.toHaveBeenCalled()
  })

  it('PUT returns 422 for a non-file thumbnail value instead of ignoring it', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-thumb-string')

    const response = await PUT(putRequest(id, { thumbnail: 'not-a-file' }), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(422)
    expect(mockSaveMediaThumbnail).not.toHaveBeenCalled()
  })

  it('PUT returns 422 for a crafted non-File thumbnail object (no 500)', async () => {
    const id = await createMediaFor(ACTOR1_ID, 'put-thumb-craft')

    // A JSON object mimicking { size, type } must not pass File validation and
    // crash later — it should be rejected as 422.
    const response = await PUT(
      putRequest(id, { thumbnail: { size: 10, type: 'image/png' } }),
      { params: Promise.resolve({ id }) }
    )

    expect(response.status).toBe(422)
    expect(mockSaveMediaThumbnail).not.toHaveBeenCalled()
  })

  it('DELETE removes owner media not attached to a status and deletes its files', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-delete-original.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      },
      thumbnail: {
        path: 'medias/route-delete-thumb.jpg',
        bytes: 200,
        mimeType: 'image/jpeg',
        metaData: { width: 40, height: 40 }
      }
    })
    const id = String(media!.id)
    mockDeleteMediaFile.mockResolvedValue(true)

    const response = await DELETE(deleteRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(200)
    const stored = await database.getMediaByIdForAccount({
      mediaId: id,
      accountId: (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    })
    expect(stored).toBeNull()
    // The original and thumbnail files are removed from storage.
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      expect.anything(),
      'medias/route-delete-original.jpg'
    )
    expect(mockDeleteMediaFile).toHaveBeenCalledWith(
      expect.anything(),
      'medias/route-delete-thumb.jpg'
    )
  })

  it('DELETE does not touch storage files on the 404 path', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'delete-foreign-nofiles')

    const response = await DELETE(deleteRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
    expect(mockDeleteMediaFile).not.toHaveBeenCalled()
  })

  it('DELETE returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'delete-foreign')

    const response = await DELETE(deleteRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
  })

  it('DELETE returns 422 when the media is attached to a status', async () => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/route-delete-attached.jpg',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 320, height: 240 }
      }
    })
    const id = String(media!.id)
    const statusId = `${ACTOR1_ID}/statuses/media-delete-attached`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'attached media',
      to: [],
      cc: []
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: media!.original.path,
      mediaId: id
    })

    const response = await DELETE(deleteRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(422)
  })

  describe('media details', () => {
    const put = async (id: string, body: Record<string, unknown>) =>
      PUT(putRequest(id, body), { params: Promise.resolve({ id }) })

    const detailsOf = async (id: string) => {
      const response = await GET(getRequest(id), {
        params: Promise.resolve({ id })
      })
      return (await response.json()).details
    }

    beforeEach(async () => {
      await database.updateGallerySettings({
        actorId: ACTOR1_ID,
        galleryDefault: 'subject'
      })
    })

    it('GET includes the empty details for a media that has none', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-empty')

      expect(await detailsOf(id)).toEqual({
        subject: null,
        takenAt: null,
        camera: null,
        lens: null,
        exposure: null,
        place: null,
        inGallery: false,
        subjectSuggestions: null
      })
    })

    it('PUT saves subject, place and gallery membership and returns them', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-save')

      const response = await put(id, {
        subject_name: 'Common Kingfisher',
        subject_scientific_name: 'Alcedo atthis',
        subject_category: 'bird',
        place_name: 'Lea Valley',
        place_latitude: 51.5543,
        place_longitude: -0.0231,
        place_precision: 'area',
        in_gallery: true
      })

      expect(response.status).toBe(200)
      const expected = {
        subject: {
          name: 'Common Kingfisher',
          scientificName: 'Alcedo atthis',
          category: 'bird'
        },
        place: {
          name: 'Lea Valley',
          latitude: 51.5543,
          longitude: -0.0231,
          precision: 'area'
        },
        inGallery: true
      }
      expect((await response.json()).details).toMatchObject(expected)
      expect(await detailsOf(id)).toMatchObject(expected)
    })

    it('PATCH accepts the same fields', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-patch')

      const response = await PATCH(
        patchRequest(id, { subject_name: 'Otter' }),
        {
          params: Promise.resolve({ id })
        }
      )

      expect(response.status).toBe(200)
      expect((await response.json()).details.subject.name).toBe('Otter')
    })

    it('leaves the description and every other detail alone on a partial update', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-partial')
      await put(id, { subject_name: 'Grey Heron', place_name: 'Marsh' })

      const response = await put(id, { place_name: 'Reedbed' })

      const data = await response.json()
      expect(data.description).toBe('before')
      expect(data.details).toMatchObject({
        subject: { name: 'Grey Heron' },
        place: { name: 'Reedbed' }
      })
    })

    it('does not touch details on a description-only update', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-description')
      await put(id, { subject_name: 'Otter', place_name: 'River' })

      const response = await put(id, { description: 'An otter' })

      expect((await response.json()).details).toMatchObject({
        subject: { name: 'Otter' },
        place: { name: 'River' }
      })
    })

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['whitespace', '   ']
    ])('clears a text detail sent as %s', async (_, value) => {
      const id = await createMediaFor(ACTOR1_ID, 'details-clear')
      await put(id, { subject_name: 'Otter', place_name: 'River' })

      const response = await put(id, { subject_name: value })

      expect((await response.json()).details).toMatchObject({
        subject: null,
        place: { name: 'River' }
      })
    })

    it('clears the place coordinates with null', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-clear-place')
      await put(id, {
        place_latitude: 10,
        place_longitude: 20,
        place_precision: 'exact'
      })

      const response = await put(id, {
        place_latitude: null,
        place_longitude: null
      })

      expect((await response.json()).details.place).toEqual({
        name: null,
        latitude: null,
        longitude: null,
        precision: 'exact',
        countryCode: null,
        nameSource: null,
        lookupStatus: null,
        lookupAt: null,
        lookupStale: false
      })
    })

    it('saves the picked GBIF key and queues the subject for its lookup', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-taxon-key')

      const response = await put(id, {
        subject_name: 'Great Hornbill',
        subject_scientific_name: 'Buceros bicornis',
        subject_category: 'bird',
        subject_taxon_key: '2481839'
      })

      expect(response.status).toBe(200)
      expect((await response.json()).details.subject).toEqual({
        name: 'Great Hornbill',
        scientificName: 'Buceros bicornis',
        category: 'bird',
        taxonKey: '2481839',
        taxonPath: null,
        iucnCategory: null,
        // Not checked yet: its place is withheld from everyone else.
        threatStatus: 'unchecked',
        lookupStatus: 'pending',
        lookupAt: expect.any(String),
        // It only just became pending: no Retry yet.
        lookupStale: false
      })
    })

    it.each([
      ['null', null],
      ['an empty string', '']
    ])('clears the GBIF key sent as %s', async (_, value) => {
      const id = await createMediaFor(ACTOR1_ID, 'details-taxon-key-clear')
      await put(id, { subject_name: 'Hornbill', subject_taxon_key: '2481839' })

      const response = await put(id, { subject_taxon_key: value })

      expect(response.status).toBe(200)
      expect((await response.json()).details.subject.taxonKey).toBeNull()
    })

    it.each([
      ['letters', 'abc'],
      ['a negative number', '-1'],
      ['more than 12 digits', '1234567890123'],
      ['a number', 2481839]
    ])('answers 422 for a GBIF key with %s', async (_, value) => {
      const id = await createMediaFor(ACTOR1_ID, 'details-taxon-key-bad')

      const response = await put(id, { subject_taxon_key: value })

      expect(response.status).toBe(422)
    })

    it('ignores a client-sent IUCN category or lookup status', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-iucn-ignored')

      const response = await put(id, {
        subject_scientific_name: 'Buceros bicornis',
        subject_iucn_category: 'LC',
        subject_lookup_status: 'resolved',
        place_country_code: 'TH'
      })

      const details = (await response.json()).details
      expect(details.subject).toMatchObject({
        iucnCategory: null,
        lookupStatus: 'pending'
      })
      expect(details.place).toBeNull()
    })

    it('reads multipart form fields, including numbers and booleans', async () => {
      const id = await createMediaFor(ACTOR1_ID, 'details-form')
      const form = new FormData()
      form.append('subject_name', 'Red Fox')
      form.append('place_latitude', '51.5')
      form.append('place_longitude', '-0.1')
      form.append('place_precision', 'country')
      form.append('in_gallery', 'true')

      const response = await PUT(
        new NextRequest(`https://llun.test/api/v1/media/${id}`, {
          method: 'PUT',
          headers: { origin: 'https://llun.test' },
          body: form
        }),
        { params: Promise.resolve({ id }) }
      )

      expect(response.status).toBe(200)
      expect((await response.json()).details).toMatchObject({
        subject: { name: 'Red Fox' },
        place: { latitude: 51.5, longitude: -0.1, precision: 'country' },
        inGallery: true
      })
    })

    it('answers 404 for another account’s media', async () => {
      const id = await createMediaFor(ACTOR2_ID, 'details-foreign')

      const response = await put(id, { subject_name: 'Otter' })

      expect(response.status).toBe(404)
    })

    it.each([
      ['an unknown subject category', { subject_category: 'dragon' }],
      ['a subject name over 255 characters', { subject_name: 'x'.repeat(256) }],
      ['a place name over 255 characters', { place_name: 'x'.repeat(256) }],
      ['a latitude above 90', { place_latitude: 91, place_longitude: 0 }],
      ['a latitude below -90', { place_latitude: -91, place_longitude: 0 }],
      ['a longitude above 180', { place_latitude: 0, place_longitude: 181 }],
      ['a longitude below -180', { place_latitude: 0, place_longitude: -181 }],
      [
        'a latitude that is not a number',
        { place_latitude: 'north', place_longitude: 0 }
      ],
      ['a latitude without a longitude', { place_latitude: 10 }],
      ['a longitude without a latitude', { place_longitude: 10 }],
      ['an unknown precision', { place_precision: 'street' }],
      ['gear that does not exist', { camera_gear_id: 'no-such-gear' }]
    ])('answers 422 for %s', async (_, body) => {
      const id = await createMediaFor(ACTOR1_ID, 'details-invalid')

      const response = await put(id, body)

      expect(response.status).toBe(422)
      expect(await detailsOf(id)).toMatchObject({ subject: null, place: null })
    })

    describe('lookup jobs', () => {
      const publishedNames = () =>
        mockPublish.mock.calls.map(([message]) => message.name)

      it('queues the place lookup when the coordinates are set', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-place')

        const response = await put(id, {
          place_latitude: 14.5347,
          place_longitude: 101.3912
        })

        expect(response.status).toBe(200)
        expect(mockPublish).toHaveBeenCalledTimes(1)
        expect(mockPublish).toHaveBeenCalledWith({
          id: expect.stringMatching(/^[0-9a-f]{64}$/),
          name: RESOLVE_MEDIA_PLACE_JOB_NAME,
          data: { mediaId: id }
        })
      })

      it('queues it again only when the coordinates changed', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-place-twice')
        const point = { place_latitude: 51.5, place_longitude: -0.12 }

        await put(id, point)
        await put(id, point)
        expect(mockPublish).toHaveBeenCalledTimes(1)

        await put(id, { place_latitude: 51.6, place_longitude: -0.12 })
        expect(mockPublish).toHaveBeenCalledTimes(2)
      })

      it('gives different media different job ids', async () => {
        const first = await createMediaFor(ACTOR1_ID, 'lookup-id-1')
        const second = await createMediaFor(ACTOR1_ID, 'lookup-id-2')

        await put(first, { place_latitude: 1, place_longitude: 2 })
        await put(second, { place_latitude: 1, place_longitude: 2 })

        const ids = mockPublish.mock.calls.map(([message]) => message.id)
        expect(new Set(ids).size).toBe(2)
      })

      // The race: job ids were a hash of the media and its inputs only, and
      // the database queue keeps finished jobs for days and ignores a new
      // job under a taken id. An edit back to an earlier subject or point
      // (A, then B, then A) reset the lookup to pending, then had its job
      // dropped as a duplicate, so it stayed pending for good.
      it('queues a new job for an edit back to an earlier subject or point', async () => {
        const queue = new DatabaseQueue(undefined, database)
        mockPublish.mockImplementation((message) => queue.publish(message))
        const id = await createMediaFor(ACTOR1_ID, 'lookup-a-b-a')
        const tiger = {
          subject_name: 'Tiger',
          subject_scientific_name: 'Panthera tigris',
          subject_category: 'mammal',
          place_latitude: 14.5,
          place_longitude: 101.4
        }
        const leopard = {
          subject_name: 'Leopard',
          subject_scientific_name: 'Panthera pardus',
          subject_category: 'mammal',
          place_latitude: 15.5,
          place_longitude: 101.4
        }

        await put(id, tiger)
        await put(id, leopard)
        await put(id, tiger)

        const ids = mockPublish.mock.calls.map(([message]) => message.id)
        expect(ids).toHaveLength(6)
        expect(new Set(ids).size).toBe(6)
        // Every publish has its own row, so the last edit's jobs will run.
        for (const jobId of ids.slice(-2)) {
          expect(await database.getQueueJobById(jobId)).toMatchObject({
            id: jobId,
            status: 'pending'
          })
        }
        expect((await detailsOf(id)).subject.lookupStatus).toBe('pending')
      })

      it('does not queue the place lookup when only the name changed', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-place-name')

        await put(id, { place_name: 'My garden' })

        expect(mockPublish).not.toHaveBeenCalled()
      })

      it('queues the subject lookup for any subject field', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-subject')

        await put(id, { subject_scientific_name: 'Alcedo atthis' })
        await put(id, { subject_category: 'bird' })

        expect(publishedNames()).toEqual([
          RESOLVE_MEDIA_SUBJECT_JOB_NAME,
          RESOLVE_MEDIA_SUBJECT_JOB_NAME
        ])
        expect(mockPublish.mock.calls[0][0].data).toEqual({ mediaId: id })
      })

      // An API client re-saving the whole subject used to queue a fresh job,
      // which overwrote a good `resolved` with `failed` while GBIF was down.
      it('queues nothing when the stored subject is sent again', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-subject-same')
        const subject = {
          subject_name: 'Tiger',
          subject_scientific_name: 'Panthera tigris',
          subject_category: 'mammal'
        }
        await put(id, subject)
        await database.setMediaSubjectLookup({
          mediaId: id,
          expect: {
            subjectName: 'Tiger',
            subjectScientificName: 'Panthera tigris',
            subjectTaxonKey: null
          },
          patch: {
            subjectLookupStatus: 'resolved',
            subjectIucnCategory: 'EN',
            subjectTaxonKey: '5219416'
          }
        })
        mockPublish.mockClear()

        const response = await put(id, subject)

        expect(response.status).toBe(200)
        expect(mockPublish).not.toHaveBeenCalled()
        expect((await response.json()).details.subject).toMatchObject({
          lookupStatus: 'resolved',
          iucnCategory: 'EN'
        })
      })

      it('queues the subject lookup when one sent field changed', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-subject-change')
        await put(id, { subject_name: 'Tiger', subject_category: 'mammal' })
        mockPublish.mockClear()

        await put(id, { subject_name: 'Tiger', subject_category: 'bird' })

        expect(publishedNames()).toEqual([RESOLVE_MEDIA_SUBJECT_JOB_NAME])
      })

      it('answers with the place lookup pending while it is queued', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-place-pending')

        const response = await put(id, {
          place_latitude: 14.5,
          place_longitude: 101.4
        })

        expect((await response.json()).details.place).toMatchObject({
          lookupStatus: 'pending',
          lookupStale: false
        })
      })

      // NoQueue runs the job inside the publish; the answer must carry what
      // it wrote, not the `pending` from before it ran.
      it('answers with what a lookup that ran inline wrote', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-place-inline')
        mockPublish.mockImplementation(async () => {
          await database.setMediaPlaceLookup({
            mediaId: id,
            expect: { placeLatitude: 14.5, placeLongitude: 101.4 },
            patch: {
              placeLookupStatus: 'resolved',
              placeCountryCode: 'TH',
              placeName: 'Pak Chong, Thailand'
            }
          })
        })

        const response = await put(id, {
          place_latitude: 14.5,
          place_longitude: 101.4
        })

        expect((await response.json()).details.place).toMatchObject({
          name: 'Pak Chong, Thailand',
          countryCode: 'TH',
          lookupStatus: 'resolved'
        })
      })

      // An API client may send any key. The job checks it against the names
      // the subject also has, so another species' key (here the LC tree
      // Panda oleosa for a giant panda) never clears the place.
      it('records failed for a subject sent with another species’ taxon key', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-subject-wrong-key')
        gbifAnswers.set('/v1/species/5380987', {
          statusCode: 200,
          body: taxonPandaOleosa
        })
        gbifAnswers.set('/v1/species/5380987/iucnRedListCategory', {
          statusCode: 200,
          body: iucnLeastConcern
        })
        mockPublish.mockImplementation(async (message) => {
          if (message.name === RESOLVE_MEDIA_SUBJECT_JOB_NAME) {
            await resolveMediaSubjectJob(database, message)
          }
        })

        const response = await put(id, {
          subject_name: 'Giant Panda',
          subject_scientific_name: 'Ailuropoda melanoleuca',
          subject_category: 'mammal',
          subject_taxon_key: '5380987'
        })

        expect(response.status).toBe(200)
        expect((await response.json()).details.subject).toMatchObject({
          taxonKey: '5380987',
          iucnCategory: null,
          lookupStatus: 'failed'
        })
        const stored = await database.getMediaWithAttachedStatusIds({
          mediaId: id
        })
        expect(stored?.media.details).toMatchObject({
          subjectLookupStatus: 'failed',
          subjectIucnCategory: null
        })
        gbifAnswers.clear()
      })

      it('queues nothing for a description-only update', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'lookup-none')

        await put(id, { description: 'after' })

        expect(mockPublish).not.toHaveBeenCalled()
      })

      it('queues nothing for another account’s media', async () => {
        const id = await createMediaFor(ACTOR2_ID, 'lookup-foreign')

        const response = await put(id, { subject_name: 'Otter' })

        expect(response.status).toBe(404)
        expect(mockPublish).not.toHaveBeenCalled()
      })

      it('still answers 200 when the queue fails', async () => {
        mockPublish.mockRejectedValue(new Error('queue down'))
        const id = await createMediaFor(ACTOR1_ID, 'lookup-queue-down')

        const response = await put(id, {
          subject_name: 'Otter',
          place_latitude: 10,
          place_longitude: 20
        })

        expect(response.status).toBe(200)
        expect((await response.json()).details.subject.name).toBe('Otter')
      })
    })

    describe('gear', () => {
      const gear = (actorId: string, kind: 'camera' | 'lens', name: string) =>
        database.createGalleryGear({ actorId, kind, name })

      it('links the owner’s camera and lens and returns their names', async () => {
        const camera = await gear(ACTOR1_ID, 'camera', 'Canon EOS R5')
        const lens = await gear(ACTOR1_ID, 'lens', 'RF100-500mm')
        const id = await createMediaFor(ACTOR1_ID, 'details-gear')

        const response = await put(id, {
          camera_gear_id: camera.id,
          lens_gear_id: lens.id
        })

        expect(response.status).toBe(200)
        expect((await response.json()).details).toMatchObject({
          camera: { id: camera.id, name: 'Canon EOS R5' },
          lens: { id: lens.id, name: 'RF100-500mm' }
        })
      })

      it('clears gear with null', async () => {
        const camera = await gear(ACTOR1_ID, 'camera', 'To clear')
        const id = await createMediaFor(ACTOR1_ID, 'details-gear-clear')
        await put(id, { camera_gear_id: camera.id })

        const response = await put(id, { camera_gear_id: null })

        expect((await response.json()).details.camera).toBeNull()
      })

      it.each([
        ['another actor’s camera', 'camera_gear_id', ACTOR2_ID, 'camera'],
        ['another actor’s lens', 'lens_gear_id', ACTOR2_ID, 'lens'],
        ['a lens as the camera', 'camera_gear_id', ACTOR1_ID, 'lens'],
        ['a camera as the lens', 'lens_gear_id', ACTOR1_ID, 'camera']
      ] as const)('answers 422 for %s', async (_, field, ownerId, kind) => {
        const other = await gear(ownerId, kind, 'Not usable')
        const id = await createMediaFor(ACTOR1_ID, 'details-gear-invalid')

        const response = await put(id, { [field]: other.id })

        expect(response.status).toBe(422)
        expect(await response.json()).toEqual({
          error: `Unknown ${field === 'camera_gear_id' ? 'camera' : 'lens'} gear`
        })
      })
    })

    describe('gallery default when a subject is first set', () => {
      it.each([
        ['subject', undefined, true],
        ['subject', false, false],
        ['always', undefined, false],
        ['never', undefined, false]
      ] as const)(
        'with default "%s" and in_gallery %s the media ends up in the gallery: %s',
        async (galleryDefault, inGallery, expected) => {
          await database.updateGallerySettings({
            actorId: ACTOR1_ID,
            galleryDefault
          })
          const id = await createMediaFor(ACTOR1_ID, 'details-default')

          const response = await put(id, {
            subject_name: 'Otter',
            ...(inGallery === undefined ? {} : { in_gallery: inGallery })
          })

          expect((await response.json()).details.inGallery).toBe(expected)
        }
      )

      it('does not put a media back in the gallery when only its subject is renamed', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'details-rename')
        await put(id, { subject_name: 'Otter' })
        await put(id, { in_gallery: false })

        const response = await put(id, { subject_name: 'River Otter' })

        expect((await response.json()).details.inGallery).toBeFalse()
      })

      it('does not change membership when the subject is not what changed', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'details-place-only')

        const response = await put(id, { place_name: 'River' })

        expect((await response.json()).details.inGallery).toBeFalse()
      })

      it('does not treat clearing a subject as setting one', async () => {
        const id = await createMediaFor(ACTOR1_ID, 'details-clear-subject')

        const response = await put(id, { subject_name: null })

        expect((await response.json()).details.inGallery).toBeFalse()
      })
    })
  })
})
