import { handleQuoteRequest } from '@/lib/actions/handleQuoteRequest'
import { QuoteRequest } from '@/lib/activities/quoteRequest'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { HANDLE_QUOTE_REQUEST_JOB_NAME } from '@/lib/jobs/names'
import { actorMatchesVerifiedSender } from '@/lib/jobs/verifiedSender'
import { JobHandle } from '@/lib/services/queue/type'
import { getOriginalStatus } from '@/lib/types/domain/status'

// Shared-inbox path for FEP-044f QuoteRequests (some servers deliver everything
// to the shared inbox). Resolves the quoted status's local author and defers to
// the same handler the per-user inbox uses.
export const handleQuoteRequestJob: JobHandle = createJobHandle(
  HANDLE_QUOTE_REQUEST_JOB_NAME,
  async (database, message) => {
    const parsed = QuoteRequest.safeParse(message.data)
    if (!parsed.success) return
    const request = parsed.data
    if (!actorMatchesVerifiedSender(request.actor, message)) return

    const quotedStatus = await database.getStatus({
      statusId: request.object,
      withReplies: false
    })
    if (!quotedStatus || !quotedStatus.isLocalActor) return

    const inboxActor = await database.getActorFromId({
      id: getOriginalStatus(quotedStatus).actorId
    })
    if (!inboxActor) return

    await handleQuoteRequest({ database, activity: message.data, inboxActor })
  }
)
