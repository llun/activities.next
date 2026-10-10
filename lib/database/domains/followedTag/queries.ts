import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import type {
  FollowTagParams,
  FollowedTag,
  GetFollowedTagsParams,
  IsFollowingTagParams,
  UnfollowTagParams
} from '@/lib/database/domains/followedTag/types'
import type { Db } from '@/lib/database/kysely'
import { pastKeyset } from '@/lib/database/kysely/keyset'

const COLUMNS = ['id', 'actorId', 'name', 'createdAt'] as const

type Row = {
  id: string
  actorId: string
  name: string
  // Nullable in the schema, but every writer sets it.
  createdAt: number | null
}

// Mirrors normalizeHashtagSearchName from the search layer so followed-tag
// matching stays consistent with hashtag indexing.
const normalizeTagName = (name: string) =>
  name.trim().replace(/^#+/, '').toLowerCase()

const toFollowedTag = (row: Row): FollowedTag => ({
  id: row.id,
  actorId: row.actorId,
  name: row.name,
  createdAt: row.createdAt ?? 0
})

const findFollowedTag = (db: Db, actorId: string, nameNormalized: string) =>
  db
    .selectFrom('followed_tags')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('nameNormalized', '=', nameNormalized)
    .limit(1)
    .executeTakeFirst()

export const followTag = async (
  db: Db,
  { actorId, name }: FollowTagParams
): Promise<FollowedTag> => {
  const displayName = name.trim().replace(/^#+/, '')
  const nameNormalized = normalizeTagName(name)
  const existing = await findFollowedTag(db, actorId, nameNormalized)
  if (existing) return toFollowedTag(existing)

  const createdAt = new Date()
  const row = { id: randomUUID(), actorId, name: displayName }
  const { numInsertedOrUpdatedRows } = await db
    .insertInto('followed_tags')
    .values({ ...row, nameNormalized, createdAt })
    .onConflict((oc) => oc.columns(['actorId', 'nameNormalized']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) {
    return toFollowedTag({ ...row, createdAt: createdAt.getTime() })
  }

  // Race: another request inserted between our SELECT and INSERT.
  const duplicated = await findFollowedTag(db, actorId, nameNormalized)
  if (duplicated) return toFollowedTag(duplicated)
  throw new Error('Failed to follow tag')
}

export const unfollowTag = async (
  db: Db,
  { actorId, name }: UnfollowTagParams
): Promise<FollowedTag | null> => {
  const existing = await findFollowedTag(db, actorId, normalizeTagName(name))
  if (!existing) return null

  await db.deleteFrom('followed_tags').where('id', '=', existing.id).execute()
  return toFollowedTag(existing)
}

export const getFollowedTags = async (
  db: Db,
  {
    actorId,
    limit = PER_PAGE_LIMIT,
    maxId,
    minId,
    sinceId
  }: GetFollowedTagsParams
): Promise<FollowedTag[]> => {
  let query = db
    .selectFrom('followed_tags')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .limit(limit)

  // min_id pages the window immediately newer than the cursor (ascending
  // scan, reversed back to newest-first below); since_id keeps the newest
  // rows (plain descending scan). Mirrors getBookmarks.
  const direction = minId ? 'asc' : 'desc'
  query = query.orderBy('createdAt', direction).orderBy('id', direction)

  // Ids are random UUIDs, so they cannot drive chronological pagination.
  // Resolve the cursor row's createdAt and paginate on that, using id as a
  // stable tie-breaker.
  const applyCursor = async (
    cursorId: string,
    operator: '<' | '>'
  ): Promise<void> => {
    const cursor = await db
      .selectFrom('followed_tags')
      .select('createdAt')
      .where('actorId', '=', actorId)
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return
    query = query.where((eb) =>
      pastKeyset(
        eb,
        { createdAt: cursor.createdAt ?? 0, tieBreaker: cursorId },
        operator,
        'id'
      )
    )
  }

  if (maxId) await applyCursor(maxId, '<')
  const newerCursorId = minId || sinceId
  if (newerCursorId) await applyCursor(newerCursorId, '>')

  const rows = await query.execute()
  return (minId ? rows.reverse() : rows).map(toFollowedTag)
}

export const isFollowingTag = async (
  db: Db,
  { actorId, name }: IsFollowingTagParams
): Promise<boolean> =>
  Boolean(await findFollowedTag(db, actorId, normalizeTagName(name)))

export const followedTagQueries = {
  followTag,
  unfollowTag,
  getFollowedTags,
  isFollowingTag
}
