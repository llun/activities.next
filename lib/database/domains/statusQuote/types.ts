// Parameter and result types of the status quote domain (FEP-044f / Mastodon 4.5
// quote edges).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { QuoteState } from '@/lib/types/domain/status'

// One quote edge: the quoting status (`statusId`, PK) → the quoted status. Only
// the five persistent states are stored; viewer-relative states are computed at
// serialization time. There is intentionally no FK to statuses (the edge can be
// created before the quoting status row exists, matching likes/recipients).
export type StatusQuoteRecord = {
  statusId: string
  quotedStatusId: string
  state: QuoteState
  quoteRequestId: string | null
  authorizationUri: string | null
  createdAt: number
  updatedAt: number
}

export type CreateStatusQuoteParams = {
  statusId: string
  quotedStatusId: string
  state?: QuoteState
  quoteRequestId?: string | null
  authorizationUri?: string | null
}
export type GetStatusQuoteParams = { statusId: string }
export type GetStatusQuoteByQuoteRequestIdParams = { quoteRequestId: string }
export type GetStatusQuoteByAuthorizationUriParams = {
  authorizationUri: string
}
export type UpdateStatusQuoteStateParams = {
  statusId: string
  state: QuoteState
  authorizationUri?: string | null
}
export type GetQuotingStatusIdsParams = {
  quotedStatusId: string
  state?: QuoteState
  limit?: number
  maxId?: string | null
  sinceId?: string | null
  // Row offset for sequential enumeration (e.g. notifying every quoter). Unlike
  // the maxId keyset cursor, an offset does not reference a deletable row, so a
  // full sweep is not truncated if a quoting post is deleted mid-enumeration.
  offset?: number
}

export interface StatusQuoteDatabase {
  // Upsert on `statusId` (the edge may pre-exist from an inbound QuoteRequest).
  createStatusQuote(params: CreateStatusQuoteParams): Promise<StatusQuoteRecord>
  getStatusQuote(
    params: GetStatusQuoteParams
  ): Promise<StatusQuoteRecord | null>
  // Match an inbound Accept/Reject against our outbound QuoteRequest.
  getStatusQuoteByQuoteRequestId(
    params: GetStatusQuoteByQuoteRequestIdParams
  ): Promise<StatusQuoteRecord | null>
  // Look up an edge by the hosted stamp uri (stamp GET route + revocation).
  getStatusQuoteByAuthorizationUri(
    params: GetStatusQuoteByAuthorizationUriParams
  ): Promise<StatusQuoteRecord | null>
  // Enforces the one-way state machine; an illegal transition is a no-op that
  // returns the row unchanged. Returns null when no edge exists.
  updateStatusQuoteState(
    params: UpdateStatusQuoteStateParams
  ): Promise<StatusQuoteRecord | null>
  // Ids of statuses quoting `quotedStatusId`, newest first, for GET /:id/quotes.
  getQuotingStatusIds(params: GetQuotingStatusIdsParams): Promise<string[]>
}
