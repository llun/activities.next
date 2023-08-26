import { StatusType } from '../models/status'
import { getSpan } from '../trace'
import { MentionTimelineRule, Timeline } from './types'

export const mentionTimelineRule: MentionTimelineRule = async ({
  currentActor,
  status
}) => {
  const span = getSpan('timelines', 'mentionTimelineRule', {
    actorId: currentActor.id,
    statusId: status.id
  })
  if (status.type === StatusType.Announce) {
    span?.finish()
    return null
  }

  if (status.actorId === currentActor.id) {
    span?.finish()
    return Timeline.MENTION
  }

  if (status.text.includes(currentActor.getActorPage())) {
    span?.finish()
    return Timeline.MENTION
  }

  span?.finish()
  return null
}
