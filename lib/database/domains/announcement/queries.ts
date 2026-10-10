import { type Selectable, sql } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  AnnouncementData,
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
} from '@/lib/database/domains/announcement/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { Announcements } from '@/lib/database/kysely/db'
import { forUpdate, timestampValue } from '@/lib/database/kysely/dialect'
import { MAX_ANNOUNCEMENT_REACTION_NAMES } from '@/lib/services/announcements/reactionLimits'

const toAnnouncementData = (
  row: Selectable<Announcements>
): AnnouncementData => ({
  id: row.id,
  text: row.text,
  published: row.published,
  allDay: row.allDay,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  publishedAt: row.publishedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

const findAnnouncement = (db: Db, id: string) =>
  db
    .selectFrom('announcements')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

export const createAnnouncement = async (
  db: Db,
  {
    text,
    startsAt = null,
    endsAt = null,
    allDay = false,
    published = false
  }: CreateAnnouncementParams
): Promise<AnnouncementData> => {
  const currentTime = new Date()
  const id = randomUUID()
  const publishedAt = published ? currentTime : null
  await db
    .insertInto('announcements')
    .values({
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
    .execute()
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
}

export const updateAnnouncement = async (
  db: Db,
  { id, text, startsAt, endsAt, allDay, published }: UpdateAnnouncementParams
): Promise<AnnouncementData | null> => {
  const existing = await findAnnouncement(db, id)
  if (!existing) return null

  const updatedAt = new Date()
  // Stamp publishedAt when this update flips published false -> true and it
  // has not been published before.
  const stampPublishedAt =
    published === true && !existing.published && existing.publishedAt === null

  await db
    .updateTable('announcements')
    .set({
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
    .where('id', '=', id)
    .execute()

  const row = await findAnnouncement(db, id)
  return row ? toAnnouncementData(row) : null
}

export const deleteAnnouncement = async (
  db: Db,
  { id }: DeleteAnnouncementParams
): Promise<void> => {
  await db
    .deleteFrom('announcement_reactions')
    .where('announcementId', '=', id)
    .execute()
  await db
    .deleteFrom('announcement_reads')
    .where('announcementId', '=', id)
    .execute()
  await db.deleteFrom('announcements').where('id', '=', id).execute()
}

export const getAnnouncements = async (db: Db): Promise<AnnouncementData[]> => {
  const rows = await db
    .selectFrom('announcements')
    .selectAll()
    .orderBy('createdAt', 'desc')
    .execute()
  return rows.map(toAnnouncementData)
}

export const getAnnouncement = async (
  db: Db,
  { id }: GetAnnouncementParams
): Promise<AnnouncementData | null> => {
  const row = await findAnnouncement(db, id)
  return row ? toAnnouncementData(row) : null
}

export const getActiveAnnouncements = async (
  db: Db,
  { now }: GetActiveAnnouncementsParams
): Promise<AnnouncementData[]> => {
  const currentTime = timestampValue(now)
  const rows = await db
    .selectFrom('announcements')
    .selectAll()
    .where('published', '=', true)
    .where((eb) =>
      eb.or([eb('startsAt', 'is', null), eb('startsAt', '<=', currentTime)])
    )
    .where((eb) =>
      eb.or([eb('endsAt', 'is', null), eb('endsAt', '>=', currentTime)])
    )
    .orderBy('createdAt', 'desc')
    .execute()
  return rows.map(toAnnouncementData)
}

export const markAnnouncementRead = async (
  db: Db,
  { announcementId, actorId }: MarkAnnouncementReadParams
): Promise<void> => {
  await db
    .insertInto('announcement_reads')
    .values({ announcementId, actorId, createdAt: new Date() })
    .onConflict((oc) => oc.columns(['announcementId', 'actorId']).doNothing())
    .execute()
}

export const addAnnouncementReaction = (
  db: Db,
  { announcementId, actorId, name }: AnnouncementReactionParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    // Serialize reactions to one announcement on its row (a no-op on SQLite,
    // whose writers already serialize) so the distinct-name ceiling holds
    // across concurrent requests.
    await forUpdate(
      trx,
      trx
        .selectFrom('announcements')
        .select('id')
        .where('id', '=', announcementId)
    ).execute()

    // A name already on the announcement never widens the rollup, so it is
    // always allowed (including this actor repeating their own reaction).
    const nameInUse = await trx
      .selectFrom('announcement_reactions')
      .select('name')
      .where('announcementId', '=', announcementId)
      .where('name', '=', name)
      .limit(1)
      .executeTakeFirst()
    if (!nameInUse) {
      const distinct = await trx
        .selectFrom('announcement_reactions')
        .select((eb) => eb.fn.count('name').distinct().as('count'))
        .where('announcementId', '=', announcementId)
        .executeTakeFirst()
      if (Number(distinct?.count ?? 0) >= MAX_ANNOUNCEMENT_REACTION_NAMES) {
        return false
      }
    }

    await trx
      .insertInto('announcement_reactions')
      .values({ announcementId, actorId, name, createdAt: new Date() })
      .onConflict((oc) =>
        oc.columns(['announcementId', 'actorId', 'name']).doNothing()
      )
      .execute()
    return true
  })

export const removeAnnouncementReaction = async (
  db: Db,
  { announcementId, actorId, name }: AnnouncementReactionParams
): Promise<void> => {
  await db
    .deleteFrom('announcement_reactions')
    .where('announcementId', '=', announcementId)
    .where('actorId', '=', actorId)
    .where('name', '=', name)
    .execute()
}

export const getAnnouncementReadIds = async (
  db: Db,
  { actorId, announcementIds }: GetAnnouncementReadIdsParams
): Promise<string[]> => {
  if (announcementIds.length === 0) return []
  const rows = await db
    .selectFrom('announcement_reads')
    .select('announcementId')
    .where('actorId', '=', actorId)
    .where('announcementId', 'in', announcementIds)
    .execute()
  return rows.map((row) => row.announcementId)
}

export const getAnnouncementReactions = async (
  db: Db,
  { announcementIds, actorId }: GetAnnouncementReactionsParams
): Promise<AnnouncementReactionRollup[]> => {
  if (announcementIds.length === 0) return []
  const rows = await db
    .selectFrom('announcement_reactions')
    .where('announcementId', 'in', announcementIds)
    .groupBy(['announcementId', 'name'])
    .select(['announcementId', 'name'])
    .select((eb) => [
      eb.fn.countAll().as('count'),
      // mine: 1 when the querying actor is among the reactors for this
      // (announcementId, name) group, 0 otherwise. MAX over a per-row CASE is
      // portable across SQLite and PostgreSQL.
      eb.fn
        .max(
          sql<number>`case when ${eb.ref('actorId')} = ${actorId} then 1 else 0 end`
        )
        .as('mine')
    ])
    .orderBy('announcementId')
    .orderBy('name')
    .execute()

  return rows.map((row): AnnouncementReactionRollup => ({
    announcementId: row.announcementId,
    name: row.name,
    // count(*) and max(case ...) have no declared column type, so SQLite
    // hands them back as is.
    count: Number(row.count),
    me: Number(row.mine) === 1
  }))
}

// The facade getSQLDatabase binds with bindDb().
export const announcementQueries = {
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncements,
  getAnnouncement,
  getActiveAnnouncements,
  markAnnouncementRead,
  addAnnouncementReaction,
  removeAnnouncementReaction,
  getAnnouncementReadIds,
  getAnnouncementReactions
}
