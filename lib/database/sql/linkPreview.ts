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
  RecordLinkPreviewFailureParams,
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
        // A successful re-fetch always replaces the stored card: a page that
        // changed its metadata must not keep serving the old one. `merge` (not
        // `ignore`) so that when two jobs fetch the same new URL at once, the
        // freshly-parsed metadata wins rather than being silently dropped in
        // favour of whichever transaction happened to insert first.
        await trx('link_previews')
          .insert({
            urlHash,
            ...values,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .onConflict('urlHash')
          .merge({ ...values, updatedAt: currentTime })

        const row = await getLinkPreviewRow(trx, urlHash)
        if (!row) {
          // Unreachable in practice — the row was just written in this
          // transaction — but throwing beats casting `undefined` into a
          // record and returning a half-built card to a caller.
          throw new Error(
            `link_previews row missing immediately after upsert: ${urlHash}`
          )
        }
        return fixLinkPreviewRow(row)
      })
    },

    async recordLinkPreviewFailure({
      urlHash,
      url,
      error
    }: RecordLinkPreviewFailureParams): Promise<void> {
      const currentTime = new Date()
      await database.transaction(async (trx) => {
        const existing = await getLinkPreviewRow(trx, urlHash)

        if (existing?.fetchStatus === 'completed') {
          // Keep the working card. Only the error and the timestamp move, so
          // every status linking this page keeps rendering while the refresh is
          // simply deferred to the next refresh window rather than retried
          // against a host that just failed.
          await trx('link_previews')
            .where('urlHash', urlHash)
            .update({ error, updatedAt: currentTime })
          return
        }

        if (existing) {
          await trx('link_previews')
            .where('urlHash', urlHash)
            .update({ fetchStatus: 'failed', error, updatedAt: currentTime })
          return
        }

        await trx('link_previews')
          .insert({
            urlHash,
            url,
            type: 'link',
            fetchStatus: 'failed',
            error,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          // A concurrent fetch of the same new URL may have inserted first; a
          // failure must never overwrite whatever it stored.
          .onConflict('urlHash')
          .ignore()
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
