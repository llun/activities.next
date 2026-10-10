import { getBaseURL } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { refreshPostsForEditedMedia } from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Media } from '@/lib/types/database/operations'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

describe('refreshPostsForEditedMedia', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let accountId = ''

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const fileUrl = (path: string) => `${getBaseURL()}/api/v1/files/${path}`

  let counter = 0
  const createPhoto = async () => {
    counter += 1
    return (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/refresh-${counter}.jpg`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: { width: 400, height: 300 }
      },
      description: `photo ${counter}`
    }))!
  }

  const edit = async (media: Media) => {
    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: media.edit?.version ?? 0,
      saveId: `refresh-${media.id}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/refresh-render-${media.id}.webp`,
        bytes: 200,
        mimeType: 'image/webp',
        width: 200,
        height: 150,
        blurhash: null,
        focus: null
      }
    })
    if (result.status !== 'ok') throw new Error('edit failed')
    return result.media
  }

  const attach = async (statusId: string, media: Media) =>
    database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: media.original.mimeType,
      url: fileUrl(media.original.path),
      width: 400,
      height: 300,
      name: media.description ?? '',
      mediaId: media.id
    })

  const createPost = async (...medias: Media[]) => {
    counter += 1
    const statusId = `${ACTOR1_ID}/statuses/refresh-${counter}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: '<p>Kept text</p>'
    })
    for (const media of medias) await attach(statusId, media)
    return statusId
  }

  const attachmentsOf = async (statusId: string) =>
    ((await database.getStatus({ statusId })) as StatusNote).attachments

  it('points the post at the edited file and sends an Update', async () => {
    const photo = await createPhoto()
    const other = await createPhoto()
    const statusId = await createPost(photo, other)
    const edited = await edit(photo)
    // The other photo was edited "Gallery only": its post must not change.
    await edit(other)

    const result = await refreshPostsForEditedMedia({
      database,
      media: edited,
      version: edited.edit!.version,
      accountId
    })

    expect(result).toEqual({ updated: [statusId], skipped: [] })
    const attachments = await attachmentsOf(statusId)
    expect(attachments).toHaveLength(2)
    const first = attachments.find((item) => item.mediaId === photo.id)
    const second = attachments.find((item) => item.mediaId === other.id)
    expect(first).toMatchObject({
      mediaId: photo.id,
      url: fileUrl(edited.original.path),
      mediaType: 'image/webp',
      width: 200,
      height: 150,
      name: photo.description
    })
    expect(second).toMatchObject({
      mediaId: other.id,
      url: fileUrl(other.original.path),
      mediaType: 'image/jpeg',
      width: 400,
      height: 300
    })

    const status = (await database.getStatus({ statusId })) as StatusNote
    expect(status.text).toBe('<p>Kept text</p>')
    expect(status.edits.length).toBeGreaterThan(0)
    expect(getQueue().publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: ACTOR1_ID, statusId }
      })
    )
  })

  // A later save owns the posts this refresh has not reached: it updates them
  // itself, or keeps them for "Gallery only", and may prune this render.
  it('leaves the posts it has not reached once a later save lands', async () => {
    const photo = await createPhoto()
    const first = await createPost(photo)
    const second = await createPost(photo)
    const edited = await edit(photo)
    const original = database.updateNote
    const updateNote = vi
      .spyOn(database, 'updateNote')
      .mockImplementation(async (params) => {
        const result = await original(params)
        // Another tab saves while this refresh federates the first post.
        if (params.statusId === first) await edit(edited)
        return result
      })

    const result = await refreshPostsForEditedMedia({
      database,
      media: edited,
      version: edited.edit!.version,
      accountId
    })
    updateNote.mockRestore()

    expect(result).toEqual({ updated: [first], skipped: [second] })
    expect((await attachmentsOf(first))[0]?.url).toBe(
      fileUrl(edited.original.path)
    )
    expect((await attachmentsOf(second))[0]?.url).toBe(
      fileUrl(photo.original.path)
    )
  })

  // Photo X was edited "Gallery only", so the post keeps X's earlier file.
  // Updating the post for photo Y must not copy the BlurHash and focal point
  // of X's new render onto X's attachment, which still shows the old image.
  it('keeps what the post recorded for a photo left on an earlier file', async () => {
    const photo = await createPhoto()
    const other = await createPhoto()
    counter += 1
    const statusId = `${ACTOR1_ID}/statuses/refresh-${counter}`
    await database.createNote({
      id: statusId,
      url: statusId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: '<p>Two photos</p>'
    })
    await attach(statusId, photo)
    await database.createAttachment({
      actorId: ACTOR1_ID,
      statusId,
      mediaType: other.original.mimeType,
      url: fileUrl(other.original.path),
      width: 400,
      height: 300,
      name: other.description ?? '',
      mediaId: other.id,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      focus: { x: 0.1, y: 0.2 }
    })
    const before = (await attachmentsOf(statusId)).find(
      (item) => item.mediaId === other.id
    )
    // "Gallery only": the render has its own placeholder and focus.
    const otherEdit = await database.applyMediaEdit({
      mediaId: other.id,
      accountId,
      baseVersion: 0,
      saveId: `gallery-${other.id}`,
      recipe: JSON.stringify({ v: 1 }),
      render: {
        path: `medias/refresh-render-${other.id}.webp`,
        bytes: 200,
        mimeType: 'image/webp',
        width: 200,
        height: 150,
        blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
        focus: { x: -0.9, y: 0.9 }
      }
    })
    expect(otherEdit.status).toBe('ok')
    const edited = await edit(photo)

    const result = await refreshPostsForEditedMedia({
      database,
      media: edited,
      version: edited.edit!.version,
      accountId
    })

    expect(result).toEqual({ updated: [statusId], skipped: [] })
    const after = (await attachmentsOf(statusId)).find(
      (item) => item.mediaId === other.id
    )
    expect(after).toEqual(before)
  })

  it('skips a post it cannot update and still updates the others', async () => {
    const photo = await createPhoto()
    const failing = await createPost(photo)
    const working = await createPost(photo)
    const edited = await edit(photo)
    const original = database.updateNote
    const updateNote = vi
      .spyOn(database, 'updateNote')
      .mockImplementation(async (params) => {
        if (params.statusId === failing) throw new Error('write failed')
        return original(params)
      })

    const result = await refreshPostsForEditedMedia({
      database,
      media: edited,
      version: edited.edit!.version,
      accountId
    })
    updateNote.mockRestore()

    expect(result.skipped).toEqual([failing])
    expect(result.updated).toEqual([working])
  })

  it('skips a status that is not a Note', async () => {
    const photo = await createPhoto()
    counter += 1
    const pollId = `${ACTOR1_ID}/statuses/refresh-poll-${counter}`
    await database.createPoll({
      id: pollId,
      url: pollId,
      actorId: ACTOR1_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Poll',
      choices: ['Yes', 'No'],
      endAt: Date.now() + 60_000
    })
    await attach(pollId, photo)
    const edited = await edit(photo)

    const result = await refreshPostsForEditedMedia({
      database,
      media: edited,
      version: edited.edit!.version,
      accountId
    })

    expect(result).toEqual({ updated: [], skipped: [pollId] })
    expect(getQueue().publish).not.toHaveBeenCalled()
  })
})
