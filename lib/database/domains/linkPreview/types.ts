// Parameter and result types of the link preview domain (Mastodon PreviewCard).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A cached preview card, keyed per URL rather than per status so the same link
// shared by many posts is fetched once. `fetchStatus: 'failed'` is a negative
// cache entry, not a card — it keeps an unreachable host from being re-fetched
// on every mention, and is never linked to a status.
export type LinkPreviewRecord = {
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
  fetchStatus: LinkPreviewFetchStatus
  error: string | null
  createdAt: number
  updatedAt: number
}

export type LinkPreviewFetchStatus = 'pending' | 'completed' | 'failed'

// Everything except the identity (`urlHash`/`url`) and the timestamps, which
// the mixin owns.
export type UpsertLinkPreviewParams = {
  urlHash: string
  url: string
  type?: string
  title?: string | null
  description?: string | null
  siteName?: string | null
  authorName?: string | null
  authorUrl?: string | null
  imageUrl?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  publishedAt?: number | null
  fetchStatus: LinkPreviewFetchStatus
  error?: string | null
}

export type RecordLinkPreviewFailureParams = {
  urlHash: string
  url: string
  error: string
}

export type GetLinkPreviewParams = { urlHash: string }
export type LinkStatusLinkPreviewParams = { statusId: string; urlHash: string }
export type GetStatusLinkPreviewsParams = { statusIds: string[] }
export type DeleteStatusLinkPreviewParams = { statusId: string }

export interface LinkPreviewDatabase {
  // Upsert on `urlHash` for a SUCCESSFUL fetch: a page that changed its
  // metadata is not stuck on a stale row.
  upsertLinkPreview(params: UpsertLinkPreviewParams): Promise<LinkPreviewRecord>
  // Record that a fetch failed, WITHOUT destroying a card that already works.
  // The row is shared by every status linking that URL, so writing a failure as
  // a full-row replace made one transient 502 on a weekly refresh blank the
  // card for every one of those posts — and the negative cache then suppressed
  // the retry that would have repaired it. A row that is already `completed`
  // keeps its content and its status and only records the error; anything else
  // becomes the `failed` negative-cache entry.
  recordLinkPreviewFailure(
    params: RecordLinkPreviewFailureParams
  ): Promise<void>
  getLinkPreview(
    params: GetLinkPreviewParams
  ): Promise<LinkPreviewRecord | null>
  // Point a status at a card. Upsert on `statusId`: an edit can move a status
  // from one card to another.
  linkStatusLinkPreview(params: LinkStatusLinkPreviewParams): Promise<void>
  // Batched hydration for a whole timeline page — one query, keyed by statusId.
  // Only `completed` cards are returned; a pending or failed row renders
  // nothing.
  getStatusLinkPreviews(
    params: GetStatusLinkPreviewsParams
  ): Promise<Map<string, LinkPreviewRecord>>
  // Drop a status→card link (the status no longer has an eligible URL).
  deleteStatusLinkPreview(params: DeleteStatusLinkPreviewParams): Promise<void>
}
