import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { applyBlockMuteFilter } from '@/lib/database/sql/utils/blockMuteFilter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  PUBLIC_ACTIVITY_RECIPIENTS,
  applyPotentiallyReadableStatusFilter
} from '@/lib/database/sql/utils/statusVisibility'
import {
  COLLECTION_FEED_MAX_ROWS,
  COLLECTION_FEED_TRIM_SLACK
} from '@/lib/services/timelines/types'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AddCollectionMembersParams,
  AddStatusToCollectionTimelinesParams,
  CollectionDatabase,
  CollectionMembersPage,
  CreateCollectionParams,
  DeleteCollectionParams,
  GetApprovedCollectionMembersParams,
  GetCollectionMemberCountsParams,
  GetCollectionMembersParams,
  GetCollectionParams,
  GetCollectionTimelineParams,
  GetCollectionsParams,
  GetCollectionsWithAccountParams,
  GetPublicCollectionTimelineParams,
  RemoveCollectionMembersParams,
  SetCollectionMemberStateParams,
  SetOwnCollectionMembershipStateParams,
  UpdateCollectionParams
} from '@/lib/types/database/operations'
import { Collection, CollectionVisibility } from '@/lib/types/domain/collection'
import { Status } from '@/lib/types/domain/status'

type SQLCollection = {
  id: string
  ownerActorId: string
  title: string
  description: string | null
  topic: string | null
  language: string | null
  visibility: string
  publicFeed: boolean | number
  createdAt: number | Date
  updatedAt: number | Date
}

const fixCollectionRow = (row: SQLCollection): Collection => ({
  id: row.id,
  ownerActorId: row.ownerActorId,
  title: row.title,
  description: row.description ?? null,
  topic: row.topic ?? null,
  language: row.language ?? null,
  visibility: (row.visibility ?? 'public') as CollectionVisibility,
  publicFeed: Boolean(row.publicFeed),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

// Resolve the owner-scoped collection to its internal bigint `seq` (the key the
// hot-path tables reference). Returns null when the collection does not exist or
// is not owned by the actor, so every caller is defensively owner-scoped.
const getOwnedCollectionSeq = async (
  database: Knex,
  id: string,
  ownerActorId: string
): Promise<string | number | null> => {
  const row = await database('collections')
    .where({ id, ownerActorId })
    .first<{ seq: string | number }>('seq')
  return row ? row.seq : null
}

// Trim a collection's materialized feed back down to COLLECTION_FEED_MAX_ROWS,
// keeping the newest rows by (sortKey, id). Runs only once the feed overshoots
// the cap by COLLECTION_FEED_TRIM_SLACK so eviction is batched rather than paid
// on every insert.
const trimCollectionFeed = async (
  database: Knex,
  collectionSeq: string | number
): Promise<void> => {
  const countRow = await database('collection_timeline')
    .where('collectionSeq', collectionSeq)
    .count<{ count: string | number }>('* as count')
    .first()
  const total = Number(countRow?.count ?? 0)
  if (total <= COLLECTION_FEED_MAX_ROWS + COLLECTION_FEED_TRIM_SLACK) return

  // The (sortKey, id) of the COLLECTION_FEED_MAX_ROWS-th newest row is the
  // retention boundary: everything strictly older than it is evicted.
  const boundary = await database('collection_timeline')
    .where('collectionSeq', collectionSeq)
    .orderBy('sortKey', 'desc')
    .orderBy('id', 'desc')
    .offset(COLLECTION_FEED_MAX_ROWS - 1)
    .limit(1)
    .first<{ sortKey: string | number; id: string | number }>('sortKey', 'id')
  if (!boundary) return

  await database('collection_timeline')
    .where('collectionSeq', collectionSeq)
    .andWhere((builder) => {
      builder.where('sortKey', '<', boundary.sortKey).orWhere((tie) => {
        tie.where('sortKey', boundary.sortKey).andWhere('id', '<', boundary.id)
      })
    })
    .delete()
}

// Materialize the given members' most recent posts into a collection's feed when
// they are added, so the feed shows history immediately rather than only posts
// published after the add. `memberSeqByActorId` maps each member's actor id to
// its collection_members.seq (the compact reference stored in the feed). Inserts
// are idempotent on the unique (collectionSeq, statusId).
const backfillCollectionFeedForMembers = async ({
  database,
  collectionSeq,
  memberSeqByActorId
}: {
  database: Knex
  collectionSeq: string | number
  memberSeqByActorId: Map<string, string | number>
}): Promise<void> => {
  const targetActorIds = [...memberSeqByActorId.keys()]
  if (targetActorIds.length === 0) return

  const whereInBatchSize = getWhereInBatchSize(database, 0)
  for (const idChunk of chunkArray(targetActorIds, whereInBatchSize)) {
    // Only the newest COLLECTION_FEED_MAX_ROWS statuses across the chunk can
    // survive the trim below, so cap the fetch instead of pulling full history.
    const statuses = await database('statuses')
      .whereIn('actorId', idChunk)
      .orderBy('createdAt', 'desc')
      .limit(COLLECTION_FEED_MAX_ROWS)
      .select('id', 'actorId', 'createdAt')
    if (statuses.length === 0) continue
    const rows = statuses
      .map((statusRow) => {
        const memberSeq = memberSeqByActorId.get(statusRow.actorId as string)
        if (memberSeq === undefined) return null
        return {
          collectionSeq,
          memberSeq,
          statusId: statusRow.id as string,
          sortKey: getCompatibleTime(statusRow.createdAt)
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
    if (rows.length === 0) continue
    const batchSize = getInsertBatchSize(database, rows[0])
    for (const chunk of chunkArray(rows, batchSize)) {
      await database('collection_timeline')
        .insert(chunk)
        .onConflict(['collectionSeq', 'statusId'])
        .ignore()
    }
  }
  await trimCollectionFeed(database, collectionSeq)
}

// Read a resolved collection's materialized feed for the given projection. The
// caller resolves `collectionSeq` (owner-scoped for the private read, or via the
// public-visibility check for the public read), so this helper is shared by both
// getCollectionTimeline and getPublicCollectionTimeline without duplicating the
// projection/pagination logic.
const readCollectionFeed = async ({
  database,
  getStatusesByIds,
  collectionSeq,
  projection,
  ownerActorId,
  limit,
  maxStatusId,
  minStatusId
}: {
  database: Knex
  getStatusesByIds: (
    statusIds: string[],
    currentActorId?: string
  ) => Promise<Status[]>
  collectionSeq: string | number
  projection: 'owner' | 'public'
  ownerActorId: string
  limit: number
  maxStatusId?: string | null
  minStatusId?: string | null
}): Promise<Status[]> => {
  const query = database('collection_timeline')
    .innerJoin('statuses', 'statuses.id', 'collection_timeline.statusId')
    .where('collection_timeline.collectionSeq', collectionSeq)

  if (projection === 'public') {
    // Public projection: only approved members, and only already-public posts
    // (a member's followers-only post must never leak to the public feed even
    // though the owner can see it in the private projection).
    query
      .innerJoin(
        'collection_members',
        'collection_members.seq',
        'collection_timeline.memberSeq'
      )
      .andWhere('collection_members.featureState', 'approved')
      .whereIn(
        'statuses.id',
        database('recipients')
          .select('statusId')
          .whereIn('recipients.actorId', PUBLIC_ACTIVITY_RECIPIENTS)
      )
  } else {
    // Owner projection: all members, filtered to what the owner may read and
    // dropping blocked/muted authors — both pre-LIMIT, like the list timeline.
    applyPotentiallyReadableStatusFilter({
      database,
      query,
      visibleToActorId: ownerActorId
    })
    applyBlockMuteFilter({
      database,
      query,
      viewerActorId: ownerActorId,
      now: Date.now()
    })
  }

  query
    .orderBy('collection_timeline.sortKey', 'desc')
    .orderBy('collection_timeline.id', 'desc')
    .limit(limit)
    .select('statuses.id')

  const applyCursor = async (
    cursorStatusId: string,
    direction: 'older' | 'newer'
  ): Promise<boolean> => {
    let cursor = await database('collection_timeline')
      .where('collectionSeq', collectionSeq)
      .where('statusId', cursorStatusId)
      .select('id', 'sortKey')
      .first<{ id: string | number | null; sortKey: number | string }>()
    if (!cursor) {
      const statusRow = await database('statuses')
        .where('id', cursorStatusId)
        .select('createdAt')
        .first<{ createdAt: number | Date }>()
      if (!statusRow) return false
      cursor = { id: null, sortKey: getCompatibleTime(statusRow.createdAt) }
    }
    const operator = direction === 'older' ? '<' : '>'
    const { id: cursorId, sortKey: cursorSortKey } = cursor
    query.andWhere((builder) => {
      builder.where('collection_timeline.sortKey', operator, cursorSortKey)
      if (cursorId !== null) {
        builder.orWhere((tie) => {
          tie
            .where('collection_timeline.sortKey', cursorSortKey)
            .andWhere('collection_timeline.id', operator, cursorId)
        })
      }
    })
    return true
  }

  if (maxStatusId && !(await applyCursor(maxStatusId, 'older'))) return []
  if (minStatusId && !(await applyCursor(minStatusId, 'newer'))) return []

  const rows = await query
  const statusIds = rows.map((row) => row.id as string)
  if (statusIds.length === 0) return []
  // Owner projection hydrates the owner's action state; the public projection
  // is anonymous (no viewer), so action state is intentionally un-acted.
  return getStatusesByIds(
    statusIds,
    projection === 'owner' ? ownerActorId : undefined
  )
}

export const CollectionSQLDatabaseMixin = (
  database: Knex,
  getMastodonActors: (actorIds: string[]) => Promise<Mastodon.Account[]>,
  getStatusesByIds: (
    statusIds: string[],
    currentActorId?: string
  ) => Promise<Status[]>
): CollectionDatabase => ({
  async createCollection({
    actorId,
    title,
    description = null,
    topic = null,
    language = null,
    visibility = 'public',
    publicFeed = true
  }: CreateCollectionParams) {
    const currentTime = new Date()
    const row = {
      id: randomUUID(),
      ownerActorId: actorId,
      title,
      description,
      topic,
      language,
      visibility,
      publicFeed,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('collections').insert(row)
    return fixCollectionRow(row as unknown as SQLCollection)
  },

  async updateCollection({
    id,
    actorId,
    title,
    description,
    topic,
    language,
    visibility,
    publicFeed
  }: UpdateCollectionParams) {
    const existing = await database<SQLCollection>('collections')
      .where({ id, ownerActorId: actorId })
      .first()
    if (!existing) return null

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (topic !== undefined) updates.topic = topic
    if (language !== undefined) updates.language = language
    if (visibility !== undefined) updates.visibility = visibility
    if (publicFeed !== undefined) updates.publicFeed = publicFeed

    await database('collections')
      .where({ id, ownerActorId: actorId })
      .update(updates)
    const updated = await database<SQLCollection>('collections')
      .where({ id, ownerActorId: actorId })
      .first()
    return updated ? fixCollectionRow(updated) : null
  },

  async getCollection({ id, actorId }: GetCollectionParams) {
    const row = await database<SQLCollection>('collections')
      .where({ id, ownerActorId: actorId })
      .first()
    return row ? fixCollectionRow(row) : null
  },

  async getCollections({ actorId }: GetCollectionsParams) {
    const rows = await database<SQLCollection>('collections')
      .where({ ownerActorId: actorId })
      .orderBy('createdAt', 'asc')
    return rows.map(fixCollectionRow)
  },

  async deleteCollection({ id, actorId }: DeleteCollectionParams) {
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return false

    await database.transaction(async (trx) => {
      await trx('collection_timeline').where('collectionSeq', seq).delete()
      await trx('collection_members').where('collectionSeq', seq).delete()
      await trx('collections').where({ id, ownerActorId: actorId }).delete()
    })
    return true
  },

  async getCollectionMemberCounts({
    actorId,
    collectionIds,
    approvedOnly = false
  }: GetCollectionMemberCountsParams) {
    const counts: Record<string, number> = {}
    for (const collectionId of collectionIds) counts[collectionId] = 0
    if (collectionIds.length === 0) return counts

    for (const chunk of chunkArray(
      collectionIds,
      getWhereInBatchSize(database, 1)
    )) {
      const query = database('collection_members')
        .innerJoin(
          'collections',
          'collections.seq',
          'collection_members.collectionSeq'
        )
        .where('collections.ownerActorId', actorId)
        .whereIn('collections.id', chunk)
        .groupBy('collections.id')
        .select('collections.id as id')
        .count<{ id: string; count: string | number }[]>('* as count')
      if (approvedOnly) {
        query.andWhere('collection_members.featureState', 'approved')
      }
      const rows = await query
      for (const row of rows) {
        counts[row.id as string] = Number(row.count)
      }
    }
    return counts
  },

  async addCollectionMembers({
    id,
    actorId,
    targetActorIds
  }: AddCollectionMembersParams) {
    if (targetActorIds.length === 0) return
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return

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

    await database.transaction(async (trx) => {
      const batchSize = getInsertBatchSize(trx, rows[0])
      for (const chunk of chunkArray(rows, batchSize)) {
        await trx('collection_members')
          .insert(chunk)
          .onConflict(['collectionSeq', 'targetActorId'])
          .ignore()
      }

      // Resolve every (target → memberSeq) for the backfill, including members
      // that already existed (onConflict-ignored above) so a re-add still ensures
      // the feed rows are present.
      const memberSeqByActorId = new Map<string, string | number>()
      for (const chunk of chunkArray(
        targetActorIds,
        getWhereInBatchSize(trx, 1)
      )) {
        const memberRows = await trx('collection_members')
          .where('collectionSeq', seq)
          .whereIn('targetActorId', chunk)
          .select('seq', 'targetActorId')
        for (const memberRow of memberRows) {
          memberSeqByActorId.set(
            memberRow.targetActorId as string,
            memberRow.seq as string | number
          )
        }
      }

      await backfillCollectionFeedForMembers({
        database: trx,
        collectionSeq: seq,
        memberSeqByActorId
      })
    })
  },

  async removeCollectionMembers({
    id,
    actorId,
    targetActorIds
  }: RemoveCollectionMembersParams) {
    if (targetActorIds.length === 0) return
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return

    await database.transaction(async (trx) => {
      // Resolve the member seqs first so the feed purge can target memberSeq
      // (indexed) rather than re-deriving the author from each timeline row.
      const memberSeqs: (string | number)[] = []
      for (const chunk of chunkArray(
        targetActorIds,
        getWhereInBatchSize(trx, 1)
      )) {
        const memberRows = await trx('collection_members')
          .where('collectionSeq', seq)
          .whereIn('targetActorId', chunk)
          .select('seq')
        for (const memberRow of memberRows) {
          memberSeqs.push(memberRow.seq as string | number)
        }
      }

      for (const chunk of chunkArray(memberSeqs, getWhereInBatchSize(trx, 0))) {
        await trx('collection_timeline').whereIn('memberSeq', chunk).delete()
      }
      for (const chunk of chunkArray(
        targetActorIds,
        getWhereInBatchSize(trx, 1)
      )) {
        await trx('collection_members')
          .where('collectionSeq', seq)
          .whereIn('targetActorId', chunk)
          .delete()
      }
    })
  },

  async setCollectionMemberState({
    id,
    actorId,
    targetActorId,
    state
  }: SetCollectionMemberStateParams) {
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return
    await database('collection_members')
      .where({ collectionSeq: seq, targetActorId })
      .update({ featureState: state })
  },

  async setOwnCollectionMembershipState({
    collectionId,
    actorId,
    state
  }: SetOwnCollectionMembershipStateParams) {
    // The member acts on their OWN membership, so this is intentionally not
    // owner-scoped — it resolves the collection by public id and matches the
    // membership row by the caller's actor id.
    const collection = await database('collections')
      .where({ id: collectionId })
      .first<{ seq: string | number }>('seq')
    if (!collection) return false
    const updated = await database('collection_members')
      .where({ collectionSeq: collection.seq, targetActorId: actorId })
      .update({ featureState: state })
    return updated > 0
  },

  async getCollectionMembers({
    id,
    actorId,
    projection = 'owner',
    limit = PER_PAGE_LIMIT,
    maxId,
    sinceId
  }: GetCollectionMembersParams): Promise<CollectionMembersPage> {
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return { accounts: [], nextMaxId: null, prevMinId: null }

    const query = database('collection_members')
      .where('collectionSeq', seq)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
    if (projection === 'public') {
      query.andWhere('featureState', 'approved')
    }

    const applyCursor = async (
      cursorId: string,
      direction: 'older' | 'newer'
    ) => {
      const cursor = await database('collection_members')
        .where({ collectionSeq: seq, id: cursorId })
        .select('createdAt')
        .first<{ createdAt: number | Date }>()
      if (!cursor) return
      const operator = direction === 'older' ? '<' : '>'
      query.andWhere((builder) => {
        builder
          .where('createdAt', operator, cursor.createdAt)
          .orWhere((tie) => {
            tie
              .where('createdAt', cursor.createdAt)
              .andWhere('id', operator, cursorId)
          })
      })
    }

    if (maxId) await applyCursor(maxId, 'older')
    if (sinceId) await applyCursor(sinceId, 'newer')

    const rows = await query.select('id', 'targetActorId')
    const targetActorIds = rows.map((row) => row.targetActorId as string)
    const accounts = await getMastodonActors(targetActorIds)
    return {
      accounts,
      nextMaxId: rows.length > 0 ? (rows[rows.length - 1].id as string) : null,
      prevMinId: rows.length > 0 ? (rows[0].id as string) : null
    }
  },

  async getCollectionsWithAccount({
    actorId,
    targetActorId
  }: GetCollectionsWithAccountParams) {
    const rows = await database<SQLCollection>('collections')
      .join(
        'collection_members',
        'collection_members.collectionSeq',
        'collections.seq'
      )
      .where('collections.ownerActorId', actorId)
      .andWhere('collection_members.targetActorId', targetActorId)
      .orderBy('collections.createdAt', 'asc')
      .select('collections.*')
    return rows.map(fixCollectionRow)
  },

  async getApprovedCollectionMembers({
    id,
    actorId
  }: GetApprovedCollectionMembersParams) {
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return []
    // Left-join the actors table to resolve each member's actor type for the
    // FEP-7aa9 `featuredObjectType` (Person/Service/Group/…). Members not present
    // locally (no actor row) fall back to 'Person'.
    const rows = await database('collection_members')
      .leftJoin('actors', 'actors.id', 'collection_members.targetActorId')
      .where({
        'collection_members.collectionSeq': seq,
        'collection_members.featureState': 'approved'
      })
      .orderBy('collection_members.createdAt', 'asc')
      .orderBy('collection_members.id', 'asc')
      .select('collection_members.targetActorId as id', 'actors.type as type')
    return rows.map((row) => ({
      id: row.id as string,
      type: (row.type as string | null) ?? 'Person'
    }))
  },

  async getCollectionTimeline({
    id,
    actorId,
    projection = 'owner',
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetCollectionTimelineParams) {
    const seq = await getOwnedCollectionSeq(database, id, actorId)
    if (seq === null) return []
    return readCollectionFeed({
      database,
      getStatusesByIds,
      collectionSeq: seq,
      projection,
      ownerActorId: actorId,
      limit,
      maxStatusId,
      minStatusId
    })
  },

  async getPublicCollectionTimeline({
    id,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetPublicCollectionTimelineParams) {
    // Resolve by id only (no owner scope) and gate on the public-feed contract:
    // the collection must exist, not be private, and have the feed enabled.
    // Returns null in those cases so the route can answer 404, distinct from an
    // empty-but-valid public feed ([]).
    const collection = await database('collections').where({ id }).first<{
      seq: string | number
      ownerActorId: string
      visibility: string
      publicFeed: boolean | number
    }>('seq', 'ownerActorId', 'visibility', 'publicFeed')
    if (!collection) return null
    if (collection.visibility === 'private' || !collection.publicFeed) {
      return null
    }
    return readCollectionFeed({
      database,
      getStatusesByIds,
      collectionSeq: collection.seq,
      projection: 'public',
      ownerActorId: collection.ownerActorId,
      limit,
      maxStatusId,
      minStatusId
    })
  },

  async addStatusToCollectionTimelines({
    status
  }: AddStatusToCollectionTimelinesParams): Promise<void> {
    const memberships = await database('collection_members')
      .where('targetActorId', status.actorId)
      .select('collectionSeq', 'seq')
    if (memberships.length === 0) return

    const sortKey = getCompatibleTime(status.createdAt)
    const rows = memberships.map((membership) => ({
      collectionSeq: membership.collectionSeq as string | number,
      memberSeq: membership.seq as string | number,
      statusId: status.id,
      sortKey
    }))

    const batchSize = getInsertBatchSize(database, rows[0])
    for (const chunk of chunkArray(rows, batchSize)) {
      await database('collection_timeline')
        .insert(chunk)
        .onConflict(['collectionSeq', 'statusId'])
        .ignore()
    }

    // Trim each collection the author posted into back down to the cap.
    const collectionSeqs = [
      ...new Set(memberships.map((m) => m.collectionSeq as string | number))
    ]
    for (const collectionSeq of collectionSeqs) {
      await trimCollectionFeed(database, collectionSeq)
    }
  }
})
