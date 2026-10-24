import { z } from 'zod'

import { applyBlock, endFollowsForBlock } from '@/lib/actions/applyBlock'
import { applyMute } from '@/lib/actions/applyMute'
import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import {
  MOVE_RELATIONSHIPS_JOB_NAME,
  SEND_BLOCK_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { JobHandle } from '@/lib/services/queue/type'
import { FollowStatus } from '@/lib/types/domain/follow'
import { actorIdsMatch, normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { withSpan } from '@/lib/utils/trace'

const JobData = z.object({
  actorId: z.string(),
  originActorId: z.string(),
  targetActorId: z.string()
})

const MAX_NOTE_LENGTH = 2000

export const getMoveRelationshipsJobId = (
  actorId: string,
  originActorId: string,
  targetActorId: string
): string =>
  getHashFromString(
    `${actorId}/move-relationships/${originActorId}/${targetActorId}`
  )

export const publishMoveRelationshipsJobs = async ({
  database,
  originActorId,
  targetActorId
}: {
  database: Database
  originActorId: string
  targetActorId: string
}): Promise<number> => {
  const [blockerIds, muterIds, authorIds] = await Promise.all([
    database.getLocalBlockerIds({ targetActorId: originActorId }),
    database.getLocalMuterIds({ targetActorId: originActorId }),
    database.getLocalNoteAuthorIds({ targetActorId: originActorId })
  ])

  const actorIds = [
    ...new Set([...blockerIds, ...muterIds, ...authorIds])
  ].filter((id) => !actorIdsMatch(id, targetActorId))
  let failures = 0

  for (const actorId of actorIds) {
    try {
      await getQueue().publish({
        id: getMoveRelationshipsJobId(actorId, originActorId, targetActorId),
        name: MOVE_RELATIONSHIPS_JOB_NAME,
        data: { actorId, originActorId, targetActorId }
      })
    } catch (error) {
      failures++
      logger.error({
        message: 'Move: failed to queue relationships carryover',
        actorId,
        originActorId,
        targetActorId,
        err: toLoggableError(error)
      })
    }
  }

  return failures
}

/**
 * Mirrors Mastodon MoveWorker's copy_account_notes!, carry_blocks_over!, and
 * carry_mutes_over!. One job is queued per local actor so that the per-account
 * ordering (notes, then blocks, then mutes) is preserved sequentially.
 */
export const moveRelationshipsJob: JobHandle = createJobHandle(
  MOVE_RELATIONSHIPS_JOB_NAME,
  async (database, message) => {
    await withSpan('job', 'moveRelationships', {}, async (span) => {
      const parsed = JobData.safeParse(message.data)
      if (!parsed.success) {
        span.recordException(new Error('Malformed move relationships job data'))
        return
      }

      const actorId = normalizeActorId(parsed.data.actorId)
      const originActorId = normalizeActorId(parsed.data.originActorId)
      const targetActorId = normalizeActorId(parsed.data.targetActorId)

      if (
        !actorId ||
        !originActorId ||
        !targetActorId ||
        actorIdsMatch(actorId, targetActorId)
      ) {
        return
      }

      const [localActor, origin, target] = await Promise.all([
        database.getActorFromId({ id: actorId }),
        database.getActorFromId({ id: originActorId }),
        database.getActorFromId({ id: targetActorId })
      ])

      if (
        !localActor?.privateKey ||
        !origin ||
        !origin.movedTo ||
        !actorIdsMatch(origin.movedTo, targetActorId) ||
        !target ||
        target.deletionStatus
      ) {
        return
      }

      const states = await database.getModerationStatesForActors({
        actorIds: [target.id]
      })
      if (states.get(target.id)?.suspendedAt) {
        return
      }

      const acct = `${origin.username}@${origin.domain}`

      const addAccountNoteIfNeeded = async (comment: string) => {
        const note = await database.getAccountNote({
          actorId,
          targetActorId: target.id
        })
        if (!note) {
          await database.upsertAccountNote({
            actorId,
            targetActorId: target.id,
            comment
          })
        }
      }

      // Step 1: Account Notes (Mastodon copy_account_notes! parity)
      const originNote = await database.getAccountNote({
        actorId,
        targetActorId: origin.id
      })

      if (originNote) {
        const targetNote = await database.getAccountNote({
          actorId,
          targetActorId: target.id
        })
        const copyText = `This user moved from ${acct}, here were your previous notes about them:`
        const notePattern = `${copyText}\n${originNote}`

        if (!targetNote.includes(notePattern)) {
          if (!targetNote) {
            const combined = [copyText, originNote].join('\n')
            if (combined.length <= MAX_NOTE_LENGTH) {
              await database.upsertAccountNote({
                actorId,
                targetActorId: target.id,
                comment: combined
              })
            } else if (originNote.length <= MAX_NOTE_LENGTH) {
              await database.upsertAccountNote({
                actorId,
                targetActorId: target.id,
                comment: originNote
              })
            }
          } else {
            const combined = [copyText, originNote, '\n', targetNote].join('\n')
            if (combined.length <= MAX_NOTE_LENGTH) {
              await database.upsertAccountNote({
                actorId,
                targetActorId: target.id,
                comment: combined
              })
            }
          }
        }
      }

      // Step 2: Block (Mastodon carry_blocks_over! parity)
      if (await database.isBlocking({ actorId, targetActorId: origin.id })) {
        const blockUri = `${actorId}#blocks/${getHashFromString(`${actorId}/move-block/${origin.id}/${target.id}`)}`
        const existingBlock = await database.getBlock({
          actorId,
          targetActorId: target.id
        })
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId,
          targetActorId: target.id
        })
        const isFollowing = follow?.status === FollowStatus.enum.Accepted
        const blockNote = `This user moved from ${acct}, which you had blocked.`

        if (existingBlock?.uri === blockUri) {
          // On resume, repeat the follow-ending half of applyBlock per
          // direction: the target's follow is always ended while the block
          // exists; the user's own follow only if it predates the block (one
          // made after the carried block is left alone). Then re-publish
          // SendBlockJob for a remote target with the deterministic id:
          // deduplicating queues drop it; others send a duplicate Block with
          // the same uri, which remote receivers treat as a no-op.
          const reverseFollow = await database.getAcceptedOrRequestedFollow({
            actorId: target.id,
            targetActorId: actorId
          })
          const followsToEnd = [
            reverseFollow,
            follow && follow.createdAt <= existingBlock.createdAt
              ? follow
              : null
          ].filter(Boolean)
          if (followsToEnd.length > 0) {
            await endFollowsForBlock({ database, follows: followsToEnd })
          }
          if (!target.privateKey) {
            await getQueue().publish({
              id: getHashFromString(blockUri),
              name: SEND_BLOCK_JOB_NAME,
              data: { actorId, targetActorId: target.id, uri: blockUri }
            })
          }
          await addAccountNoteIfNeeded(blockNote)
        } else if (!existingBlock && !isFollowing) {
          const block = await applyBlock({
            database,
            actorId,
            targetActorId: target.id,
            uri: blockUri
          })
          if (!target.privateKey) {
            await getQueue().publish({
              id: getHashFromString(block.uri),
              name: SEND_BLOCK_JOB_NAME,
              data: { actorId, targetActorId: target.id, uri: block.uri }
            })
          }
          await addAccountNoteIfNeeded(blockNote)
        }
      }

      // Step 3: Mute (Mastodon carry_mutes_over! parity)
      const originMute = await database.getMute({
        actorId,
        targetActorId: origin.id
      })

      if (originMute) {
        const targetMute = await database.getMute({
          actorId,
          targetActorId: target.id
        })
        const follow = await database.getAcceptedOrRequestedFollow({
          actorId,
          targetActorId: target.id
        })
        const isFollowing = follow?.status === FollowStatus.enum.Accepted
        const muteNote = `This user moved from ${acct}, which you had muted.`

        if (!targetMute && !isFollowing) {
          await applyMute({
            database,
            actorId,
            targetActorId: target.id,
            notifications: originMute.notifications,
            // Mastodon passes only the notifications flag; the end time is kept so a temporary mute stays temporary.
            endsAt: originMute.endsAt
          })
          await addAccountNoteIfNeeded(muteNote)
        } else if (
          targetMute &&
          !isFollowing &&
          targetMute.notifications === originMute.notifications &&
          targetMute.endsAt === originMute.endsAt
        ) {
          const originSettings = await database.getActorSettings({
            actorId: origin.id
          })
          // updatedAt, not createdAt: createMute re-activates an expired row in place
          // and keeps its old createdAt.
          const moveClaimAt = originSettings?.moveProcessing?.at
          if (
            typeof moveClaimAt === 'number' &&
            targetMute.updatedAt >= moveClaimAt
          ) {
            await addAccountNoteIfNeeded(muteNote)
          }
        }
      }
    })
  }
)
