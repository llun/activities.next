import { getPublicProfileFromHandle } from '../../activities'
import { Mention } from '../../activities/entities/mention'
import { Actor } from '../../models/actor'
import { Status } from '../../models/status'
import { getSpan } from '../trace'
import { MENTION_GLOBAL_REGEX, MentionMatchGroup } from './convertMarkdownText'

interface GetMentionsParams {
  text: string
  currentActor: Actor
  replyStatus?: Status
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
        const person = await getPublicProfileFromHandle(
          `${mention.username}@${userHost}`
        )
        if (!person) return null
        return {
          type: 'Mention',
          href:
            person?.id ?? `https://${mention.domain}/users/${mention.username}`,
          name: match[0].trim()
        } as Mention
      } catch {
        return null
      }
    })
  )

  if (replyStatus) {
    const name = replyStatus.actor
      ? Actor.getMentionFromProfile(replyStatus.actor, true)
      : Actor.getMentionFromId(replyStatus.actorId, true)

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
