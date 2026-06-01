import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  FollowTagParams,
  FollowedTag,
  FollowedTagDatabase,
  GetFollowedTagParams,
  GetFollowedTagsParams,
  IsFollowingTagParams,
  UnfollowTagParams
} from '@/lib/types/database/operations'

type SQLFollowedTag = {
  id: string
  actorId: string
  name: string
  nameNormalized: string
  createdAt: number | Date
}

// Mirrors normalizeHashtagSearchName from the search layer so followed-tag
// matching stays consistent with hashtag indexing.
const normalizeTagName = (name: string) =>
  name.trim().replace(/^#+/, '').toLowerCase()

const fixFollowedTag = (row: SQLFollowedTag): FollowedTag => ({
  id: row.id,
  actorId: row.actorId,
  name: row.name,
  createdAt: getCompatibleTime(row.createdAt)
})

export const FollowedTagSQLDatabaseMixin = (
  database: Knex
): FollowedTagDatabase => ({
  async followTag({ actorId, name }: FollowTagParams) {
    const displayName = name.trim().replace(/^#+/, '')
    const nameNormalized = normalizeTagName(name)
    const existing = await database<SQLFollowedTag>('followed_tags')
      .where({ actorId, nameNormalized })
      .first()
    if (existing) return fixFollowedTag(existing)

    const row = {
      id: randomUUID(),
      actorId,
      name: displayName,
      nameNormalized,
      createdAt: new Date()
    }
    try {
      await database('followed_tags').insert(row)
      return fixFollowedTag(row as unknown as SQLFollowedTag)
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const duplicated = await database<SQLFollowedTag>('followed_tags')
        .where({ actorId, nameNormalized })
        .first()
      if (duplicated) return fixFollowedTag(duplicated)
      throw error
    }
  },

  async unfollowTag({ actorId, name }: UnfollowTagParams) {
    const nameNormalized = normalizeTagName(name)
    const existing = await database<SQLFollowedTag>('followed_tags')
      .where({ actorId, nameNormalized })
      .first()
    if (!existing) return null

    await database('followed_tags').where('id', existing.id).delete()
    return fixFollowedTag(existing)
  },

  async getFollowedTag({ actorId, name }: GetFollowedTagParams) {
    const nameNormalized = normalizeTagName(name)
    const row = await database<SQLFollowedTag>('followed_tags')
      .where({ actorId, nameNormalized })
      .first()
    return row ? fixFollowedTag(row) : null
  },

  async getFollowedTags({
    actorId,
    limit = PER_PAGE_LIMIT,
    maxId,
    sinceId
  }: GetFollowedTagsParams) {
    const query = database<SQLFollowedTag>('followed_tags')
      .where('actorId', actorId)
      .orderBy('id', 'desc')
      .limit(limit)

    if (maxId) query.andWhere('id', '<', maxId)
    if (sinceId) query.andWhere('id', '>', sinceId)

    const rows = await query
    return rows.map(fixFollowedTag)
  },

  async isFollowingTag({ actorId, name }: IsFollowingTagParams) {
    const nameNormalized = normalizeTagName(name)
    const row = await database<SQLFollowedTag>('followed_tags')
      .where({ actorId, nameNormalized })
      .first('id')
    return Boolean(row)
  }
})
