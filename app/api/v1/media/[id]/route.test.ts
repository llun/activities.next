import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { MediaValidationError } from '@/lib/services/medias/errors'
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

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
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
  verifyAccessToken: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

describe('/api/v1/media/[id]', () => {
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
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    mockStoredToken.mockResolvedValue(null)
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

  it('requires authentication', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const id = await createMediaFor(ACTOR1_ID, 'auth')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(401)
  })

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

  it('GET returns 404 for media owned by another account', async () => {
    const id = await createMediaFor(ACTOR2_ID, 'get-foreign')

    const response = await GET(getRequest(id), {
      params: Promise.resolve({ id })
    })

    expect(response.status).toBe(404)
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
})
