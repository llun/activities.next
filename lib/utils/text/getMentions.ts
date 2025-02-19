import { Mention } from '@llun/activities.schema'

import { getWebfingerSelf } from '@/lib/activities/requests/getWebfingerSelf'
import { Actor, getMention, getMentionFromActorID } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import {
  MENTION_GLOBAL_REGEX,
  MentionMatchGroup
} from '@/lib/utils/text/convertMarkdownText'
import { getSpan } from '@/lib/utils/trace'

interface GetMentionsParams {
  text: string
  currentActor: Actor
  replyStatus: Status | null
}
export const getMentions = async ({
  text,
  currentActor,
  replyStatus
}: GetMentionsParams): Promise<Mention[]> => {
  const span = getSpan('link', 'getMentions', {
    text,
    actorId: currentActor.id,
    replyStatusId: replyStatus?.id
  })

  const mentions = await Promise.all(
    Array.from(text.matchAll(MENTION_GLOBAL_REGEX)).map(async (match) => {
      const mention = match.groups as MentionMatchGroup
      try {
        const userHost = mention.domain ?? currentActor.domain
        const actorId = await getWebfingerSelf({
          account: `${mention.username}@${userHost}`
        })
        if (!actorId) return null

        return Mention.parse({
          type: 'Mention',
          href: actorId,
          name: match[0].trim()
        })
      } catch {
        return null
      }
    })
  )

  if (replyStatus) {
    const name = replyStatus.actor
      ? getMention(replyStatus.actor, true)
      : getMentionFromActorID(replyStatus.actorId, true)

    mentions.push({
      type: 'Mention',
      href: replyStatus.actorId,
      name
    })
  }

  const mentionsMap = mentions
    .filter((item): item is Mention => item !== null)
    .reduce(
      (out, item) => {
        out[item.name] = item
        return out
      },
      {} as { [key: string]: Mention }
    )

  span.end()
  return Object.values(mentionsMap)
}
