import { deleteStatus } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { getFederatedStatusDeliveryInboxes } from '@/lib/services/federation/statusDelivery'
import { Actor } from '@/lib/types/domain/actor'
import { getVisibility } from '@/lib/utils/getVisibility'
import { getSpan } from '@/lib/utils/trace'

interface DeleteStatusFromUserInputParams {
  currentActor: Actor
  statusId: string
  database: Database
}
export const deleteStatusFromUserInput = async ({
  currentActor,
  statusId,
  database
}: DeleteStatusFromUserInputParams): Promise<void> => {
  const span = getSpan('actions', 'deleteNote', { statusId })
  const originalStatus = await database.getStatus({
    statusId,
    withReplies: false
  })
  if (!originalStatus) {
    span.end()
    return
  }

  const inboxes = await getFederatedStatusDeliveryInboxes({
    database,
    currentActor,
    status: originalStatus
  })
  const isDirect =
    getVisibility(originalStatus.to, originalStatus.cc) === 'direct'
  await Promise.all(
    inboxes.map((inbox) => {
      return deleteStatus({
        currentActor,
        inbox,
        statusId,
        to: isDirect ? originalStatus.to : undefined,
        cc: isDirect ? originalStatus.cc : undefined
      })
    })
  )
  await database.deleteStatus({ statusId })
  span.end()
}
