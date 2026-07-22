import { Database } from '@/lib/database/types'
import { SEND_UPDATE_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import {
  QuoteApprovalPolicy,
  Status,
  StatusType
} from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getSpan } from '@/lib/utils/trace'

interface UpdateStatusInteractionPolicyFromUserInput {
  statusId: string
  currentActor: Actor
  quoteApprovalPolicy: QuoteApprovalPolicy
  publish?: boolean
  status?: Status
  database: Database
}

/**
 * Set who may quote a status (Mastodon `PUT /statuses/:id/interaction_policy`).
 * Author-only. Rewrites `quoteApprovalPolicy` in the content blob WITHOUT
 * recording an edit (no status_history / no `edited_at` bump — see
 * `updateStatusQuoteApprovalPolicy`), then re-federates the note so the
 * advertised `interactionPolicy.canQuote` refreshes. Returns the updated status,
 * or null when the caller is not the local author of a Note/Poll.
 */
export const updateStatusInteractionPolicyFromUserInput = async ({
  statusId,
  currentActor,
  quoteApprovalPolicy,
  publish = true,
  status: preloadedStatus,
  database
}: UpdateStatusInteractionPolicyFromUserInput): Promise<Status | null> => {
  const span = getSpan('actions', 'updateStatusInteractionPolicyFromUser', {
    statusId
  })
  const status = preloadedStatus ?? (await database.getStatus({ statusId }))
  if (
    !status ||
    status.id !== statusId ||
    status.actorId !== currentActor.id ||
    (status.type !== StatusType.enum.Note &&
      status.type !== StatusType.enum.Poll)
  ) {
    span.end()
    return null
  }

  const updatedStatus = await database.updateStatusQuoteApprovalPolicy({
    statusId,
    quoteApprovalPolicy
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  if (publish) {
    await getQueue().publish({
      id: getHashFromString(`${statusId}#interaction-policy`),
      name: SEND_UPDATE_NOTE_JOB_NAME,
      data: { actorId: currentActor.id, statusId }
    })
  }

  span.end()
  return updatedStatus
}
