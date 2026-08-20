import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  DeleteStatusLinkPreviewParams,
  GetLinkPreviewParams,
  GetStatusLinkPreviewsParams,
  LinkPreviewDatabase,
  LinkPreviewFetchStatus,
  LinkPreviewRecord,
  LinkStatusLinkPreviewParams,
  UpsertLinkPreviewParams
} from '@/lib/types/database/operations'

type LinkPreviewRow = {
  urlHash: string
  url: string
  type: string
  title: string | null
  description: string | null
  siteName: string | null
  authorName: string | null
  authorUrl: string | null
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
  publishedAt: number | Date | string | null
  fetchStatus: string
  error: string | null
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const LINK_PREVIEW_COLUMNS = [
  'urlHash',
  'url',
  'type',
  'title',
  'description',
  'siteName',
  'authorName',
  'authorUrl',
  'imageUrl',
  'imageWidth',
  'imageHeight',
  'publishedAt',
  'fetchStatus',
  'error',
  'createdAt',
  'updatedAt'
] as const

const fixLinkPreviewRow = (row: LinkPreviewRow): LinkPreviewRecord => ({
  urlHash: row.urlHash,
  url: row.url,
  type: row.type,
  title: row.title ?? null,
  description: row.description ?? null,
  siteName: row.siteName ?? null,
  authorName: row.authorName ?? null,
  authorUrl: row.authorUrl ?? null,
  imageUrl: row.imageUrl ?? null,
  // SQLite hands integers back as numbers but PostgreSQL can widen them to
  // strings; normalise so callers never see a numeric string.
  imageWidth: row.imageWidth === null ? null : Number(row.imageWidth),
  imageHeight: row.imageHeight === null ? null : Number(row.imageHeight),
  publishedAt:
    row.publishedAt === null ? null : getCompatibleTime(row.publishedAt),
  fetchStatus: row.fetchStatus as LinkPreviewFetchStatus,
  error: row.error ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const LinkPreviewSQLDatabaseMixin = (
  database: Knex
): LinkPreviewDatabase => {
  const getLinkPreviewRow = (
    db: Knex | Knex.Transaction,
    urlHash: string
  ): Promise<LinkPreviewRow | undefined> =>
    db<LinkPreviewRow>('link_previews')
      .where('urlHash', urlHash)
      .first(...LINK_PREVIEW_COLUMNS)

  return {
    async upsertLinkPreview({
      urlHash,
      url,
      type = 'link',
      title = null,
      description = null,
      siteName = null,
      authorName = null,
      authorUrl = null,
      imageUrl = null,
      imageWidth = null,
      imageHeight = null,
      publishedAt = null,
      fetchStatus,
      error = null
    }: UpsertLinkPreviewParams): Promise<LinkPreviewRecord> {
      const currentTime = new Date()
      const values = {
        url,
        type,
        title,
        description,
        siteName,
        authorName,
        authorUrl,
        imageUrl,
        imageWidth,
        imageHeight,
        publishedAt: publishedAt === null ? null : new Date(publishedAt),
        fetchStatus,
        error
      }
      return database.transaction(async (trx) => {
        const existing = await getLinkPreviewRow(trx, urlHash)
        if (existing) {
          // A re-fetch always replaces the stored card: a page that changed its
          // metadata — or started failing — must not keep serving the old one.
          await trx('link_previews')
            .where('urlHash', urlHash)
            .update({ ...values, updatedAt: currentTime })
        } else {
          await trx('link_previews')
            .insert({
              urlHash,
              ...values,
              createdAt: currentTime,
              updatedAt: currentTime
            })
            // Two jobs can fetch the same new URL concurrently; the loser's
            // insert is dropped rather than raising, and the read below returns
            // whichever row landed.
            .onConflict('urlHash')
            .ignore()
        }
        const row = await getLinkPreviewRow(trx, urlHash)
        // The row was written in this transaction, so it always exists.
        return fixLinkPreviewRow(row as LinkPreviewRow)
      })
    },

    async getLinkPreview({
      urlHash
    }: GetLinkPreviewParams): Promise<LinkPreviewRecord | null> {
      const row = await getLinkPreviewRow(database, urlHash)
      return row ? fixLinkPreviewRow(row) : null
    },

    async linkStatusLinkPreview({
      statusId,
      urlHash
    }: LinkStatusLinkPreviewParams): Promise<void> {
      const currentTime = new Date()
      await database.transaction(async (trx) => {
        const existing = await trx('status_link_previews')
          .where('statusId', statusId)
          .first('statusId')
        if (existing) {
          // An edit can move a status from one card to another.
          await trx('status_link_previews')
            .where('statusId', statusId)
            .update({ urlHash, updatedAt: currentTime })
          return
        }
        await trx('status_link_previews')
          .insert({
            statusId,
            urlHash,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .onConflict('statusId')
          .ignore()
      })
    },

    async getStatusLinkPreviews({
      statusIds
    }: GetStatusLinkPreviewsParams): Promise<Map<string, LinkPreviewRecord>> {
      if (statusIds.length === 0) return new Map()

      // One join for the whole page. Only completed cards are hydrated — a
      // pending fetch or a negative-cache entry renders nothing.
      const rows = await database('status_link_previews')
        .join(
          'link_previews',
          'status_link_previews.urlHash',
          'link_previews.urlHash'
        )
        .whereIn('status_link_previews.statusId', statusIds)
        .where('link_previews.fetchStatus', 'completed')
        .select(
          'status_link_previews.statusId as statusId',
          ...LINK_PREVIEW_COLUMNS.map(
            (column) => `link_previews.${column} as ${column}`
          )
        )

      return new Map(
        (rows as (LinkPreviewRow & { statusId: string })[]).map((row) => [
          row.statusId,
          fixLinkPreviewRow(row)
        ])
      )
    },

    async deleteStatusLinkPreview({
      statusId
    }: DeleteStatusLinkPreviewParams): Promise<void> {
      // Only the status→card link goes; the per-url cache stays for every other
      // status showing the same page.
      await database('status_link_previews')
        .where('statusId', statusId)
        .delete()
    }
  }
}
