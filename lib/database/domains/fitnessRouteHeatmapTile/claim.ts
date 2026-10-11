import {
  applyClaimableFilter,
  applyResumePremiseFilter,
  classifyPyramidForClaim,
  isOwnContinuation,
  newPyramidRow,
  toFitnessRouteHeatmapPyramid
} from '@/lib/database/domains/fitnessRouteHeatmapTile/rows'
import type { ClaimFitnessRouteHeatmapPyramidBuildParams } from '@/lib/database/domains/fitnessRouteHeatmapTile/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { FitnessRouteHeatmapPyramidClaim } from '@/lib/types/database/fitnessRouteHeatmapTile'

// Taking ownership of an actor's pyramid build. The compare-and-swap and the
// read that confirms it run in one transaction; the row creation and the
// first read before them do not.

// Attempts to get the actor's build-state row created and read back before
// giving up. One is not enough: clearing an actor's heatmaps can delete the row
// between the insert and the read, and `ON CONFLICT DO NOTHING` holds no lock
// to stop it. Three makes that pathological rather than merely unlucky.
const PYRAMID_ROW_CREATE_ATTEMPTS = 3

export const readPyramidRow = (db: Db, actorId: string) =>
  db
    .selectFrom('fitness_route_heatmap_pyramids')
    .selectAll()
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()

export const claimFitnessRouteHeatmapPyramidBuild = async (
  db: Db,
  {
    actorId,
    requestedAt,
    staleBefore,
    resumeBuild
  }: ClaimFitnessRouteHeatmapPyramidBuildParams
): Promise<FitnessRouteHeatmapPyramidClaim> => {
  const currentTime = new Date()

  // Create the row on first use. `doNothing` rather than an update so two
  // concurrent first-time claims do not reset each other's state; whichever
  // insert lost simply reads the winner's row below.
  //
  // Retried, because the insert does NOT guarantee the read that follows
  // finds a row: clearing an actor's heatmaps deletes it, and that delete can
  // land in between. `ON CONFLICT DO NOTHING` takes no lock on the row it
  // conflicts with, so nothing here holds it still. Re-creating is the right
  // answer rather than an error — the row was cleared, and a claim arriving
  // after a clear should build.
  const createAndReadPyramidRow = async () => {
    const insertRow = () =>
      db
        .insertInto('fitness_route_heatmap_pyramids')
        .values(newPyramidRow(actorId, currentTime, currentTime))
        .onConflict((oc) => oc.column('actorId').doNothing())
        .execute()

    for (
      let attempt = 1;
      attempt <= PYRAMID_ROW_CREATE_ATTEMPTS;
      attempt += 1
    ) {
      await insertRow()
      const row = await readPyramidRow(db, actorId)
      if (row) return row
    }
    return null
  }

  const existing = await createAndReadPyramidRow()
  // Only reachable if a clear won every attempt in a row, which means the
  // owner is clearing repeatedly rather than anything being broken. Transient
  // by nature: the caller's next run creates the row uncontended.
  if (!existing) {
    throw new Error(
      `Route heatmap pyramid row for actor ${actorId} was cleared during every claim attempt`
    )
  }

  const pyramid = toFitnessRouteHeatmapPyramid(existing)
  const verdict = classifyPyramidForClaim(
    pyramid,
    requestedAt,
    staleBefore,
    resumeBuild
  )

  if (verdict !== 'claimable') {
    return { claimed: false, resumed: false, reason: verdict, pyramid }
  }

  // Only this build's own continuation may resume it, and only when it got
  // far enough to checkpoint; anything else starts a fresh version so its
  // tiles replace the previous build's rather than adding to them.
  //
  // The token is what makes the difference, not the caller's say-so. A pass
  // that merely declares itself a resume — which every retry of a failed
  // region row does, carrying that row's offset and no pyramid token — can
  // offer no evidence about which activities it will re-present, so letting
  // it keep the version lets it complete a build over the ones it never
  // folded.
  const resumed =
    isOwnContinuation(pyramid, resumeBuild) &&
    pyramid.status === 'generating' &&
    pyramid.cursor !== undefined
  const nextVersion = resumed ? pyramid.version : pyramid.version + 1
  const nextClaimSeq = pyramid.claimSeq + 1

  // The compare-and-swap and the read that confirms it share one transaction.
  // Separately, a failure after the CAS committed — a pool timeout, a reset
  // connection, a statement timeout on the read — left the row stamped
  // `generating` at a token nobody was holding: the caller saw only a throw,
  // so it never learned it had a build, and every claimant for the next
  // staleness window was refused `build-in-progress` while nothing wrote.
  // Rolling the CAS back means a claim either happens and is reported, or
  // does not happen at all.
  const { claimedRows, currentPyramid } = await inTransaction(
    db,
    async (trx) => {
      const result = await applyResumePremiseFilter(
        applyClaimableFilter(
          trx
            .updateTable('fitness_route_heatmap_pyramids')
            .set({
              status: 'generating',
              error: null,
              claimSeq: nextClaimSeq,
              updatedAt: currentTime,
              // A fresh build restarts the tile generation and this run's
              // progress. `totalCount`, `tileCount` and `pointCount` are
              // deliberately left: they describe the tiles still on disk,
              // which stay readable until this build's own numbers replace
              // them at completion.
              ...(resumed
                ? {}
                : {
                    version: nextVersion,
                    scannedCount: 0,
                    activityCount: 0,
                    cursorCreatedAt: null,
                    cursorId: null,
                    completedAt: null
                  })
            })
            .where('actorId', '=', actorId),
          requestedAt,
          staleBefore,
          resumeBuild
        ),
        resumed
      )
        // The compare-and-swap. Guarded on the ownership token, which BOTH
        // branches above move — guarding on `version` would be vacuous for a
        // resume, which leaves the version where it is, so two workers
        // reclaiming the same abandoned build would both be told they own it.
        //
        // The token alone is NOT enough, which is why the same predicate the
        // decision above used is repeated as a WHERE clause. A live owner
        // heartbeats by writing `updatedAt`, and finishes by writing `status`
        // and `completedAt` — none of which move `claimSeq`. So between the
        // read and this statement the owner can invalidate every input to the
        // decision while leaving the token exactly where this CAS expects it:
        // a heartbeat that lands there would let this claim steal a
        // demonstrably live build, and a completion that lands there would let
        // it throw away the very pyramid the request was asking for.
        .where('id', '=', pyramid.id)
        .where('claimSeq', '=', pyramid.claimSeq)
        .executeTakeFirst()

      // Re-read either way. On success it picks up a checkpoint the previous
      // owner committed between this claim's read and its CAS, which a resume
      // needs; on failure it is what says WHY, since the row now holds
      // whatever the winner wrote.
      const current = await readPyramidRow(trx, actorId)
      return {
        claimedRows: Number(result.numUpdatedRows),
        currentPyramid: current ? toFitnessRouteHeatmapPyramid(current) : null
      }
    }
  )

  if (claimedRows === 0) {
    // Re-classify rather than always reporting `lost-race`: losing to a build
    // that COMPLETED is `already-fresh`, and a caller told that serves its
    // request from the finished pyramid instead of giving up. A row that
    // reads as claimable means the state was fine and only the token moved —
    // which is what `lost-race` has always meant.
    const verdictNow = currentPyramid
      ? classifyPyramidForClaim(
          currentPyramid,
          requestedAt,
          staleBefore,
          resumeBuild
        )
      : 'claimable'

    return {
      claimed: false,
      resumed: false,
      reason: verdictNow === 'claimable' ? ('lost-race' as const) : verdictNow,
      pyramid: currentPyramid ?? pyramid
    }
  }

  // A successful CAS holds the row's write lock for the rest of the
  // transaction, so the read above is this pass's own write and the row it
  // names cannot have been deleted or replaced underneath it. `currentPyramid`
  // is therefore never null here; the check is what makes that fact explicit
  // rather than an unchecked spread.
  if (!currentPyramid) {
    return {
      claimed: false,
      resumed: false,
      reason: 'lost-race' as const,
      pyramid
    }
  }

  return {
    claimed: true,
    resumed,
    reason: 'claimed' as const,
    // The token and version reported are the ones THIS compare-and-swap
    // wrote. They agree with the read above only because that read shares the
    // CAS's transaction: taken from a read outside it, a rival claim landing
    // in between would hand this pass the rival's live token, and the fence
    // every later write is checked against would accept both passes — worse
    // than having no fence at all. The read is still what supplies the cursor
    // and the counters, which a resume needs.
    pyramid: {
      ...currentPyramid,
      version: nextVersion,
      claimSeq: nextClaimSeq
    }
  }
}
