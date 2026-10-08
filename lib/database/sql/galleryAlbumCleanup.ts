import { Knex } from 'knex'

/**
 * Drops one media from every album when the media row goes: removes its
 * `gallery_album_items` and clears any album cover that pointed at it. Both
 * tables cascade or are plain columns, but SQLite runs without foreign keys, so
 * every media delete path calls this inside its own transaction. Kept apart
 * from `galleryAlbums.ts` so `media.ts` can import it without a cycle.
 */
export const removeMediaFromGalleryAlbums = async (
  trx: Knex.Transaction,
  mediaId: number
): Promise<void> => {
  await trx('gallery_album_items').where('mediaId', mediaId).del()
  await trx('gallery_albums')
    .where('coverMediaId', mediaId)
    .update({ coverMediaId: null })
}
