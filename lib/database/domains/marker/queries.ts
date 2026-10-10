import { randomUUID } from 'node:crypto'

import type {
  GetMarkersParams,
  MarkerRow,
  MarkerTimeline,
  UpsertMarkerParams
} from '@/lib/database/domains/marker/types'
import type { Db } from '@/lib/database/kysely'

const COLUMNS = [
  'actorId',
  'timeline',
  'lastReadId',
  'version',
  'updatedAt'
] as const

type Row = {
  actorId: string
  timeline: string
  lastReadId: string
  version: number
  updatedAt: number
}

const toMarkerRow = (row: Row): MarkerRow => ({
  actorId: row.actorId,
  timeline: row.timeline as MarkerTimeline,
  lastReadId: row.lastReadId,
  version: row.version,
  updatedAt: row.updatedAt
})

const findMarker = (db: Db, actorId: string, timeline: string) =>
  db
    .selectFrom('markers')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('timeline', '=', timeline)
    .limit(1)
    .executeTakeFirst()

export const getMarkers = async (
  db: Db,
  { actorId, timelines }: GetMarkersParams
): Promise<MarkerRow[]> => {
  if (timelines.length === 0) return []
  const rows = await db
    .selectFrom('markers')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .where('timeline', 'in', timelines)
    .execute()
  return rows.map(toMarkerRow)
}

export const upsertMarker = async (
  db: Db,
  { actorId, timeline, lastReadId }: UpsertMarkerParams
): Promise<MarkerRow> => {
  // Marker ids in this system are opaque strings / UUIDs (a UUIDv7 status
  // publicId or notification id, a v4 notification id written before ids
  // were time-ordered, or the legacy urlToId base64url/colon encoding) — a MIX
  // of forms, never numeric snowflakes, so a stored value cannot be compared
  // for ordering against the next one even when one of those forms happens to
  // sort by time. Id-comparison monotonicity is therefore unsound and can
  // wrongly freeze the read position. This is unconditional last-write-wins;
  // `version` still increments atomically so clients can detect concurrent updates.
  const updatedAt = new Date()

  const incrementAndUpdate = async (prior: Row): Promise<MarkerRow> => {
    await db
      .updateTable('markers')
      .set((eb) => ({
        lastReadId,
        updatedAt,
        version: eb('version', '+', 1)
      }))
      .where('actorId', '=', actorId)
      .where('timeline', '=', timeline)
      .execute()
    const row = await findMarker(db, actorId, timeline)
    if (row) return toMarkerRow(row)
    // Row was concurrently deleted after the update; return the values this request applied.
    return {
      actorId,
      timeline: timeline as MarkerTimeline,
      lastReadId,
      version: prior.version + 1,
      updatedAt: updatedAt.getTime()
    }
  }

  const existing = await findMarker(db, actorId, timeline)
  if (existing) return incrementAndUpdate(existing)

  const { numInsertedOrUpdatedRows } = await db
    .insertInto('markers')
    .values({
      id: randomUUID(),
      actorId,
      timeline,
      lastReadId,
      version: 1,
      updatedAt
    })
    .onConflict((oc) => oc.columns(['actorId', 'timeline']).doNothing())
    .executeTakeFirst()
  if (Number(numInsertedOrUpdatedRows) > 0) {
    return {
      actorId,
      timeline: timeline as MarkerTimeline,
      lastReadId,
      version: 1,
      updatedAt: updatedAt.getTime()
    }
  }

  // Race: another request inserted between our SELECT and INSERT — update it
  // unconditionally (last-write-wins).
  const duplicated = await findMarker(db, actorId, timeline)
  if (duplicated) return incrementAndUpdate(duplicated)
  throw new Error('Failed to upsert marker')
}

export const markerQueries = { getMarkers, upsertMarker }
