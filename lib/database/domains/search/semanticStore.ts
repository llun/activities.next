import { createHash } from 'crypto'
import { type SelectQueryBuilder, sql } from 'kysely'

import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import { getDialectName, jsonFlagIsTrue } from '@/lib/database/kysely/dialect'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { StatusType } from '@/lib/types/domain/status'

// Every read and write of the optional semantic search tables. They live
// outside the shared migrations (`yarn search:semantic:setup` creates them on
// PostgreSQL with pgvector), so the generated Kysely types do not know them and
// they are spelled in raw SQL here, and only here.

export const EMBEDDINGS_TABLE = 'search_document_embeddings'
export const SEMANTIC_STATUS_TABLE = 'search_semantic_status'
// The one row of the status table this layer writes.
const STATUS_ROW_ID = 'embeddings'
export const MIN_PGVECTOR_VERSION = '0.8.0'
// The most characters of a document sent to the provider (about 500 tokens).
export const MAX_EMBEDDING_TEXT_LENGTH = 2000
const AVAILABILITY_TTL_MS = 5 * 60 * 1000
const SEARCHABLE_STATUS_TYPES: string[] = [
  StatusType.enum.Note,
  StatusType.enum.Poll
]

export type SemanticAvailability =
  { available: true } | { available: false; reason: string }

export const compareVersions = (left: string, right: string): number => {
  const parse = (value: string) =>
    value.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

// `halfvec(768)` → 768.
export const parseHalfvecDimensions = (type: string | null): number | null => {
  const match = type?.match(/^halfvec\((\d+)\)$/)
  return match ? Number(match[1]) : null
}

type AvailabilityRow = {
  version: string | null
  embeddingType: string | null
  hasStatus: boolean
  canWrite: boolean
}

export const readSemanticAvailability = async (
  db: Db,
  dimensions: number
): Promise<SemanticAvailability> => {
  if (getDialectName(db) !== 'postgres') {
    return { available: false, reason: 'the database is not PostgreSQL' }
  }
  const { rows } = await sql<AvailabilityRow>`
    select
      (select extversion from pg_extension where extname = 'vector') as "version",
      (select format_type(atttypid, atttypmod) from pg_attribute
        where attrelid = to_regclass(${EMBEDDINGS_TABLE})
          and attname = 'embedding' and not attisdropped) as "embeddingType",
      to_regclass(${SEMANTIC_STATUS_TABLE}) is not null as "hasStatus",
      case when to_regclass(${EMBEDDINGS_TABLE}) is null then false
        else has_table_privilege(to_regclass(${EMBEDDINGS_TABLE}), 'SELECT, INSERT, UPDATE, DELETE')
      end as "canWrite"
  `.execute(db)
  const row = rows[0]
  if (!row?.version) {
    return {
      available: false,
      reason: 'the pgvector extension is not installed'
    }
  }
  if (compareVersions(row.version, MIN_PGVECTOR_VERSION) < 0) {
    return {
      available: false,
      reason: `pgvector ${row.version} is older than ${MIN_PGVECTOR_VERSION}`
    }
  }
  const tableDimensions = parseHalfvecDimensions(row.embeddingType)
  if (tableDimensions === null || !row.hasStatus) {
    return {
      available: false,
      reason:
        'the semantic search tables are missing; run yarn search:semantic:setup'
    }
  }
  if (tableDimensions !== dimensions) {
    return {
      available: false,
      reason: `${EMBEDDINGS_TABLE} holds ${tableDimensions} dimensions but ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS is ${dimensions}; run yarn search:semantic:setup --recreate`
    }
  }
  if (!row.canWrite) {
    return {
      available: false,
      reason: `the database user cannot write ${EMBEDDINGS_TABLE}; run yarn search:semantic:setup --grant-to <role>`
    }
  }
  return { available: true }
}

let cachedAvailability: {
  dimensions: number
  expiresAt: number
  value: Promise<SemanticAvailability>
} | null = null

// Read at most once per AVAILABILITY_TTL_MS, so a setup run after the app
// started is picked up without a restart. A failed read counts as unavailable.
export const getSemanticAvailability = (
  db: Db,
  dimensions: number,
  now = Date.now()
): Promise<SemanticAvailability> => {
  if (
    cachedAvailability &&
    cachedAvailability.dimensions === dimensions &&
    cachedAvailability.expiresAt > now
  ) {
    return cachedAvailability.value
  }
  const value = readSemanticAvailability(db, dimensions).catch(
    (error: unknown): SemanticAvailability => ({
      available: false,
      reason: `the availability check failed: ${error instanceof Error ? error.message : String(error)}`
    })
  )
  cachedAvailability = {
    dimensions,
    expiresAt: now + AVAILABILITY_TTL_MS,
    value
  }
  return value
}

export const resetSemanticAvailabilityCache = () => {
  cachedAvailability = null
}

// The text a document is embedded from and the hash that says it is unchanged.
export const getEmbeddingText = (documentText: string) => {
  const text = documentText.slice(0, MAX_EMBEDDING_TEXT_LENGTH)
  // Never end on half of a surrogate pair (an emoji cut in two), which strict
  // JSON parsers refuse.
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

export const getEmbeddingContentHash = (text: string) =>
  createHash('sha256').update(text).digest('hex')

// pgvector's text form of a vector: `[0.1,0.2,…]`.
export const toVectorLiteral = (embedding: number[]) =>
  `[${embedding.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`

// The status documents whose text may go to the embeddings provider: only text
// any stranger could already read. A local Note or Poll addressed to the public
// (`to` or `cc`, so public or unlisted) or a remote one with the public in `to`
// whose author opted in to search (`indexable`), by an author who is not being
// deleted, suspended or silenced. Never followers-only or direct.
const embeddableDocuments = (db: Db) =>
  db
    .selectFrom('search_documents')
    .innerJoin('statuses', 'statuses.id', 'search_documents.entityId')
    .innerJoin('actors', 'actors.id', 'statuses.actorId')
    .where('search_documents.entityType', '=', 'status')
    .where('statuses.type', 'in', SEARCHABLE_STATUS_TYPES)
    .where('actors.deletionStatus', 'is', null)
    .where('actors.suspendedAt', 'is', null)
    .where('actors.silencedAt', 'is', null)
    .where((eb) => {
      const isLocal = eb.and([
        eb('actors.privateKey', 'is not', null),
        eb('actors.privateKey', '<>', '')
      ])
      const publicRecipient = (types: string[]) =>
        eb.exists(
          eb
            .selectFrom('recipients as embed_recipients')
            .select(sql.lit(1).as('one'))
            .whereRef('embed_recipients.statusId', '=', 'statuses.id')
            .where('embed_recipients.type', 'in', types)
            .where('embed_recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)
        )
      return eb.or([
        eb.and([isLocal, publicRecipient(['to', 'cc'])]),
        eb.and([
          eb.not(isLocal),
          publicRecipient(['to']),
          jsonFlagIsTrue(db, 'actors.settings', 'indexable')
        ])
      ])
    })

export type EmbeddableDocument = { id: string; documentText: string }

export const getEmbeddableDocuments = async (
  db: Db,
  documentIds: string[]
): Promise<EmbeddableDocument[]> => {
  if (documentIds.length === 0) return []
  return embeddableDocuments(db)
    .select(['search_documents.id', 'search_documents.documentText'])
    .where(
      sql<boolean>`${sql.ref('search_documents.id')} = any(${documentIds}::text[])`
    )
    .execute()
}

// The next `limit` embeddable documents after `afterId`, by id, for the
// backfill.
export const getEmbeddableDocumentPage = (
  db: Db,
  { afterId, limit }: { afterId: string | null; limit: number }
): Promise<EmbeddableDocument[]> =>
  embeddableDocuments(db)
    .select(['search_documents.id', 'search_documents.documentText'])
    .$if(afterId !== null, (query) =>
      query.where('search_documents.id', '>', afterId as string)
    )
    .orderBy('search_documents.id')
    .limit(limit)
    .execute()

export type StoredEmbedding = {
  documentId: string
  model: string
  dimensions: number
  contentHash: string | null
  hasEmbedding: boolean
}

export const getStoredEmbeddings = async (
  db: Db,
  documentIds: string[]
): Promise<Map<string, StoredEmbedding>> => {
  if (documentIds.length === 0) return new Map()
  const { rows } = await sql<StoredEmbedding>`
    select "documentId", model, dimensions, "contentHash",
      embedding is not null as "hasEmbedding"
    from ${sql.table(EMBEDDINGS_TABLE)}
    where "documentId" = any(${documentIds}::text[])
  `.execute(db)
  return new Map(rows.map((row) => [row.documentId, row]))
}

// Marks the documents as needing a look from the embedding job (embed, refresh
// or drop). A document that already has a row (embedded, or waiting) is marked
// whatever it is now, so the job can drop it when it stopped qualifying; a new
// one gets a row only when it qualifies, so a followers-only post or a
// non-indexable author's never schedules work. A new mark starts its retries
// over. Returns how many were marked.
export const markEmbeddingsPending = async (
  db: Db,
  documentIds: string[],
  { model, dimensions }: { model: string; dimensions: number }
): Promise<number> => {
  if (documentIds.length === 0) return 0
  const { rows: existing } = await sql<{ documentId: string }>`
    update ${sql.table(EMBEDDINGS_TABLE)}
    set "pendingSince" = now(), attempts = 0, "retryAfter" = null
    where "documentId" = any(${documentIds}::text[])
    returning "documentId"
  `.execute(db)
  const marked = new Set(existing.map((row) => row.documentId))
  const fresh = (
    await getEmbeddableDocuments(
      db,
      documentIds.filter((id) => !marked.has(id))
    )
  ).map((document) => document.id)
  if (fresh.length > 0) {
    await sql`
      insert into ${sql.table(EMBEDDINGS_TABLE)}
        ("documentId", model, dimensions, "pendingSince", "updatedAt")
      select id, ${model}, ${dimensions}, now(), now()
      from search_documents
      where id = any(${fresh}::text[])
      on conflict ("documentId") do update
        set "pendingSince" = now(), attempts = 0, "retryAfter" = null
    `.execute(db)
  }
  return marked.size + fresh.length
}

// `pendingSince` is the timestamp's exact text, so the conditional writes below
// compare it to the microsecond (a JS Date keeps milliseconds only).
export type PendingEmbedding = { documentId: string; pendingSince: string }

// How long a job owns the rows it claimed. A job that fails releases them; one
// that dies leaves them to the next job once the lease ends. Every write a job
// makes is fenced by its claim token, so a job that outlived its lease (and
// lost the rows to another job) changes nothing.
export const EMBEDDING_CLAIM_LEASE_SECONDS = 120

// The rows a job may claim: marked, held by no live claim, and not backing off
// after a failure.
const claimable = sql<boolean>`"pendingSince" is not null
  and ("claimedUntil" is null or "claimedUntil" < now())
  and ("retryAfter" is null or "retryAfter" <= now())`

// Claims up to `limit` pending rows, oldest mark first, for the job holding
// `claimToken`, so concurrent jobs (several instances, overlapping deliveries)
// never send the same document twice.
export const claimPendingEmbeddings = async (
  db: Db,
  limit: number,
  claimToken: string
): Promise<PendingEmbedding[]> => {
  const { rows } = await sql<PendingEmbedding>`
    update ${sql.table(EMBEDDINGS_TABLE)}
    set "claimedUntil" = now() + make_interval(secs => ${EMBEDDING_CLAIM_LEASE_SECONDS}),
      "claimToken" = ${claimToken}
    where "documentId" in (
      select "documentId" from ${sql.table(EMBEDDINGS_TABLE)}
      where ${claimable}
      order by "pendingSince", "documentId"
      limit ${limit}
      for update skip locked
    )
    returning "documentId", "pendingSince"::text as "pendingSince"
  `.execute(db)
  return rows
}

// Whether any row is waiting that a job could claim now.
export const hasClaimablePendingEmbeddings = async (
  db: Db
): Promise<boolean> => {
  const { rows } = await sql<{ one: number }>`
    select 1 as one from ${sql.table(EMBEDDINGS_TABLE)} where ${claimable} limit 1
  `.execute(db)
  return rows.length > 0
}

export const releaseEmbeddingClaims = async (
  db: Db,
  documentIds: string[],
  claimToken: string
): Promise<void> => {
  if (documentIds.length === 0) return
  await sql`
    update ${sql.table(EMBEDDINGS_TABLE)}
    set "claimedUntil" = null, "claimToken" = null
    where "documentId" = any(${documentIds}::text[])
      and "claimToken" = ${claimToken}
  `.execute(db)
}

// The provider would not embed these rows: back off (one minute, doubling,
// at most a day) and keep the mark, so a fixed key or model picks them up
// again without blocking the rows behind them.
export const markEmbeddingsFailed = async (
  db: Db,
  documentIds: string[],
  claim: { claimToken: string; pendingSince: Map<string, string> }
): Promise<void> => {
  for (const documentId of documentIds) {
    const mark = claim.pendingSince.get(documentId)
    if (mark === undefined) continue
    // A row marked again since (the post was edited) gets a fresh try instead.
    await sql`
      update ${sql.table(EMBEDDINGS_TABLE)}
      set attempts = attempts + 1,
        "retryAfter" = now() + least(interval '1 day', interval '1 minute' * power(2, least(attempts, 20))),
        "claimedUntil" = null,
        "claimToken" = null
      where "documentId" = ${documentId}
        and "claimToken" = ${claim.claimToken}
        and "pendingSince" = ${mark}::timestamptz
    `.execute(db)
  }
  await releaseEmbeddingClaims(db, documentIds, claim.claimToken)
}

export const countPendingEmbeddings = async (db: Db): Promise<number> => {
  const { rows } = await sql<{ count: string | number }>`
    select count(*) as count from ${sql.table(EMBEDDINGS_TABLE)}
    where "pendingSince" is not null
  `.execute(db)
  return Number(rows[0]?.count ?? 0)
}

export type EmbeddingWrite = {
  documentId: string
  contentHash: string
  embedding: number[]
  // The mark this write answers, from the job's claim; null for the backfill.
  pendingSince: string | null
}

export const storeEmbeddings = async (
  db: Db,
  writes: EmbeddingWrite[],
  {
    model,
    dimensions,
    claimToken = null
  }: { model: string; dimensions: number; claimToken?: string | null }
): Promise<void> => {
  for (const write of writes) {
    const vector = sql`${toVectorLiteral(write.embedding)}::halfvec`
    if (claimToken !== null) {
      // Only a row this job still holds: a row deleted meanwhile (the author
      // opted out, the post was deleted) stays deleted, and a newer mark (the
      // post changed again) is kept for the next job.
      await sql`
        update ${sql.table(EMBEDDINGS_TABLE)} set
          model = ${model},
          dimensions = ${dimensions},
          "contentHash" = ${write.contentHash},
          embedding = ${vector},
          "pendingSince" = case
            when "pendingSince" = ${write.pendingSince}::timestamptz then null
            else "pendingSince" end,
          attempts = 0,
          "retryAfter" = null,
          "claimedUntil" = null,
          "claimToken" = null,
          "updatedAt" = now()
        where "documentId" = ${write.documentId} and "claimToken" = ${claimToken}
      `.execute(db)
      continue
    }
    // The backfill: never over a row a job is about to look at (marked) or one
    // already embedded from the same text.
    await sql`
      insert into ${sql.table(EMBEDDINGS_TABLE)} as stored
        ("documentId", model, dimensions, "contentHash", embedding, "updatedAt")
      select id, ${model}, ${dimensions}, ${write.contentHash}, ${vector}, now()
      from search_documents where id = ${write.documentId}
      on conflict ("documentId") do update set
        model = excluded.model,
        dimensions = excluded.dimensions,
        "contentHash" = excluded."contentHash",
        embedding = excluded.embedding,
        "updatedAt" = now()
      where stored."pendingSince" is null
    `.execute(db)
  }
}

// The document is unchanged: clear the mark this job read (a newer one stays).
export const clearEmbeddingPending = async (
  db: Db,
  documentId: string,
  pendingSince: string,
  claimToken: string
): Promise<void> => {
  await sql`
    update ${sql.table(EMBEDDINGS_TABLE)}
    set "pendingSince" = case
        when "pendingSince" = ${pendingSince}::timestamptz then null
        else "pendingSince" end,
      attempts = 0,
      "retryAfter" = null,
      "claimedUntil" = null,
      "claimToken" = null
    where "documentId" = ${documentId} and "claimToken" = ${claimToken}
  `.execute(db)
}

// Drops rows that no longer qualify. From a job, only rows it still holds and
// that still carry the mark it read: a newer mark (the post made public again
// meanwhile) keeps the row for the next job.
export const deleteEmbeddings = async (
  db: Db,
  documentIds: string[],
  claim?: { claimToken: string; pendingSince: Map<string, string> }
): Promise<void> => {
  if (documentIds.length === 0) return
  if (!claim) {
    await sql`
      delete from ${sql.table(EMBEDDINGS_TABLE)}
      where "documentId" = any(${documentIds}::text[])
    `.execute(db)
    return
  }
  for (const documentId of documentIds) {
    const mark = claim.pendingSince.get(documentId)
    if (mark !== undefined) {
      await sql`
        delete from ${sql.table(EMBEDDINGS_TABLE)}
        where "documentId" = ${documentId}
          and "pendingSince" = ${mark}::timestamptz
          and "claimToken" = ${claim.claimToken}
      `.execute(db)
    }
  }
  await releaseEmbeddingClaims(db, documentIds, claim.claimToken)
}

// The ids of an author's status documents, to look at again when they opt back
// in to search.
export const getActorStatusDocumentIds = async (
  db: Db,
  actorId: string
): Promise<string[]> => {
  const rows = await db
    .selectFrom('search_documents')
    .select('id')
    .where('entityType', '=', 'status')
    .where('actorId', '=', actorId)
    .execute()
  return rows.map((row) => row.id)
}

// A remote author's posts are embedded only while they opt in to search.
export const deleteEmbeddingsForActor = async (
  db: Db,
  actorId: string
): Promise<void> => {
  await sql`
    delete from ${sql.table(EMBEDDINGS_TABLE)}
    where "documentId" in (
      select id from search_documents
      where "entityType" = 'status' and "actorId" = ${actorId}
    )
    -- A local author's public posts are embedded whatever the flag says.
    and exists (
      select 1 from actors where id = ${actorId}
        and ("privateKey" is null or "privateKey" = '')
    )
  `.execute(db)
}

// Timestamps come back as the driver normalises them (epoch milliseconds).
export type SemanticStatus = {
  lastSuccessAt: number | Date | null
  lastErrorAt: number | Date | null
  lastError: string | null
  failureCount: number
  backfillCursor: string | null
}

export const getSemanticStatus = async (
  db: Db
): Promise<SemanticStatus | null> => {
  const { rows } = await sql<SemanticStatus>`
    select "lastSuccessAt", "lastErrorAt", "lastError", "failureCount", "backfillCursor"
    from ${sql.table(SEMANTIC_STATUS_TABLE)} where id = ${STATUS_ROW_ID}
  `.execute(db)
  return rows[0] ?? null
}

// The persisted health signal: what failed last, when, and how many times in a
// row. A degraded semantic search must be visible without the logs.
export const recordSemanticFailure = async (
  db: Db,
  error: string
): Promise<void> => {
  await sql`
    insert into ${sql.table(SEMANTIC_STATUS_TABLE)}
      (id, "lastErrorAt", "lastError", "failureCount", "updatedAt")
    values (${STATUS_ROW_ID}, now(), ${error.slice(0, 500)}, 1, now())
    on conflict (id) do update set
      "lastErrorAt" = now(),
      "lastError" = excluded."lastError",
      "failureCount" = ${sql.table(SEMANTIC_STATUS_TABLE)}."failureCount" + 1,
      "updatedAt" = now()
  `.execute(db)
}

export const recordSemanticSuccess = async (db: Db): Promise<void> => {
  await sql`
    insert into ${sql.table(SEMANTIC_STATUS_TABLE)}
      (id, "lastSuccessAt", "failureCount", "updatedAt")
    values (${STATUS_ROW_ID}, now(), 0, now())
    on conflict (id) do update set
      "lastSuccessAt" = now(), "failureCount" = 0, "updatedAt" = now()
  `.execute(db)
}

export const saveBackfillCursor = async (
  db: Db,
  cursor: string | null
): Promise<void> => {
  await sql`
    insert into ${sql.table(SEMANTIC_STATUS_TABLE)}
      (id, "backfillCursor", "failureCount", "updatedAt")
    values (${STATUS_ROW_ID}, ${cursor}, 0, now())
    on conflict (id) do update set "backfillCursor" = excluded."backfillCursor", "updatedAt" = now()
  `.execute(db)
}

// The ids of the `limit` documents of a status search query nearest to
// `embedding` by cosine distance, nearest first. The query is driven from the
// embeddings table so its HNSW index serves the order; the caller runs it
// inside a transaction after `enableIterativeScan`, so the query's filters do
// not starve the scan of results.
export const nearestDocumentIds = async (
  query: SelectQueryBuilder<DB, 'search_documents' | 'statuses', object>,
  embedding: number[],
  {
    model,
    dimensions,
    limit
  }: { model: string; dimensions: number; limit: number }
): Promise<string[]> => {
  const rows = await query
    .innerJoin(
      sql<{
        documentId: string
        model: string
        embedding: unknown
      }>`${sql.table(EMBEDDINGS_TABLE)}`.as('semantic_embeddings'),
      (join) =>
        join.onRef('semantic_embeddings.documentId', '=', 'search_documents.id')
    )
    .select('search_documents.entityId as semanticEntityId')
    .where('semantic_embeddings.model', '=', model)
    .where('semantic_embeddings.embedding', 'is not', null)
    .orderBy(
      sql`${sql.ref('semantic_embeddings.embedding')} <=> ${toVectorLiteral(embedding)}::halfvec(${sql.lit(dimensions)})`
    )
    .limit(limit)
    .execute()
  return rows.map((row) => String(row.semanticEntityId))
}

// Let the HNSW index keep scanning past rows the query's filters drop
// (pgvector 0.8). Only inside a transaction: SET LOCAL ends with it.
export const enableIterativeScan = async (db: Db): Promise<void> => {
  await sql`set local hnsw.iterative_scan = relaxed_order`.execute(db)
}

export class SemanticSetupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SemanticSetupError'
  }
}

export type SemanticSetupResult = {
  pgvectorVersion: string
  created: boolean
  recreated: boolean
  grantedTo: string | null
}

const isInsufficientPrivilege = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '42501'

// A role name as the operator typed it, quoted as an identifier.
const ROLE_NAME = /^[A-Za-z_][A-Za-z0-9_$.@-]{0,62}$/

// Creates (or, with `recreate`, rebuilds) the semantic search tables. Safe to
// run again: an existing table with the same dimensions is left as it is.
export const setupSemanticSearchTables = async (
  db: Db,
  {
    dimensions,
    recreate = false,
    grantTo = null
  }: { dimensions: number; recreate?: boolean; grantTo?: string | null }
): Promise<SemanticSetupResult> => {
  if (getDialectName(db) !== 'postgres') {
    throw new SemanticSetupError(
      'Semantic search needs PostgreSQL with pgvector; this database is not PostgreSQL.'
    )
  }
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4000) {
    throw new SemanticSetupError(
      `Dimensions must be an integer from 1 to 4000, got ${dimensions}.`
    )
  }
  if (grantTo !== null && !ROLE_NAME.test(grantTo)) {
    throw new SemanticSetupError(`"${grantTo}" is not a valid role name.`)
  }

  try {
    await sql`create extension if not exists vector`.execute(db)
  } catch (error) {
    if (isInsufficientPrivilege(error)) {
      throw new SemanticSetupError(
        'This database user may not create the pgvector extension. Run the setup as a user that can, such as `postgres` (a cloudsqlsuperuser member) on Cloud SQL, then pass --grant-to <app user>.'
      )
    }
    throw error
  }
  const { rows: versionRows } = await sql<{ version: string }>`
    select extversion as version from pg_extension where extname = 'vector'
  `.execute(db)
  const pgvectorVersion = versionRows[0]?.version ?? '0'
  if (compareVersions(pgvectorVersion, MIN_PGVECTOR_VERSION) < 0) {
    throw new SemanticSetupError(
      `pgvector ${pgvectorVersion} is installed; semantic search needs ${MIN_PGVECTOR_VERSION} or newer (ALTER EXTENSION vector UPDATE).`
    )
  }

  const { rows: typeRows } = await sql<{ embeddingType: string | null }>`
    select (select format_type(atttypid, atttypmod) from pg_attribute
      where attrelid = to_regclass(${EMBEDDINGS_TABLE})
        and attname = 'embedding' and not attisdropped) as "embeddingType"
  `.execute(db)
  const existingDimensions = parseHalfvecDimensions(
    typeRows[0]?.embeddingType ?? null
  )
  const tableExists = typeRows[0]?.embeddingType != null
  if (tableExists && existingDimensions !== dimensions) {
    if (!recreate) {
      throw new SemanticSetupError(
        `${EMBEDDINGS_TABLE} holds ${existingDimensions ?? 'unknown'} dimensions, not ${dimensions}. Run again with --recreate to drop the stored embeddings and rebuild the table, then run yarn search:semantic:backfill.`
      )
    }
  }
  const recreated = tableExists && recreate

  // One transaction: a failed grant leaves the old table (and its embeddings)
  // in place rather than dropped.
  await inTransaction(db, async (trx) => {
    if (recreated) {
      await sql`drop table ${sql.table(EMBEDDINGS_TABLE)}`.execute(trx)
    }
    await sql`
      create table if not exists ${sql.table(EMBEDDINGS_TABLE)} (
        "documentId" varchar(320) primary key
          references search_documents(id) on delete cascade,
        model text not null,
        dimensions integer not null,
        "contentHash" text,
        embedding halfvec(${sql.lit(dimensions)}),
        "pendingSince" timestamptz,
        "claimedUntil" timestamptz,
        "claimToken" text,
        attempts integer not null default 0,
        "retryAfter" timestamptz,
        "updatedAt" timestamptz not null default now()
      )
    `.execute(trx)
    await sql`
      create index if not exists search_document_embeddings_embedding_idx
        on ${sql.table(EMBEDDINGS_TABLE)} using hnsw (embedding halfvec_cosine_ops)
    `.execute(trx)
    await sql`
      create index if not exists search_document_embeddings_pending_idx
        on ${sql.table(EMBEDDINGS_TABLE)} ("pendingSince")
        where "pendingSince" is not null
    `.execute(trx)
    await sql`
      create table if not exists ${sql.table(SEMANTIC_STATUS_TABLE)} (
        id text primary key,
        "lastSuccessAt" timestamptz,
        "lastErrorAt" timestamptz,
        "lastError" text,
        "failureCount" integer not null default 0,
        "backfillCursor" text,
        "updatedAt" timestamptz not null default now()
      )
    `.execute(trx)
    // A table made by an earlier version of this script.
    await sql`
      alter table ${sql.table(EMBEDDINGS_TABLE)}
        add column if not exists "claimedUntil" timestamptz,
        add column if not exists "claimToken" text,
        add column if not exists attempts integer not null default 0,
        add column if not exists "retryAfter" timestamptz
    `.execute(trx)
    if (!tableExists || recreated) {
      // No embeddings yet, so the backfill starts over.
      await sql`update ${sql.table(SEMANTIC_STATUS_TABLE)} set "backfillCursor" = null`.execute(
        trx
      )
    }
    if (grantTo !== null) {
      for (const table of [EMBEDDINGS_TABLE, SEMANTIC_STATUS_TABLE]) {
        await sql`grant select, insert, update, delete on ${sql.table(table)} to ${sql.id(grantTo)}`.execute(
          trx
        )
      }
    }
  })
  resetSemanticAvailabilityCache()
  return {
    pgvectorVersion,
    created: !tableExists || recreated,
    recreated,
    grantedTo: grantTo
  }
}
