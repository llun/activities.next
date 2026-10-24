import type {
  GalleryAlbumItemSet,
  GetGalleryAlbumItemSetsParams
} from '@/lib/database/domains/gallery/types'
import { toMediaRowId } from '@/lib/database/domains/media/rows'
import type { Db } from '@/lib/database/kysely'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'

// The one read the album suggestions need from the album tables (see
// GalleryAlbumSuggestionDatabase in ./types.ts).

// Bindings a batch spends beyond its `in` list: the actor id twice.
const RESERVED_BINDINGS = 8

export const getGalleryAlbumItemSets = async (
  db: Db,
  { actorId, mediaIds }: GetGalleryAlbumItemSetsParams
): Promise<GalleryAlbumItemSet[]> => {
  // Out-of-range ids (above the 32-bit integer column) match nothing, so drop them here.
  const rowIds = [
    ...new Set(
      mediaIds
        .map((id) => toMediaRowId(String(id)))
        .filter((id): id is number => id !== null)
    )
  ]
  const sets = new Map<string, Set<string>>()
  for (const chunk of chunkArray(
    rowIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const rows = await db
      .selectFrom('gallery_album_items as album_items')
      .innerJoin('gallery_albums as albums', 'albums.id', 'album_items.albumId')
      .select([
        'album_items.albumId as albumId',
        'album_items.mediaId as mediaId'
      ])
      .where('albums.actorId', '=', actorId)
      .where('album_items.actorId', '=', actorId)
      .where('album_items.mediaId', 'in', chunk)
      .execute()
    for (const row of rows) {
      const ids = sets.get(row.albumId)
      if (ids) ids.add(String(row.mediaId))
      else sets.set(row.albumId, new Set([String(row.mediaId)]))
    }
  }
  return [...sets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([albumId, ids]) => ({ albumId, mediaIds: [...ids] }))
}
