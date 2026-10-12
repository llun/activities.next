import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getMastodonActors } from '@/lib/database/domains/actor/mastodon'
import {
  type CollectionStatusSource,
  addStatusToCollectionTimelines,
  backfillCollectionFeedForMembers,
  getCollectionTimeline,
  getOwnedCollectionSeq,
  getPublicCollectionTimeline
} from '@/lib/database/domains/collection/feed'
import {
  type CollectionItemSelection,
  toCollection,
  toCollectionItem
} from '@/lib/database/domains/collection/rows'
import type {
  AddCollectionMembersParams,
  ApprovedCollectionMember,
  CollectionItemRow,
  CollectionMembersPage,
  CountCollectionItemsParams,
  CreateCollectionParams,
  DeleteCollectionParams,
  GetAccountCollectionsParams,
  GetApprovedCollectionMembersParams,
  GetCollectionByIdParams,
  GetCollectionItemByAccountParams,
  GetCollectionItemParams,
  GetCollectionItemsParams,
  GetCollectionMemberCountsParams,
  GetCollectionMembersParams,
  GetCollectionParams,
  GetCollectionTimelineParams,
  GetCollectionsFeaturingAccountParams,
  GetCollectionsParams,
  GetPublicCollectionTimelineParams,
  RemoveCollectionItemByIdParams,
  RemoveCollectionMembersParams,
  SetOwnCollectionMembershipStateParams,
  UpdateCollectionParams
} from '@/lib/database/domains/collection/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import {
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { pastStoredKeyset } from '@/lib/database/kysely/keyset'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import {
  CollectionLimitError,
  MAX_COLLECTIONS_PER_ACTOR,
  MAX_COLLECTION_MEMBERS
} from '@/lib/services/collections/limits'
import type {
  Collection,
  CollectionVisibility
} from '@/lib/types/domain/collection'

export type { CollectionStatusSource } from '@/lib/database/domains/collection/feed'
export {
  addStatusToCollectionTimelines,
  getCollectionTimeline,
  getPublicCollectionTimeline
} from '@/lib/database/domains/collection/feed'

const findOwnedCollection = (db: Db, id: string, ownerActorId: string) =>
  db
    .selectFrom('collections')
    .selectAll()
    .where('id', '=', id)
    .where('ownerActorId', '=', ownerActorId)
    .limit(1)
    .executeTakeFirst()

export const createCollection = async (
  db: Db,
  {
    actorId,
    title,
    description = null,
    topic = null,
    language = null,
    visibility = 'public',
    sensitive = false,
    publicFeed = true
  }: CreateCollectionParams
): Promise<Collection> => {
  const currentTime = new Date()
  const row = {
    id: randomUUID(),
    ownerActorId: actorId,
    title,
    description,
    topic,
    language,
    visibility,
    sensitive,
    publicFeed,
    createdAt: currentTime,
    updatedAt: currentTime
  }
  await inTransaction(db, async (trx) => {
    // Serialize one owner's creates on their actor row (a no-op on SQLite,
    // whose writers already serialize) so concurrent requests cannot each read
    // a count below the ceiling and together overshoot it.
    await forUpdate(
      trx,
      trx.selectFrom('actors').select('id').where('id', '=', actorId)
    ).execute()
    const countRow = await trx
      .selectFrom('collections')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('ownerActorId', '=', actorId)
      .executeTakeFirst()
    if (Number(countRow?.count ?? 0) >= MAX_COLLECTIONS_PER_ACTOR) {
      throw new CollectionLimitError('collections')
    }
    await trx.insertInto('collections').values(row).execute()
  })
  return {
    ...row,
    visibility: (visibility ?? 'public') as CollectionVisibility,
    sensitive: Boolean(sensitive),
    publicFeed: Boolean(publicFeed),
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
}

export const updateCollection = async (
  db: Db,
  {
    id,
    actorId,
    title,
    description,
    topic,
    language,
    visibility,
    sensitive,
    publicFeed
  }: UpdateCollectionParams
): Promise<Collection | null> => {
  const existing = await findOwnedCollection(db, id, actorId)
  if (!existing) return null

  await db
    .updateTable('collections')
    .set({
      updatedAt: new Date(),
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(topic !== undefined ? { topic } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
      ...(publicFeed !== undefined ? { publicFeed } : {})
    })
    .where('id', '=', id)
    .where('ownerActorId', '=', actorId)
    .execute()
  const updated = await findOwnedCollection(db, id, actorId)
  return updated ? toCollection(updated) : null
}

export const getCollection = async (
  db: Db,
  { id, actorId }: GetCollectionParams
): Promise<Collection | null> => {
  const row = await findOwnedCollection(db, id, actorId)
  return row ? toCollection(row) : null
}

/**
 * A collection by id alone, not owner-scoped. Visibility gating is the
 * caller's: the public collection page and member notifications use it.
 */
export const getCollectionById = async (
  db: Db,
  { id }: GetCollectionByIdParams
): Promise<Collection | null> => {
  const row = await db
    .selectFrom('collections')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toCollection(row) : null
}

export const getCollections = async (
  db: Db,
  { actorId }: GetCollectionsParams
): Promise<Collection[]> => {
  const rows = await db
    .selectFrom('collections')
    .selectAll()
    .where('ownerActorId', '=', actorId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toCollection)
}

export const deleteCollection = async (
  db: Db,
  { id, actorId }: DeleteCollectionParams
): Promise<boolean> => {
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return false

  await inTransaction(db, async (trx) => {
    await trx
      .deleteFrom('collection_timeline')
      .where('collectionSeq', '=', seq)
      .execute()
    await trx
      .deleteFrom('collection_members')
      .where('collectionSeq', '=', seq)
      .execute()
    await trx
      .deleteFrom('collections')
      .where('id', '=', id)
      .where('ownerActorId', '=', actorId)
      .execute()
  })
  return true
}

export const getCollectionMemberCounts = async (
  db: Db,
  {
    actorId,
    collectionIds,
    approvedOnly = false
  }: GetCollectionMemberCountsParams
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const collectionId of collectionIds) counts[collectionId] = 0
  if (collectionIds.length === 0) return counts

  // The chunks reserve the owner's binding.
  const rows = await selectInChunks(
    db,
    collectionIds,
    (chunk) =>
      db
        .selectFrom('collection_members')
        .innerJoin(
          'collections',
          'collections.seq',
          'collection_members.collectionSeq'
        )
        .select(['collections.id as id', (eb) => eb.fn.countAll().as('count')])
        .where('collections.ownerActorId', '=', actorId)
        .where('collections.id', 'in', chunk)
        .$if(approvedOnly, (qb) =>
          qb.where('collection_members.featureState', '=', 'approved')
        )
        .groupBy('collections.id')
        .execute(),
    1
  )
  for (const row of rows) counts[row.id] = Number(row.count)
  return counts
}

/**
 * Adds the members (pending until each approves) and backfills their recent
 * posts into the feed, in one transaction. Returns the actor ids that were not
 * members before, so the caller notifies only those.
 */
export const addCollectionMembers = async (
  db: Db,
  { id, actorId, targetActorIds }: AddCollectionMembersParams
): Promise<string[]> => {
  if (targetActorIds.length === 0) return []
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return []

  const currentTime = new Date()
  const rows = targetActorIds.map((targetActorId) => ({
    id: randomUUID(),
    collectionSeq: seq,
    targetActorId,
    // New members start pending; they become publicly visible only after the
    // member approves (and only if their allowFeaturing opt-in is set).
    featureState: 'pending',
    createdAt: currentTime
  }))

  return inTransaction(db, async (trx) => {
    // Serialize adds to one collection on its row (a no-op on SQLite) so the
    // member ceiling below holds across concurrent requests.
    await forUpdate(
      trx,
      trx.selectFrom('collections').select('seq').where('seq', '=', seq)
    ).execute()
    // The chunks reserve the collectionSeq binding.
    const existing = new Set(
      (
        await selectInChunks(
          trx,
          targetActorIds,
          (chunk) =>
            trx
              .selectFrom('collection_members')
              .select('targetActorId')
              .where('collectionSeq', '=', seq)
              .where('targetActorId', 'in', chunk)
              .execute(),
          1
        )
      ).map((row) => row.targetActorId)
    )
    // Actor ids that were not members before this call: a re-add is a no-op,
    // not a re-notify.
    const newlyAdded = targetActorIds.filter((target) => !existing.has(target))

    const memberCountRow = await trx
      .selectFrom('collection_members')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('collectionSeq', '=', seq)
      .executeTakeFirst()
    if (
      Number(memberCountRow?.count ?? 0) + new Set(newlyAdded).size >
      MAX_COLLECTION_MEMBERS
    ) {
      throw new CollectionLimitError('members')
    }

    await insertInChunks(trx, rows, (chunk) =>
      trx
        .insertInto('collection_members')
        .values(chunk)
        .onConflict((conflict) =>
          conflict.columns(['collectionSeq', 'targetActorId']).doNothing()
        )
        .execute()
    )

    // Resolve every (target -> memberSeq) for the backfill, members that
    // already existed included, so a re-add still ensures their feed rows.
    const memberSeqByActorId = new Map<string, number>()
    const memberRows = await selectInChunks(
      trx,
      targetActorIds,
      (chunk) =>
        trx
          .selectFrom('collection_members')
          .select(['seq', 'targetActorId'])
          .where('collectionSeq', '=', seq)
          .where('targetActorId', 'in', chunk)
          .execute(),
      1
    )
    for (const memberRow of memberRows) {
      memberSeqByActorId.set(memberRow.targetActorId, memberRow.seq)
    }

    await backfillCollectionFeedForMembers(trx, {
      collectionSeq: seq,
      memberSeqByActorId
    })
    return newlyAdded
  })
}

export const removeCollectionMembers = async (
  db: Db,
  { id, actorId, targetActorIds }: RemoveCollectionMembersParams
): Promise<void> => {
  if (targetActorIds.length === 0) return
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return

  await inTransaction(db, async (trx) => {
    // Resolve the member seqs first, so the feed purge targets memberSeq
    // (indexed) rather than re-deriving the author of each feed row. The
    // chunks reserve the collectionSeq binding.
    const memberSeqs = (
      await selectInChunks(
        trx,
        targetActorIds,
        (chunk) =>
          trx
            .selectFrom('collection_members')
            .select('seq')
            .where('collectionSeq', '=', seq)
            .where('targetActorId', 'in', chunk)
            .execute(),
        1
      )
    ).map((row) => row.seq)

    for (const chunk of chunkArray(memberSeqs, getWhereInBatchSize(trx, 0))) {
      await trx
        .deleteFrom('collection_timeline')
        .where('memberSeq', 'in', chunk)
        .execute()
    }
    for (const chunk of chunkArray(
      targetActorIds,
      getWhereInBatchSize(trx, 1)
    )) {
      await trx
        .deleteFrom('collection_members')
        .where('collectionSeq', '=', seq)
        .where('targetActorId', 'in', chunk)
        .execute()
    }
  })
}

/**
 * The member's approve or revoke of their OWN membership, so not owner-scoped:
 * the collection is found by its public id and the membership by the caller.
 */
export const setOwnCollectionMembershipState = async (
  db: Db,
  { collectionId, actorId, state }: SetOwnCollectionMembershipStateParams
): Promise<boolean> => {
  const collection = await db
    .selectFrom('collections')
    .select('seq')
    .where('id', '=', collectionId)
    .limit(1)
    .executeTakeFirst()
  if (!collection) return false
  const result = await db
    .updateTable('collection_members')
    .set({ featureState: state })
    .where('collectionSeq', '=', collection.seq)
    .where('targetActorId', '=', actorId)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const getCollectionMembers = async (
  db: Db,
  {
    id,
    actorId,
    projection = 'owner',
    limit = PER_PAGE_LIMIT,
    maxId,
    sinceId
  }: GetCollectionMembersParams
): Promise<CollectionMembersPage> => {
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return { accounts: [], nextMaxId: null, prevMinId: null }

  let query = db
    .selectFrom('collection_members')
    .select(['id', 'targetActorId'])
    .where('collectionSeq', '=', seq)
    .$if(projection === 'public', (qb) =>
      qb.where('featureState', '=', 'approved')
    )

  // Membership ids are random UUIDs, so the cursor is the cursor row's
  // createdAt with the id as tie-breaker. An unknown cursor applies no bound.
  const applyCursor = async (cursorId: string, operator: '<' | '>') => {
    const cursor = await db
      .selectFrom('collection_members')
      .select('createdAt')
      .where('collectionSeq', '=', seq)
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return
    const past = { createdAt: cursor.createdAt, tieBreaker: cursorId }
    query = query.where((eb) => pastStoredKeyset(eb, past, operator, 'id'))
  }

  if (maxId) await applyCursor(maxId, '<')
  if (sinceId) await applyCursor(sinceId, '>')

  const rows = await query
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit)
    .execute()
  const accounts = await getMastodonActors(
    db,
    rows.map((row) => row.targetActorId)
  )
  return {
    accounts,
    nextMaxId: rows.length > 0 ? rows[rows.length - 1].id : null,
    prevMinId: rows.length > 0 ? rows[0].id : null
  }
}

/**
 * The approved members, oldest first, with each one's actor type for the
 * FEP-7aa9 `featuredObjectType` (Person, Service, Group…). A member with no
 * local actor row reads as 'Person'.
 */
export const getApprovedCollectionMembers = async (
  db: Db,
  { id, actorId }: GetApprovedCollectionMembersParams
): Promise<ApprovedCollectionMember[]> => {
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return []
  const rows = await db
    .selectFrom('collection_members')
    .leftJoin('actors', 'actors.id', 'collection_members.targetActorId')
    .select(['collection_members.targetActorId as id', 'actors.type as type'])
    .where('collection_members.collectionSeq', '=', seq)
    .where('collection_members.featureState', '=', 'approved')
    .orderBy('collection_members.createdAt', 'asc')
    .orderBy('collection_members.id', 'asc')
    .execute()
  return rows.map((row) => ({ id: row.id, type: row.type ?? 'Person' }))
}

// The membership rows of the collections `whereCollection` picks, oldest
// first, with the collection id they belong to.
const selectCollectionItems = (db: Db, approvedOnly: boolean) =>
  db
    .selectFrom('collection_members')
    .innerJoin(
      'collections',
      'collections.seq',
      'collection_members.collectionSeq'
    )
    .select([
      'collections.id as collectionId',
      'collection_members.id as id',
      'collection_members.targetActorId as targetActorId',
      'collection_members.featureState as featureState',
      'collection_members.createdAt as createdAt'
    ])
    .$if(approvedOnly, (qb) =>
      qb.where('collection_members.featureState', '=', 'approved')
    )
    .orderBy('collection_members.createdAt', 'asc')
    .orderBy('collection_members.id', 'asc')

export const getCollectionItems = async (
  db: Db,
  {
    collectionIds,
    approvedOnly = false,
    limitPerCollection
  }: GetCollectionItemsParams
): Promise<Record<string, CollectionItemRow[]>> => {
  const itemsByCollection: Record<string, CollectionItemRow[]> = {}
  for (const collectionId of collectionIds) {
    itemsByCollection[collectionId] = []
  }
  if (collectionIds.length === 0) return itemsByCollection

  const collect = (
    rows: (CollectionItemSelection & { collectionId: string })[]
  ) => {
    for (const row of rows) {
      itemsByCollection[row.collectionId]?.push(toCollectionItem(row))
    }
  }

  if (limitPerCollection !== undefined) {
    // A bounded preview: one LIMITed query per collection, so the rows read
    // never depend on how many members a collection holds.
    for (const collectionId of new Set(collectionIds)) {
      collect(
        await selectCollectionItems(db, approvedOnly)
          .where('collections.id', '=', collectionId)
          .limit(limitPerCollection)
          .execute()
      )
    }
    return itemsByCollection
  }

  collect(
    await selectInChunks(
      db,
      collectionIds,
      (chunk) =>
        selectCollectionItems(db, approvedOnly)
          .where('collections.id', 'in', chunk)
          .execute(),
      1
    )
  )
  return itemsByCollection
}

const selectCollectionItem = (db: Db, collectionId: string) =>
  db
    .selectFrom('collection_members')
    .innerJoin(
      'collections',
      'collections.seq',
      'collection_members.collectionSeq'
    )
    .select([
      'collection_members.id as id',
      'collection_members.targetActorId as targetActorId',
      'collection_members.featureState as featureState',
      'collection_members.createdAt as createdAt'
    ])
    .where('collections.id', '=', collectionId)

export const getCollectionItem = async (
  db: Db,
  { collectionId, itemId }: GetCollectionItemParams
): Promise<CollectionItemRow | null> => {
  const row = await selectCollectionItem(db, collectionId)
    .where('collection_members.id', '=', itemId)
    .limit(1)
    .executeTakeFirst()
  return row ? toCollectionItem(row) : null
}

export const getCollectionItemByAccount = async (
  db: Db,
  { collectionId, targetActorId }: GetCollectionItemByAccountParams
): Promise<CollectionItemRow | null> => {
  const row = await selectCollectionItem(db, collectionId)
    .where('collection_members.targetActorId', '=', targetActorId)
    .limit(1)
    .executeTakeFirst()
  return row ? toCollectionItem(row) : null
}

export const countCollectionItems = async (
  db: Db,
  { collectionIds, approvedOnly = false }: CountCollectionItemsParams
): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const collectionId of collectionIds) counts[collectionId] = 0
  if (collectionIds.length === 0) return counts

  const rows = await selectInChunks(
    db,
    collectionIds,
    (chunk) =>
      db
        .selectFrom('collection_members')
        .innerJoin(
          'collections',
          'collections.seq',
          'collection_members.collectionSeq'
        )
        .select(['collections.id as id', (eb) => eb.fn.countAll().as('count')])
        .where('collections.id', 'in', chunk)
        .$if(approvedOnly, (qb) =>
          qb.where('collection_members.featureState', '=', 'approved')
        )
        .groupBy('collections.id')
        .execute(),
    1
  )
  for (const row of rows) counts[row.id] = Number(row.count)
  return counts
}

export const getAccountCollections = async (
  db: Db,
  {
    ownerActorId,
    publicOnly = false,
    limit = PER_PAGE_LIMIT,
    offset = 0
  }: GetAccountCollectionsParams
): Promise<Collection[]> => {
  const rows = await db
    .selectFrom('collections')
    .selectAll()
    .where('ownerActorId', '=', ownerActorId)
    .$if(publicOnly, (qb) => qb.where('visibility', '=', 'public'))
    .orderBy('createdAt', 'asc')
    .orderBy('seq', 'asc')
    .limit(limit)
    .offset(offset)
    .execute()
  return rows.map(toCollection)
}

/**
 * The collections featuring an account that the viewer may see: the viewer's
 * own, and other owners' public ones where the membership is approved.
 * (collectionSeq, targetActorId) is unique, so each collection joins at most
 * one membership row and needs no DISTINCT.
 */
export const getCollectionsFeaturingAccount = async (
  db: Db,
  {
    targetActorId,
    viewerActorId,
    limit = PER_PAGE_LIMIT,
    offset = 0
  }: GetCollectionsFeaturingAccountParams
): Promise<Collection[]> => {
  const rows = await db
    .selectFrom('collections')
    .innerJoin(
      'collection_members',
      'collection_members.collectionSeq',
      'collections.seq'
    )
    .selectAll('collections')
    .where('collection_members.targetActorId', '=', targetActorId)
    .where((eb) =>
      eb.or([
        eb('collections.ownerActorId', '=', viewerActorId),
        eb.and([
          eb('collections.visibility', '=', 'public'),
          eb('collection_members.featureState', '=', 'approved')
        ])
      ])
    )
    .orderBy('collections.createdAt', 'asc')
    .orderBy('collections.seq', 'asc')
    .limit(limit)
    .offset(offset)
    .execute()
  return rows.map(toCollection)
}

export const removeCollectionItemById = async (
  db: Db,
  { id, actorId, itemId }: RemoveCollectionItemByIdParams
): Promise<boolean> => {
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return false
  const member = await db
    .selectFrom('collection_members')
    .select('seq')
    .where('collectionSeq', '=', seq)
    .where('id', '=', itemId)
    .limit(1)
    .executeTakeFirst()
  if (!member) return false
  await inTransaction(db, async (trx) => {
    await trx
      .deleteFrom('collection_timeline')
      .where('memberSeq', '=', member.seq)
      .execute()
    await trx
      .deleteFrom('collection_members')
      .where('seq', '=', member.seq)
      .execute()
  })
  return true
}

/**
 * The collection facade methods as `(db, params)` queries. The two feed reads
 * hydrate their statuses through `getStatusesByIds` (the status facade's,
 * injected), after this domain's queries and outside any transaction.
 */
export const createCollectionQueries = (
  getStatusesByIds: CollectionStatusSource
) => ({
  createCollection,
  updateCollection,
  getCollection,
  getCollectionById,
  getCollections,
  deleteCollection,
  getCollectionMemberCounts,
  addCollectionMembers,
  removeCollectionMembers,
  setOwnCollectionMembershipState,
  getCollectionMembers,
  getApprovedCollectionMembers,
  getCollectionItems,
  getCollectionItem,
  getCollectionItemByAccount,
  countCollectionItems,
  getAccountCollections,
  getCollectionsFeaturingAccount,
  removeCollectionItemById,
  getCollectionTimeline: (db: Db, params: GetCollectionTimelineParams) =>
    getCollectionTimeline(db, getStatusesByIds, params),
  getPublicCollectionTimeline: (
    db: Db,
    params: GetPublicCollectionTimelineParams
  ) => getPublicCollectionTimeline(db, getStatusesByIds, params),
  addStatusToCollectionTimelines
})
