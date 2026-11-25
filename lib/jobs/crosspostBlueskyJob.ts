import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import { crosspostStatus } from '@/lib/services/bluesky/crosspost'
import { JobHandle } from '@/lib/services/queue/type'

const JobData = z.object({ statusId: z.string() })

// Published after a public local post is created, when the author asked for it
// (or their account cross-posts by default). The row is claimed before this is
// queued, so a duplicate job is a no-op.
export const crosspostBlueskyJob: JobHandle = createJobHandle(
  CROSSPOST_BLUESKY_JOB_NAME,
  async (database, message) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) return
    await crosspostStatus(database, parsed.data.statusId)
  }
)
