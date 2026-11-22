import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  readSearchDocument,
  seedStatus
} from '@/lib/database/testing/searchTestHelpers'

// The writes that change something a status shows besides its own row refresh
// that status's search document, so the extra text it holds (attachment alt
// text, a photo's species, an activity's type) does not go stale.

const DOMAIN = 'reindex-hooks.test'

describe('status search re-index hooks', () => {
  const testDb = createTestDatabase()
  const { database, db } = testDb

  const newOwner = async (key: string) => {
    const accountId = `account-${key}`
    const actorId = `https://${DOMAIN}/users/${key}`
    await db.insertInto('accounts').values({ id: accountId }).execute()
    await db
      .insertInto('actors')
      .values({
        id: actorId,
        username: key,
        domain: DOMAIN,
        accountId,
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .execute()
    return { accountId, actorId }
  }

  const documentTextOf = async (statusId: string) =>
    (await readSearchDocument(db, 'status', statusId))?.documentText

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('refreshes the status document when a media subject changes', async () => {
    const owner = await newOwner('media')
    const statusId = `${owner.actorId}/statuses/media-hook`
    await seedStatus(db, {
      id: statusId,
      actorId: owner.actorId,
      createdAt: 1,
      text: 'media hook base'
    })
    const media = await db
      .insertInto('medias')
      .values({
        actorId: owner.actorId,
        original: 'medias/media-hook.jpg',
        originalBytes: 1000,
        originalMimeType: 'image/jpeg',
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    await db
      .insertInto('attachments')
      .values({
        id: `${statusId}/attachments/photo`,
        actorId: owner.actorId,
        statusId,
        type: 'Document',
        mediaType: 'image/jpeg',
        url: `https://${DOMAIN}/media/photo.jpg`,
        name: 'A bird',
        mediaId: media.id,
        isRouteMap: false,
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .execute()
    await database.indexStatusSearchDocument({ statusId })
    expect(await documentTextOf(statusId)).not.toContain('kingfisher')

    await database.updateMedia({
      mediaId: String(media.id),
      accountId: owner.accountId,
      details: { subjectName: 'Kingfisher' }
    })

    expect(await documentTextOf(statusId)).toContain('kingfisher')
  })

  it('refreshes the status document when a fitness file is linked', async () => {
    const owner = await newOwner('fitness-link')
    const statusId = `${owner.actorId}/statuses/fitness-link`
    await seedStatus(db, {
      id: statusId,
      actorId: owner.actorId,
      createdAt: 1,
      text: 'fitness link base'
    })
    const fitnessFileId = `${statusId}/fitness/ride`
    await db
      .insertInto('fitness_files')
      .values({
        id: fitnessFileId,
        actorId: owner.actorId,
        path: 'fitness/ride.fit',
        fileName: 'ride.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 100,
        activityType: 'ride',
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .execute()
    await database.indexStatusSearchDocument({ statusId })
    expect(await documentTextOf(statusId)).not.toContain('cycling')

    await database.updateFitnessFileStatus(fitnessFileId, statusId)

    expect(await documentTextOf(statusId)).toContain('cycling')
  })

  it('refreshes the status document when a fitness file finishes processing', async () => {
    const owner = await newOwner('fitness-complete')
    const statusId = `${owner.actorId}/statuses/fitness-complete`
    await seedStatus(db, {
      id: statusId,
      actorId: owner.actorId,
      createdAt: 1,
      text: 'fitness complete base'
    })
    const fitnessFileId = `${statusId}/fitness/run`
    await db
      .insertInto('fitness_files')
      .values({
        id: fitnessFileId,
        actorId: owner.actorId,
        statusId,
        path: 'fitness/run.fit',
        fileName: 'run.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 100,
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      .execute()
    await database.indexStatusSearchDocument({ statusId })
    expect(await documentTextOf(statusId)).not.toContain('running')

    // The processing run writes the activity type before it reports completion.
    await db
      .updateTable('fitness_files')
      .set({ activityType: 'run' })
      .where('id', '=', fitnessFileId)
      .execute()
    await database.updateFitnessFileProcessingStatus(fitnessFileId, 'completed')

    expect(await documentTextOf(statusId)).toContain('running')
  })

  it('refreshes the status document when its remote attachments are replaced', async () => {
    const owner = await newOwner('remote')
    const statusId = `${owner.actorId}/statuses/remote-hook`
    await seedStatus(db, {
      id: statusId,
      actorId: owner.actorId,
      createdAt: 1,
      text: 'remote hook base'
    })
    await database.indexStatusSearchDocument({ statusId })
    expect(await documentTextOf(statusId)).not.toContain('fresh alt')

    await database.replaceRemoteAttachmentsForStatus({
      statusId,
      attachments: [
        {
          actorId: owner.actorId,
          statusId,
          mediaType: 'image/jpeg',
          url: `https://${DOMAIN}/media/fresh.jpg`,
          name: 'Fresh alt',
          createdAt: 9000
        }
      ]
    })

    expect(await documentTextOf(statusId)).toContain('fresh alt')
  })
})
