import { sql } from 'kysely'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  getHashtagStorageNames,
  normalizeHashtagSearchName
} from '@/lib/database/domains/search/rows'
import type {
  GetHashtagCounterParams,
  GetHashtagStatusesPageParams,
  GetHashtagStatusesPageResult,
  GetStatusesByHashtagParams,
  GetTagsParams,
  StatusHydration
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'
import { getCounterValue } from '@/lib/database/kysely/counter'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { isLocalActor } from '@/lib/database/kysely/visibility/localActor'
import { PUBLIC_ACTIVITY_RECIPIENTS } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'

// The hashtag reads: a status's tags, the hashtag timeline, the admin hashtag
// page and the hashtag counter. Tag writes and the counter adjustments are
// still the Knex mixin in lib/database/sql/status.ts.

export const getTags = async (
  db: Db,
  { statusId }: GetTagsParams
): Promise<Tag[]> => {
  const rows = await db
    .selectFrom('tags')
    .selectAll()
    .where('statusId', '=', statusId)
    .execute()
  return rows.map((row) =>
    Tag.parse({
      ...row,
      // getCompatibleTime threw a TypeError on a NULL timestamp; it reads as 0.
      createdAt: row.createdAt ?? 0,
      updatedAt: row.updatedAt ?? 0
    })
  )
}

// The hashtag rows of publicly addressed Notes and Polls whose tag is one of
// `names`, joined to their status and its public recipients.
const publicHashtagStatuses = (db: Db, names: string[]) =>
  db
    .selectFrom('tags')
    .innerJoin('statuses', 'tags.statusId', 'statuses.id')
    .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
    .where('tags.type', '=', 'hashtag')
    .where('tags.nameNormalized', 'in', names)
    .where('recipients.actorId', 'in', PUBLIC_ACTIVITY_RECIPIENTS)
    .where('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll])

// The createdAt of a cursor status. `undefined` when the status does not
// exist, `null` when it has no createdAt.
const getCursorCreatedAt = async (db: Db, statusId: string) => {
  const row = await db
    .selectFrom('statuses')
    .select('createdAt')
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return row ? row.createdAt : undefined
}

export const getStatusesByHashtag = async (
  db: Db,
  hydration: StatusHydration,
  {
    hashtag,
    currentActorId,
    limit = PER_PAGE_LIMIT,
    minStatusId,
    maxStatusId,
    onlyMedia = false,
    local = false,
    remote = false,
    anyTags = [],
    allTags = [],
    noneTags = []
  }: GetStatusesByHashtagParams
): Promise<Status[]> => {
  // `any[]` widens the primary tag match: a status qualifies when it carries
  // the main hashtag OR any of the additional tags (Mastodon semantics).
  const normalizedNames = [hashtag, ...anyTags].flatMap(getHashtagStorageNames)
  // Knex compiled an empty IN list to a false predicate; PostgreSQL rejects
  // `in ()`, so the empty case returns the empty page itself.
  if (normalizedNames.length === 0) return []

  let query = publicHashtagStatuses(db, normalizedNames)
    .select(['statuses.id', 'statuses.createdAt'])
    .distinct()
    .orderBy('statuses.createdAt', 'desc')
    .orderBy('statuses.id', 'desc')
    .limit(limit)

  // `all[]`: every additional tag must also be present on the status.
  for (const tag of allTags) {
    const lookupNames = getHashtagStorageNames(tag)
    if (lookupNames.length === 0) {
      query = query.where(sql<boolean>`1 = 0`)
      continue
    }
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('tags as all_tags')
          .select(sql.lit(1).as('one'))
          .whereRef('all_tags.statusId', '=', 'statuses.id')
          .where('all_tags.type', '=', 'hashtag')
          .where('all_tags.nameNormalized', 'in', lookupNames)
      )
    )
  }

  // `none[]`: statuses carrying any of these tags are excluded.
  const noneLookupNames = noneTags.flatMap(getHashtagStorageNames)
  if (noneLookupNames.length > 0) {
    query = query.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('tags as none_tags')
            .select(sql.lit(1).as('one'))
            .whereRef('none_tags.statusId', '=', 'statuses.id')
            .where('none_tags.type', '=', 'hashtag')
            .where('none_tags.nameNormalized', 'in', noneLookupNames)
        )
      )
    )
  }

  if (onlyMedia) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('attachments')
          .select(sql.lit(1).as('one'))
          .whereRef('attachments.statusId', '=', 'statuses.id')
      )
    )
  }

  // Mastodon `local`/`remote` scope. A status is local when its author is an
  // actor this server hosts (privateKey set), mirroring the LOCAL_PUBLIC
  // timeline selection; remote is the complement (including statuses whose
  // author has no actors row at all).
  if (local !== remote) {
    query = query.where((eb) => {
      const authorIsLocal = eb.exists(
        eb
          .selectFrom('actors')
          .select(sql.lit(1).as('one'))
          .whereRef('actors.id', '=', 'statuses.actorId')
          .where(isLocalActor)
      )
      return local ? authorIsLocal : eb.not(authorIsLocal)
    })
  }

  if (maxStatusId) {
    const createdAt = await getCursorCreatedAt(db, maxStatusId)
    // An unresolvable cursor yields no page, matching the repo-wide keyset
    // convention (bookmark/block/follow/mute/scheduledStatus) rather than
    // silently falling back to the first page. A cursor with no createdAt is
    // an empty page too: Knex compared `createdAt < NULL`, which is never
    // true, on both arms of the keyset.
    if (createdAt === undefined || createdAt === null) return []
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt, tieBreaker: maxStatusId },
        '<',
        'statuses.id',
        'statuses.createdAt'
      )
    )
  }

  if (minStatusId) {
    const createdAt = await getCursorCreatedAt(db, minStatusId)
    if (createdAt === undefined || createdAt === null) return []
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt, tieBreaker: minStatusId },
        '>',
        'statuses.id',
        'statuses.createdAt'
      )
    )
  }

  const rows = await query.execute()
  const statusIds = rows.map((row) => row.id)
  if (statusIds.length === 0) return []
  return hydration.getStatusesByIds({ statusIds, currentActorId })
}

export const getHashtagStatusesPage = async (
  db: Db,
  hydration: StatusHydration,
  { hashtag, limit, offset }: GetHashtagStatusesPageParams
): Promise<GetHashtagStatusesPageResult> => {
  const normalizedNames = getHashtagStorageNames(hashtag)
  // An empty IN list was a false predicate in Knex: no rows and a zero count.
  if (normalizedNames.length === 0) return { statuses: [], total: 0 }

  const [rows, countRow] = await Promise.all([
    publicHashtagStatuses(db, normalizedNames)
      .select(['statuses.id', 'statuses.createdAt'])
      .distinct()
      .orderBy('statuses.createdAt', 'desc')
      .orderBy('statuses.id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute(),
    publicHashtagStatuses(db, normalizedNames)
      .select((eb) => eb.fn.count('statuses.id').distinct().as('count'))
      .executeTakeFirst()
  ])

  const statusIds = rows.map((row) => row.id)
  const statuses =
    statusIds.length > 0 ? await hydration.getStatusesByIds({ statusIds }) : []
  return {
    statuses,
    total: Number(countRow?.count ?? 0)
  }
}

export const getHashtagCounter = (
  db: Db,
  { hashtag }: GetHashtagCounterParams
): Promise<number> =>
  getCounterValue(
    db,
    CounterKey.totalHashtag(normalizeHashtagSearchName(hashtag))
  )
