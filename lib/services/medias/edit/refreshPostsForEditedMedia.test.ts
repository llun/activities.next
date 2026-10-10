import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { getBaseURL } from '@/lib/config'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { refreshPostsForEditedMedia } from '@/lib/services/medias/edit/refreshPostsForEditedMedia'
import { getQueue } from '@/lib/services/queue'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { Media } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
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
  describe('a post pointed at an earlier render', () => {
    const editTo = async (media: Media, name: string) => {
      const result = await database.applyMediaEdit({
        mediaId: media.id,
        accountId,
        baseVersion: media.edit?.version ?? 0,
        saveId: name,
        recipe: JSON.stringify({ v: 1, name }),
        render: {
          path: `medias/${name}.webp`,
          bytes: 200,
          mimeType: 'image/webp',
          width: 200,
          height: 150,
          blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
          focus: { x: 0.5, y: 0.5 }
        }
      })
      if (result.status !== 'ok') throw new Error('edit failed')
      return result.media
    }

    const editFilePaths = async (media: Media) =>
      (await database.listMediaEditFiles({ mediaIds: [media.id] })).map(
        (file) => file.path
      )

    const actor = async () =>
      (await database.getActorFromId({ id: ACTOR1_ID })) as Actor

    // Save A passed its version check for the post, then save B committed and
    // updated the post; A's write lands last. B's prune must keep render A.
    it('keeps the render a slower refresh wrote after a later save updated the post', async () => {
      const photo = await createPhoto()
      const statusId = await createPost(photo)
      const first = await editTo(photo, `race-a-${photo.id}`)
      let second: Media | null = null
      const original = database.updateNote
      const updateNote = vi
        .spyOn(database, 'updateNote')
        .mockImplementation(async (params) => {
          if (!second) {
            second = await editTo(first, `race-b-${photo.id}`)
            await refreshPostsForEditedMedia({
              database,
              media: second,
              version: second.edit!.version,
              accountId
            })
          }
          return original(params)
        })

      await refreshPostsForEditedMedia({
        database,
        media: first,
        version: first.edit!.version,
        accountId
      })
      updateNote.mockRestore()
      const pruned = await database.pruneSupersededMediaEditFiles({
        mediaId: photo.id,
        accountId,
        version: second!.edit!.version
      })

      const [attachment] = await attachmentsOf(statusId)
      expect(attachment.url).toBe(fileUrl(first.original.path))
      expect(pruned).not.toContain(first.original.path)
      expect(await editFilePaths(photo)).toContain(first.original.path)
    })

    // A composer opened before another tab's "Update posts" save still holds
    // the render that save superseded and pruned.
    it('takes the live file over a stale render sent for a kept photo', async () => {
      const photo = await createPhoto()
      const statusId = await createPost(photo)
      const first = await editTo(photo, `stale-a-${photo.id}`)
      await refreshPostsForEditedMedia({
        database,
        media: first,
        version: first.edit!.version,
        accountId
      })
      const second = await editTo(first, `stale-b-${photo.id}`)
      await refreshPostsForEditedMedia({
        database,
        media: second,
        version: second.edit!.version,
        accountId
      })
      await database.pruneSupersededMediaEditFiles({
        mediaId: photo.id,
        accountId,
        version: second.edit!.version
      })
      expect(await editFilePaths(photo)).not.toContain(first.original.path)

      await updateNoteFromUserInput({
        statusId,
        currentActor: await actor(),
        text: '<p>Fixed a typo</p>',
        attachments: [
          {
            type: 'upload',
            id: photo.id,
            mediaType: 'image/webp',
            url: fileUrl(first.original.path),
            width: 999,
            height: 999,
            name: 'alt'
          }
        ],
        database
      })

      const [attachment] = await attachmentsOf(statusId)
      expect(attachment).toMatchObject({
        url: fileUrl(second.original.path),
        mediaType: 'image/webp',
        width: 200,
        height: 150,
        blurhash: second.blurhash,
        focus: second.focus
      })
    })

    it('takes the live file over an earlier render sent for a new post', async () => {
      const photo = await createPhoto()
      const first = await editTo(photo, `new-a-${photo.id}`)
      const second = await editTo(first, `new-b-${photo.id}`)

      const status = (await createNoteFromUserInput({
        text: 'A new post',
        currentActor: await actor(),
        attachments: [
          {
            type: 'upload',
            id: photo.id,
            mediaType: 'image/jpeg',
            url: fileUrl(photo.original.path),
            width: 400,
            height: 300,
            name: 'alt'
          },
          {
            type: 'upload',
            id: photo.id,
            mediaType: 'image/webp',
            url: fileUrl(first.original.path),
            width: 200,
            height: 150,
            name: 'alt'
          }
        ],
        database
      })) as StatusNote

      const attachments = await attachmentsOf(status.id)
      expect(attachments.map((item) => item.url)).toEqual([
        fileUrl(second.original.path),
        fileUrl(second.original.path)
      ])
      expect(attachments[0]).toMatchObject({
        mediaId: photo.id,
        mediaType: 'image/webp',
        width: 200,
        height: 150
      })
    })
  })
})
