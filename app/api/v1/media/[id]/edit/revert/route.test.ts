import { NextRequest } from 'next/server'
import sharp from 'sharp'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { deleteMediaFile } from '@/lib/services/medias'
import { refreshPostsForEditedMedia } from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID, seedActor1 } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

vi.mock('@/lib/services/medias', () => ({
  getMediaStorage: vi.fn(),
  deleteMediaFile: vi.fn()
}))

vi.mock('@/lib/services/medias/readStoredMedia', () => ({
  readStoredImage: vi.fn()
}))

vi.mock(
  '@/lib/services/medias/edit/refreshPostsForEditedMedia',
  async (importActual) => ({
    ...(await importActual<
      typeof import('@/lib/services/medias/edit/refreshPostsForEditedMedia')
    >()),
    refreshPostsForEditedMedia: vi.fn()
  })
)

describe('POST /api/v1/media/[id]/edit/revert', () => {
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

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetServerSession.mockResolvedValue({
      user: { email: seedActor1.email }
    })
    const buffer = await sharp({
      create: { width: 400, height: 300, channels: 3, background: '#000' }
    })
      .jpeg()
      .toBuffer()
    vi.mocked(readStoredImage).mockResolvedValue({
      buffer,
      mimeType: 'image/jpeg'
    })
    vi.mocked(deleteMediaFile).mockResolvedValue(true)
    vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
      updated: [],
      skipped: []
    })
  })

  let counter = 0
  const createMediaFor = async (actorId: string) => {
    counter += 1
    const media = await database.createMedia({
      actorId,
      original: {
        path: `medias/revert-${counter}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      },
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    })
    return media!
  }

  const edit = async (mediaId: string, baseVersion = 0) =>
    database.applyMediaEdit({
      mediaId,
      accountId,
      baseVersion,
      saveId: `edit-${baseVersion}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/revert-render-${mediaId}-${baseVersion}.webp`,
        bytes: 200,
        mimeType: 'image/webp',
        width: 400,
        height: 300,
        blurhash: null,
        focus: null
      }
    })

  const revert = (id: string, body: unknown) =>
    POST(
      new NextRequest(`https://llun.test/api/v1/media/${id}/edit/revert`, {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }),
      { params: Promise.resolve({ id }) }
    )

  it('answers 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null)
    const media = await createMediaFor(ACTOR1_ID)
    expect(
      (
        await revert(media.id, {
          base_version: 0,
          save_id: crypto.randomUUID()
        })
      ).status
    ).toBe(401)
  })

  it('answers 404 for a media of another account', async () => {
    const media = await createMediaFor(ACTOR2_ID)
    const response = await revert(media.id, {
      base_version: 0,
      save_id: crypto.randomUUID()
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Record not found' })
  })

  it.each([
    ['no body', undefined],
    [
      'a string base version',
      { base_version: '1', save_id: crypto.randomUUID() }
    ],
    ['a save id that is not a uuid', { base_version: 1, save_id: 'x' }],
    [
      'an unknown apply_to_posts',
      { base_version: 1, save_id: crypto.randomUUID(), apply_to_posts: 'all' }
    ]
  ])('answers 422 for %s', async (_, body) => {
    const media = await createMediaFor(ACTOR1_ID)
    expect((await revert(media.id, body)).status).toBe(422)
  })

  it('answers 409 when there is nothing to revert', async () => {
    const media = await createMediaFor(ACTOR1_ID)
    const response = await revert(media.id, {
      base_version: 0,
      save_id: crypto.randomUUID()
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Nothing to revert' })
  })

  it('answers 409 stale with the current version and save id', async () => {
    const media = await createMediaFor(ACTOR1_ID)
    await edit(media.id)
    const response = await revert(media.id, {
      base_version: 0,
      save_id: crypto.randomUUID()
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'stale',
      edit: { version: 1, saveId: 'edit-0' }
    })
  })

  it('puts the uploaded file back and prunes the render when no post uses it', async () => {
    const media = await createMediaFor(ACTOR1_ID)
    await edit(media.id)
    const saveId = crypto.randomUUID()

    const response = await revert(media.id, {
      base_version: 1,
      save_id: saveId
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.edit).toEqual({
      version: 2,
      recipe: null,
      editedAt: null,
      saveId,
      source: { width: 400, height: 300, mimeType: 'image/jpeg' },
      masks: []
    })
    expect(body.media.url).toBe(
      `https://llun.test/api/v1/files/${media.original.path}`
    )
    expect(body.media.blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
    expect(body.posts).toEqual({ updated: [], skipped: [] })
    expect(deleteMediaFile).toHaveBeenCalledWith(
      database,
      `medias/revert-render-${media.id}-0.webp`
    )
    await expect(
      database.listMediaEditFiles({ mediaIds: [media.id] })
    ).resolves.toEqual([])
  })

  it('requires apply_to_posts when the photo is in a post, then updates them', async () => {
    const media = await createMediaFor(ACTOR1_ID)
    const statusId = `${ACTOR1_ID}/statuses/revert-post-${media.id}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Posted photo'
    })
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/api/v1/files/${media.original.path}`,
      width: 400,
      height: 300,
      mediaId: media.id
    })
    await edit(media.id)

    const missing = await revert(media.id, {
      base_version: 1,
      save_id: crypto.randomUUID()
    })
    expect(missing.status).toBe(422)

    vi.mocked(refreshPostsForEditedMedia).mockResolvedValue({
      updated: [statusId],
      skipped: []
    })
    const response = await revert(media.id, {
      base_version: 1,
      save_id: crypto.randomUUID(),
      apply_to_posts: 'update'
    })
    expect(response.status).toBe(200)
    expect((await response.json()).posts).toEqual({
      updated: [statusId],
      skipped: []
    })
    expect(refreshPostsForEditedMedia).toHaveBeenCalledWith({
      database,
      media: expect.objectContaining({
        id: media.id,
        original: expect.objectContaining({ path: media.original.path })
      }),
      version: 2,
      accountId
    })
  })
})
