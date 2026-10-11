import type { Db } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'

/**
 * Serialises one actor's album writes on their actor row, as the gear creates
 * do: caps, cover checks and media deletes all take it first, in that order,
 * so none of them can interleave with another and a cover never names a media
 * that is no longer an item. SQLite's single writer connection already
 * serialises transactions, so the lock is PostgreSQL-only. Take it before
 * touching any album or media row, so two transactions never wait on each
 * other's row locks.
 *
 * The album writes in lib/database/domains/gallery/albums.ts take it first
 * inside their own transaction.
 */
export const lockGalleryAlbumActor = async (
  db: Db,
  actorId: string
): Promise<void> => {
  await forUpdate(
    db,
    db.selectFrom('actors').select('id').where('id', '=', actorId)
  ).execute()
}

/**
 * Drops one media from every album when the media row goes: removes its
 * `gallery_album_items` and clears any album cover that pointed at it. Items
 * cascade on PostgreSQL and covers are a plain column, and SQLite may run
 * without foreign keys, so every media delete path calls this inside its own
 * transaction, after `lockGalleryAlbumActor` for the media's owner and before
 * it deletes the `medias` row.
 */
export const removeMediaFromGalleryAlbums = async (
  db: Db,
  mediaId: number
): Promise<void> => {
  await db
    .deleteFrom('gallery_album_items')
    .where('mediaId', '=', mediaId)
    .execute()
  await db
    .updateTable('gallery_albums')
    .set({ coverMediaId: null })
    .where('coverMediaId', '=', mediaId)
    .execute()
}
