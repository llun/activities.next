import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME } from '@/lib/jobs/names'
import { JobHandle } from '@/lib/services/queue/type'
import { logger } from '@/lib/utils/logger'

const JobData = z.object({ actorId: z.string() })

// The hosted PDS modules import `@atproto/*`, which the CommonJS queue worker
// cannot load. Hosted accounts are served by the app process, so the worker
// logs and drops the job rather than retrying it.
const COMMONJS_LOAD_ERRORS = new Set([
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
  'ERR_REQUIRE_ESM'
])

// Published after a profile edit of a hosted account, and by the Settings card
// backfill. The sync re-reads the actor and repo, so a duplicate job is a no-op.
export const syncHostedBlueskyProfileJob: JobHandle = createJobHandle(
  SYNC_HOSTED_BLUESKY_PROFILE_JOB_NAME,
  async (database, message) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) return

    let syncHostedBlueskyProfile: (typeof import('@/lib/services/pds/profile'))['syncHostedBlueskyProfile']
    try {
      ;({ syncHostedBlueskyProfile } =
        await import('@/lib/services/pds/profile'))
    } catch (error) {
      if (
        !COMMONJS_LOAD_ERRORS.has((error as { code?: unknown })?.code as string)
      ) {
        throw error
      }
      logger.warn({
        actorId: parsed.data.actorId,
        message:
          'Hosted Bluesky profile sync needs the app process queue; dropping the job in this worker'
      })
      return
    }

    await syncHostedBlueskyProfile(database, parsed.data.actorId)
  }
)
