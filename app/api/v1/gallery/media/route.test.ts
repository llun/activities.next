import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { OWNER_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { MAX_ADD_TO_GALLERY_MEDIA } from '@/lib/services/gallery/galleryRequests'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID, seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { OPTIONS, POST } from './route'

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

const signIn = (email: string) =>
  mockGetServerSession.mockResolvedValue({ user: { email } })

const add = (body: unknown) =>
  POST(
    new NextRequest('https://llun.test/api/v1/gallery/media', {
      method: 'POST',
      headers: {
        origin: 'https://llun.test',
        'content-type': 'application/json'
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    { params: Promise.resolve({}) }
  )

describe('/api/v1/gallery/media', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let counter = 0

  const upload = async (
    actorId = ACTOR1_ID,
    upload?: 'pending' | 'verified'
  ) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/gallery-add-${counter}.webp`,
        bytes: 1000,
        mimeType: 'image/webp',
        metaData: {
          width: 100,
          height: 100,
          ...(upload ? { upload: { state: upload } } : {})
        }
      },
      // What a composer-style upload starts as.
      details: { inGallery: false }
    })
    return media!.id
  }

  const ownerRows = async (show: 'not_posted' | 'all' = 'not_posted') =>
    (
      await database.getGalleryMedia({
        actorId: ACTOR1_ID,
        audience: OWNER_GALLERY_AUDIENCE,
        limit: 100,
        show
      })
    ).map((row) => row.media.id)

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
    signIn(seedActor1.email)
  })

  it('advertises POST and OPTIONS', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/gallery/media', {
        method: 'OPTIONS'
      })
    )

    const methods = response.headers.get('Access-Control-Allow-Methods')
    expect(methods).toContain('POST')
    expect(methods).toContain('OPTIONS')
  })

  it('answers 401 with CORS headers when nobody is signed in', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const response = await add({ media_ids: ['1'] })

    expect(response.status).toBe(401)
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBeNull()
  })

  it('keeps the uploads in the gallery, switched on and visible to the owner', async () => {
    const first = await upload()
    const second = await upload()

    const response = await add({ media_ids: [first, second] })

    expect(response.status).toBe(200)
    expect((await response.json()).media_ids).toEqual([second, first])
    const rows = await database.getGalleryMedia({
      actorId: ACTOR1_ID,
      audience: OWNER_GALLERY_AUDIENCE,
      limit: 100,
      show: 'not_posted'
    })
    expect(rows.map((row) => row.media.id)).toEqual(
      expect.arrayContaining([first, second])
    )
    expect(
      rows.every((row) => row.media.details?.inGallery && !row.statusId)
    ).toBe(true)
  })

  it('is idempotent', async () => {
    const mediaId = await upload()

    const once = await add({ media_ids: [mediaId] })
    const twice = await add({ media_ids: [mediaId, mediaId] })

    expect(once.status).toBe(200)
    expect(twice.status).toBe(200)
    expect((await twice.json()).media_ids).toEqual([mediaId])
    expect((await ownerRows()).filter((id) => id === mediaId)).toHaveLength(1)
  })

  it('skips media a post uses, another actor media and a pending upload', async () => {
    const own = await upload()
    const posted = await upload()
    const statusId = `${ACTOR1_ID}/statuses/gallery-add-posted`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'posted'
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/webp',
      url: 'https://llun.test/api/v1/files/posted.webp',
      width: 100,
      height: 100,
      mediaId: posted
    })
    const foreign = await upload(ACTOR2_ID)
    const pending = await upload(ACTOR1_ID, 'pending')

    const response = await add({
      media_ids: [own, posted, foreign, pending, '999999']
    })

    expect(response.status).toBe(200)
    expect((await response.json()).media_ids).toEqual([own])
    const rows = await ownerRows()
    expect(rows).toContain(own)
    expect(rows).not.toContain(foreign)
    expect(rows).not.toContain(pending)
    // The posted one stays a post's photo, not an addition.
    expect(await ownerRows('not_posted')).not.toContain(posted)
  })

  it('does not let another account add the owner media', async () => {
    const mediaId = await upload()
    signIn(seedActor2.email)

    const response = await add({ media_ids: [mediaId] })

    expect(response.status).toBe(404)
    expect(await ownerRows()).not.toContain(mediaId)
  })

  it('answers 404 when none of the ids could be added', async () => {
    const response = await add({ media_ids: ['999999'] })

    expect(response.status).toBe(404)
  })

  it.each([
    ['no body', ''],
    ['invalid JSON', '{'],
    ['no media_ids', {}],
    ['an empty list', { media_ids: [] }],
    ['a non-numeric id', { media_ids: ['abc'] }],
    ['a number instead of a string id', { media_ids: [1] }],
    [
      'more ids than one request may add',
      {
        media_ids: Array.from(
          { length: MAX_ADD_TO_GALLERY_MEDIA + 1 },
          (_, index) => String(index + 1)
        )
      }
    ]
  ])('answers 422 for %s', async (_, body) => {
    const response = await add(body)

    expect(response.status).toBe(422)
  })

  it('accepts as many ids as one request may add', async () => {
    const mediaIds = []
    for (let index = 0; index < MAX_ADD_TO_GALLERY_MEDIA; index += 1) {
      mediaIds.push(await upload())
    }

    const response = await add({ media_ids: mediaIds })

    expect(response.status).toBe(200)
    expect((await response.json()).media_ids).toHaveLength(
      MAX_ADD_TO_GALLERY_MEDIA
    )
  })
})
