import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SYNC_BLUESKY_HOME_JOB_NAME } from '@/lib/jobs/names'
import { syncBlueskyHome } from '@/lib/services/bluesky/sync'
import {
  isActorConfirmationPending,
  isActorModerationBlocked
} from '@/lib/services/guards/accountState'
import { JobHandle } from '@/lib/services/queue/type'

const JobData = z.object({ actorId: z.string() })

// Published by the Bluesky sync sweep and right after an account is linked.
export const syncBlueskyHomeJob: JobHandle = createJobHandle(
  SYNC_BLUESKY_HOME_JOB_NAME,
  async (database, message) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) return
    const actor = await database.getActorFromId({ id: parsed.data.actorId })
    // Unlinked (or the actor is gone) since the job was published, or the
    // actor may no longer act: listBlueskyAccountsToSync's rules, again.
    if (
      !actor ||
      isActorModerationBlocked(actor) ||
      isActorConfirmationPending(actor) ||
      actor.deletionStatus ||
      !(await database.getBlueskyAccount({ actorId: actor.id }))
    ) {
      return
    }
    await syncBlueskyHome(database, actor)
  }
)
