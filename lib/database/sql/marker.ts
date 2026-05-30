import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import {
  GetMarkersParams,
  MarkerDatabase,
  MarkerRow,
  MarkerTimeline,
  UpsertMarkerParams
} from '@/lib/types/database/operations'

interface SQLMarker {
  id: string
  actorId: string
  timeline: string
  lastReadId: string
  version: number
  updatedAt: string | number | Date
}

const toMarkerRow = (row: SQLMarker): MarkerRow => ({
  actorId: row.actorId,
  timeline: row.timeline as MarkerTimeline,
  lastReadId: row.lastReadId,
  version: Number(row.version),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const MarkerSQLDatabaseMixin = (database: Knex): MarkerDatabase => ({
  async getMarkers({ actorId, timelines }: GetMarkersParams) {
    if (timelines.length === 0) return []
    const rows = await database<SQLMarker>('markers')
      .where('actorId', actorId)
      .whereIn('timeline', timelines)
    return rows.map(toMarkerRow)
  },

  async upsertMarker({ actorId, timeline, lastReadId }: UpsertMarkerParams) {
    const updatedAt = new Date()

    const incrementAndUpdate = async (): Promise<MarkerRow> => {
      await database('markers')
        .where({ actorId, timeline })
        .update({
          lastReadId,
          version: database.raw('?? + 1', ['version']),
          updatedAt
        })
      const row = await database<SQLMarker>('markers')
        .where({ actorId, timeline })
        .first()
      return toMarkerRow(row as SQLMarker)
    }

    const existing = await database<SQLMarker>('markers')
      .where({ actorId, timeline })
      .first()

    if (existing) {
      return incrementAndUpdate()
    }

    try {
      await database<SQLMarker>('markers').insert({
        id: randomUUID(),
        actorId,
        timeline,
        lastReadId,
        version: 1,
        updatedAt
      })
      return {
        actorId,
        timeline: timeline as MarkerTimeline,
        lastReadId,
        version: 1,
        updatedAt: getCompatibleTime(updatedAt)
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error

      // Race: another request inserted between our SELECT and INSERT — update it.
      const duplicated = await database<SQLMarker>('markers')
        .where({ actorId, timeline })
        .first()
      if (duplicated) {
        return incrementAndUpdate()
      }
      throw error
    }
  }
})
