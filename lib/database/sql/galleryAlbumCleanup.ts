import { Knex } from 'knex'

import { isPostgresClient } from '@/lib/database/sql/utils/knex'

/**
 * Serialises one actor's album writes on their actor row, as the gear creates
 * do: caps, cover checks and media deletes all take it first, in that order,
 * so none of them can interleave with another and a cover never names a media
 * that is no longer an item. SQLite's single writer connection already
 * serialises transactions, so the lock is PostgreSQL-only. Take it before
 * touching any album or media row, so two transactions never wait on each
 * other's row locks.
 */
export const lockGalleryAlbumActor = async (
  trx: Knex.Transaction,
  actorId: string
): Promise<void> => {
  const lock = trx('actors').where({ id: actorId }).select('id')
  if (isPostgresClient(trx)) lock.forUpdate()
  await lock
}

/**
 * Drops one media from every album when the media row goes: removes its
 * `gallery_album_items` and clears any album cover that pointed at it. Items
 * cascade on PostgreSQL and covers are a plain column, and SQLite runs without
 * foreign keys, so every media delete path calls this inside its own
 * transaction, after `lockGalleryAlbumActor` for the media's owner and before
 * it deletes the `medias` row. Kept apart from `galleryAlbums.ts` so
 * `media.ts` can import it without a cycle.
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
