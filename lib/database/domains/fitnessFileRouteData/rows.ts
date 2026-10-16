import type { Selectable } from 'kysely'

import type { FitnessFileRouteData as FitnessFileRouteDataRow } from '@/lib/database/kysely/db'
import type { FitnessFileRouteData } from '@/lib/types/database/fitnessFileRouteData'

export type FitnessFileRouteDataTable = Selectable<FitnessFileRouteDataRow>

export const toFitnessFileRouteData = (
  row: FitnessFileRouteDataTable
): FitnessFileRouteData => ({
  fitnessFileId: row.fitnessFileId,
  actorId: row.actorId,
  routeData: row.routeData,
  sourceVersion: Number(row.sourceVersion ?? 1),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})
