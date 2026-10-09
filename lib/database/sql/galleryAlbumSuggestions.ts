import { Knex } from 'knex'

import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'

// The one read the album suggestions need from the album tables: which of some
// media each of the owner's albums already holds, so a suggestion an album
// already covers is not offered again.

// Bindings a batch spends beyond its `whereIn` list: the actor id twice.
const RESERVED_BINDINGS = 8

export interface GetGalleryAlbumItemSetsParams {
  actorId: string
  // The candidate media ids (the decimal `medias.id`). Only items among them are
  // read, in batches: a suggestion is covered when one album holds ALL its
  // photos, so an album's other items never matter.
  mediaIds: string[]
}

export interface GalleryAlbumItemSet {
  albumId: string
  // Media ids (the decimal `medias.id`), only those asked about.
  mediaIds: string[]
}

export interface GalleryAlbumSuggestionDatabase {
  // Owner data. Of the asked media ids, the ones each of the actor's albums
  // holds, whether or not the photo is still visible: an album that holds a
  // photo covers it. Albums holding none of them are left out.
  getGalleryAlbumItemSets(
    params: GetGalleryAlbumItemSetsParams
  ): Promise<GalleryAlbumItemSet[]>
}

export const GalleryAlbumSuggestionSQLDatabaseMixin = (
  database: Knex
): GalleryAlbumSuggestionDatabase => ({
  async getGalleryAlbumItemSets({ actorId, mediaIds }) {
    const rowIds = [
      ...new Set(
        mediaIds.filter((id) => /^\d{1,15}$/.test(id)).map((id) => Number(id))
      )
    ]
    const sets = new Map<string, Set<string>>()
    for (const chunk of chunkArray(
      rowIds,
      getWhereInBatchSize(database, RESERVED_BINDINGS)
    )) {
      const rows: Array<{ albumId: string; mediaId: string | number }> =
        await database('gallery_album_items as album_items')
          .innerJoin(
            'gallery_albums as albums',
            'albums.id',
            'album_items.albumId'
          )
          .where('albums.actorId', actorId)
          .where('album_items.actorId', actorId)
          .whereIn('album_items.mediaId', chunk)
          .select(
            'album_items.albumId as albumId',
            'album_items.mediaId as mediaId'
          )
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
})
