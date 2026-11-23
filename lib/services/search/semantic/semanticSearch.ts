import { randomUUID } from 'crypto'

import { getKysely } from '@/lib/database'
import { foldSearchText } from '@/lib/database/domains/search/rows'
import {
  type EmbeddableDocument,
  clearEmbeddingPending,
  deleteEmbeddings,
  deleteEmbeddingsForActor,
  getEmbeddableDocuments,
  getEmbeddingContentHash,
  getEmbeddingText,
  getPendingEmbeddings,
  getSemanticAvailability,
  getStoredEmbeddings,
  markEmbeddingsPending,
  recordSemanticFailure,
  recordSemanticSuccess,
  storeEmbeddings
} from '@/lib/database/domains/search/semanticStore'
import type { Db } from '@/lib/database/kysely'
import { EMBED_SEARCH_DOCUMENTS_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import type { ParsedSearchQuery } from '@/lib/services/search/parseSearchQuery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { getEmbeddingProvider } from './index'
import { type EmbeddingProvider, EmbeddingProviderError } from './types'

// How many pending documents one job embeds (one or two provider calls).
export const EMBEDDING_JOB_BATCH_SIZE = 64
// Writes within this window share one embedding job.
const JOB_BUCKET_MS = 10_000
const JOB_DELAY_SECONDS = 10
export const QUERY_EMBEDDING_TIMEOUT_MS = 2000
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000
const QUERY_CACHE_MAX_ENTRIES = 500

export type SemanticLayer = { provider: EmbeddingProvider }

// The layer when it can run here: an embeddings provider is configured and
// the database has pgvector and tables of the configured dimensions.
export const getSemanticLayer = async (
  db: Db
): Promise<SemanticLayer | null> => {
  const provider = getEmbeddingProvider()
  if (!provider) return null
  const availability = await getSemanticAvailability(db, provider.dimensions)
  return availability.available ? { provider } : null
}

const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

// Records a failure in the persisted health signal; never throws (the status
// table may be what is broken).
export const recordFailure = async (db: Db, error: unknown) => {
  try {
    await recordSemanticFailure(db, describeError(error))
  } catch (recordError) {
    logger.error({
      message: 'Failed to record a semantic search failure',
      err: toLoggableError(recordError)
    })
  }
}

// Embeds the documents whose text changed since their embedding was made (or
// that have none), in provider-sized batches, and stores the vectors. Returns
// how many were sent to the provider.
export const embedDocuments = async (
  db: Db,
  provider: EmbeddingProvider,
  documents: EmbeddableDocument[],
  pendingSince: Map<string, string> = new Map()
): Promise<number> => {
  const stored = await getStoredEmbeddings(
    db,
    documents.map((document) => document.id)
  )
  const toEmbed: { id: string; text: string; hash: string }[] = []
  for (const document of documents) {
    const text = getEmbeddingText(document.documentText)
    const hash = getEmbeddingContentHash(text)
    const current = stored.get(document.id)
    const pending = pendingSince.get(document.id)
    if (
      current?.hasEmbedding &&
      current.contentHash === hash &&
      current.model === provider.model &&
      current.dimensions === provider.dimensions
    ) {
      if (pending) await clearEmbeddingPending(db, document.id, pending)
      continue
    }
    // A post with no words (a captionless photo) has nothing to embed.
    if (!text.trim()) {
      await deleteEmbeddings(db, [document.id])
      continue
    }
    toEmbed.push({ id: document.id, text, hash })
  }
  for (let start = 0; start < toEmbed.length; start += provider.maxBatchSize) {
    const batch = toEmbed.slice(start, start + provider.maxBatchSize)
    const vectors = await provider.embed(
      batch.map((item) => item.text),
      'document'
    )
    await storeEmbeddings(
      db,
      batch.map((item, index) => ({
        documentId: item.id,
        contentHash: item.hash,
        embedding: vectors[index],
        pendingSince: pendingSince.get(item.id) ?? null
      })),
      provider
    )
  }
  return toEmbed.length
}

// One pass over the pending marks: embed what still qualifies, drop what no
// longer does (a post made followers-only, an author who opted out).
export const processPendingEmbeddings = async (
  db: Db,
  provider: EmbeddingProvider,
  limit = EMBEDDING_JOB_BATCH_SIZE
): Promise<{ looked: number; embedded: number }> => {
  const pending = await getPendingEmbeddings(db, limit)
  if (pending.length === 0) return { looked: 0, embedded: 0 }
  const pendingSince = new Map(
    pending.map((row) => [row.documentId, row.pendingSince])
  )
  const documents = await getEmbeddableDocuments(db, [...pendingSince.keys()])
  const embeddable = new Set(documents.map((document) => document.id))
  await deleteEmbeddings(
    db,
    [...pendingSince.keys()].filter((id) => !embeddable.has(id))
  )
  const embedded = await embedDocuments(db, provider, documents, pendingSince)
  return { looked: pending.length, embedded }
}

const publishEmbeddingJob = async (id: string) => {
  const queue = getQueue()
  await queue.publish({
    id,
    name: EMBED_SEARCH_DOCUMENTS_JOB_NAME,
    data: {},
    ...(queue.dropsDelayedJobs ? {} : { delaySeconds: JOB_DELAY_SECONDS })
  })
}

// Bursts of writes share one job (the queue drops a repeated id); a
// continuation gets an id of its own.
export const scheduleEmbeddingJob = (continuation = false) =>
  publishEmbeddingJob(
    continuation
      ? `semantic-embed-${randomUUID()}`
      : `semantic-embed-${Math.floor(Date.now() / JOB_BUCKET_MS)}`
  )

// The job: one batch of pending documents, then another job while more wait.
// A provider failure is recorded in the health signal; a retryable one is
// thrown so the queue retries it with backoff, the rest wait for the next
// write or `yarn search:semantic:backfill` (retrying a bad key changes
// nothing).
export const runEmbeddingJob = async (db: Db): Promise<void> => {
  const layer = await getSemanticLayer(db)
  if (!layer) return
  let result: { looked: number; embedded: number }
  try {
    result = await processPendingEmbeddings(db, layer.provider)
  } catch (error) {
    await recordFailure(db, error)
    logger.warn({
      message: 'Semantic search embedding failed',
      err: toLoggableError(error)
    })
    if (error instanceof EmbeddingProviderError && !error.retryable) return
    throw error
  }
  if (result.embedded > 0) await recordSemanticSuccess(db)
  if (result.looked >= EMBEDDING_JOB_BATCH_SIZE)
    await scheduleEmbeddingJob(true)
}

type CachedQuery = { expiresAt: number; vector: Promise<number[]> }
const queryCache = new Map<string, CachedQuery>()

export const clearQueryEmbeddingCache = () => queryCache.clear()

// The query's embedding, from a 10-minute in-process LRU keyed by model,
// dimensions and the folded query, else from the provider with a 2 s timeout.
export const embedSearchQuery = (
  provider: EmbeddingProvider,
  query: string,
  now = Date.now()
): Promise<number[]> => {
  const key = `${provider.cacheKey}\u0000${foldSearchText(query).trim()}`
  const cached = queryCache.get(key)
  if (cached && cached.expiresAt > now) {
    // Refresh its place as the most recently used.
    queryCache.delete(key)
    queryCache.set(key, cached)
    return cached.vector
  }
  const vector = provider
    .embed([query], 'query', { timeoutMs: QUERY_EMBEDDING_TIMEOUT_MS })
    .then((vectors) => vectors[0])
  queryCache.set(key, { expiresAt: now + QUERY_CACHE_TTL_MS, vector })
  // A failed embedding is not kept.
  vector.catch(() => {
    if (queryCache.get(key)?.vector === vector) queryCache.delete(key)
  })
  while (queryCache.size > QUERY_CACHE_MAX_ENTRIES) {
    const oldest = queryCache.keys().next().value
    if (oldest === undefined) break
    queryCache.delete(oldest)
  }
  return vector
}

// What the database layer's write hook does when the layer is configured:
// mark the written documents pending and schedule the job, without holding the
// write. Nothing happens until the database has the tables.
export const createSemanticSearchListener = (getDb: () => Db) => ({
  statusDocumentsWritten(documentIds: string[]) {
    void (async () => {
      const db = getDb()
      const layer = await getSemanticLayer(db)
      if (!layer) return
      await markEmbeddingsPending(db, documentIds, layer.provider)
      await scheduleEmbeddingJob()
    })().catch((error) =>
      logger.warn({
        message: 'Failed to schedule semantic search embeddings',
        err: toLoggableError(error)
      })
    )
  },
  actorUnindexed(actorId: string) {
    void (async () => {
      const db = getDb()
      if (!(await getSemanticLayer(db))) return
      await deleteEmbeddingsForActor(db, actorId)
    })().catch((error) =>
      logger.warn({
        message: 'Failed to drop semantic search embeddings of an actor',
        err: toLoggableError(error)
      })
    )
  }
})

export type SearchQueryEmbedding = {
  embedding: number[]
  model: string
  dimensions: number
}

// The embedding a relevance search with at least one plain word uses, or null:
// semantic search off, a latest-first sort, the search rate limit spent, or the
// provider failing or slower than 2 s (recorded in the health signal; the
// search goes on with keyword results). Only the plain words and phrases as
// typed go to the provider, never the operators.
export const getSearchQueryEmbedding = async ({
  parsedQuery,
  sort,
  consumeRateLimit,
  getDb = () => getKysely()
}: {
  parsedQuery: Pick<ParsedSearchQuery, 'terms' | 'plainText'>
  sort: 'latest' | 'relevance'
  consumeRateLimit: () => boolean
  getDb?: () => Db
}): Promise<SearchQueryEmbedding | null> => {
  if (sort !== 'relevance' || parsedQuery.terms.length === 0) return null
  const text = parsedQuery.plainText.trim()
  // Read before the database is: without a provider nothing else runs.
  if (!text || !getEmbeddingProvider()) return null
  const db = getDb()
  try {
    const layer = await getSemanticLayer(db)
    if (!layer || !consumeRateLimit()) return null
    const embedding = await embedSearchQuery(layer.provider, text)
    return {
      embedding,
      model: layer.provider.model,
      dimensions: layer.provider.dimensions
    }
  } catch (error) {
    await recordFailure(db, error)
    logger.warn({
      message: 'Semantic search query embedding failed; using keyword results',
      err: toLoggableError(error)
    })
    return null
  }
}
