import { DELETED_ATTACHMENT_MEDIA_TTL_MS } from '@/lib/database/domains/media/types'
import {
  createIsolatedActorFactory,
  extraActorId,
  primaryActorId
} from '@/lib/database/domains/status/statusTestHelpers'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('deleted_attachment_media domain lifecycle', () => {
  const testDb = createTestDatabase({ isolated: true })

  beforeAll(async () => {
    await testDb.prepare()
    await testDb.database.migrate()
    await seedDatabase(testDb.database)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const createVerifiedMedia = async (actorId: string, label: string) => {
    const media = await testDb.database.createMedia({
      actorId,
      original: {
        path: `/uploads/${label}.jpg`,
        bytes: 1024,
        mimeType: 'image/jpeg',
        metaData: { width: 800, height: 600 }
      },
      description: `Description for ${label}`
    })
    if (!media) {
      throw new Error(`Expected media creation to succeed for ${label}`)
    }
    return media
  }

  it('records both attachment-to-media mappings when deleting a status with two media attachments', async () => {
    const suffix = `${Date.now()}-two-media`
    const mediaOne = await createVerifiedMedia(primaryActorId, `${suffix}-1`)
    const mediaTwo = await createVerifiedMedia(primaryActorId, `${suffix}-2`)
    const foreignMedia = await createVerifiedMedia(
      extraActorId,
      `${suffix}-foreign`
    )

    const statusId = `${primaryActorId}/statuses/${suffix}`
    await testDb.database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Status with two local attachments'
    })

    const attachmentOne = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-1.jpg`,
      width: 800,
      height: 600,
      name: 'First image',
      mediaId: mediaOne.id
    })
    const attachmentTwo = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-2.jpg`,
      width: 800,
      height: 600,
      name: 'Second image',
      mediaId: mediaTwo.id
    })
    const remoteAttachment = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://remote.test/files/${suffix}-remote.jpg`,
      width: 800,
      height: 600,
      name: 'Remote image'
    })
    const mismatchedActorAttachment = await testDb.database.createAttachment({
      actorId: extraActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-foreign.jpg`,
      width: 800,
      height: 600,
      name: 'Mismatched actor image',
      mediaId: foreignMedia.id
    })

    // Editing a status to drop an attachment must NOT record a redraft mapping.
    const editedStatusId = `${primaryActorId}/statuses/${suffix}-edited`
    const editedMedia = await createVerifiedMedia(
      primaryActorId,
      `${suffix}-edit`
    )
    await testDb.database.createNote({
      id: editedStatusId,
      url: editedStatusId,
      actorId: primaryActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Before edit'
    })
    const editedAttachment = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId: editedStatusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-edit.jpg`,
      width: 800,
      height: 600,
      mediaId: editedMedia.id
    })
    await testDb.database.updateNote({
      statusId: editedStatusId,
      text: 'After edit removing attachment',
      attachments: []
    })

    await testDb.database.deleteStatus({ statusId })

    const mappings = await testDb.database.getDeletedAttachmentMediaIds({
      actorId: primaryActorId,
      attachmentIds: [
        attachmentOne.id,
        attachmentTwo.id,
        remoteAttachment.id,
        mismatchedActorAttachment.id,
        editedAttachment.id
      ]
    })

    expect(mappings).toEqual(
      new Map([
        [attachmentOne.id, mediaOne.id],
        [attachmentTwo.id, mediaTwo.id]
      ])
    )
    expect(
      await testDb.database.getDeletedAttachmentMediaIds({
        actorId: primaryActorId,
        attachmentIds: []
      })
    ).toEqual(new Map())
  })

  it('tolerates a repeated delete and conflicting existing mappings', async () => {
    const suffix = `${Date.now()}-repeat`
    const mediaOne = await createVerifiedMedia(primaryActorId, `${suffix}-1`)
    const mediaTwo = await createVerifiedMedia(primaryActorId, `${suffix}-2`)

    const statusId = `${primaryActorId}/statuses/${suffix}`
    await testDb.database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Status deleted twice'
    })
    const attachmentOne = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-1.jpg`,
      mediaId: mediaOne.id
    })
    const attachmentTwo = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}-2.jpg`,
      mediaId: mediaTwo.id
    })

    // Pre-insert attachmentOne to exercise primary-key conflict handling.
    await testDb.db
      .insertInto('deleted_attachment_media')
      .values({
        attachmentId: attachmentOne.id,
        actorId: primaryActorId,
        mediaId: Number(mediaOne.id),
        createdAt: new Date()
      })
      .execute()

    await expect(
      testDb.database.deleteStatus({ statusId })
    ).resolves.toBeUndefined()
    await expect(
      testDb.database.deleteStatus({ statusId })
    ).resolves.toBeUndefined()

    const mappings = await testDb.database.getDeletedAttachmentMediaIds({
      actorId: primaryActorId,
      attachmentIds: [attachmentOne.id, attachmentTwo.id]
    })
    expect(mappings).toEqual(
      new Map([
        [attachmentOne.id, mediaOne.id],
        [attachmentTwo.id, mediaTwo.id]
      ])
    )
  })

  it('omits mappings older than 7 days on lookup and prunes them on status deletion', async () => {
    const suffix = `${Date.now()}-ttl`
    const expiredAttachmentId = `expired-attachment-${suffix}`
    const freshAttachmentId = `fresh-attachment-${suffix}`
    const expiredMedia = await createVerifiedMedia(
      primaryActorId,
      `${suffix}-expired`
    )
    const freshMedia = await createVerifiedMedia(
      primaryActorId,
      `${suffix}-fresh`
    )

    await testDb.db
      .insertInto('deleted_attachment_media')
      .values([
        {
          attachmentId: expiredAttachmentId,
          actorId: primaryActorId,
          mediaId: Number(expiredMedia.id),
          createdAt: new Date(
            Date.now() - DELETED_ATTACHMENT_MEDIA_TTL_MS - 60_000
          )
        },
        {
          attachmentId: freshAttachmentId,
          actorId: primaryActorId,
          mediaId: Number(freshMedia.id),
          createdAt: new Date()
        }
      ])
      .execute()

    const beforePruneLookup =
      await testDb.database.getDeletedAttachmentMediaIds({
        actorId: primaryActorId,
        attachmentIds: [expiredAttachmentId, freshAttachmentId]
      })
    expect(beforePruneLookup).toEqual(
      new Map([[freshAttachmentId, freshMedia.id]])
    )

    const triggerStatusId = `${primaryActorId}/statuses/${suffix}-prune`
    await testDb.database.createNote({
      id: triggerStatusId,
      url: triggerStatusId,
      actorId: primaryActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Status deletion that prunes expired mappings'
    })
    await testDb.database.deleteStatus({ statusId: triggerStatusId })

    const remainingRows = await testDb.db
      .selectFrom('deleted_attachment_media')
      .select('attachmentId')
      .where('attachmentId', 'in', [expiredAttachmentId, freshAttachmentId])
      .execute()
    expect(remainingRows.map((row) => row.attachmentId)).toEqual([
      freshAttachmentId
    ])
  })

  it('returns nothing when another actor looks up the deleted status attachment ids', async () => {
    const suffix = `${Date.now()}-other-actor`
    const media = await createVerifiedMedia(primaryActorId, suffix)
    const statusId = `${primaryActorId}/statuses/${suffix}`
    await testDb.database.createNote({
      id: statusId,
      url: statusId,
      actorId: primaryActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Owner-only redraft mapping'
    })
    const attachment = await testDb.database.createAttachment({
      actorId: primaryActorId,
      statusId,
      mediaType: 'image/jpeg',
      url: `https://llun.test/files/${suffix}.jpg`,
      mediaId: media.id
    })

    await testDb.database.deleteStatus({ statusId })

    expect(
      await testDb.database.getDeletedAttachmentMediaIds({
        actorId: primaryActorId,
        attachmentIds: [attachment.id]
      })
    ).toEqual(new Map([[attachment.id, media.id]]))

    expect(
      await testDb.database.getDeletedAttachmentMediaIds({
        actorId: extraActorId,
        attachmentIds: [attachment.id]
      })
    ).toEqual(new Map())
  })

  it('removes the actor mappings from deleted_attachment_media when deleteActorData runs', async () => {
    const suffix = `${Date.now()}-actor-delete`
    const createIsolatedActor = createIsolatedActorFactory(testDb.database)
    const doomedActorId = await createIsolatedActor(`redraft-${suffix}`)
    const doomedAttachmentId = `doomed-attachment-${suffix}`
    const survivorAttachmentId = `survivor-attachment-${suffix}`

    await testDb.db
      .insertInto('deleted_attachment_media')
      .values([
        {
          attachmentId: doomedAttachmentId,
          actorId: doomedActorId,
          mediaId: 101,
          createdAt: new Date()
        },
        {
          attachmentId: survivorAttachmentId,
          actorId: primaryActorId,
          mediaId: 102,
          createdAt: new Date()
        }
      ])
      .execute()

    await testDb.database.deleteActorData({ actorId: doomedActorId })

    const remainingRows = await testDb.db
      .selectFrom('deleted_attachment_media')
      .select('attachmentId')
      .where('attachmentId', 'in', [doomedAttachmentId, survivorAttachmentId])
      .execute()
    expect(remainingRows.map((row) => row.attachmentId)).toEqual([
      survivorAttachmentId
    ])
  })
})
