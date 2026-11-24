import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { DELETE_BLUESKY_CROSSPOST_JOB_NAME } from '@/lib/jobs/names'
import {
  BlueskyRequestError,
  getBlueskyAgent
} from '@/lib/services/bluesky/agent'
import { isBlueskyAllowed } from '@/lib/services/bluesky/policy'
import { parseAtUri } from '@/lib/services/bluesky/records'
import { JobHandle } from '@/lib/services/queue/type'

const POST_COLLECTION = 'app.bsky.feed.post'

// A missing or malformed uri is refused here, so the job is a no-op for data
// that could never name one of the account's own posts.
export const JobData = z.object({
  actorId: z.string(),
  uri: z
    .string()
    .refine((uri) => parseAtUri(uri)?.collection === POST_COLLECTION, {
      message: 'Not a Bluesky post record uri'
    })
})

// Deletes the Bluesky copy of a local post after the local status is gone.
// Only the linked account's own record is touched; a record already deleted on
// Bluesky (RecordNotFound) is tolerated.
export const deleteBlueskyCrosspostJob: JobHandle = createJobHandle(
  DELETE_BLUESKY_CROSSPOST_JOB_NAME,
  async (database, message) => {
    const parsed = JobData.safeParse(message.data)
    if (!parsed.success) return
    const { actorId, uri } = parsed.data
    const at = parseAtUri(uri)
    if (!at || at.collection !== POST_COLLECTION) return

    const account = await database.getBlueskyAccount({ actorId })
    if (!account || account.did !== at.did) return
    if (!(await isBlueskyAllowed(database))) return

    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) return
    const agent = await getBlueskyAgent(database, actor)
    if (!agent) return

    try {
      await agent.post('com.atproto.repo.deleteRecord', {
        repo: at.did,
        collection: at.collection,
        rkey: at.rkey
      })
    } catch (error) {
      if (
        !(error instanceof BlueskyRequestError) ||
        error.error !== 'RecordNotFound'
      ) {
        throw error
      }
    }
  }
)
