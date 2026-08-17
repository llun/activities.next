export type FitnessRouteHeatmapPyramidStatus =
  'idle' | 'generating' | 'completed' | 'failed' | 'cancelled'

/**
 * Keyset resume position: the `(createdAt, id)` of the last activity folded
 * into the pyramid. An integer offset would double-count or skip an activity
 * whenever an upload or delete shifted the window between passes, and a
 * double-counted activity is a permanently wrong heat value rather than a
 * merely missing one.
 */
export interface FitnessRouteHeatmapPyramidCursor {
  createdAt: number
  id: string
}

export interface SQLFitnessRouteHeatmapPyramid {
  id: string
  actorId: string
  status: string
  error: string | null
  version: number
  claimSeq: number
  totalCount: number
  scannedCount: number
  activityCount: number
  tileCount: number
  pointCount: number
  cursorCreatedAt: Date | string | number | null
  cursorId: string | null
  completedAt: Date | string | number | null
  createdAt: Date | string | number
  updatedAt: Date | string | number
}

export interface FitnessRouteHeatmapPyramid {
  id: string
  actorId: string
  status: FitnessRouteHeatmapPyramidStatus
  error?: string
  /**
   * Monotonic tile-generation counter. Every tile records the version that
   * wrote it, so a resumed pass adds to its own tiles while a fresh build
   * replaces them, and completion sweeps whatever an older version left
   * behind.
   */
  version: number
  /**
   * Monotonic ownership token, bumped by every successful claim — including a
   * resume, which by design leaves `version` alone. Whoever holds the current
   * value owns the build; every write passes it back so a superseded pass is
   * rejected instead of overwriting its successor's progress.
   */
  claimSeq: number
  totalCount: number
  scannedCount: number
  activityCount: number
  tileCount: number
  pointCount: number
  cursor?: FitnessRouteHeatmapPyramidCursor
  completedAt?: number
  createdAt: number
  updatedAt: number
}

export interface SQLFitnessRouteHeatmapTile {
  actorId: string
  tileKey: string
  z: number
  x: number
  y: number
  version: number
  segments: string | null
  pointCount: number
  createdAt: Date | string | number
  updatedAt: Date | string | number
}

export interface FitnessRouteHeatmapTileRow {
  actorId: string
  tileKey: string
  z: number
  x: number
  y: number
  version: number
  /**
   * The encoded tile payload, deliberately left as the stored string. The
   * serving path forwards it to the client verbatim and the build path hands
   * it straight to the tile codec, so parsing it here would cost every reader
   * a decode neither of them wants.
   */
  segments: string
  pointCount: number
  createdAt: number
  updatedAt: number
}

/**
 * Why a claim attempt did or did not take ownership of the build.
 *
 * - `claimed` — this caller owns the build and must run it.
 * - `already-fresh` — a completed pyramid already covers the request; there is
 *   nothing to rebuild.
 * - `build-in-progress` — another worker holds a live (recently heartbeating)
 *   build; this caller waits for it rather than racing.
 * - `lost-race` — the row moved between the read and the compare-and-swap, so
 *   another worker claimed it first.
 */
export type FitnessRouteHeatmapPyramidClaimReason =
  'claimed' | 'already-fresh' | 'build-in-progress' | 'lost-race'

export interface FitnessRouteHeatmapPyramidClaim {
  claimed: boolean
  /**
   * True when the claim picked up an abandoned build's cursor instead of
   * starting over. The build keeps its version, so the tiles it already wrote
   * stay valid and are added to rather than replaced.
   */
  resumed: boolean
  reason: FitnessRouteHeatmapPyramidClaimReason
  pyramid: FitnessRouteHeatmapPyramid
}
