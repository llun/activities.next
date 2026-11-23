// Parameter and result types of the search domain: search documents and
// account, hashtag and status search. lib/types/database/operations.ts
// re-exports them, so existing imports keep working.
import { z } from 'zod'

import type { ParsedSearchQuery } from '@/lib/services/search/parseSearchQuery'

export const SearchDocumentEntityType = z.enum(['account', 'status', 'hashtag'])
export type SearchDocumentEntityType = z.infer<typeof SearchDocumentEntityType>

export type SearchDocument = {
  id: string
  entityType: SearchDocumentEntityType
  entityId: string
  documentText: string
  actorId: string | null
  visibility: string | null
  entityCreatedAt: number | null
  discoverable: boolean | null
  postCount: number | null
  lastPostAt: number | null
  createdAt: number
  updatedAt: number
}

export type UpsertSearchDocumentParams = {
  entityType: SearchDocumentEntityType
  entityId: string
  documentText: string
  actorId?: string | null
  visibility?: string | null
  entityCreatedAt?: number | null
  discoverable?: boolean | null
  postCount?: number | null
  lastPostAt?: number | null
}

export type DeleteSearchDocumentParams = {
  entityType: SearchDocumentEntityType
  entityId: string
}

export type SearchDocumentsParams = {
  entityType?: SearchDocumentEntityType
  q: string
  limit: number
  offset?: number
  includeNonDiscoverable?: boolean
  visibleToActorId?: string | null
}

export type SearchAccountsParams = {
  q: string
  limit: number
  offset?: number
  localDomain?: string | null
  followingActorId?: string | null
  exactActorIds?: string[]
}

export type SearchHashtagsParams = {
  q: string
  limit: number
  offset?: number
  excludeUnreviewed?: boolean
}

export type SearchHashtag = {
  name: string
  url: string
  history: { day: string; uses: string; accounts: string }[]
  following?: boolean
  postCount: number
  lastPostAt: number | null
}

export type SearchStatusSort = 'latest' | 'relevance'

export type SearchStatusesParams = {
  q: string
  // `q` already read by parseSearchQuery, so a caller that parsed it does not
  // parse it again.
  parsedQuery?: ParsedSearchQuery
  limit: number
  offset?: number
  currentActorId: string
  currentActorUsername?: string | null
  currentActorDomain?: string | null
  // The domain a bare `from:username` names; the viewer's own when absent.
  localDomain?: string | null
  // `latest` (the default) is newest first with max_id/min_id paging;
  // `relevance` ranks the newest RELEVANCE_CANDIDATE_LIMIT matches and pages
  // with offset only.
  sort?: SearchStatusSort
  accountId?: string | null
  minId?: string | null
  maxId?: string | null
  // The query's embedding, when semantic search is on: a relevance search with
  // at least one plain word then also takes the nearest embedded documents and
  // merges both rankings by reciprocal rank fusion.
  semantic?: { embedding: number[]; model: string; dimensions: number } | null
}

export type ReindexSearchDocumentsParams = {
  afterId?: string | null
  limit?: number
}

export type ReindexSearchDocumentsResult = {
  indexed: number
  nextCursor: string | null
}

export interface SearchDatabase {
  upsertSearchDocument(params: UpsertSearchDocumentParams): Promise<void>
  deleteSearchDocument(params: DeleteSearchDocumentParams): Promise<void>
  searchDocuments(params: SearchDocumentsParams): Promise<SearchDocument[]>
  searchAccountIds(params: SearchAccountsParams): Promise<string[]>
  indexActorSearchDocument(params: { id: string }): Promise<void>
  deleteActorSearchDocument(params: { id: string }): Promise<void>
  reindexSearchAccounts(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
  searchHashtags(params: SearchHashtagsParams): Promise<SearchHashtag[]>
  indexHashtagSearchDocument(params: { hashtag: string }): Promise<void>
  indexHashtagSearchDocuments(params: { hashtags: string[] }): Promise<void>
  deleteHashtagSearchDocument(params: { hashtag: string }): Promise<void>
  reindexSearchHashtags(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
  searchStatusIds(params: SearchStatusesParams): Promise<string[]>
  indexStatusSearchDocument(params: { statusId: string }): Promise<void>
  deleteStatusSearchDocument(params: { statusId: string }): Promise<void>
  reindexSearchStatuses(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
}
