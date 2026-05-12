import { JobMessage } from '@/lib/services/queue/type'
import { normalizeActorId } from '@/lib/utils/activitypub'

export const actorMatchesVerifiedSender = (
  actorId: string,
  message: JobMessage
) => {
  if (!message.verifiedSenderActorId) return true

  const normalizedActorId = normalizeActorId(actorId)
  const normalizedVerifiedSenderActorId = normalizeActorId(
    message.verifiedSenderActorId
  )

  return (
    Boolean(normalizedActorId) &&
    normalizedActorId === normalizedVerifiedSenderActorId
  )
}
