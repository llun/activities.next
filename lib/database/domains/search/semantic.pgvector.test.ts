import { sql } from 'kysely'

import { createDatabaseConnection } from '@/lib/database/connection'
import { getSearchDocumentId } from '@/lib/database/domains/search/rows'
import {
  ACTOR_OPT_IN_DOCUMENT_LIMIT,
  EMBEDDINGS_TABLE,
  SEMANTIC_STATUS_TABLE,
  SemanticSetupError,
  claimPendingEmbeddings,
  clearEmbeddingPending,
  countPendingEmbeddings,
  deleteEmbeddings,
  deleteEmbeddingsForActor,
  getActorStatusDocumentIds,
  getEmbeddableDocuments,
  getEmbeddingContentHash,
  getEmbeddingText,
  getSemanticStatus,
  getStoredEmbeddings,
  hasClaimablePendingEmbeddings,
  markEmbeddingsFailed,
  markEmbeddingsPending,
  readSemanticAvailability,
  releaseEmbeddingClaims,
  resetSemanticAvailabilityCache,
  saveBackfillCursor,
  setupSemanticSearchTables,
  storeEmbeddings,
  toVectorLiteral
} from '@/lib/database/domains/search/semanticStore'
import { inTransaction } from '@/lib/database/kysely'
import {
  createTestDatabase,
  getTestDatabaseConfig
} from '@/lib/database/testing/createTestDatabase'
import {
  createSearchActor,
  seedStatus
} from '@/lib/database/testing/searchTestHelpers'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getQueue } from '@/lib/services/queue'
import { getEmbeddingProvider } from '@/lib/services/search/semantic/index'
import {
  getDocumentsNeedingEmbedding,
  processPendingEmbeddings,
  runEmbeddingJob
} from '@/lib/services/search/semantic/semanticSearch'
import {
  type EmbeddingProvider,
  EmbeddingProviderError
} from '@/lib/services/search/semantic/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/search/semantic/index', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/services/search/semantic/index')
    >()
  return {
    ...actual,
    getEmbeddingProvider: vi.fn(actual.getEmbeddingProvider)
  }
})

vi.mock('@/lib/services/queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/queue')>()
  return {
    ...actual,
    getQueue: vi.fn(actual.getQueue)
  }
})

const DIMENSIONS = 8
const MODEL = 'fake-bow-8'
const DOMAIN = 'sem.pgvector.test'
const REMOTE_DOMAIN = 'remote.pgvector.test'
const PUBLIC = ACTIVITY_STREAM_PUBLIC

const TOPIC_BUCKET: Record<string, number> = {
  bicycle: 0,
  cycling: 0,
  peloton: 0,
  derailleur: 0,
  espresso: 1,
  barista: 1,
  cappuccino: 1,
  hiking: 2,
  summit: 2,
  alpine: 2
}

const hashWordToBucket = (word: string): number => {
  const mapped = TOPIC_BUCKET[word]
  if (mapped !== undefined) return mapped
  let hash = 2166136261
  for (let i = 0; i < word.length; i += 1) {
    hash ^= word.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % DIMENSIONS
}

const bagOfWordsVector = (text: string): number[] => {
  const vector = new Array<number>(DIMENSIONS).fill(0)
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const word of words) {
    vector[hashWordToBucket(word)] += 1
  }
  const norm = Math.hypot(...vector)
  return norm === 0 ? vector : vector.map((value) => value / norm)
}

const createDeterministicProvider = (
  model = MODEL,
  dimensions = DIMENSIONS
): EmbeddingProvider & { embed: ReturnType<typeof vi.fn> } => {
  const embed = vi.fn(async (texts: string[]) =>
    texts.map((text) => bagOfWordsVector(text))
  )
  return {
    cacheKey: `fake:${model}:${dimensions}`,
    model,
    dimensions,
    maxBatchSize: 16,
    embed
  }
}

const runPgvector =
  Boolean(process.env.TEST_PGVECTOR) && process.env.TEST_DATABASE_TYPE === 'pg'

describe.skipIf(!runPgvector)('semantic search pgvector integration', () => {
  const testDb = createTestDatabase({ backend: 'pg' })
  const { database, db } = testDb

  const actorIdOf = (username: string, domain = DOMAIN) =>
    `https://${domain}/users/${username}`
  const statusIdOf = (actorId: string, slug: string) =>
    `${actorId}/statuses/${slug}`
  const docIdOf = (statusId: string) =>
    getSearchDocumentId({ entityType: 'status', entityId: statusId })

  const addActor = async (
    username: string,
    {
      domain = DOMAIN,
      remote = false,
      indexable = false,
      suspended = false
    }: {
      domain?: string
      remote?: boolean
      indexable?: boolean
      suspended?: boolean
    } = {}
  ) => {
    const id = actorIdOf(username, domain)
    await createSearchActor(database, { id, username, domain })
    const row = await db
      .selectFrom('actors')
      .select('settings')
      .where('id', '=', id)
      .executeTakeFirstOrThrow()
    const settings = getCompatibleJSON<Record<string, unknown>>(
      row.settings as string | Record<string, unknown>
    )
    await db
      .updateTable('actors')
      .set({
        privateKey: remote ? '' : 'private-key',
        settings: JSON.stringify({ ...settings, indexable }),
        suspendedAt: suspended ? new Date(1000) : null
      })
      .where('id', '=', id)
      .execute()
    return id
  }

  const indexedStatus = async (
    params: Parameters<typeof seedStatus>[1]
  ): Promise<string> => {
    await seedStatus(db, params)
    await database.indexStatusSearchDocument({ statusId: params.id })
    return params.id
  }

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await setupSemanticSearchTables(db, { dimensions: DIMENSIONS })
  })

  afterAll(async () => {
    resetSemanticAvailabilityCache()
    await database.destroy()
  })

  describe('setup and availability', () => {
    it('is idempotent on repeated setup and reports availability and dimension mismatches', async () => {
      const second = await setupSemanticSearchTables(db, {
        dimensions: DIMENSIONS
      })
      expect(second.created).toBe(false)
      expect(second.recreated).toBe(false)
      expect(second.grantedTo).toBeNull()
      expect(second.pgvectorVersion).toMatch(/^\d+\.\d+/)

      await expect(readSemanticAvailability(db, DIMENSIONS)).resolves.toEqual({
        available: true
      })

      const mismatched = await readSemanticAvailability(db, DIMENSIONS * 2)
      expect(mismatched.available).toBe(false)
      if (!mismatched.available) {
        expect(mismatched.reason).toContain(`${DIMENSIONS} dimensions`)
        expect(mismatched.reason).toContain(`${DIMENSIONS * 2}`)
      }
    })

    it('rejects a dimension change without --recreate and rebuilds with --recreate', async () => {
      await expect(
        setupSemanticSearchTables(db, { dimensions: 16 })
      ).rejects.toThrow(SemanticSetupError)

      try {
        await saveBackfillCursor(db, 'status:previous-cursor')
        const rebuilt = await setupSemanticSearchTables(db, {
          dimensions: 16,
          recreate: true
        })
        expect(rebuilt.created).toBe(true)
        expect(rebuilt.recreated).toBe(true)

        await expect(readSemanticAvailability(db, 16)).resolves.toEqual({
          available: true
        })
        expect((await getSemanticStatus(db))?.backfillCursor).toBeNull()
      } finally {
        // Restore 8-dimension tables for subsequent tests.
        await setupSemanticSearchTables(db, {
          dimensions: DIMENSIONS,
          recreate: true
        })
      }
    })

    it('grants table privileges to a requested role', async () => {
      const workerSuffix = (process.env.VITEST_POOL_ID ?? '0').replace(
        /\D/g,
        ''
      )
      const roleName = `semantic_app_test_${workerSuffix}`

      const { rows: existingRoles } = await sql<{ exists: boolean }>`
        select exists(select 1 from pg_roles where rolname = ${roleName}) as exists
      `.execute(db)
      if (!existingRoles[0]?.exists) {
        await sql`create role ${sql.id(roleName)} nologin`.execute(db)
      }

      try {
        const result = await setupSemanticSearchTables(db, {
          dimensions: DIMENSIONS,
          grantTo: roleName
        })
        expect(result.grantedTo).toBe(roleName)

        // has_table_privilege with a list answers whether ANY is held, so each
        // privilege is asked on its own; TRUNCATE is for the archive restore.
        for (const table of [EMBEDDINGS_TABLE, SEMANTIC_STATUS_TABLE]) {
          for (const privilege of [
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'TRUNCATE'
          ]) {
            const { rows } = await sql<{ granted: boolean }>`
              select has_table_privilege(${roleName}, ${table}, ${privilege}) as granted
            `.execute(db)
            expect({ table, privilege, granted: rows[0]?.granted }).toEqual({
              table,
              privilege,
              granted: true
            })
          }
        }
      } finally {
        await sql`revoke all on table ${sql.table(EMBEDDINGS_TABLE)}, ${sql.table(SEMANTIC_STATUS_TABLE)} from ${sql.id(roleName)}`.execute(
          db
        )
        await sql`drop role if exists ${sql.id(roleName)}`.execute(db)
      }
    })

    it('keeps the old table when --recreate fails on a bad --grant-to role and resets backfillCursor on fresh create', async () => {
      const author = await addActor('setup-tx-author')
      const statusId = await indexedStatus({
        id: statusIdOf(author, 'setup-tx-post'),
        actorId: author,
        createdAt: 50,
        text: 'bicycle setup rollback check',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)
      const provider = createDeterministicProvider()
      await markEmbeddingsPending(db, [docId], provider)
      await processPendingEmbeddings(db, provider)

      try {
        await expect(
          setupSemanticSearchTables(db, {
            dimensions: 16,
            recreate: true,
            grantTo: 'semantic_missing_role_for_test'
          })
        ).rejects.toThrow()

        // The rolled-back transaction kept the original 8-dim table and its row.
        await expect(readSemanticAvailability(db, DIMENSIONS)).resolves.toEqual(
          {
            available: true
          }
        )
        expect((await getStoredEmbeddings(db, [docId])).get(docId)).toEqual(
          expect.objectContaining({
            documentId: docId,
            dimensions: DIMENSIONS,
            hasEmbedding: true
          })
        )

        // Fresh create (table absent, recreate=false) resets any stale backfillCursor.
        await saveBackfillCursor(db, 'status:stale-before-fresh-create')
        await sql`drop table ${sql.table(EMBEDDINGS_TABLE)}`.execute(db)

        const fresh = await setupSemanticSearchTables(db, {
          dimensions: DIMENSIONS
        })
        expect(fresh.created).toBe(true)
        expect(fresh.recreated).toBe(false)
        expect((await getSemanticStatus(db))?.backfillCursor).toBeNull()
      } finally {
        await setupSemanticSearchTables(db, { dimensions: DIMENSIONS })
        await deleteEmbeddings(db, [docId])
      }
    })

    it('adds claim, retry, and backoff columns to an existing table created without them', async () => {
      const upgradedColumns = [
        'claimedUntil',
        'claimToken',
        'attempts',
        'retryAfter'
      ]
      try {
        await sql`
          alter table ${sql.table(EMBEDDINGS_TABLE)}
            drop column "claimedUntil",
            drop column "claimToken",
            drop column attempts,
            drop column "retryAfter"
        `.execute(db)

        const { rows: beforeRows } = await sql<{ attname: string }>`
          select attname from pg_attribute
          where attrelid = to_regclass(${EMBEDDINGS_TABLE})
            and attname = any(${upgradedColumns}::text[])
            and not attisdropped
        `.execute(db)
        expect(beforeRows).toEqual([])

        const upgraded = await setupSemanticSearchTables(db, {
          dimensions: DIMENSIONS
        })
        expect(upgraded.created).toBe(false)
        expect(upgraded.recreated).toBe(false)

        const { rows: afterRows } = await sql<{
          attname: string
          colType: string
        }>`
          select attname, format_type(atttypid, atttypmod) as "colType"
          from pg_attribute
          where attrelid = to_regclass(${EMBEDDINGS_TABLE})
            and attname = any(${upgradedColumns}::text[])
            and not attisdropped
          order by attname
        `.execute(db)
        expect(afterRows).toEqual([
          { attname: 'attempts', colType: 'integer' },
          { attname: 'claimToken', colType: 'text' },
          { attname: 'claimedUntil', colType: 'timestamp with time zone' },
          { attname: 'retryAfter', colType: 'timestamp with time zone' }
        ])
        await expect(
          claimPendingEmbeddings(db, 10, 'upgrade-token')
        ).resolves.toEqual([])
        await expect(hasClaimablePendingEmbeddings(db)).resolves.toBe(false)
      } finally {
        await setupSemanticSearchTables(db, { dimensions: DIMENSIONS })
      }
    })
  })

  describe('getEmbeddableDocuments privacy matrix', () => {
    it('returns only local public/unlisted and remote public-in-to by indexable non-suspended authors', async () => {
      const localAuthor = await addActor('priv-local')
      const localPeer = await addActor('priv-peer')
      const suspendedLocal = await addActor('priv-suspended', {
        suspended: true
      })
      const remoteIndexable = await addActor('priv-remote-ok', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })
      const remoteOptOut = await addActor('priv-remote-no', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: false
      })

      const localPublic = await indexedStatus({
        id: statusIdOf(localAuthor, 'local-public'),
        actorId: localAuthor,
        createdAt: 100,
        text: 'local public post',
        to: [PUBLIC]
      })
      const localUnlisted = await indexedStatus({
        id: statusIdOf(localAuthor, 'local-unlisted'),
        actorId: localAuthor,
        createdAt: 101,
        text: 'local unlisted post',
        to: [`${localAuthor}/followers`],
        cc: [PUBLIC]
      })
      const localFollowersOnly = await indexedStatus({
        id: statusIdOf(localAuthor, 'local-followers'),
        actorId: localAuthor,
        createdAt: 102,
        text: 'local followers only',
        to: [`${localAuthor}/followers`]
      })
      const localDirect = await indexedStatus({
        id: statusIdOf(localAuthor, 'local-direct'),
        actorId: localAuthor,
        createdAt: 103,
        text: 'local direct message',
        to: [localPeer]
      })
      const remotePublicIndexable = await indexedStatus({
        id: statusIdOf(remoteIndexable, 'remote-public-ok'),
        actorId: remoteIndexable,
        createdAt: 104,
        text: 'remote public indexable',
        to: [PUBLIC]
      })
      const remotePublicOptOut = await indexedStatus({
        id: statusIdOf(remoteOptOut, 'remote-public-no'),
        actorId: remoteOptOut,
        createdAt: 105,
        text: 'remote public non-indexable',
        to: [PUBLIC]
      })
      const remoteUnlistedIndexable = await indexedStatus({
        id: statusIdOf(remoteIndexable, 'remote-unlisted-ok'),
        actorId: remoteIndexable,
        createdAt: 106,
        text: 'remote unlisted indexable',
        to: [`${remoteIndexable}/followers`],
        cc: [PUBLIC]
      })
      const suspendedPost = await indexedStatus({
        id: statusIdOf(suspendedLocal, 'suspended-public'),
        actorId: suspendedLocal,
        createdAt: 107,
        text: 'suspended author public post',
        to: [PUBLIC]
      })

      const allDocIds = [
        localPublic,
        localUnlisted,
        localFollowersOnly,
        localDirect,
        remotePublicIndexable,
        remotePublicOptOut,
        remoteUnlistedIndexable,
        suspendedPost
      ].map(docIdOf)

      const embeddable = await getEmbeddableDocuments(db, allDocIds)
      expect(embeddable.map((doc) => doc.id).sort()).toEqual(
        [localPublic, localUnlisted, remotePublicIndexable].map(docIdOf).sort()
      )
    })
  })

  describe('processPendingEmbeddings and deleteEmbeddingsForActor', () => {
    it('leaves out remote authors on a suspended or silenced domain', async () => {
      const silencedDomain = 'silenced-embed.test'
      const subdomainParent = 'blocked-parent.test'
      const silenced = await addActor('domain-silenced', {
        domain: silencedDomain,
        remote: true,
        indexable: true
      })
      const subdomain = await addActor('domain-sub', {
        domain: `social.${subdomainParent}`,
        remote: true,
        indexable: true
      })
      const allowed = await addActor('domain-allowed', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })
      // A handle on an allowed domain for an actor whose id is on the
      // silenced host.
      const split = `https://${silencedDomain}/users/domain-split`
      await createSearchActor(database, {
        id: split,
        username: 'domain-split',
        domain: REMOTE_DOMAIN
      })
      await db
        .updateTable('actors')
        .set({ privateKey: '', settings: JSON.stringify({ indexable: true }) })
        .where('id', '=', split)
        .execute()
      const posts = await Promise.all(
        [silenced, subdomain, split, allowed].map((actorId, index) =>
          indexedStatus({
            id: statusIdOf(actorId, `domain-${index}`),
            actorId,
            createdAt: 600 + index,
            text: `domain rule post ${index}`,
            to: [PUBLIC]
          })
        )
      )
      await sql`
        insert into domain_federation_rules (id, domain, type, severity)
        values (${`rule-${silencedDomain}`}, ${silencedDomain}, 'block', 'silence'),
          (${`rule-${subdomainParent}`}, ${`*.${subdomainParent}`}, 'block', 'suspend')
      `.execute(db)
      try {
        const embeddable = await getEmbeddableDocuments(db, posts.map(docIdOf))
        expect(embeddable.map((document) => document.id)).toEqual([
          docIdOf(posts[3])
        ])
      } finally {
        await sql`
          delete from domain_federation_rules
          where domain in (${silencedDomain}, ${`*.${subdomainParent}`})
        `.execute(db)
      }
    })

    it('embeds pending docs, skips unchanged text, drops newly followers-only docs, and deletes remote actor embeddings only', async () => {
      const provider = createDeterministicProvider()
      const localAuthor = await addActor('proc-local')
      const remoteAuthor = await addActor('proc-remote', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })

      const localStatus = await indexedStatus({
        id: statusIdOf(localAuthor, 'pend-local'),
        actorId: localAuthor,
        createdAt: 200,
        text: 'bicycle peloton ride',
        to: [PUBLIC]
      })
      const remoteStatus = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'pend-remote'),
        actorId: remoteAuthor,
        createdAt: 201,
        text: 'espresso barista morning',
        to: [PUBLIC]
      })

      const localDocId = docIdOf(localStatus)
      const remoteDocId = docIdOf(remoteStatus)

      await markEmbeddingsPending(db, [localDocId, remoteDocId], provider)
      expect(await countPendingEmbeddings(db)).toBe(2)

      const firstPass = await processPendingEmbeddings(db, provider)
      expect(firstPass).toMatchObject({ looked: 2, embedded: 2 })
      expect(provider.embed).toHaveBeenCalledTimes(1)
      expect(await countPendingEmbeddings(db)).toBe(0)

      const storedAfterFirst = await getStoredEmbeddings(db, [
        localDocId,
        remoteDocId
      ])
      expect(storedAfterFirst.get(localDocId)?.hasEmbedding).toBe(true)
      expect(storedAfterFirst.get(remoteDocId)?.hasEmbedding).toBe(true)

      // Marking the same unchanged document pending again skips calling the provider.
      await markEmbeddingsPending(db, [localDocId], provider)
      const secondPass = await processPendingEmbeddings(db, provider)
      expect(secondPass).toMatchObject({ looked: 1, embedded: 0 })
      expect(provider.embed).toHaveBeenCalledTimes(1)
      expect(await countPendingEmbeddings(db)).toBe(0)

      // deleteEmbeddingsForActor drops the remote author's embeddings, never the local author's.
      await deleteEmbeddingsForActor(db, remoteAuthor)
      await deleteEmbeddingsForActor(db, localAuthor)
      const storedAfterActorDelete = await getStoredEmbeddings(db, [
        localDocId,
        remoteDocId
      ])
      expect(storedAfterActorDelete.has(remoteDocId)).toBe(false)
      expect(storedAfterActorDelete.has(localDocId)).toBe(true)

      // Making the local post followers-only and re-marking pending drops its embedding.
      await db
        .deleteFrom('recipients')
        .where('statusId', '=', localStatus)
        .execute()
      await db
        .insertInto('recipients')
        .values({
          id: 'recip-followers-only',
          statusId: localStatus,
          actorId: `${localAuthor}/followers`,
          type: 'to',
          createdAt: new Date(200),
          updatedAt: new Date(200)
        })
        .execute()
      await markEmbeddingsPending(db, [localDocId], provider)
      const thirdPass = await processPendingEmbeddings(db, provider)
      expect(thirdPass).toMatchObject({ looked: 1, embedded: 0 })
      expect(
        (await getStoredEmbeddings(db, [localDocId])).has(localDocId)
      ).toBe(false)
    })

    it('getActorStatusDocumentIds returns [] for local authors and at most ACTOR_OPT_IN_DOCUMENT_LIMIT newest-first for remote authors', async () => {
      const localAuthor = await addActor('optin-ids-local')
      const remoteAuthor = await addActor('optin-ids-remote', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })
      const cappedRemote = await addActor('optin-ids-remote-cap', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })
      // Also exercise the privateKey IS NULL remote representation.
      await db
        .updateTable('actors')
        .set({ privateKey: null })
        .where('id', '=', cappedRemote)
        .execute()

      await indexedStatus({
        id: statusIdOf(localAuthor, 'local-1'),
        actorId: localAuthor,
        createdAt: 1_000,
        text: 'local post one',
        to: [PUBLIC]
      })
      await indexedStatus({
        id: statusIdOf(localAuthor, 'local-2'),
        actorId: localAuthor,
        createdAt: 2_000,
        text: 'local post two',
        to: [PUBLIC]
      })

      // Insert remote posts out of chronological order to verify ORDER BY entityCreatedAt DESC.
      const oldest = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'remote-oldest'),
        actorId: remoteAuthor,
        createdAt: 1_000,
        text: 'remote oldest post',
        to: [PUBLIC]
      })
      const newest = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'remote-newest'),
        actorId: remoteAuthor,
        createdAt: 3_000,
        text: 'remote newest post',
        to: [PUBLIC]
      })
      const middle = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'remote-middle'),
        actorId: remoteAuthor,
        createdAt: 2_000,
        text: 'remote middle post',
        to: [PUBLIC]
      })

      expect(await getActorStatusDocumentIds(db, localAuthor)).toEqual([])
      expect(await getActorStatusDocumentIds(db, remoteAuthor)).toEqual([
        docIdOf(newest),
        docIdOf(middle),
        docIdOf(oldest)
      ])

      const totalRows = ACTOR_OPT_IN_DOCUMENT_LIMIT + 5
      try {
        await sql`
          insert into statuses (id, "actorId", type, content, url, reply, "createdAt", "updatedAt")
          select
            ${`${cappedRemote}/statuses/bulk-`} || lpad(g::text, 4, '0'),
            ${cappedRemote},
            'Note',
            'bulk post ' || g::text,
            ${`${cappedRemote}/statuses/bulk-`} || lpad(g::text, 4, '0'),
            '',
            to_timestamp(1700000000 + g),
            to_timestamp(1700000000 + g)
          from generate_series(1, ${totalRows}) as g
        `.execute(db)
        await sql`
          insert into recipients (id, "statusId", "actorId", type, "createdAt", "updatedAt")
          select
            'recip-bulk-' || lpad(g::text, 4, '0'),
            ${`${cappedRemote}/statuses/bulk-`} || lpad(g::text, 4, '0'),
            ${PUBLIC},
            'to',
            to_timestamp(1700000000 + g),
            to_timestamp(1700000000 + g)
          from generate_series(1, ${totalRows}) as g
        `.execute(db)
        await sql`
          insert into search_documents
            (id, "entityType", "entityId", "documentText", "actorId", visibility, "entityCreatedAt")
          select
            ${`status:${cappedRemote}/statuses/bulk-`} || lpad(g::text, 4, '0'),
            'status',
            ${`${cappedRemote}/statuses/bulk-`} || lpad(g::text, 4, '0'),
            'bulk post ' || g::text,
            ${cappedRemote},
            'public',
            to_timestamp(1700000000 + g)
          from generate_series(1, ${totalRows}) as g
        `.execute(db)

        const cappedIds = await getActorStatusDocumentIds(db, cappedRemote)
        expect(cappedIds).toHaveLength(ACTOR_OPT_IN_DOCUMENT_LIMIT)
        expect(cappedIds[0]).toBe(
          `status:${cappedRemote}/statuses/bulk-${String(totalRows).padStart(4, '0')}`
        )
        expect(cappedIds[cappedIds.length - 1]).toBe(
          `status:${cappedRemote}/statuses/bulk-0006`
        )
        expect(cappedIds).not.toContain(
          `status:${cappedRemote}/statuses/bulk-0005`
        )
      } finally {
        await db
          .deleteFrom('search_documents')
          .where('actorId', '=', cappedRemote)
          .where('entityType', '=', 'status')
          .execute()
        await db
          .deleteFrom('recipients')
          .where('id', 'like', 'recip-bulk-%')
          .execute()
        await db
          .deleteFrom('statuses')
          .where('actorId', '=', cappedRemote)
          .execute()
      }
    })

    it('getActorStatusDocumentIds ignores non-public posts when applying the limit', async () => {
      const remoteAuthor = await addActor('optin-nonpublic-remote', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })

      const olderPublic1 = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'pub-1'),
        actorId: remoteAuthor,
        createdAt: 1_000,
        text: 'older public post one',
        to: [PUBLIC]
      })
      const olderPublic2 = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'pub-2'),
        actorId: remoteAuthor,
        createdAt: 2_000,
        text: 'older public post two',
        to: [PUBLIC]
      })
      const olderPublic3 = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'pub-3'),
        actorId: remoteAuthor,
        createdAt: 3_000,
        text: 'older public post three',
        to: [PUBLIC]
      })
      // Unlisted (public only in cc) and direct posts must also be excluded for remote authors.
      await indexedStatus({
        id: statusIdOf(remoteAuthor, 'unlisted-newer'),
        actorId: remoteAuthor,
        createdAt: 4_000,
        text: 'remote unlisted post',
        to: [`${remoteAuthor}/followers`],
        cc: [PUBLIC]
      })
      await indexedStatus({
        id: statusIdOf(remoteAuthor, 'direct-newer'),
        actorId: remoteAuthor,
        createdAt: 5_000,
        text: 'remote direct post',
        to: [actorIdOf('someone-else', REMOTE_DOMAIN)]
      })

      // Add ACTOR_OPT_IN_DOCUMENT_LIMIT newer followers-only posts so that if
      // non-public posts counted toward the limit, none of the older public posts
      // would be returned.
      const followersOnlyCount = ACTOR_OPT_IN_DOCUMENT_LIMIT
      try {
        await sql`
          insert into statuses (id, "actorId", type, content, url, reply, "createdAt", "updatedAt")
          select
            ${`${remoteAuthor}/statuses/followers-`} || lpad(g::text, 4, '0'),
            ${remoteAuthor},
            'Note',
            'followers only post ' || g::text,
            ${`${remoteAuthor}/statuses/followers-`} || lpad(g::text, 4, '0'),
            '',
            to_timestamp(1700010000 + g),
            to_timestamp(1700010000 + g)
          from generate_series(1, ${followersOnlyCount}) as g
        `.execute(db)
        await sql`
          insert into recipients (id, "statusId", "actorId", type, "createdAt", "updatedAt")
          select
            'recip-nonpub-foll-' || lpad(g::text, 4, '0'),
            ${`${remoteAuthor}/statuses/followers-`} || lpad(g::text, 4, '0'),
            ${`${remoteAuthor}/followers`},
            'to',
            to_timestamp(1700010000 + g),
            to_timestamp(1700010000 + g)
          from generate_series(1, ${followersOnlyCount}) as g
        `.execute(db)
        await sql`
          insert into search_documents
            (id, "entityType", "entityId", "documentText", "actorId", visibility, "entityCreatedAt")
          select
            ${`status:${remoteAuthor}/statuses/followers-`} || lpad(g::text, 4, '0'),
            'status',
            ${`${remoteAuthor}/statuses/followers-`} || lpad(g::text, 4, '0'),
            'followers only post ' || g::text,
            ${remoteAuthor},
            'followers',
            to_timestamp(1700010000 + g)
          from generate_series(1, ${followersOnlyCount}) as g
        `.execute(db)

        const ids = await getActorStatusDocumentIds(db, remoteAuthor)
        expect(ids).toEqual([
          docIdOf(olderPublic3),
          docIdOf(olderPublic2),
          docIdOf(olderPublic1)
        ])
      } finally {
        await db
          .deleteFrom('search_documents')
          .where('actorId', '=', remoteAuthor)
          .where('entityType', '=', 'status')
          .execute()
        await db
          .deleteFrom('recipients')
          .where('id', 'like', 'recip-nonpub-foll-%')
          .execute()
        await db
          .deleteFrom('statuses')
          .where('actorId', '=', remoteAuthor)
          .execute()
      }
    })
  })

  describe('claims, conditional writes, and batch resilience', () => {
    it('hands disjoint rows to two concurrent claimPendingEmbeddings calls', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('claim-concurrent')
      const docIds: string[] = []
      for (let i = 0; i < 4; i += 1) {
        const statusId = await indexedStatus({
          id: statusIdOf(author, `claim-${i}`),
          actorId: author,
          createdAt: 300 + i,
          text: `bicycle concurrent claim ${i}`,
          to: [PUBLIC]
        })
        docIds.push(docIdOf(statusId))
      }

      const secondHandle = createDatabaseConnection(getTestDatabaseConfig('pg'))
      try {
        expect(await markEmbeddingsPending(db, docIds, provider)).toBe(4)

        // Hold an uncommitted claim on connection 1 while connection 2 claims concurrently
        // to prove FOR UPDATE SKIP LOCKED skips locked rows instead of duplicating or blocking.
        let firstIds: string[] = []
        let secondIds: string[] = []
        await inTransaction(db, async (trx) => {
          const first = await claimPendingEmbeddings(trx, 2, 'concurrent-1')
          const second = await claimPendingEmbeddings(
            secondHandle.db,
            2,
            'concurrent-2'
          )
          firstIds = first.map((row) => row.documentId)
          secondIds = second.map((row) => row.documentId)
        })

        expect(firstIds).toHaveLength(2)
        expect(secondIds).toHaveLength(2)
        expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
        expect([...firstIds, ...secondIds].sort()).toEqual([...docIds].sort())
        expect(
          await claimPendingEmbeddings(db, 10, 'concurrent-extra')
        ).toEqual([])

        // Release each set with its own claim token and verify parallel claims get disjoint rows.
        await releaseEmbeddingClaims(db, firstIds, 'concurrent-1')
        await releaseEmbeddingClaims(db, secondIds, 'concurrent-2')
        const [parallelA, parallelB] = await Promise.all([
          claimPendingEmbeddings(db, 2, 'parallel-a'),
          claimPendingEmbeddings(db, 2, 'parallel-b')
        ])
        const parallelAIds = parallelA.map((row) => row.documentId)
        const parallelBIds = parallelB.map((row) => row.documentId)
        expect(parallelAIds).toHaveLength(2)
        expect(parallelBIds).toHaveLength(2)
        expect(parallelAIds.filter((id) => parallelBIds.includes(id))).toEqual(
          []
        )
        expect([...parallelAIds, ...parallelBIds].sort()).toEqual(
          [...docIds].sort()
        )
      } finally {
        await deleteEmbeddings(db, docIds)
        await secondHandle.destroy()
      }
    })

    it('claims only among the given document ids (the backfill page)', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('claim-page-only')
      const docIds: string[] = []
      for (let i = 0; i < 3; i += 1) {
        const statusId = await indexedStatus({
          id: statusIdOf(author, `page-only-${i}`),
          actorId: author,
          createdAt: 320 + i,
          text: `kayak page only claim ${i}`,
          to: [PUBLIC]
        })
        docIds.push(docIdOf(statusId))
      }
      try {
        expect(await markEmbeddingsPending(db, docIds, provider)).toBe(3)
        const claimed = await claimPendingEmbeddings(db, 10, 'page-only', [
          docIds[1]
        ])
        expect(claimed.map((row) => row.documentId)).toEqual([docIds[1]])
        expect(
          await claimPendingEmbeddings(db, 10, 'page-only-empty', [])
        ).toEqual([])
        const rest = await claimPendingEmbeddings(db, 10, 'page-only-rest')
        expect(rest.map((row) => row.documentId).sort()).toEqual(
          [docIds[0], docIds[2]].sort()
        )
      } finally {
        await deleteEmbeddings(db, docIds)
      }
    })

    it('makes a row claimable again once its lease expires', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('claim-expire')
      const statusId = await indexedStatus({
        id: statusIdOf(author, 'lease-post'),
        actorId: author,
        createdAt: 310,
        text: 'bicycle lease expiry test',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)

      try {
        await markEmbeddingsPending(db, [docId], provider)

        const firstClaim = await claimPendingEmbeddings(db, 10, 'lease-first')
        expect(firstClaim.map((row) => row.documentId)).toEqual([docId])
        expect(await claimPendingEmbeddings(db, 10, 'lease-second')).toEqual([])

        await sql`
          update ${sql.table(EMBEDDINGS_TABLE)}
          set "claimedUntil" = now() - interval '1 second'
          where "documentId" = ${docId}
        `.execute(db)

        const reclaimed = await claimPendingEmbeddings(db, 10, 'lease-reclaim')
        expect(reclaimed.map((row) => row.documentId)).toEqual([docId])
      } finally {
        await deleteEmbeddings(db, [docId])
      }
    })

    it('releases claims when the provider throws so rows are claimable at once', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('claim-release')
      const statusA = await indexedStatus({
        id: statusIdOf(author, 'rel-a'),
        actorId: author,
        createdAt: 320,
        text: 'bicycle release alpha',
        to: [PUBLIC]
      })
      const statusB = await indexedStatus({
        id: statusIdOf(author, 'rel-b'),
        actorId: author,
        createdAt: 321,
        text: 'espresso release beta',
        to: [PUBLIC]
      })
      const docIds = [docIdOf(statusA), docIdOf(statusB)]

      const failingProvider = createDeterministicProvider()
      failingProvider.embed.mockRejectedValue(
        new EmbeddingProviderError('provider unavailable', {
          statusCode: 503,
          retryable: true
        })
      )

      try {
        await markEmbeddingsPending(db, docIds, provider)

        await expect(
          processPendingEmbeddings(db, failingProvider)
        ).rejects.toThrow('provider unavailable')

        const claimed = await claimPendingEmbeddings(db, 10, 'after-release')
        expect(claimed.map((row) => row.documentId).sort()).toEqual(
          [...docIds].sort()
        )
      } finally {
        await deleteEmbeddings(db, docIds)
      }
    })

    it('keeps a newer mark on deleteEmbeddings or clearEmbeddingPending with an older mark', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('mark-race')
      const statusClear = await indexedStatus({
        id: statusIdOf(author, 'mark-clear'),
        actorId: author,
        createdAt: 330,
        text: 'bicycle clear race',
        to: [PUBLIC]
      })
      const statusDelete = await indexedStatus({
        id: statusIdOf(author, 'mark-delete'),
        actorId: author,
        createdAt: 331,
        text: 'espresso delete race',
        to: [PUBLIC]
      })
      const docClear = docIdOf(statusClear)
      const docDelete = docIdOf(statusDelete)

      try {
        await markEmbeddingsPending(db, [docClear, docDelete], provider)
        const claimed = await claimPendingEmbeddings(db, 10, 'mark-race-1')
        const oldMarks = new Map(
          claimed.map((row) => [row.documentId, row.pendingSince])
        )
        const oldClearMark = oldMarks.get(docClear)!
        const oldDeleteMark = oldMarks.get(docDelete)!

        // Simulate a newer edit arriving while the previous job was still running.
        await sql`
          update ${sql.table(EMBEDDINGS_TABLE)}
          set "pendingSince" = "pendingSince" + interval '1 second'
          where "documentId" = any(${[docClear, docDelete]}::text[])
        `.execute(db)

        await clearEmbeddingPending(db, docClear, oldClearMark, 'mark-race-1')
        await deleteEmbeddings(db, [docDelete], {
          claimToken: 'mark-race-1',
          pendingSince: new Map([[docDelete, oldDeleteMark]])
        })

        // Both rows survive with their newer marks and are immediately claimable again.
        const reclaimed = await claimPendingEmbeddings(db, 10, 'mark-race-2')
        const newMarks = new Map(
          reclaimed.map((row) => [row.documentId, row.pendingSince])
        )
        expect(reclaimed.map((row) => row.documentId).sort()).toEqual(
          [docClear, docDelete].sort()
        )
        expect(newMarks.get(docClear)).not.toBe(oldClearMark)
        expect(newMarks.get(docDelete)).not.toBe(oldDeleteMark)

        // Applying the current marks clears/deletes as expected.
        await clearEmbeddingPending(
          db,
          docClear,
          newMarks.get(docClear)!,
          'mark-race-2'
        )
        await deleteEmbeddings(db, [docDelete], {
          claimToken: 'mark-race-2',
          pendingSince: new Map([[docDelete, newMarks.get(docDelete)!]])
        })
        expect(await countPendingEmbeddings(db)).toBe(0)
        expect(
          (await getStoredEmbeddings(db, [docDelete])).has(docDelete)
        ).toBe(false)
      } finally {
        await deleteEmbeddings(db, [docClear, docDelete])
      }
    })

    it('does not re-create a claimed row deleted meanwhile by deleteEmbeddingsForActor', async () => {
      const provider = createDeterministicProvider()
      const remoteAuthor = await addActor('store-optout-remote', {
        domain: REMOTE_DOMAIN,
        remote: true,
        indexable: true
      })
      const statusId = await indexedStatus({
        id: statusIdOf(remoteAuthor, 'optout-post'),
        actorId: remoteAuthor,
        createdAt: 340,
        text: 'hiking alpine summit',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)

      try {
        await markEmbeddingsPending(db, [docId], provider)
        const [claimed] = await claimPendingEmbeddings(db, 10, 'optout-token')
        expect(claimed?.documentId).toBe(docId)

        // Author opts out while the embedding request is in flight.
        await deleteEmbeddingsForActor(db, remoteAuthor)

        await storeEmbeddings(
          db,
          [
            {
              documentId: docId,
              contentHash: 'optout-hash',
              embedding: bagOfWordsVector('hiking alpine summit'),
              pendingSince: claimed.pendingSince
            }
          ],
          { ...provider, claimToken: 'optout-token' }
        )

        expect((await getStoredEmbeddings(db, [docId])).has(docId)).toBe(false)
      } finally {
        await deleteEmbeddings(db, [docId])
      }
    })

    it('creates no row when marking a followers-only post pending, but marks an existing row flipped to followers-only', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('mark-followers')
      const followersOnlyStatus = await indexedStatus({
        id: statusIdOf(author, 'always-followers'),
        actorId: author,
        createdAt: 350,
        text: 'private followers only note',
        to: [`${author}/followers`]
      })
      const flippedStatus = await indexedStatus({
        id: statusIdOf(author, 'public-then-followers'),
        actorId: author,
        createdAt: 351,
        text: 'bicycle public note',
        to: [PUBLIC]
      })
      const followersOnlyDocId = docIdOf(followersOnlyStatus)
      const flippedDocId = docIdOf(flippedStatus)

      try {
        // Fresh followers-only post: 0 marked, no row created.
        expect(
          await markEmbeddingsPending(db, [followersOnlyDocId], provider)
        ).toBe(0)
        expect(
          (await getStoredEmbeddings(db, [followersOnlyDocId])).has(
            followersOnlyDocId
          )
        ).toBe(false)
        expect(await countPendingEmbeddings(db)).toBe(0)

        // Public post: embedded first so it has a row.
        expect(await markEmbeddingsPending(db, [flippedDocId], provider)).toBe(
          1
        )
        await processPendingEmbeddings(db, provider)
        expect(
          (await getStoredEmbeddings(db, [flippedDocId])).get(flippedDocId)
            ?.hasEmbedding
        ).toBe(true)

        // Flip it to followers-only: markEmbeddingsPending marks the existing row so the job drops it.
        await db
          .deleteFrom('recipients')
          .where('statusId', '=', flippedStatus)
          .execute()
        await db
          .insertInto('recipients')
          .values({
            id: 'recip-mark-flipped-followers',
            statusId: flippedStatus,
            actorId: `${author}/followers`,
            type: 'to',
            createdAt: new Date(351),
            updatedAt: new Date(351)
          })
          .execute()

        expect(await markEmbeddingsPending(db, [flippedDocId], provider)).toBe(
          1
        )
        expect(await countPendingEmbeddings(db)).toBe(1)

        await processPendingEmbeddings(db, provider)
        expect(
          (await getStoredEmbeddings(db, [flippedDocId])).has(flippedDocId)
        ).toBe(false)
      } finally {
        await deleteEmbeddings(db, [followersOnlyDocId, flippedDocId])
      }
    })

    it('re-checks eligibility after embed() and stores nothing when a post became followers-only mid-request', async () => {
      const author = await addActor('recheck-author')
      const statusId = await indexedStatus({
        id: statusIdOf(author, 'recheck-post'),
        actorId: author,
        createdAt: 360,
        text: 'bicycle peloton race condition',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)

      const flippingProvider = createDeterministicProvider()
      flippingProvider.embed.mockImplementation(async (texts: string[]) => {
        // Flip the post to followers-only while the provider call is in flight.
        await db
          .deleteFrom('recipients')
          .where('statusId', '=', statusId)
          .execute()
        await db
          .insertInto('recipients')
          .values({
            id: 'recip-recheck-followers',
            statusId,
            actorId: `${author}/followers`,
            type: 'to',
            createdAt: new Date(360),
            updatedAt: new Date(360)
          })
          .execute()
        return texts.map((text) => bagOfWordsVector(text))
      })

      try {
        await markEmbeddingsPending(db, [docId], flippingProvider)
        await processPendingEmbeddings(db, flippingProvider)

        expect(flippingProvider.embed).toHaveBeenCalledTimes(1)
        expect((await getStoredEmbeddings(db, [docId])).has(docId)).toBe(false)
        expect(await countPendingEmbeddings(db)).toBe(0)
      } finally {
        await deleteEmbeddings(db, [docId])
      }
    })

    it('fences store, clear, delete, release, and fail by claimToken when a job loses its lease', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('fence-author')
      const [statusStore, statusClear, statusDelete, statusRelease] =
        await Promise.all([
          indexedStatus({
            id: statusIdOf(author, 'fence-store'),
            actorId: author,
            createdAt: 365,
            text: 'bicycle fence store',
            to: [PUBLIC]
          }),
          indexedStatus({
            id: statusIdOf(author, 'fence-clear'),
            actorId: author,
            createdAt: 366,
            text: 'espresso fence clear',
            to: [PUBLIC]
          }),
          indexedStatus({
            id: statusIdOf(author, 'fence-delete'),
            actorId: author,
            createdAt: 367,
            text: 'hiking fence delete',
            to: [PUBLIC]
          }),
          indexedStatus({
            id: statusIdOf(author, 'fence-release'),
            actorId: author,
            createdAt: 368,
            text: 'peloton fence release',
            to: [PUBLIC]
          })
        ])
      const docStore = docIdOf(statusStore)
      const docClear = docIdOf(statusClear)
      const docDelete = docIdOf(statusDelete)
      const docRelease = docIdOf(statusRelease)
      const allDocIds = [docStore, docClear, docDelete, docRelease]

      try {
        await markEmbeddingsPending(db, allDocIds, provider)
        const jobAClaim = await claimPendingEmbeddings(db, 10, 'token-a')
        const jobAMarks = new Map(
          jobAClaim.map((row) => [row.documentId, row.pendingSince])
        )
        expect(jobAClaim).toHaveLength(4)

        // Job A's lease expires and Job B reclaims all four rows.
        await sql`
          update ${sql.table(EMBEDDINGS_TABLE)}
          set "claimedUntil" = now() - interval '1 second'
          where "documentId" = any(${allDocIds}::text[])
        `.execute(db)
        const jobBClaim = await claimPendingEmbeddings(db, 10, 'token-b')
        expect(jobBClaim).toHaveLength(4)

        // Stale Job A attempts every write with its old token: all must be no-ops.
        await storeEmbeddings(
          db,
          [
            {
              documentId: docStore,
              contentHash: 'stale-hash',
              embedding: bagOfWordsVector('bicycle fence store'),
              pendingSince: jobAMarks.get(docStore)!
            }
          ],
          { ...provider, claimToken: 'token-a' }
        )
        await clearEmbeddingPending(
          db,
          docClear,
          jobAMarks.get(docClear)!,
          'token-a'
        )
        await deleteEmbeddings(db, [docDelete], {
          claimToken: 'token-a',
          pendingSince: new Map([[docDelete, jobAMarks.get(docDelete)!]])
        })
        await releaseEmbeddingClaims(db, [docRelease], 'token-a')
        await markEmbeddingsFailed(db, [docRelease], {
          claimToken: 'token-a',
          pendingSince: jobAMarks
        })

        const { rows } = await sql<{
          documentId: string
          claimToken: string | null
          hasEmbedding: boolean
          hasPending: boolean
          hasClaimedUntil: boolean
          attempts: number
          hasRetryAfter: boolean
        }>`
          select
            "documentId",
            "claimToken",
            embedding is not null as "hasEmbedding",
            "pendingSince" is not null as "hasPending",
            "claimedUntil" > now() as "hasClaimedUntil",
            attempts,
            "retryAfter" is not null as "hasRetryAfter"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = any(${allDocIds}::text[])
        `.execute(db)

        expect(rows).toHaveLength(4)
        for (const row of rows) {
          expect(row.claimToken).toBe('token-b')
          expect(row.hasEmbedding).toBe(false)
          expect(row.hasPending).toBe(true)
          expect(row.hasClaimedUntil).toBe(true)
          expect(row.attempts).toBe(0)
          expect(row.hasRetryAfter).toBe(false)
        }
        expect(await claimPendingEmbeddings(db, 10, 'token-c')).toEqual([])
      } finally {
        await deleteEmbeddings(db, allDocIds)
      }
    })

    it('backs off rows on markEmbeddingsFailed, respects retryAfter, and resets backoff on markEmbeddingsPending', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('backoff-author')
      const statusId = await indexedStatus({
        id: statusIdOf(author, 'backoff-post'),
        actorId: author,
        createdAt: 369,
        text: 'bicycle backoff test',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)

      try {
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)

        await markEmbeddingsPending(db, [docId], provider)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(true)

        const [firstClaim] = await claimPendingEmbeddings(db, 10, 'backoff-1')
        expect(firstClaim?.documentId).toBe(docId)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)

        await markEmbeddingsFailed(db, [docId], {
          claimToken: 'backoff-1',
          pendingSince: new Map([[docId, firstClaim!.pendingSince]])
        })

        const { rows: afterFirstFail } = await sql<{
          attempts: number
          backingOff: boolean
          hasPending: boolean
          claimToken: string | null
          claimedUntil: string | null
        }>`
          select
            attempts,
            "retryAfter" > now() as "backingOff",
            "pendingSince" is not null as "hasPending",
            "claimToken",
            "claimedUntil"::text as "claimedUntil"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = ${docId}
        `.execute(db)
        expect(afterFirstFail[0]).toEqual({
          attempts: 1,
          backingOff: true,
          hasPending: true,
          claimToken: null,
          claimedUntil: null
        })
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)
        expect(await claimPendingEmbeddings(db, 10, 'backoff-2')).toEqual([])

        // Once retryAfter elapses, the row is claimable again.
        await sql`
          update ${sql.table(EMBEDDINGS_TABLE)}
          set "retryAfter" = now() - interval '1 second'
          where "documentId" = ${docId}
        `.execute(db)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(true)

        const [secondClaim] = await claimPendingEmbeddings(db, 10, 'backoff-2')
        expect(secondClaim?.documentId).toBe(docId)
        await markEmbeddingsFailed(db, [docId], {
          claimToken: 'backoff-2',
          pendingSince: new Map([[docId, secondClaim!.pendingSince]])
        })
        const { rows: afterSecondFail } = await sql<{
          attempts: number
          backingOff: boolean
        }>`
          select attempts, "retryAfter" > now() as "backingOff"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = ${docId}
        `.execute(db)
        expect(afterSecondFail[0]).toEqual({ attempts: 2, backingOff: true })
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)

        // A fresh markEmbeddingsPending clears attempts and retryAfter, making it claimable at once.
        await markEmbeddingsPending(db, [docId], provider)
        const { rows: afterRemark } = await sql<{
          attempts: number
          retryAfter: string | null
        }>`
          select attempts, "retryAfter"::text as "retryAfter"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = ${docId}
        `.execute(db)
        expect(afterRemark[0]).toEqual({ attempts: 0, retryAfter: null })
        expect(await hasClaimablePendingEmbeddings(db)).toBe(true)

        const [thirdClaim] = await claimPendingEmbeddings(db, 10, 'backoff-3')
        expect(thirdClaim?.documentId).toBe(docId)
      } finally {
        await deleteEmbeddings(db, [docId])
      }
    })

    it('keeps a newer mark written while claimed and re-embeds it in the next pass of runEmbeddingJob', async () => {
      const author = await addActor('remark-cont-author')
      const statusId = await indexedStatus({
        id: statusIdOf(author, 'remark-cont-post'),
        actorId: author,
        createdAt: 370,
        text: 'bicycle initial text',
        to: [PUBLIC]
      })
      const docId = docIdOf(statusId)
      const publish = vi.fn().mockResolvedValue(undefined)

      let editStep = 0
      const provider = createDeterministicProvider()
      provider.embed.mockImplementation(async (texts: string[]) => {
        editStep += 1
        if (editStep === 1) {
          // Simulate an edit arriving while processPendingEmbeddings is waiting on the provider.
          await db
            .updateTable('search_documents')
            .set({ documentText: 'espresso updated text' })
            .where('id', '=', docId)
            .execute()
          await new Promise((resolve) => setTimeout(resolve, 5))
          await markEmbeddingsPending(db, [docId], provider)
        } else if (editStep === 2) {
          // Simulate a second edit arriving during pass 1 of runEmbeddingJob so pass 2 picks it up.
          await db
            .updateTable('search_documents')
            .set({ documentText: 'hiking final text' })
            .where('id', '=', docId)
            .execute()
          await new Promise((resolve) => setTimeout(resolve, 5))
          await markEmbeddingsPending(db, [docId], provider)
        }
        return texts.map((text) => bagOfWordsVector(text))
      })

      const prevProviderImpl = vi
        .mocked(getEmbeddingProvider)
        .getMockImplementation()
      const prevQueueImpl = vi.mocked(getQueue).getMockImplementation()
      vi.mocked(getEmbeddingProvider).mockReturnValue(provider)
      vi.mocked(getQueue).mockReturnValue({
        publish,
        handle: vi.fn(),
        runsInline: false,
        dropsDelayedJobs: false
      } as unknown as ReturnType<typeof getQueue>)

      try {
        await markEmbeddingsPending(db, [docId], provider)

        // One pass stores the initial embedding while preserving the newer pending mark.
        await processPendingEmbeddings(db, provider)

        const { rows: afterFirst } = await sql<{
          hasEmbedding: boolean
          contentHash: string | null
          hasPending: boolean
          claimToken: string | null
          claimedUntil: string | null
        }>`
          select
            embedding is not null as "hasEmbedding",
            "contentHash",
            "pendingSince" is not null as "hasPending",
            "claimToken",
            "claimedUntil"::text as "claimedUntil"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = ${docId}
        `.execute(db)
        expect(afterFirst[0]).toEqual({
          hasEmbedding: true,
          contentHash: getEmbeddingContentHash(
            getEmbeddingText('bicycle initial text')
          ),
          hasPending: true,
          claimToken: null,
          claimedUntil: null
        })
        expect(await hasClaimablePendingEmbeddings(db)).toBe(true)

        // runEmbeddingJob loops across passes within the same job until nothing is claimable,
        // embedding both the preserved mark and the edit that arrived during pass 1.
        await runEmbeddingJob(db)
        expect(provider.embed).toHaveBeenCalledTimes(3)
        const storedAfterJob = await getStoredEmbeddings(db, [docId])
        expect(storedAfterJob.get(docId)?.contentHash).toBe(
          getEmbeddingContentHash(getEmbeddingText('hiking final text'))
        )
        expect(await countPendingEmbeddings(db)).toBe(0)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)
        expect(publish).not.toHaveBeenCalled()
      } finally {
        if (prevProviderImpl) {
          vi.mocked(getEmbeddingProvider).mockImplementation(prevProviderImpl)
        } else {
          vi.mocked(getEmbeddingProvider).mockReset()
        }
        if (prevQueueImpl) {
          vi.mocked(getQueue).mockImplementation(prevQueueImpl)
        } else {
          vi.mocked(getQueue).mockReset()
        }
        await deleteEmbeddings(db, [docId])
      }
    })

    it('backs off all rows without clearing marks on a request-wide 400 after the batch and the first, middle, and last probes', async () => {
      const author = await addActor('reqwide-400-author')
      const docIds: string[] = []
      for (let i = 0; i < 5; i += 1) {
        const statusId = await indexedStatus({
          id: statusIdOf(author, `reqwide-400-${i}`),
          actorId: author,
          createdAt: 371 + i,
          text: `bicycle request wide refusal ${i}`,
          to: [PUBLIC]
        })
        docIds.push(docIdOf(statusId))
      }

      const refuseAllProvider = createDeterministicProvider()
      refuseAllProvider.embed.mockRejectedValue(
        new EmbeddingProviderError('API key rejected as bad request', {
          statusCode: 400,
          retryable: false
        })
      )

      try {
        await markEmbeddingsPending(db, docIds, refuseAllProvider)

        const pass = await processPendingEmbeddings(db, refuseAllProvider)
        expect(pass.looked).toBe(5)
        expect(pass.embedded).toBe(0)
        expect(pass.failed).toBeInstanceOf(EmbeddingProviderError)

        // Four calls: the full batch of 5, then the first, middle, and last single-document probes.
        expect(refuseAllProvider.embed).toHaveBeenCalledTimes(4)
        expect(refuseAllProvider.embed.mock.calls[0]?.[0]).toHaveLength(5)
        expect(refuseAllProvider.embed.mock.calls[1]?.[0]).toHaveLength(1)
        expect(refuseAllProvider.embed.mock.calls[2]?.[0]).toHaveLength(1)
        expect(refuseAllProvider.embed.mock.calls[3]?.[0]).toHaveLength(1)

        // No marks cleared; every row is backing off with its claim released.
        expect(await countPendingEmbeddings(db)).toBe(5)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)
        expect(await claimPendingEmbeddings(db, 10, 'after-reqwide')).toEqual(
          []
        )

        const { rows } = await sql<{
          attempts: number
          backingOff: boolean
          hasPending: boolean
          hasEmbedding: boolean
          claimToken: string | null
        }>`
          select
            attempts,
            "retryAfter" > now() as "backingOff",
            "pendingSince" is not null as "hasPending",
            embedding is not null as "hasEmbedding",
            "claimToken"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = any(${docIds}::text[])
        `.execute(db)
        expect(rows).toHaveLength(5)
        for (const row of rows) {
          expect(row).toEqual({
            attempts: 1,
            backingOff: true,
            hasPending: true,
            hasEmbedding: false,
            claimToken: null
          })
        }
      } finally {
        await deleteEmbeddings(db, docIds)
      }
    })

    it('isolates one bad document in a batch of 5, storing the other 4 and backing off the bad one', async () => {
      const author = await addActor('batch-isolate-author')
      const specs = [
        { slug: 'iso-1-good', text: 'bicycle morning commute' },
        { slug: 'iso-2-good', text: 'espresso cappuccino barista' },
        {
          slug: 'iso-3-poison',
          text: 'poisondocument text refused by provider'
        },
        { slug: 'iso-4-good', text: 'hiking alpine summit' },
        { slug: 'iso-5-good', text: 'peloton derailleur climb' }
      ]
      const docIds: string[] = []
      for (let i = 0; i < specs.length; i += 1) {
        const statusId = await indexedStatus({
          id: statusIdOf(author, specs[i].slug),
          actorId: author,
          createdAt: 380 + i,
          text: specs[i].text,
          to: [PUBLIC]
        })
        docIds.push(docIdOf(statusId))
      }
      const badDocId = docIds[2]
      const goodDocIds = docIds.filter((id) => id !== badDocId)

      const selectiveProvider = createDeterministicProvider()
      selectiveProvider.embed.mockImplementation(async (texts: string[]) => {
        if (
          texts.some((text) => text.toLowerCase().includes('poisondocument'))
        ) {
          throw new EmbeddingProviderError('input exceeds model token limit', {
            statusCode: 400,
            retryable: false
          })
        }
        return texts.map((text) => bagOfWordsVector(text))
      })

      try {
        const failuresBefore = (await getSemanticStatus(db))?.failureCount ?? 0
        await markEmbeddingsPending(db, docIds, selectiveProvider)

        const pass = await processPendingEmbeddings(db, selectiveProvider)
        expect(pass.looked).toBe(5)
        expect(pass.failed).toBeUndefined()

        const stored = await getStoredEmbeddings(db, docIds)
        for (const goodId of goodDocIds) {
          expect(stored.get(goodId)?.hasEmbedding).toBe(true)
        }
        expect(stored.get(badDocId)?.hasEmbedding).toBe(false)

        // Only the refused row remains pending, and it is backing off (not claimable).
        expect(await countPendingEmbeddings(db)).toBe(1)
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)
        expect(await claimPendingEmbeddings(db, 10, 'after-iso')).toEqual([])

        const { rows: badRows } = await sql<{
          attempts: number
          backingOff: boolean
          hasPending: boolean
          claimToken: string | null
        }>`
          select
            attempts,
            "retryAfter" > now() as "backingOff",
            "pendingSince" is not null as "hasPending",
            "claimToken"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = ${badDocId}
        `.execute(db)
        expect(badRows[0]).toEqual({
          attempts: 1,
          backingOff: true,
          hasPending: true,
          claimToken: null
        })

        const status = await getSemanticStatus(db)
        expect(status?.failureCount).toBe(failuresBefore + 1)
        expect(status?.lastError).toContain('refused 1 document(s)')
      } finally {
        await deleteEmbeddings(db, docIds)
      }
    })

    it('backfill flow lifts backoff via markEmbeddingsPending and embeds through processPendingEmbeddings', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('backfill-flow-author')
      const [upToDateStatus, backingOffStatus, freshStatus] = await Promise.all(
        [
          indexedStatus({
            id: statusIdOf(author, 'bf-uptodate'),
            actorId: author,
            createdAt: 390,
            text: 'bicycle already embedded post',
            to: [PUBLIC]
          }),
          indexedStatus({
            id: statusIdOf(author, 'bf-backoff'),
            actorId: author,
            createdAt: 391,
            text: 'peloton backed off post',
            to: [PUBLIC]
          }),
          indexedStatus({
            id: statusIdOf(author, 'bf-fresh'),
            actorId: author,
            createdAt: 392,
            text: 'hiking fresh unembedded post',
            to: [PUBLIC]
          })
        ]
      )
      const upToDateDocId = docIdOf(upToDateStatus)
      const backingOffDocId = docIdOf(backingOffStatus)
      const freshDocId = docIdOf(freshStatus)
      const allDocIds = [upToDateDocId, backingOffDocId, freshDocId]

      try {
        // Seed upToDateDocId with a current embedding.
        await markEmbeddingsPending(db, [upToDateDocId], provider)
        await processPendingEmbeddings(db, provider)

        // Put backingOffDocId into backoff (attempts = 1, retryAfter > now(), pendingSince set).
        await markEmbeddingsPending(db, [backingOffDocId], provider)
        const [backoffClaim] = await claimPendingEmbeddings(
          db,
          10,
          'bf-backoff-token'
        )
        expect(backoffClaim?.documentId).toBe(backingOffDocId)
        await markEmbeddingsFailed(db, [backingOffDocId], {
          claimToken: 'bf-backoff-token',
          pendingSince: new Map([[backingOffDocId, backoffClaim!.pendingSince]])
        })
        expect(await hasClaimablePendingEmbeddings(db)).toBe(false)

        provider.embed.mockClear()

        // Backfill flow: find documents needing embedding, mark pending, drain passes.
        const page = await getEmbeddableDocuments(db, allDocIds)
        const needing = await getDocumentsNeedingEmbedding(db, provider, page)
        expect(needing.map((doc) => doc.id).sort()).toEqual(
          [backingOffDocId, freshDocId].sort()
        )

        await markEmbeddingsPending(
          db,
          needing.map((doc) => doc.id),
          provider
        )
        expect(await hasClaimablePendingEmbeddings(db)).toBe(true)

        let totalEmbedded = 0
        for (;;) {
          const pass = await processPendingEmbeddings(db, provider)
          expect(pass.failed).toBeUndefined()
          if (pass.looked === 0) break
          totalEmbedded += pass.embedded
        }
        expect(totalEmbedded).toBe(2)
        expect(provider.embed).toHaveBeenCalledTimes(1)
        expect(provider.embed.mock.calls[0]?.[0]).toHaveLength(2)

        const { rows } = await sql<{
          documentId: string
          hasEmbedding: boolean
          contentHash: string | null
          pendingSince: string | null
          attempts: number
          retryAfter: string | null
          claimToken: string | null
        }>`
          select
            "documentId",
            embedding is not null as "hasEmbedding",
            "contentHash",
            "pendingSince"::text as "pendingSince",
            attempts,
            "retryAfter"::text as "retryAfter",
            "claimToken"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = any(${allDocIds}::text[])
        `.execute(db)
        const byId = new Map(rows.map((row) => [row.documentId, row]))

        expect(byId.get(backingOffDocId)).toEqual({
          documentId: backingOffDocId,
          hasEmbedding: true,
          contentHash: getEmbeddingContentHash(
            getEmbeddingText('peloton backed off post')
          ),
          pendingSince: null,
          attempts: 0,
          retryAfter: null,
          claimToken: null
        })
        expect(byId.get(freshDocId)).toEqual({
          documentId: freshDocId,
          hasEmbedding: true,
          contentHash: getEmbeddingContentHash(
            getEmbeddingText('hiking fresh unembedded post')
          ),
          pendingSince: null,
          attempts: 0,
          retryAfter: null,
          claimToken: null
        })
        expect(await countPendingEmbeddings(db)).toBe(0)
      } finally {
        await deleteEmbeddings(db, allDocIds)
      }
    })

    it('leaves a row held by a live claim untouched during a second processPendingEmbeddings', async () => {
      const author = await addActor('live-claim-pass-author')
      const [heldStatus, otherStatus] = await Promise.all([
        indexedStatus({
          id: statusIdOf(author, 'live-held'),
          actorId: author,
          createdAt: 393,
          text: 'barista held by first pass',
          to: [PUBLIC]
        }),
        indexedStatus({
          id: statusIdOf(author, 'live-other'),
          actorId: author,
          createdAt: 394,
          text: 'bicycle embedded by second pass',
          to: [PUBLIC]
        })
      ])
      const heldDocId = docIdOf(heldStatus)
      const otherDocId = docIdOf(otherStatus)

      const secondProvider = createDeterministicProvider()
      let secondPassResult: Awaited<
        ReturnType<typeof processPendingEmbeddings>
      > | null = null
      let emptyPassResult: Awaited<
        ReturnType<typeof processPendingEmbeddings>
      > | null = null
      let heldRowDuringFirstPass: {
        claimToken: string | null
        pendingSince: string | null
        hasEmbedding: boolean
        hasLiveClaim: boolean
      } | null = null
      let heldRowAfterSecondPass: {
        claimToken: string | null
        pendingSince: string | null
        hasEmbedding: boolean
        hasLiveClaim: boolean
      } | null = null

      const firstProvider = createDeterministicProvider()
      firstProvider.embed.mockImplementation(async (texts: string[]) => {
        const readHeld = async () => {
          const { rows } = await sql<{
            claimToken: string | null
            pendingSince: string | null
            hasEmbedding: boolean
            hasLiveClaim: boolean
          }>`
            select
              "claimToken",
              "pendingSince"::text as "pendingSince",
              embedding is not null as "hasEmbedding",
              coalesce("claimedUntil" > now(), false) as "hasLiveClaim"
            from ${sql.table(EMBEDDINGS_TABLE)}
            where "documentId" = ${heldDocId}
          `.execute(db)
          return rows[0] ?? null
        }

        heldRowDuringFirstPass = await readHeld()
        await markEmbeddingsPending(db, [otherDocId], secondProvider)
        secondPassResult = await processPendingEmbeddings(db, secondProvider)
        emptyPassResult = await processPendingEmbeddings(db, secondProvider)
        heldRowAfterSecondPass = await readHeld()
        return texts.map((text) => bagOfWordsVector(text))
      })

      try {
        await markEmbeddingsPending(db, [heldDocId], firstProvider)

        const firstPassResult = await processPendingEmbeddings(
          db,
          firstProvider
        )
        expect(firstPassResult).toMatchObject({ looked: 1, embedded: 1 })
        expect(secondPassResult).toMatchObject({ looked: 1, embedded: 1 })
        expect(emptyPassResult).toEqual({ looked: 0, embedded: 0 })
        expect(secondProvider.embed).toHaveBeenCalledTimes(1)
        expect(secondProvider.embed.mock.calls[0]?.[0]).toEqual([
          'bicycle embedded by second pass'
        ])

        // The second pass left the live-claimed row completely untouched.
        expect(heldRowDuringFirstPass).toEqual({
          claimToken: expect.any(String),
          pendingSince: expect.any(String),
          hasEmbedding: false,
          hasLiveClaim: true
        })
        expect(heldRowAfterSecondPass).toEqual(heldRowDuringFirstPass)

        // Once the first pass completes, both rows have their embeddings.
        const stored = await getStoredEmbeddings(db, [heldDocId, otherDocId])
        expect(stored.get(heldDocId)?.hasEmbedding).toBe(true)
        expect(stored.get(otherDocId)?.hasEmbedding).toBe(true)
        expect(await countPendingEmbeddings(db)).toBe(0)
      } finally {
        await deleteEmbeddings(db, [heldDocId, otherDocId])
      }
    })

    it('changes nothing when storeEmbeddings is called without the holding claimToken', async () => {
      const provider = createDeterministicProvider()
      const author = await addActor('store-token-fence-author')
      const [missingRowStatus, heldStatus, settledStatus] = await Promise.all([
        indexedStatus({
          id: statusIdOf(author, 'token-missing-row'),
          actorId: author,
          createdAt: 395,
          text: 'bicycle no row exists',
          to: [PUBLIC]
        }),
        indexedStatus({
          id: statusIdOf(author, 'token-held'),
          actorId: author,
          createdAt: 396,
          text: 'espresso held by valid token',
          to: [PUBLIC]
        }),
        indexedStatus({
          id: statusIdOf(author, 'token-settled'),
          actorId: author,
          createdAt: 397,
          text: 'hiking already settled row',
          to: [PUBLIC]
        })
      ])
      const missingRowDocId = docIdOf(missingRowStatus)
      const heldDocId = docIdOf(heldStatus)
      const settledDocId = docIdOf(settledStatus)
      const allDocIds = [missingRowDocId, heldDocId, settledDocId]

      try {
        // Settle settledDocId so its row exists with claimToken = null.
        await markEmbeddingsPending(db, [settledDocId], provider)
        await processPendingEmbeddings(db, provider)
        const settledHash = getEmbeddingContentHash(
          getEmbeddingText('hiking already settled row')
        )

        // Hold heldDocId with a live claim.
        await markEmbeddingsPending(db, [heldDocId], provider)
        const [heldClaim] = await claimPendingEmbeddings(
          db,
          10,
          'holding-token'
        )
        expect(heldClaim?.documentId).toBe(heldDocId)

        // Calling storeEmbeddings with a non-holding token must neither insert nor update any row.
        await storeEmbeddings(
          db,
          [
            {
              documentId: missingRowDocId,
              contentHash: 'unclaimed-insert-attempt',
              embedding: bagOfWordsVector('bicycle no row exists'),
              pendingSince: null
            },
            {
              documentId: heldDocId,
              contentHash: 'wrong-token-overwrite',
              embedding: bagOfWordsVector('espresso held by valid token'),
              pendingSince: heldClaim!.pendingSince
            },
            {
              documentId: settledDocId,
              contentHash: 'settled-overwrite-attempt',
              embedding: bagOfWordsVector('bicycle'),
              pendingSince: null
            }
          ],
          { ...provider, claimToken: 'not-the-holding-token' }
        )

        const { rows: afterWrongToken } = await sql<{
          documentId: string
          hasEmbedding: boolean
          contentHash: string | null
          pendingSince: string | null
          claimToken: string | null
          hasLiveClaim: boolean
        }>`
          select
            "documentId",
            embedding is not null as "hasEmbedding",
            "contentHash",
            "pendingSince"::text as "pendingSince",
            "claimToken",
            coalesce("claimedUntil" > now(), false) as "hasLiveClaim"
          from ${sql.table(EMBEDDINGS_TABLE)}
          where "documentId" = any(${allDocIds}::text[])
        `.execute(db)
        const byId = new Map(
          afterWrongToken.map((row) => [row.documentId, row])
        )

        expect(byId.has(missingRowDocId)).toBe(false)
        expect(byId.get(heldDocId)).toEqual({
          documentId: heldDocId,
          hasEmbedding: false,
          contentHash: null,
          pendingSince: heldClaim!.pendingSince,
          claimToken: 'holding-token',
          hasLiveClaim: true
        })
        expect(byId.get(settledDocId)).toEqual({
          documentId: settledDocId,
          hasEmbedding: true,
          contentHash: settledHash,
          pendingSince: null,
          claimToken: null,
          hasLiveClaim: false
        })

        // Calling storeEmbeddings with the actual holding token succeeds.
        const heldHash = getEmbeddingContentHash(
          getEmbeddingText('espresso held by valid token')
        )
        await storeEmbeddings(
          db,
          [
            {
              documentId: heldDocId,
              contentHash: heldHash,
              embedding: bagOfWordsVector('espresso held by valid token'),
              pendingSince: heldClaim!.pendingSince
            }
          ],
          { ...provider, claimToken: 'holding-token' }
        )
        const storedHeld = (await getStoredEmbeddings(db, [heldDocId])).get(
          heldDocId
        )
        expect(storedHeld).toEqual(
          expect.objectContaining({
            documentId: heldDocId,
            contentHash: heldHash,
            hasEmbedding: true
          })
        )
        expect(await countPendingEmbeddings(db)).toBe(0)
      } finally {
        await deleteEmbeddings(db, allDocIds)
      }
    })
  })

  describe('hybrid ordering and access control', () => {
    it('merges vector-only hits by RRF, enforces visibility/blocks/in:library/operators, and ignores semantic for latest sort', async () => {
      const provider = createDeterministicProvider()
      const viewer = await addActor('hyb-viewer', { indexable: true })
      const authorA = await addActor('hyb-author-a', { indexable: true })
      const authorB = await addActor('hyb-author-b', { indexable: true })
      const blockedAuthor = await addActor('hyb-blocked', { indexable: true })
      const unfollowedAuthor = await addActor('hyb-unfollowed', {
        indexable: true
      })

      await db
        .insertInto('blocks')
        .values({
          id: 'hyb-block-row',
          actorId: viewer,
          actorHost: DOMAIN,
          targetActorId: blockedAuthor,
          targetActorHost: DOMAIN,
          uri: 'https://sem.pgvector.test/blocks/hyb-block-row'
        })
        .execute()

      // Keyword + semantic match (ranks high in both lists -> wins RRF).
      const bothHit = await indexedStatus({
        id: statusIdOf(authorA, 'both-hit'),
        actorId: authorA,
        createdAt: 1_700_000_000_000,
        text: 'bicycle carbon frame morning ride',
        to: [PUBLIC]
      })
      // Vector-only hit: no word "bicycle", but peloton+derailleur maps to the same bucket.
      const vectorOnly = await indexedStatus({
        id: statusIdOf(authorA, 'vector-only'),
        actorId: authorA,
        createdAt: 1_700_000_001_000,
        text: 'peloton derailleur climb "golden hour" mountain',
        to: [PUBLIC]
      })
      // Vector-only hit with an excluded word and a different author.
      const vectorExcluded = await indexedStatus({
        id: statusIdOf(authorB, 'vector-excluded'),
        actorId: authorB,
        createdAt: 1_700_000_002_000,
        text: 'peloton derailleur spoiler "golden hour"',
        to: [PUBLIC]
      })
      // Viewer's own post (in library) with vector-only match.
      const viewerOwn = await indexedStatus({
        id: statusIdOf(viewer, 'viewer-own'),
        actorId: viewer,
        createdAt: 1_700_000_003_000,
        text: 'cycling peloton journal',
        to: [PUBLIC]
      })
      // Blocked author's public post with exact semantic match.
      const blockedPost = await indexedStatus({
        id: statusIdOf(blockedAuthor, 'blocked-post'),
        actorId: blockedAuthor,
        createdAt: 1_700_000_004_000,
        text: 'peloton derailleur cycling',
        to: [PUBLIC]
      })
      // Unfollowed author's followers-only post: manually give it an embedding
      // to prove query-time visibility still hides it.
      const hiddenFollowersPost = await indexedStatus({
        id: statusIdOf(unfollowedAuthor, 'hidden-followers'),
        actorId: unfollowedAuthor,
        createdAt: 1_700_000_005_000,
        text: 'peloton derailleur secret',
        to: [`${unfollowedAuthor}/followers`]
      })
      // Public post marked pending but not yet embedded (embedding IS NULL):
      // must never leak into semantic results.
      const pendingUnembeddedPost = await indexedStatus({
        id: statusIdOf(authorA, 'pending-unembedded'),
        actorId: authorA,
        createdAt: 1_700_000_006_000,
        text: 'unrelated quiet afternoon',
        to: [PUBLIC]
      })

      const publicIds = [
        bothHit,
        vectorOnly,
        vectorExcluded,
        viewerOwn,
        blockedPost
      ]
      await markEmbeddingsPending(db, publicIds.map(docIdOf), provider)
      await processPendingEmbeddings(db, provider)
      await markEmbeddingsPending(
        db,
        [docIdOf(pendingUnembeddedPost)],
        provider
      )
      await sql`
        insert into ${sql.table(EMBEDDINGS_TABLE)}
          ("documentId", model, dimensions, "contentHash", embedding)
        values (
          ${docIdOf(hiddenFollowersPost)},
          ${MODEL},
          ${DIMENSIONS},
          'manual-hash',
          ${toVectorLiteral(bagOfWordsVector('bicycle'))}::halfvec
        )
      `.execute(db)

      const semantic = {
        embedding: bagOfWordsVector('bicycle'),
        model: MODEL,
        dimensions: DIMENSIONS
      }

      try {
        // 1. Relevance search merges vector-only hits and excludes blocked,
        // followers-only, and unembedded pending rows.
        const hybridResults = await database.searchStatusIds({
          q: 'bicycle',
          sort: 'relevance',
          limit: 20,
          currentActorId: viewer,
          localDomain: DOMAIN,
          semantic
        })
        expect(hybridResults[0]).toBe(bothHit)
        expect(hybridResults).toContain(vectorOnly)
        expect(hybridResults).toContain(viewerOwn)
        expect(hybridResults).not.toContain(blockedPost)
        expect(hybridResults).not.toContain(hiddenFollowersPost)
        expect(hybridResults).not.toContain(pendingUnembeddedPost)

        // 2. in:library excludes another author's public vector-only hit, keeps viewer's own.
        const libraryResults = await database.searchStatusIds({
          q: 'in:library bicycle',
          sort: 'relevance',
          limit: 20,
          currentActorId: viewer,
          localDomain: DOMAIN,
          semantic
        })
        expect(libraryResults).toContain(viewerOwn)
        expect(libraryResults).not.toContain(bothHit)
        expect(libraryResults).not.toContain(vectorOnly)

        // 3. Phrases, exclusions, and operators filter the vector side too.
        const filteredResults = await database.searchStatusIds({
          q: 'bicycle "golden hour" -spoiler from:hyb-author-a',
          sort: 'relevance',
          limit: 20,
          currentActorId: viewer,
          localDomain: DOMAIN,
          semantic
        })
        expect(filteredResults).toEqual([vectorOnly])

        // 4. Latest sort ignores semantic and returns keyword matches only.
        const latestResults = await database.searchStatusIds({
          q: 'bicycle',
          sort: 'latest',
          limit: 20,
          currentActorId: viewer,
          localDomain: DOMAIN,
          semantic
        })
        expect(latestResults).toEqual([bothHit])
      } finally {
        await sql`delete from ${sql.table(EMBEDDINGS_TABLE)} where "documentId" = ${docIdOf(pendingUnembeddedPost)}`.execute(
          db
        )
      }
    })
  })

  describe('fallback on query failure', () => {
    it('falls back to keyword results and records failure on wrong-dimension vector or dropped embeddings table', async () => {
      const author = await addActor('fb-author', { indexable: true })
      const keywordMatch = await indexedStatus({
        id: statusIdOf(author, 'fb-keyword'),
        actorId: author,
        createdAt: 1_700_000_010_000,
        text: 'fallbackkeyword lantern',
        to: [PUBLIC]
      })
      const provider = createDeterministicProvider()
      await markEmbeddingsPending(db, [docIdOf(keywordMatch)], provider)
      await processPendingEmbeddings(db, provider)

      // Wrong vector dimension triggers a pgvector error; search returns keyword match.
      const wrongDimResults = await database.searchStatusIds({
        q: 'fallbackkeyword',
        sort: 'relevance',
        limit: 10,
        currentActorId: author,
        semantic: {
          embedding: [1, 0, 0, 0],
          model: MODEL,
          dimensions: 4
        }
      })
      expect(wrongDimResults).toEqual([keywordMatch])

      const statusAfterWrongDim = await getSemanticStatus(db)
      expect(statusAfterWrongDim?.failureCount).toBeGreaterThanOrEqual(1)
      expect(statusAfterWrongDim?.lastError).toContain('search query:')
      expect(Number(statusAfterWrongDim?.lastErrorAt)).toBeGreaterThan(0)
      const countAfterWrongDim = statusAfterWrongDim?.failureCount ?? 0

      // Dropping the embeddings table still falls back to keyword results and records failure.
      await sql`drop table ${sql.table(EMBEDDINGS_TABLE)}`.execute(db)
      try {
        const droppedResults = await database.searchStatusIds({
          q: 'fallbackkeyword',
          sort: 'relevance',
          limit: 10,
          currentActorId: author,
          semantic: {
            embedding: bagOfWordsVector('fallbackkeyword'),
            model: MODEL,
            dimensions: DIMENSIONS
          }
        })
        expect(droppedResults).toEqual([keywordMatch])

        const statusAfterDrop = await getSemanticStatus(db)
        expect(statusAfterDrop?.failureCount).toBe(countAfterWrongDim + 1)
        expect(statusAfterDrop?.lastError).toContain(EMBEDDINGS_TABLE)
      } finally {
        await setupSemanticSearchTables(db, { dimensions: DIMENSIONS })
      }
    })
  })
})
