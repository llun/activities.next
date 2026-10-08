import { buildGalleryMediaScope } from '@/lib/database/sql/galleryMedia'
import { getTestSQLDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'

// `attachments.mediaId` is varchar on SQLite and `medias.id` an integer. Compared
// directly, SQLite converts the varchar side to a number and cannot use
// `attachments_mediaId_idx`, so every media row rescans the owner's attachments.
// SQLite ONLY: PostgreSQL and MySQL compare the integer column directly.
describe('gallery scope query plan on SQLite', () => {
  const planOf = async (
    audience: typeof OWNER_GALLERY_AUDIENCE | typeof PUBLIC_GALLERY_AUDIENCE
  ) => {
    const { database, instance } = getTestSQLDatabaseWithInstance()
    try {
      await database.migrate()
      const query = instance('medias').select('medias.id')
      buildGalleryMediaScope(instance, 'actor', audience)(query)
      const rows = (await instance.raw(
        `explain query plan ${query.toString()}`
      )) as {
        detail: string
      }[]
      return rows.map((row) => row.detail).join('\n')
    } finally {
      await instance.destroy()
    }
  }

  it.each([
    ['owner', OWNER_GALLERY_AUDIENCE],
    ['logged out', PUBLIC_GALLERY_AUDIENCE]
  ])(
    'probes attachments_mediaId_idx for the %s audience',
    async (_, audience) => {
      const plan = await planOf(audience)

      expect(plan).toContain('USING INDEX attachments_mediaId_idx (mediaId=?)')
    }
  )

  it('stores a canonical media id however the caller spells it', async () => {
    const { database, instance } = getTestSQLDatabaseWithInstance()
    try {
      await database.migrate()
      for (const mediaId of ['12', '12.0', '012']) {
        await database.createAttachment({
          actorId: 'actor',
          statusId: 'status',
          mediaType: 'image/jpeg',
          url: `https://media.test/${mediaId}.jpg`,
          mediaId
        })
      }

      const rows = await instance('attachments').select('mediaId')
      expect(rows.map((row) => row.mediaId)).toEqual(['12', '12', '12'])
    } finally {
      await instance.destroy()
    }
  })
})
