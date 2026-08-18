import { getFitnessRouteHeatmapConfig } from '@/lib/config/fitnessRouteHeatmap'
import { Database } from '@/lib/database/types'
import { FitnessFileRoutePoint } from '@/lib/types/database/fitnessFileRoute'

import type { FitnessCoordinate } from './parseFitnessFile'
import { simplifyPoints } from './simplifyRoute'

/**
 * The representation the cached points are written in. Bump it whenever the
 * pipeline below stops producing what an existing row holds — a different
 * simplification, a different rounding, a different point shape. Readers
 * compare it against their own expectation and treat a mismatch as a miss, so
 * a bump silently re-derives every row from its source file instead of serving
 * geometry built by rules that no longer apply.
 *
 * A CONFIG change is deliberately not a version change: `filePointLimit` and
 * `simplifyToleranceMeters` are operator knobs, and re-deriving every actor's
 * whole history because someone nudged a tolerance would cost far more than
 * the fidelity difference is worth. Rows written under an older setting stay
 * valid until their activity is reprocessed.
 */
export const FITNESS_FILE_ROUTE_SOURCE_VERSION = 1

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

/**
 * Uniformly decimates to `maxPoints` by index. This is a memory guard, not a
 * shape-preserving simplifier: it runs BEFORE Douglas–Peucker so the recursive
 * pass never sees an unbounded, user-supplied point list (a 50 MB GPX can hold
 * ~1M points). Shape is then restored by the simplification that follows.
 */
export const downsampleRoutePoints = <Point>(
  points: Point[],
  maxPoints: number
) => {
  if (points.length <= maxPoints) {
    return points
  }

  const lastIndex = points.length - 1
  const step = lastIndex / (maxPoints - 1)

  return Array.from({ length: maxPoints }, (_value, index) => {
    return points[Math.round(index * step)] as Point
  })
}

/**
 * Turns a parsed activity's raw coordinates into the points cached for it.
 *
 * The pipeline — cap, then simplify at the configured floor tolerance, then
 * round to six decimals — is deliberately IDENTICAL to what the heatmap
 * generator does per file today, so a cache hit and a cache miss produce the
 * same geometry and the generated heatmap cannot depend on whether the row
 * happened to exist.
 *
 * The result is PRE-PRIVACY on purpose. Privacy zones are a live setting: the
 * owner can move or remove one at any time, and a cache that had already
 * trimmed the route could never grow those ends back without re-downloading
 * the file. Trimming happens at build time from the settings in force then.
 * These are the same coordinates the source file in object storage already
 * holds, and the rows are never serialized to a client.
 */
export const buildFitnessFileRoutePoints = (
  coordinates: FitnessCoordinate[],
  config = getFitnessRouteHeatmapConfig()
): FitnessFileRoutePoint[] => {
  if (coordinates.length === 0) return []

  const simplified = simplifyPoints(
    downsampleRoutePoints(coordinates, config.filePointLimit),
    config.simplifyToleranceMeters
  )

  return simplified.map((point) => [round6(point.lat), round6(point.lng)])
}

export interface WriteFitnessFileRouteParams {
  fitnessFileId: string
  actorId: string
  coordinates: FitnessCoordinate[]
}

/**
 * Caches an activity's route so a heatmap rebuild does not have to download and
 * re-parse the source file. An activity with no GPS still gets a row: that
 * empty answer is exactly what a rebuild would otherwise pay a download to
 * rediscover, every single time.
 */
export const writeFitnessFileRoute = async (
  database: Database,
  { fitnessFileId, actorId, coordinates }: WriteFitnessFileRouteParams
) => {
  const points = buildFitnessFileRoutePoints(coordinates)

  await database.upsertFitnessFileRoute({
    fitnessFileId,
    actorId,
    points,
    sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
  })

  return points
}
