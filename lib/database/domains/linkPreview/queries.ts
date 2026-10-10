import type {
  DeleteStatusLinkPreviewParams,
  GetLinkPreviewParams,
  GetStatusLinkPreviewsParams,
  LinkPreviewFetchStatus,
  LinkPreviewRecord,
  LinkStatusLinkPreviewParams,
  RecordLinkPreviewFailureParams,
  UpsertLinkPreviewParams
} from '@/lib/database/domains/linkPreview/types'
import { type Db, inTransaction } from '@/lib/database/kysely'

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
  publishedAt: number | null
  fetchStatus: string
  error: string | null
  createdAt: number | null
  updatedAt: number | null
}

const toLinkPreviewRecord = (row: LinkPreviewRow): LinkPreviewRecord => ({
  urlHash: row.urlHash,
  url: row.url,
  type: row.type,
  title: row.title ?? null,
  description: row.description ?? null,
  siteName: row.siteName ?? null,
  authorName: row.authorName ?? null,
  authorUrl: row.authorUrl ?? null,
  imageUrl: row.imageUrl ?? null,
  imageWidth: row.imageWidth ?? null,
  imageHeight: row.imageHeight ?? null,
  publishedAt: row.publishedAt ?? null,
  fetchStatus: row.fetchStatus as LinkPreviewFetchStatus,
  error: row.error ?? null,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const getLinkPreviewRow = (db: Db, urlHash: string) =>
  db
    .selectFrom('link_previews')
    .selectAll()
    .where('urlHash', '=', urlHash)
    .limit(1)
    .executeTakeFirst()

export const upsertLinkPreview = (
  db: Db,
  {
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
  }: UpsertLinkPreviewParams
): Promise<LinkPreviewRecord> => {
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
  return inTransaction(db, async (trx) => {
    // A successful re-fetch always replaces the stored card: a page that
    // changed its metadata must not keep serving the old one. Update (not
    // ignore) so that when two jobs fetch the same new URL at once, the
    // freshly-parsed metadata wins rather than being silently dropped in
    // favour of whichever transaction happened to insert first.
    await trx
      .insertInto('link_previews')
      .values({
        urlHash,
        ...values,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) =>
        oc.column('urlHash').doUpdateSet({ ...values, updatedAt: currentTime })
      )
      .execute()

    const row = await getLinkPreviewRow(trx, urlHash)
    if (!row) {
      // Unreachable in practice — the row was just written in this
      // transaction — but throwing beats casting `undefined` into a
      // record and returning a half-built card to a caller.
      throw new Error(
        `link_previews row missing immediately after upsert: ${urlHash}`
      )
    }
    return toLinkPreviewRecord(row)
  })
}

export const recordLinkPreviewFailure = (
  db: Db,
  { urlHash, url, error }: RecordLinkPreviewFailureParams
): Promise<void> => {
  const currentTime = new Date()
  return inTransaction(db, async (trx) => {
    const existing = await getLinkPreviewRow(trx, urlHash)

    if (existing?.fetchStatus === 'completed') {
      // Keep the working card. Only the error and the timestamp move, so
      // every status linking this page keeps rendering while the refresh is
      // simply deferred to the next refresh window rather than retried
      // against a host that just failed.
      await trx
        .updateTable('link_previews')
        .set({ error, updatedAt: currentTime })
        .where('urlHash', '=', urlHash)
        .execute()
      return
    }

    if (existing) {
      await trx
        .updateTable('link_previews')
        .set({ fetchStatus: 'failed', error, updatedAt: currentTime })
        .where('urlHash', '=', urlHash)
        // The read above and this write are not atomic on either backend, so
        // a concurrent successful fetch can land in between. Without this
        // predicate that success is flipped straight back to `failed` and
        // the just-repaired card disappears from every status linking the
        // URL — the failure this whole method exists to prevent, through a
        // narrower window.
        .where('fetchStatus', '<>', 'completed')
        .execute()
      return
    }

    await trx
      .insertInto('link_previews')
      .values({
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
      .onConflict((oc) => oc.column('urlHash').doNothing())
      .execute()
  })
}

export const getLinkPreview = async (
  db: Db,
  { urlHash }: GetLinkPreviewParams
): Promise<LinkPreviewRecord | null> => {
  const row = await getLinkPreviewRow(db, urlHash)
  return row ? toLinkPreviewRecord(row) : null
}

export const linkStatusLinkPreview = (
  db: Db,
  { statusId, urlHash }: LinkStatusLinkPreviewParams
): Promise<void> => {
  const currentTime = new Date()
  return inTransaction(db, async (trx) => {
    const existing = await trx
      .selectFrom('status_link_previews')
      .select('statusId')
      .where('statusId', '=', statusId)
      .limit(1)
      .executeTakeFirst()
    if (existing) {
      // An edit can move a status from one card to another.
      await trx
        .updateTable('status_link_previews')
        .set({ urlHash, updatedAt: currentTime })
        .where('statusId', '=', statusId)
        .execute()
      return
    }
    await trx
      .insertInto('status_link_previews')
      .values({
        statusId,
        urlHash,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) => oc.column('statusId').doNothing())
      .execute()
  })
}

export const getStatusLinkPreviews = async (
  db: Db,
  { statusIds }: GetStatusLinkPreviewsParams
): Promise<Map<string, LinkPreviewRecord>> => {
  if (statusIds.length === 0) return new Map()

  // One join for the whole page. Only completed cards are hydrated — a
  // pending fetch or a negative-cache entry renders nothing.
  const rows = await db
    .selectFrom('status_link_previews')
    .innerJoin(
      'link_previews',
      'status_link_previews.urlHash',
      'link_previews.urlHash'
    )
    .where('status_link_previews.statusId', 'in', statusIds)
    .where('link_previews.fetchStatus', '=', 'completed')
    .selectAll('link_previews')
    .select('status_link_previews.statusId')
    .execute()

  return new Map(rows.map((row) => [row.statusId, toLinkPreviewRecord(row)]))
}

export const deleteStatusLinkPreview = async (
  db: Db,
  { statusId }: DeleteStatusLinkPreviewParams
): Promise<void> => {
  // Only the status→card link goes; the per-url cache stays for every other
  // status showing the same page.
  await db
    .deleteFrom('status_link_previews')
    .where('statusId', '=', statusId)
    .execute()
}

// The facade getSQLDatabase binds with bindDb().
export const linkPreviewQueries = {
  upsertLinkPreview,
  recordLinkPreviewFailure,
  getLinkPreview,
  linkStatusLinkPreview,
  getStatusLinkPreviews,
  deleteStatusLinkPreview
}
