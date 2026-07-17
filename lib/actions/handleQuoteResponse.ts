import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'

type HandleQuoteResponseParams = {
  database: Database
  // The compacted inbound Accept/Reject activity.
  activity: unknown
}

// Read a bare id or an embedded `{ id }` reference.
const refId = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string'
  ) {
    return (value as { id: string }).id
  }
  return null
}

/**
 * Quoter side of the FEP-044f handshake: match an inbound Accept/Reject against
 * one of our pending outbound QuoteRequests (by `object` == quoteRequestId). On
 * Accept, store the hosted stamp uri (`result`) and re-federate our note so it
 * carries `quoteAuthorization`; on Reject, mark the edge rejected. Returns true
 * when the activity matched a quote (so the caller skips the follow path), false
 * otherwise.
 */
export const handleQuoteResponse = async ({
  database,
  activity
}: HandleQuoteResponseParams): Promise<boolean> => {
  const record = activity as Record<string, unknown>
  const type = record.type
  if (type !== 'Accept' && type !== 'Reject') return false

  const quoteRequestId = refId(record.object)
  if (!quoteRequestId) return false

  const edge = await database.getStatusQuoteByQuoteRequestId({ quoteRequestId })
  if (!edge) return false

  if (type === 'Accept') {
    const stampUri = refId(record.result)
    await database.updateStatusQuoteState({
      statusId: edge.statusId,
      state: 'accepted',
      // Only overwrite the stamp uri when the Accept carries a `result`.
      authorizationUri: stampUri ?? undefined
    })
    // Re-federate the quoting note so it now advertises the stamp.
    const status = await database.getStatus({
      statusId: edge.statusId,
      withReplies: false
    })
    if (status) {
      await getQueue().publish({
        id: getHashFromString(`${edge.statusId}#quote-accepted`),
        name: SEND_UPDATE_NOTE_JOB_NAME,
        data: { actorId: status.actorId, statusId: edge.statusId }
      })
    }
    logger.info({
      message: 'Quote request accepted by remote author',
      statusId: edge.statusId
    })
    return true
  }

  await database.updateStatusQuoteState({
    statusId: edge.statusId,
    state: 'rejected'
  })
  logger.info({
    message: 'Quote request rejected by remote author',
    statusId: edge.statusId
  })
  return true
}
