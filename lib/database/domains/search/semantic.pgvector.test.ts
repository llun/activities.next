import { sql } from 'kysely'

import { createDatabaseConnection } from '@/lib/database/connection'
import { getSearchDocumentId } from '@/lib/database/domains/search/rows'
import {
  EMBEDDINGS_TABLE,
  SEMANTIC_STATUS_TABLE,
  SemanticSetupError,
  claimPendingEmbeddings,
  clearEmbeddingPending,
  countPendingEmbeddings,
  deleteEmbeddings,
  deleteEmbeddingsForActor,
  getEmbeddableDocuments,
  getSemanticStatus,
  getStoredEmbeddings,
  markEmbeddingsPending,
  readSemanticAvailability,
  releaseEmbeddingClaims,
  resetSemanticAvailabilityCache,
  saveBackfillCursor,
  setupSemanticSearchTables,
  storeEmbeddings
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
import { processPendingEmbeddings } from '@/lib/services/search/semantic/semanticSearch'
import {
  type EmbeddingProvider,
  EmbeddingProviderError
} from '@/lib/services/search/semantic/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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

        const { rows } = await sql<{
          canEmbeddings: boolean
          canStatus: boolean
        }>`
          select
            has_table_privilege(${roleName}, ${EMBEDDINGS_TABLE}, 'SELECT, INSERT, UPDATE, DELETE') as "canEmbeddings",
            has_table_privilege(${roleName}, ${SEMANTIC_STATUS_TABLE}, 'SELECT, INSERT, UPDATE, DELETE') as "canStatus"
        `.execute(db)
        expect(rows[0]).toEqual({ canEmbeddings: true, canStatus: true })
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
      await storeEmbeddings(
        db,
        [
          {
            documentId: docId,
            contentHash: 'setup-tx-hash',
            embedding: bagOfWordsVector('bicycle'),
            pendingSince: null
          }
        ],
        { model: MODEL, dimensions: DIMENSIONS }
      )

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

    it('adds the claimedUntil column to an existing table created without it', async () => {
      try {
        await sql`alter table ${sql.table(EMBEDDINGS_TABLE)} drop column "claimedUntil"`.execute(
          db
        )
        const { rows: beforeRows } = await sql<{ exists: boolean }>`
          select exists(
            select 1 from pg_attribute
            where attrelid = to_regclass(${EMBEDDINGS_TABLE})
              and attname = 'claimedUntil' and not attisdropped
          ) as exists
        `.execute(db)
        expect(beforeRows[0]?.exists).toBe(false)

        const upgraded = await setupSemanticSearchTables(db, {
          dimensions: DIMENSIONS
        })
        expect(upgraded.created).toBe(false)
        expect(upgraded.recreated).toBe(false)

        const { rows: afterRows } = await sql<{ colType: string | null }>`
          select format_type(atttypid, atttypmod) as "colType"
          from pg_attribute
          where attrelid = to_regclass(${EMBEDDINGS_TABLE})
            and attname = 'claimedUntil' and not attisdropped
        `.execute(db)
        expect(afterRows[0]?.colType).toBe('timestamp with time zone')
        await expect(claimPendingEmbeddings(db, 10)).resolves.toEqual([])
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
      expect(firstPass).toEqual({ looked: 2, embedded: 2 })
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
      expect(secondPass).toEqual({ looked: 1, embedded: 0 })
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
      expect(thirdPass).toEqual({ looked: 1, embedded: 0 })
      expect(
        (await getStoredEmbeddings(db, [localDocId])).has(localDocId)
      ).toBe(false)
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
          const first = await claimPendingEmbeddings(trx, 2)
          const second = await claimPendingEmbeddings(secondHandle.db, 2)
          firstIds = first.map((row) => row.documentId)
          secondIds = second.map((row) => row.documentId)
        })

        expect(firstIds).toHaveLength(2)
        expect(secondIds).toHaveLength(2)
        expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([])
        expect([...firstIds, ...secondIds].sort()).toEqual([...docIds].sort())
        expect(await claimPendingEmbeddings(db, 10)).toEqual([])

        // Release and verify two parallel top-level claims also receive disjoint rows.
        await releaseEmbeddingClaims(db, docIds)
        const [parallelA, parallelB] = await Promise.all([
          claimPendingEmbeddings(db, 2),
          claimPendingEmbeddings(db, 2)
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

        const firstClaim = await claimPendingEmbeddings(db, 10)
        expect(firstClaim.map((row) => row.documentId)).toEqual([docId])
        expect(await claimPendingEmbeddings(db, 10)).toEqual([])

        await sql`
          update ${sql.table(EMBEDDINGS_TABLE)}
          set "claimedUntil" = now() - interval '1 second'
          where "documentId" = ${docId}
        `.execute(db)

        const reclaimed = await claimPendingEmbeddings(db, 10)
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

        const claimed = await claimPendingEmbeddings(db, 10)
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
        const claimed = await claimPendingEmbeddings(db, 10)
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

        await clearEmbeddingPending(db, docClear, oldClearMark)
        await deleteEmbeddings(
          db,
          [docDelete],
          new Map([[docDelete, oldDeleteMark]])
        )

        // Both rows survive with their newer marks and are immediately claimable again.
        const reclaimed = await claimPendingEmbeddings(db, 10)
        const newMarks = new Map(
          reclaimed.map((row) => [row.documentId, row.pendingSince])
        )
        expect(reclaimed.map((row) => row.documentId).sort()).toEqual(
          [docClear, docDelete].sort()
        )
        expect(newMarks.get(docClear)).not.toBe(oldClearMark)
        expect(newMarks.get(docDelete)).not.toBe(oldDeleteMark)

        // Applying the current marks clears/deletes as expected.
        await clearEmbeddingPending(db, docClear, newMarks.get(docClear)!)
        await deleteEmbeddings(
          db,
          [docDelete],
          new Map([[docDelete, newMarks.get(docDelete)!]])
        )
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
        const [claimed] = await claimPendingEmbeddings(db, 10)
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
          provider
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

    it('retries one document at a time on a non-retryable batch error, clears the bad mark, records the failure, and embeds the rest', async () => {
      const author = await addActor('batch-retry-author')
      const goodFirst = await indexedStatus({
        id: statusIdOf(author, 'retry-good-1'),
        actorId: author,
        createdAt: 370,
        text: 'bicycle morning commute',
        to: [PUBLIC]
      })
      const badDoc = await indexedStatus({
        id: statusIdOf(author, 'retry-bad'),
        actorId: author,
        createdAt: 371,
        text: 'poisondocument text refused by provider',
        to: [PUBLIC]
      })
      const goodSecond = await indexedStatus({
        id: statusIdOf(author, 'retry-good-2'),
        actorId: author,
        createdAt: 372,
        text: 'espresso cappuccino barista',
        to: [PUBLIC]
      })
      const goodFirstDocId = docIdOf(goodFirst)
      const badDocId = docIdOf(badDoc)
      const goodSecondDocId = docIdOf(goodSecond)
      const allDocIds = [goodFirstDocId, badDocId, goodSecondDocId]

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
        await markEmbeddingsPending(db, allDocIds, selectiveProvider)

        const result = await processPendingEmbeddings(db, selectiveProvider)
        expect(result).toEqual({ looked: 3, embedded: 2 })
        // 1 failed batch of 3 + 3 single-document retries.
        expect(selectiveProvider.embed).toHaveBeenCalledTimes(4)

        const stored = await getStoredEmbeddings(db, allDocIds)
        expect(stored.get(goodFirstDocId)?.hasEmbedding).toBe(true)
        expect(stored.get(goodSecondDocId)?.hasEmbedding).toBe(true)
        expect(stored.get(badDocId)?.hasEmbedding).toBe(false)
        expect(await countPendingEmbeddings(db)).toBe(0)

        const status = await getSemanticStatus(db)
        expect(status?.failureCount).toBe(failuresBefore + 1)
        expect(status?.lastError).toContain('input exceeds model token limit')
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
      await storeEmbeddings(
        db,
        [
          {
            documentId: docIdOf(hiddenFollowersPost),
            contentHash: 'manual-hash',
            embedding: bagOfWordsVector('bicycle'),
            pendingSince: null
          }
        ],
        provider
      )

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
      await storeEmbeddings(
        db,
        [
          {
            documentId: docIdOf(keywordMatch),
            contentHash: 'fb-hash',
            embedding: bagOfWordsVector('fallbackkeyword lantern'),
            pendingSince: null
          }
        ],
        { model: MODEL, dimensions: DIMENSIONS }
      )

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
