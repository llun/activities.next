import { NextRequest } from 'next/server'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { Media } from '@/lib/types/database/operations'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { urlToId } from '@/lib/utils/urlToId'

import { PUT } from './route'

const mockGetServerSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: () => mockGetServerSession()
}))

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', async () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('next/headers', async () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined)
  })
}))

vi.mock('better-auth/oauth2', async () => ({
  verifyBearerToken: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn().mockReturnValue('https://llun.test'),
  getConfig: vi.fn().mockReturnValue({
    allowEmails: [],
    host: 'llun.test',
    secretPhase: 'test-secret'
  })
}))

// An alt-text or focal-point edit (`media_attributes` without `media_ids`)
// must leave every photo on the file the post shows: a photo edited "Gallery
// only" keeps its earlier file in the post until an "Update posts" save.
describe('PUT /api/v1/statuses/[id] media_attributes after a Gallery-only edit', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let accountId = ''

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
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

  const fileUrl = (path: string) => `https://llun.test/api/v1/files/${path}`

  const createPhoto = async (name: string) =>
    (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/${name}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      },
      description: `${name} alt`,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.1, y: 0.2 }
    }))!

  const editGalleryOnly = async (media: Media, name: string) => {
    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: `gallery-only-${name}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/${name}-render.webp`,
        bytes: 200,
        mimeType: 'image/webp',
        width: 300,
        height: 300,
        blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
        focus: { x: -0.9, y: 0.9 }
      }
    })
    if (result.status !== 'ok') throw new Error('edit failed')
  }

  const put = (statusId: string, body: unknown) =>
    PUT(
      new NextRequest(
        `https://llun.test/api/v1/statuses/${urlToId(statusId)}`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://llun.test'
          }
        }
      ),
      { params: Promise.resolve({ id: urlToId(statusId) }) }
    )

  it('keeps each photo on the file the post shows', async () => {
    const x = await createPhoto('gallery-only-x')
    const y = await createPhoto('gallery-only-y')
    const statusId = `${ACTOR1_ID}/statuses/gallery-only-alt`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      text: 'Two photos',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    for (const [index, media] of [x, y].entries()) {
      await database.createAttachment({
        actorId: ACTOR1_ID,
        statusId,
        mediaType: 'image/jpeg',
        url: fileUrl(media.original.path),
        width: 400,
        height: 300,
        name: media.description ?? '',
        mediaId: media.id,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.1, y: 0.2 },
        createdAt: Date.now() + index
      })
    }
    await editGalleryOnly(x, 'gallery-only-x')
    await editGalleryOnly(y, 'gallery-only-y')
    const before = await database.getAttachments({ statusId })

    const fixX = await put(statusId, {
      media_attributes: [{ id: x.id, description: 'Fixed alt for X' }]
    })
    expect(fixX.status).toBe(200)
    const fixY = await put(statusId, {
      media_attributes: [{ id: y.id, description: 'Fixed alt for Y' }]
    })
    expect(fixY.status).toBe(200)

    const after = await database.getAttachments({ statusId })
    const pick = (list: typeof after, media: Media) =>
      list.find((item) => item.mediaId === media.id)!
    for (const media of [x, y]) {
      const { name: _beforeName, updatedAt: _b, ...kept } = pick(before, media)
      const { name: _afterName, updatedAt: _a, ...now } = pick(after, media)
      expect(now).toEqual(kept)
      expect(now).toMatchObject({
        url: fileUrl(media.original.path),
        mediaType: 'image/jpeg',
        width: 400,
        height: 300,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        focus: { x: 0.1, y: 0.2 }
      })
    }
    expect(pick(after, x).name).toBe('Fixed alt for X')
    expect(pick(after, y).name).toBe('Fixed alt for Y')
  })
})
