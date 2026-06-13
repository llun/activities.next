import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  AnnouncementData,
  AnnouncementDatabase,
  AnnouncementReactionParams,
  AnnouncementReactionRollup,
  CreateAnnouncementParams,
  DeleteAnnouncementParams,
  GetActiveAnnouncementsParams,
  GetAnnouncementParams,
  GetAnnouncementReactionsParams,
  GetAnnouncementReadIdsParams,
  MarkAnnouncementReadParams,
  UpdateAnnouncementParams
} from '@/lib/types/database/operations'

type SQLAnnouncement = {
  id: string
  text: string
  published: boolean | number
  allDay: boolean | number
  startsAt: number | Date | string | null
  endsAt: number | Date | string | null
  publishedAt: number | Date | string | null
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

// count() comes back as a string on Postgres but a number on SQLite.
type SQLReactionRollupRow = {
  announcementId: string
  name: string
  count: number | string
  mine: number | string
}

const toTimeOrNull = (value: number | Date | string | null): number | null =>
  value === null ? null : getCompatibleTime(value)

const toAnnouncementData = (row: SQLAnnouncement): AnnouncementData => ({
  id: row.id,
  text: row.text,
  published: Boolean(row.published),
  allDay: Boolean(row.allDay),
  startsAt: toTimeOrNull(row.startsAt),
  endsAt: toTimeOrNull(row.endsAt),
  publishedAt: toTimeOrNull(row.publishedAt),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const AnnouncementSQLDatabaseMixin = (
  database: Knex
): AnnouncementDatabase => ({
  async createAnnouncement({
    text,
    startsAt = null,
    endsAt = null,
    allDay = false,
    published = false
  }: CreateAnnouncementParams) {
    const currentTime = new Date()
    const id = randomUUID()
    const publishedAt = published ? currentTime : null
    await database('announcements').insert({
      id,
      text,
      published,
      allDay,
      startsAt: startsAt === null ? null : new Date(startsAt),
      endsAt: endsAt === null ? null : new Date(endsAt),
      publishedAt,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return {
      id,
      text,
      published,
      allDay,
      startsAt,
      endsAt,
      publishedAt: publishedAt ? publishedAt.getTime() : null,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async updateAnnouncement({
    id,
    text,
    startsAt,
    endsAt,
    allDay,
    published
  }: UpdateAnnouncementParams) {
    const existing = await database<SQLAnnouncement>('announcements')
      .where({ id })
      .first()
    if (!existing) return null

    const updatedAt = new Date()
    // Stamp publishedAt when this update flips published false -> true and it
    // has not been published before.
    const wasPublished = Boolean(existing.published)
    const stampPublishedAt =
      published === true && !wasPublished && existing.publishedAt === null

    await database('announcements')
      .where({ id })
      .update({
        ...(text !== undefined ? { text } : null),
        ...(startsAt !== undefined
          ? { startsAt: startsAt === null ? null : new Date(startsAt) }
          : null),
        ...(endsAt !== undefined
          ? { endsAt: endsAt === null ? null : new Date(endsAt) }
          : null),
        ...(allDay !== undefined ? { allDay } : null),
        ...(published !== undefined ? { published } : null),
        ...(stampPublishedAt ? { publishedAt: updatedAt } : null),
        updatedAt
      })

    const row = await database<SQLAnnouncement>('announcements')
      .where({ id })
      .first()
    return row ? toAnnouncementData(row) : null
  },

  async deleteAnnouncement({ id }: DeleteAnnouncementParams) {
    await database('announcement_reactions')
      .where('announcementId', id)
      .delete()
    await database('announcement_reads').where('announcementId', id).delete()
    await database('announcements').where({ id }).delete()
  },

  async getAnnouncements() {
    const rows = await database<SQLAnnouncement>('announcements').orderBy(
      'createdAt',
      'desc'
    )
    return rows.map(toAnnouncementData)
  },

  async getAnnouncement({ id }: GetAnnouncementParams) {
    const row = await database<SQLAnnouncement>('announcements')
      .where({ id })
      .first()
    return row ? toAnnouncementData(row) : null
  },

  async getActiveAnnouncements({ now }: GetActiveAnnouncementsParams) {
    const currentTime = new Date(now)
    const rows = await database<SQLAnnouncement>('announcements')
      .where('published', true)
      .andWhere((builder) =>
        builder.whereNull('startsAt').orWhere('startsAt', '<=', currentTime)
      )
      .andWhere((builder) =>
        builder.whereNull('endsAt').orWhere('endsAt', '>=', currentTime)
      )
      .orderBy('createdAt', 'desc')
    return rows.map(toAnnouncementData)
  },

  async markAnnouncementRead({
    announcementId,
    actorId
  }: MarkAnnouncementReadParams) {
    await database('announcement_reads')
      .insert({ announcementId, actorId, createdAt: new Date() })
      .onConflict(['announcementId', 'actorId'])
      .ignore()
  },

  async addAnnouncementReaction({
    announcementId,
    actorId,
    name
  }: AnnouncementReactionParams) {
    await database('announcement_reactions')
      .insert({ announcementId, actorId, name, createdAt: new Date() })
      .onConflict(['announcementId', 'actorId', 'name'])
      .ignore()
  },

  async removeAnnouncementReaction({
    announcementId,
    actorId,
    name
  }: AnnouncementReactionParams) {
    await database('announcement_reactions')
      .where({ announcementId, actorId, name })
      .delete()
  },

  async getAnnouncementReadIds({
    actorId,
    announcementIds
  }: GetAnnouncementReadIdsParams) {
    if (announcementIds.length === 0) return []
    const rows = await database<{ announcementId: string }>(
      'announcement_reads'
    )
      .where('actorId', actorId)
      .whereIn('announcementId', announcementIds)
      .select('announcementId')
    return rows.map((row) => row.announcementId)
  },

  async getAnnouncementReactions({
    announcementIds,
    actorId
  }: GetAnnouncementReactionsParams) {
    if (announcementIds.length === 0) return []
    const rows = (await database('announcement_reactions')
      .whereIn('announcementId', announcementIds)
      .groupBy('announcementId', 'name')
      .select('announcementId', 'name')
      .count({ count: '*' })
      // mine: 1 when the querying actor is among the reactors for this
      // (announcementId, name) group, 0 otherwise. MAX over a per-row CASE is
      // portable across SQLite and PostgreSQL.
      .max({
        mine: database.raw('CASE WHEN ?? = ? THEN 1 ELSE 0 END', [
          'actorId',
          actorId
        ])
      })
      .orderBy('announcementId')
      .orderBy('name')) as SQLReactionRollupRow[]

    return rows.map(
      (row): AnnouncementReactionRollup => ({
        announcementId: row.announcementId,
        name: row.name,
        count: Number(row.count),
        me: Number(row.mine) === 1
      })
    )
  }
})
