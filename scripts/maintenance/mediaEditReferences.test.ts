import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'

import { getMediaEditReferencedPaths } from './mediaEditReferences'

describe('getMediaEditReferencedPaths', () => {
  const testDb = createTestDatabase()
  const { database } = testDb

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  it('counts edit files and the original upload key as referenced', async () => {
    const accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!
      .account!.id
    const media = (await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: 'medias/cleanup-uploaded.webp',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: {
          width: 40,
          height: 30,
          upload: { state: 'verified', clientPath: 'uploads/cleanup.jpg' }
        }
      }
    }))!
    for (const [index, name] of ['first', 'second'].entries()) {
      await database.applyMediaEdit({
        mediaId: media.id,
        accountId,
        baseVersion: index,
        saveId: name,
        recipe: '{"v":1}',
        render: {
          path: `medias/cleanup-${name}.webp`,
          bytes: 100,
          mimeType: 'image/webp',
          width: 40,
          height: 30,
          blurhash: null,
          focus: null
        }
      })
    }

    const paths = await getMediaEditReferencedPaths(testDb.knex)

    // The live second render is a `medias` row reference, not an edit file.
    expect(paths.sort()).toEqual([
      'medias/cleanup-first.webp',
      'medias/cleanup-uploaded.webp',
      'uploads/cleanup.jpg'
    ])
  })
})
