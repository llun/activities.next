import { decode } from 'blurhash'
import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createNoteJob } from '@/lib/jobs/createNoteJob'
import { CREATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import * as animationMetadataService from '@/lib/services/medias/animationMetadata'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { MockMastodonActivityPubNote } from '@/lib/stub/note'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

enableFetchMocks()

describe('createNoteJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor | null | undefined

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor1 = await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('persists validated blurhash and focalPoint from inbound note attachments', async () => {
    const noteId = `https://${actor1!.domain}/notes/attachment-focal-test-${Date.now()}`
    const note = {
      ...MockMastodonActivityPubNote({
        id: noteId,
        from: actor1!.id,
        content: '<p>Photo with blurhash and focal point</p>'
      }),
      attachment: [
        {
          type: 'Document',
          mediaType: 'image/jpeg',
          url: 'https://somewhere.test/media/photo.jpg',
          width: 1200,
          height: 800,
          name: 'A scenic mountain',
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          focalPoint: [-0.4, 0.6]
        }
      ]
    }

    await createNoteJob(database, {
      id: 'id-attachment-focal',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actor1!.id
    })

    const attachments = await database.getAttachments({ statusId: noteId })
    expect(attachments).toHaveLength(1)
    expect(attachments[0].blurhash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj')
    expect(attachments[0].focus).toEqual({ x: -0.4, y: 0.6 })
  })

  it('sanitizes invalid blurhash and focalPoint from inbound note attachments', async () => {
    const noteId = `https://${actor1!.domain}/notes/attachment-invalid-test-${Date.now()}`
    const note = {
      ...MockMastodonActivityPubNote({
        id: noteId,
        from: actor1!.id,
        content: '<p>Photo with invalid meta</p>'
      }),
      attachment: [
        {
          type: 'Document',
          mediaType: 'image/jpeg',
          url: 'https://somewhere.test/media/photo2.jpg',
          width: 1200,
          height: 800,
          name: 'A photo',
          blurhash: 'invalid blurhash with spaces',
          focalPoint: [2.5, -3.0] // out of [-1, 1] range
        }
      ]
    }

    await createNoteJob(database, {
      id: 'id-attachment-invalid',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actor1!.id
    })

    const attachments = await database.getAttachments({ statusId: noteId })
    expect(attachments).toHaveLength(1)
    expect(attachments[0].blurhash).toBeUndefined()
    expect(attachments[0].focus).toBeUndefined()
  })

  // The validator compares the trimmed form, so a padded hash was approved
  // and then persisted verbatim — `decode` threw on every render and the
  // padded value was federated on to third-party clients as-is.
  it('stores a padded blurhash in the form decode can read', async () => {
    const hash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    const noteId = `https://${actor1!.domain}/notes/attachment-padded-test-${Date.now()}`
    const note = {
      ...MockMastodonActivityPubNote({
        id: noteId,
        from: actor1!.id,
        content: '<p>Photo with a padded blurhash</p>'
      }),
      attachment: [
        {
          type: 'Document',
          mediaType: 'image/jpeg',
          url: 'https://somewhere.test/media/photo3.jpg',
          width: 1200,
          height: 800,
          name: 'A photo',
          blurhash: `  ${hash}\n`
        }
      ]
    }

    await createNoteJob(database, {
      id: 'id-attachment-padded',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actor1!.id
    })

    const attachments = await database.getAttachments({ statusId: noteId })
    expect(attachments).toHaveLength(1)
    const stored = attachments[0].blurhash
    expect(stored).toBe(hash)
    expect(() => decode(stored as string, 32, 32)).not.toThrow()
  })

  it('persists playbackType and previewUrl for resolved animated GIFV attachments', async () => {
    const spy = vi
      .spyOn(animationMetadataService, 'resolveAnimationMetadata')
      .mockResolvedValueOnce({
        'https://files.mastodon.social/video.mp4': {
          playbackType: 'gifv',
          previewUrl: 'https://files.mastodon.social/preview.jpg'
        }
      })

    try {
      const noteId = `https://${actor1!.domain}/notes/attachment-gifv-test-${Date.now()}`
      const note = MockMastodonActivityPubNote({
        id: noteId,
        from: actor1!.id,
        content: '<p>GIFV post</p>',
        documents: [
          {
            type: 'Document',
            mediaType: 'video/mp4',
            url: 'https://files.mastodon.social/video.mp4',
            name: 'GIF animation'
          }
        ]
      })

      await createNoteJob(database, {
        id: 'id-attachment-gifv',
        name: CREATE_NOTE_JOB_NAME,
        data: note,
        verifiedSenderActorId: actor1!.id
      })

      const attachments = await database.getAttachments({ statusId: noteId })
      expect(attachments).toHaveLength(1)
      expect(attachments[0].playbackType).toBe('gifv')
      expect(attachments[0].thumbnailUrl).toBe(
        'https://files.mastodon.social/preview.jpg'
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('preserves existing thumbnailUrl for image attachments when animation metadata is absent', async () => {
    const noteId = `https://${actor1!.domain}/notes/attachment-img-test-${Date.now()}`
    const note = MockMastodonActivityPubNote({
      id: noteId,
      from: actor1!.id,
      content: '<p>Image post</p>',
      documents: [
        {
          type: 'Document',
          mediaType: 'image/jpeg',
          url: 'https://files.mastodon.social/image.jpg',
          name: 'Photo',
          thumbnailUrl: 'https://files.mastodon.social/thumb.jpg'
        }
      ]
    })

    await createNoteJob(database, {
      id: 'id-attachment-image',
      name: CREATE_NOTE_JOB_NAME,
      data: note,
      verifiedSenderActorId: actor1!.id
    })

    const attachments = await database.getAttachments({ statusId: noteId })
    expect(attachments).toHaveLength(1)
    expect(attachments[0].thumbnailUrl).toBe(
      'https://files.mastodon.social/thumb.jpg'
    )
  })
})
