import { sql } from 'kysely'

import { getSearchDocumentId } from '@/lib/database/domains/search/rows'
import {
  EMBEDDINGS_TABLE,
  SEMANTIC_STATUS_TABLE,
  SemanticSetupError,
  countPendingEmbeddings,
  deleteEmbeddingsForActor,
  getEmbeddableDocuments,
  getSemanticStatus,
  getStoredEmbeddings,
  markEmbeddingsPending,
  readSemanticAvailability,
  resetSemanticAvailabilityCache,
  saveBackfillCursor,
  setupSemanticSearchTables,
  storeEmbeddings
} from '@/lib/database/domains/search/semanticStore'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createSearchActor,
  seedStatus
} from '@/lib/database/testing/searchTestHelpers'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { processPendingEmbeddings } from '@/lib/services/search/semantic/semanticSearch'
import type { EmbeddingProvider } from '@/lib/services/search/semantic/types'
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
