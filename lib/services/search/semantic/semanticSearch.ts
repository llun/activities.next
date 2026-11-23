import { randomUUID } from 'crypto'

import { getKysely } from '@/lib/database'
import { foldSearchText } from '@/lib/database/domains/search/rows'
import {
  type EmbeddableDocument,
  type StoredEmbedding,
  claimPendingEmbeddings,
  clearEmbeddingPending,
  deleteEmbeddings,
  deleteEmbeddingsForActor,
  getActorStatusDocumentIds,
  getEmbeddableDocuments,
  getEmbeddingContentHash,
  getEmbeddingText,
  getSemanticAvailability,
  getStoredEmbeddings,
  hasClaimablePendingEmbeddings,
  markEmbeddingsFailed,
  markEmbeddingsPending,
  recordSemanticFailure,
  recordSemanticSuccess,
  releaseEmbeddingClaims,
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

type EmbedItem = { id: string; text: string; hash: string }
type Embedded = { item: EmbedItem; vector: number[] }
// A job's hold on the rows it claimed and the marks it read.
type JobClaim = { claimToken: string; pendingSince: Map<string, string> }

const INPUT_REFUSAL_STATUS_CODES = new Set([400, 413, 422])
const isInputRefusal = (error: unknown) =>
  error instanceof EmbeddingProviderError &&
  !error.retryable &&
  INPUT_REFUSAL_STATUS_CODES.has(error.statusCode ?? 0)

const embedTexts = async (
  provider: EmbeddingProvider,
  batch: EmbedItem[]
): Promise<Embedded[]> => {
  const vectors = await provider.embed(
    batch.map((item) => item.text),
    'document'
  )
  return batch.map((item, index) => ({ item, vector: vectors[index] }))
}

type Isolated = {
  embedded: Embedded[]
  refused: EmbedItem[]
  refusal?: unknown
}

// Narrows a refused batch down to the documents the provider refuses, by
// halves.
const embedByHalves = async (
  provider: EmbeddingProvider,
  batch: EmbedItem[]
): Promise<Isolated> => {
  if (batch.length === 0) return { embedded: [], refused: [] }
  try {
    return { embedded: await embedTexts(provider, batch), refused: [] }
  } catch (error) {
    if (!isInputRefusal(error)) throw error
    if (batch.length === 1) {
      return { embedded: [], refused: batch, refusal: error }
    }
    const middle = Math.ceil(batch.length / 2)
    const left = await embedByHalves(provider, batch.slice(0, middle))
    const right = await embedByHalves(provider, batch.slice(middle))
    return {
      embedded: [...left.embedded, ...right.embedded],
      refused: [...left.refused, ...right.refused],
      refusal: right.refusal ?? left.refusal
    }
  }
}

// Embeds a batch. When the provider refuses it as a bad request (a text over
// the model's limit, say), the first, middle and last document are tried
// alone: all refused, the refusal is about the request (a key or model the
// provider calls a bad request) and is thrown; otherwise the rest is narrowed
// by halves, so one bad post does not hold back the others.
const embedIsolating = async (
  provider: EmbeddingProvider,
  batch: EmbedItem[]
): Promise<Isolated> => {
  try {
    return { embedded: await embedTexts(provider, batch), refused: [] }
  } catch (error) {
    if (!isInputRefusal(error)) throw error
    // A lone document refused is that document (it backs off; nothing is
    // lost if it was really the request).
    if (batch.length === 1) {
      return { embedded: [], refused: batch, refusal: error }
    }
    // The first, middle and last alone: all three refused, it is the request.
    const probeIndexes = [
      ...new Set([0, Math.floor(batch.length / 2), batch.length - 1])
    ]
    const probes = await Promise.all(
      probeIndexes.map((index) =>
        embedByHalves(provider, batch.slice(index, index + 1))
      )
    )
    if (probes.every((probe) => probe.embedded.length === 0)) throw error
    const rest = await embedByHalves(
      provider,
      batch.filter((_, index) => !probeIndexes.includes(index))
    )
    return {
      embedded: [
        ...probes.flatMap((probe) => probe.embedded),
        ...rest.embedded
      ],
      refused: [...probes.flatMap((probe) => probe.refused), ...rest.refused],
      refusal: rest.refusal ?? probes.find((probe) => probe.refusal)?.refusal
    }
  }
}

// Stores what still qualifies once the vectors are back: a post made
// followers-only, or an author who opted out, while the request was out is
// dropped. Every write is fenced by the job's claim (see semanticStore.ts), so
// a newer mark or a newer job always wins.
const storeEmbedded = async (
  db: Db,
  provider: EmbeddingProvider,
  embedded: Embedded[],
  claim: JobClaim
) => {
  if (embedded.length === 0) return
  const stillEmbeddable = new Set(
    (
      await getEmbeddableDocuments(
        db,
        embedded.map(({ item }) => item.id)
      )
    ).map((document) => document.id)
  )
  await deleteEmbeddings(
    db,
    embedded
      .filter(({ item }) => !stillEmbeddable.has(item.id))
      .map(({ item }) => item.id),
    claim
  )
  await storeEmbeddings(
    db,
    embedded
      .filter(({ item }) => stillEmbeddable.has(item.id))
      .map(({ item, vector }) => ({
        documentId: item.id,
        contentHash: item.hash,
        embedding: vector,
        pendingSince: claim.pendingSince.get(item.id) ?? null
      })),
    { ...provider, claimToken: claim.claimToken }
  )
}

// `sent`: documents sent to the provider; `embedded`: vectors it returned;
// `refused`: documents it refused as input.
export type EmbedResult = {
  sent: number
  embedded: number
  refused: string[]
  // The provider's last refusal of a document, for the health signal.
  refusal?: unknown
}

// Whether a document's stored embedding exists and matches its text, model
// and dimensions.
const isUpToDate = (
  current: StoredEmbedding | undefined,
  hash: string,
  provider: EmbeddingProvider
) =>
  Boolean(
    current?.hasEmbedding &&
    current.contentHash === hash &&
    current.model === provider.model &&
    current.dimensions === provider.dimensions
  )

// The documents (with any words) whose embedding is missing or out of date:
// what the backfill marks, and what its dry run counts.
export const getDocumentsNeedingEmbedding = async (
  db: Db,
  provider: EmbeddingProvider,
  documents: EmbeddableDocument[]
): Promise<EmbeddableDocument[]> => {
  const stored = await getStoredEmbeddings(
    db,
    documents.map((document) => document.id)
  )
  return documents.filter((document) => {
    const text = getEmbeddingText(document.documentText)
    return (
      text.trim() !== '' &&
      !isUpToDate(
        stored.get(document.id),
        getEmbeddingContentHash(text),
        provider
      )
    )
  })
}

// Embeds the claimed documents whose text changed since their embedding was
// made (or that have none), in provider-sized batches, and stores the vectors.
// Returns how many were sent and the documents the provider refused as input;
// a failure of the whole request (network, key, model) is thrown.
export const embedDocuments = async (
  db: Db,
  provider: EmbeddingProvider,
  documents: EmbeddableDocument[],
  claim: JobClaim
): Promise<EmbedResult> => {
  const stored = await getStoredEmbeddings(
    db,
    documents.map((document) => document.id)
  )
  const toEmbed: EmbedItem[] = []
  for (const document of documents) {
    const text = getEmbeddingText(document.documentText)
    const hash = getEmbeddingContentHash(text)
    const pending = claim.pendingSince.get(document.id)
    if (isUpToDate(stored.get(document.id), hash, provider)) {
      if (pending) {
        await clearEmbeddingPending(db, document.id, pending, claim.claimToken)
      }
      continue
    }
    // A post with no words (a captionless photo) has nothing to embed.
    if (!text.trim()) {
      await deleteEmbeddings(db, [document.id], claim)
      continue
    }
    toEmbed.push({ id: document.id, text, hash })
  }
  const result: EmbedResult = { sent: 0, embedded: 0, refused: [] }
  for (let start = 0; start < toEmbed.length; start += provider.maxBatchSize) {
    const batch = toEmbed.slice(start, start + provider.maxBatchSize)
    const { embedded, refused, refusal } = await embedIsolating(provider, batch)
    await storeEmbedded(db, provider, embedded, claim)
    result.sent += batch.length
    result.embedded += embedded.length
    result.refused.push(...refused.map((item) => item.id))
    if (refusal !== undefined) result.refusal = refusal
  }
  return result
}

export type EmbeddingPass = {
  looked: number
  // Documents sent to the provider (refused ones included).
  sent?: number
  embedded: number
  refused?: number
  // Set when the provider failed the whole request in a way retrying soon
  // will not fix (a bad key, a wrong model): the rows back off.
  failed?: unknown
}

// One pass over the pending marks this job claims: embed what still qualifies,
// drop what no longer does (a post made followers-only, an author who opted
// out). A retryable failure releases the claims and is thrown for the queue's
// retry; any other failure, and each document the provider refuses, backs the
// rows off (the mark is kept) instead of holding back the rows behind them.
export const processPendingEmbeddings = async (
  db: Db,
  provider: EmbeddingProvider,
  limit = EMBEDDING_JOB_BATCH_SIZE,
  onlyDocumentIds?: string[]
): Promise<EmbeddingPass> => {
  const claimToken = randomUUID()
  const pending = await claimPendingEmbeddings(
    db,
    limit,
    claimToken,
    onlyDocumentIds
  )
  if (pending.length === 0) return { looked: 0, embedded: 0 }
  const claim: JobClaim = {
    claimToken,
    pendingSince: new Map(
      pending.map((row) => [row.documentId, row.pendingSince])
    )
  }
  const ids = [...claim.pendingSince.keys()]
  try {
    const documents = await getEmbeddableDocuments(db, ids)
    const embeddable = new Set(documents.map((document) => document.id))
    await deleteEmbeddings(
      db,
      ids.filter((id) => !embeddable.has(id)),
      claim
    )
    const result = await embedDocuments(db, provider, documents, claim)
    if (result.refused.length > 0) {
      await markEmbeddingsFailed(db, result.refused, claim)
      await recordFailure(
        db,
        new Error(
          `the provider refused ${result.refused.length} document(s) as input: ${describeError(result.refusal)}`
        )
      )
    }
    return {
      looked: pending.length,
      sent: result.sent,
      embedded: result.embedded,
      refused: result.refused.length
    }
  } catch (error) {
    if (error instanceof EmbeddingProviderError && !error.retryable) {
      await markEmbeddingsFailed(db, ids, claim)
      return { looked: pending.length, embedded: 0, failed: error }
    }
    await releaseEmbeddingClaims(db, ids, claimToken).catch(() => undefined)
    throw error
  }
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

let lastScheduledBucket: number | null = null

// Bursts of writes share one job: under a real queue this process schedules
// at most one per JOB_BUCKET_MS window, delayed past the window's end (a queue
// that drops a repeated id also folds the windows of several processes); jobs
// that do overlap claim disjoint rows. An inline queue runs each job at once,
// so every write gets one. A continuation gets an id of its own.
export const scheduleEmbeddingJob = async (
  continuation = false,
  now = Date.now()
) => {
  if (continuation || getQueue().runsInline) {
    await publishEmbeddingJob(`semantic-embed-${randomUUID()}`)
    return
  }
  const bucket = Math.floor(now / JOB_BUCKET_MS)
  if (lastScheduledBucket === bucket) return
  lastScheduledBucket = bucket
  try {
    await publishEmbeddingJob(`semantic-embed-${bucket}`)
  } catch (error) {
    // Let the next write in this window try again.
    if (lastScheduledBucket === bucket) lastScheduledBucket = null
    throw error
  }
}

export const resetEmbeddingJobScheduleForTests = () => {
  lastScheduledBucket = null
}

// How many batches one job takes under a real queue before handing over to a
// continuation job.
export const EMBEDDING_JOB_MAX_PASSES = 8
// The inline queue's bound: a safety stop (12,800 rows), not a pace; the next
// write's job picks up what is left.
export const EMBEDDING_INLINE_JOB_MAX_PASSES = 200

// The job: batches of pending documents while rows remain that a job could
// claim (marks written while it held them included). Under a real queue it
// hands over to a continuation job after EMBEDDING_JOB_MAX_PASSES; the inline
// queue runs it detached from the request, so it loops until nothing is left
// rather than publishing (which would nest each job inside the last). A
// failure is recorded in the health signal; a retryable one is thrown so the
// queue retries it with backoff, any other backs its rows off and ends the
// job until the next write.
export const runEmbeddingJob = async (db: Db): Promise<void> => {
  const layer = await getSemanticLayer(db)
  if (!layer) return
  const inline = getQueue().runsInline
  const maxPasses = inline
    ? EMBEDDING_INLINE_JOB_MAX_PASSES
    : EMBEDDING_JOB_MAX_PASSES
  for (let passes = 0; passes < maxPasses; passes += 1) {
    let pass: EmbeddingPass
    try {
      pass = await processPendingEmbeddings(db, layer.provider)
    } catch (error) {
      await recordFailure(db, error)
      logger.warn({
        message: 'Semantic search embedding failed',
        err: toLoggableError(error)
      })
      throw error
    }
    if (pass.failed) {
      await recordFailure(db, pass.failed)
      logger.warn({
        message: 'Semantic search embedding failed; the documents back off',
        err: toLoggableError(pass.failed)
      })
      return
    }
    // A refusal was recorded as a failure; do not wipe it straight away.
    if (pass.embedded > 0 && !pass.refused) await recordSemanticSuccess(db)
    if (pass.looked === 0 || !(await hasClaimablePendingEmbeddings(db))) {
      return
    }
  }
  if (!inline) await scheduleEmbeddingJob(true)
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
  // Re-inserted either way, so it moves to the most recently used end.
  queryCache.delete(key)
  if (cached && cached.expiresAt > now) {
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

const ACTOR_OPT_IN_INTERVAL_MS = 24 * 60 * 60 * 1000
const ACTOR_OPT_IN_MAX_ENTRIES = 10_000
const actorOptIns = new Map<string, number>()

const takeActorOptIn = (actorId: string, now = Date.now()) => {
  const last = actorOptIns.get(actorId)
  if (last !== undefined && now - last < ACTOR_OPT_IN_INTERVAL_MS) return false
  actorOptIns.delete(actorId)
  actorOptIns.set(actorId, now)
  while (actorOptIns.size > ACTOR_OPT_IN_MAX_ENTRIES) {
    const oldest = actorOptIns.keys().next().value
    if (oldest === undefined) break
    actorOptIns.delete(oldest)
  }
  return true
}

export const resetActorOptInsForTests = () => actorOptIns.clear()

// What the database layer's write hook does when the layer is configured:
// mark the written documents pending and schedule the job, without holding the
// write. Nothing happens until the database has the tables.
export const createSemanticSearchListener = (getDb: () => Db) => ({
  statusDocumentsWritten(documentIds: string[]) {
    void (async () => {
      const db = getDb()
      const layer = await getSemanticLayer(db)
      if (!layer) return
      const marked = await markEmbeddingsPending(
        db,
        documentIds,
        layer.provider
      )
      if (marked > 0) await scheduleEmbeddingJob()
    })().catch((error) =>
      logger.warn({
        message: 'Failed to schedule semantic search embeddings',
        err: toLoggableError(error)
      })
    )
  },
  actorIndexed(actorId: string) {
    void (async () => {
      const db = getDb()
      const layer = await getSemanticLayer(db)
      if (!layer) return
      // An author toggling the flag must not re-embed their history over and
      // over: once a day per author in each process, best effort (the record
      // is in memory, capped).
      if (!takeActorOptIn(actorId)) return
      try {
        const documentIds = await getActorStatusDocumentIds(db, actorId)
        // A local author's posts never left, and an author with no public
        // posts does not use up the day.
        if (documentIds.length === 0) {
          actorOptIns.delete(actorId)
          return
        }
        const marked = await markEmbeddingsPending(
          db,
          documentIds,
          layer.provider
        )
        if (marked > 0) await scheduleEmbeddingJob()
      } catch (error) {
        actorOptIns.delete(actorId)
        throw error
      }
    })().catch((error) =>
      logger.warn({
        message: 'Failed to schedule semantic search embeddings of an actor',
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
